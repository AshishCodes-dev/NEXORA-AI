const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const { recordEvent, EVENT_TYPES } = require('./missionEventService');
const { recordStageTransition, computeMissionMetrics } = require('./telemetry/telemetryService');
const { executeMission } = require('../orchestrator/missionOrchestrator');
const { LEASE_DURATION_MS } = require('../orchestrator/taskExecutor');

const MAX_TASK_RETRIES = 2;

/**
 * Helper to determine if an error represents a cluster-level database connectivity outage
 * rather than an isolated, recoverable document-level error.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isDatabaseOutage(err) {
  if (mongoose.connection && mongoose.connection.readyState !== 1) {
    return true;
  }
  if (!err) return false;
  if (
    err.name === 'MongoServerSelectionError' ||
    err.name === 'MongoNetworkError' ||
    err.name === 'MongoNetworkTimeoutError' ||
    err.name === 'MongoTopologyClosedError' ||
    err.name === 'MongoNotConnectedError'
  ) {
    return true;
  }
  if (
    typeof err.message === 'string' &&
    /topology was destroyed|connection closed|client is closed|server selection timed out|ECONNREFUSED|ENOTFOUND/i.test(err.message)
  ) {
    return true;
  }
  return false;
}

/**
 * Reconciles tasks whose worker leases have expired.
 *
 * Safety invariants:
 * 1. Only tasks with status 'running' and heartbeatAt older than lease threshold are eligible.
 * 2. Uses conditional findOneAndUpdate CAS matching status, generation, claimedBy, and heartbeatAt.
 * 3. Exactly one concurrent recovery worker wins the CAS.
 * 4. Advances generation so old workers are strictly fenced on wake-up.
 * 5. Respects MAX_TASK_RETRIES (2):
 *    - attempt < 2: reset to 'pending' with generation + 1 and attempt + 1.
 *    - attempt >= 2: transition to 'failed' with generation + 1 to prevent infinite crash loops.
 * 6. Conservative on invalid/missing metadata: tasks lacking valid generation are not blindly requeued.
 *
 * @param {object} [options={}]
 * @param {number} [options.leaseDurationMs] - Custom lease duration (defaults to LEASE_DURATION_MS = 25000)
 * @param {mongoose.Types.ObjectId|string} [options.missionId] - Optional scope to specific mission
 * @returns {Promise<{reclaimedToPending: number, failedExhausted: number, skippedActive: number, invalidSkipped: number, errors: number}>}
 */
async function reconcileStaleTasks(options = {}) {
  const leaseDurationMs = typeof options.leaseDurationMs === 'number' && options.leaseDurationMs > 0
    ? options.leaseDurationMs
    : LEASE_DURATION_MS;

  const nowMs = Date.now();
  const staleThreshold = new Date(nowMs - leaseDurationMs);

  const query = {
    status: 'running',
  };
  if (options.missionId) {
    query.missionId = options.missionId;
  }

  const runningTasks = await MissionTask.find(query);

  const stats = {
    reclaimedToPending: 0,
    failedExhausted: 0,
    skippedActive: 0,
    invalidSkipped: 0,
    invalidFailed: 0,
    errors: 0,
  };

  for (const task of runningTasks) {
    if (stopRequested && isPeriodicSweepRunning) {
      console.log('[MISSION RECOVERY] Stop requested; aborting stale tasks sweep.');
      break;
    }
    try {
      const meta = task.executionMetadata || {};
    const heartbeatAt = meta.heartbeatAt ? new Date(meta.heartbeatAt) : null;
    const claimedAt = meta.claimedAt ? new Date(meta.claimedAt) : null;
    const currentGeneration = meta.generation;
    const currentWorkerId = meta.claimedBy;
    const currentAttempt = typeof meta.attempt === 'number' ? meta.attempt : 1;

    // Check if task has valid, fenceable worker ownership metadata
    const hasValidOwnership = typeof currentGeneration === 'number' && typeof currentWorkerId === 'string' && currentWorkerId.length > 0;

    // Determine effective timestamp for lease evaluation
    // Preference: heartbeatAt -> claimedAt -> updatedAt -> createdAt
    let effectiveTimestamp = null;
    if (heartbeatAt && !Number.isNaN(heartbeatAt.getTime())) {
      effectiveTimestamp = heartbeatAt;
    } else if (claimedAt && !Number.isNaN(claimedAt.getTime())) {
      effectiveTimestamp = claimedAt;
    } else if (task.updatedAt && !Number.isNaN(new Date(task.updatedAt).getTime())) {
      effectiveTimestamp = new Date(task.updatedAt);
    } else if (task.createdAt && !Number.isNaN(new Date(task.createdAt).getTime())) {
      effectiveTimestamp = new Date(task.createdAt);
    }

    // Conservative check: If timestamp indicates the task was active recently (< leaseDurationMs),
    // an active worker may still own it! Never fail or reclaim an active task based on malformed metadata.
    if (effectiveTimestamp && effectiveTimestamp.getTime() > staleThreshold.getTime()) {
      stats.skippedActive++;
      continue;
    }

    // The lease is expired or unverifiable!
    // If ownership metadata is invalid or missing, we cannot safely fence worker ownership to reclaim to pending.
    // Instead of leaving it in 'running' (which deadlocks the orchestrator in-flight guard), fail it safely via atomic status CAS.
    if (!hasValidOwnership) {
      const baseMetadata = (task.executionMetadata && typeof task.executionMetadata === 'object')
        ? { ...task.executionMetadata }
        : {};
      baseMetadata.claimedBy = null;
      baseMetadata.heartbeatAt = null;
      baseMetadata.reclaimedAt = new Date();

      // Optimistic concurrency control (OCC): match observed updatedAt to prevent overwriting
      // a task document that changed after the scanner read it.
      const observedUpdatedAt = task.updatedAt ? new Date(task.updatedAt) : null;
      const invalidCasFilter = {
        _id: task._id,
        status: 'running',
        updatedAt: (observedUpdatedAt && !Number.isNaN(observedUpdatedAt.getTime()))
          ? observedUpdatedAt
          : null,
      };

      if (typeof options.__barrierBeforeInvalidFailureCas === 'function') {
        await options.__barrierBeforeInvalidFailureCas(task);
      }

      const failed = await MissionTask.findOneAndUpdate(
        invalidCasFilter,
        {
          $set: {
            status: 'failed',
            error: 'Task has missing or invalid worker ownership metadata; failed safely during recovery.',
            executionMetadata: baseMetadata,
          },
        },
        { returnDocument: 'after' }
      );

      if (failed) {
        stats.invalidFailed++;
        await recordEvent({
          missionId: task.missionId,
          taskId: task._id,
          type: EVENT_TYPES.TASK_FAILED,
          reason: 'Task has missing or invalid worker ownership metadata; failed safely during recovery.',
          action: 'Mark task failed on invalid ownership metadata',
          outcome: 'failed',
          metadata: {
            previousWorker: currentWorkerId || null,
            attempt: currentAttempt,
            recovery: true,
            invalidMetadata: true,
          },
        }).catch(() => {});
      }
      continue;
    }

    // Task lease is expired! Build single-winner atomic CAS filter
    const casFilter = {
      _id: task._id,
      status: 'running',
      'executionMetadata.generation': currentGeneration,
      'executionMetadata.claimedBy': currentWorkerId,
    };
    if (heartbeatAt) {
      casFilter['executionMetadata.heartbeatAt'] = heartbeatAt;
    }

    if (currentAttempt < MAX_TASK_RETRIES) {
      // Reclaim to pending for retry
      const reclaimed = await MissionTask.findOneAndUpdate(
        casFilter,
        {
          $set: {
            status: 'pending',
            'executionMetadata.claimedBy': null,
            'executionMetadata.heartbeatAt': null,
            'executionMetadata.reclaimedAt': new Date(),
          },
          $inc: {
            'executionMetadata.generation': 1,
            'executionMetadata.attempt': 1,
          },
        },
        { returnDocument: 'after' }
      );

      if (reclaimed) {
        stats.reclaimedToPending++;
        await recordEvent({
          missionId: task.missionId,
          taskId: task._id,
          type: EVENT_TYPES.TASK_RETRY_STARTED,
          action: `Reclaimed stale task after lease expiry for retry attempt ${currentAttempt + 1}`,
          outcome: 'retrying',
          metadata: {
            previousWorker: currentWorkerId,
            attempt: currentAttempt + 1,
            generation: currentGeneration + 1,
            recovery: true,
          },
        }).catch(() => {});
      }
    } else {
      // Retry budget exhausted -> transition to failed to prevent infinite crash loops
      const failed = await MissionTask.findOneAndUpdate(
        casFilter,
        {
          $set: {
            status: 'failed',
            error: 'Task execution lease expired; retry budget exhausted.',
            'executionMetadata.claimedBy': null,
            'executionMetadata.heartbeatAt': null,
            'executionMetadata.reclaimedAt': new Date(),
          },
          $inc: {
            'executionMetadata.generation': 1,
          },
        },
        { returnDocument: 'after' }
      );

      if (failed) {
        stats.failedExhausted++;
        await recordEvent({
          missionId: task.missionId,
          taskId: task._id,
          type: EVENT_TYPES.TASK_FAILED,
          reason: 'Task execution lease expired; retry budget exhausted.',
          action: 'Mark task failed on lease expiry',
          outcome: 'failed',
          metadata: {
            previousWorker: currentWorkerId,
            attempt: currentAttempt,
            generation: currentGeneration + 1,
            recovery: true,
          },
        }).catch(() => {});
      }
    }
    } catch (taskErr) {
      if (isDatabaseOutage(taskErr)) {
        throw taskErr;
      }
      stats.errors++;
      console.error(`[MISSION RECOVERY] Recoverable error reconciling stale task ${task._id}:`, taskErr.message);
    }
  }

  return stats;
}

/**
 * Reconciles pending and queued tasks belonging to terminal failed missions,
 * including missions interrupted during cancellation.
 *
 * Safety invariants:
 * 1. Only tasks with status 'pending' or 'queued' are eligible.
 * 2. Never modifies completed tasks (status: 'completed' tasks are untouched).
 * 3. Never overwrites active/running task ownership (status: 'running' tasks are untouched
 *    by this rule; their lifecycle is governed by worker fencing and lease expiry).
 * 4. Checks that the parent mission is in terminal 'failed' status before mutating.
 * 5. Uses atomic conditional findOneAndUpdate CAS matching _id and status: { $in: ['pending', 'queued'] }
 *    to ensure single-winner idempotency and prevent races with concurrent worker claims.
 * 6. Records canonical TASK_FAILED events for reconciled tasks.
 * 7. Idempotent: safe to run repeatedly across periodic sweeps with zero duplicate mutations or events.
 * 8. Outage-aware: genuine database outages are re-thrown; per-task errors are logged without halting the sweep.
 *
 * @param {object} [options={}]
 * @param {mongoose.Types.ObjectId|string} [options.missionId] - Optional scope to specific mission
 * @returns {Promise<{reconciledToFailed: number, reconciledCount: number, skippedActive: number, errors: number}>}
 */
async function reconcileTerminalMissionTasks(options = {}) {
  const stats = {
    reconciledToFailed: 0,
    reconciledCount: 0,
    skippedActive: 0,
    errors: 0,
  };

  const taskQuery = {
    status: { $in: ['pending', 'queued'] },
  };
  if (options.missionId) {
    taskQuery.missionId = options.missionId;
  }

  let candidateTasks;
  try {
    candidateTasks = await MissionTask.find(taskQuery);
  } catch (err) {
    if (isDatabaseOutage(err)) throw err;
    console.error('[MISSION RECOVERY] Error querying pending/queued tasks:', err.message);
    stats.errors++;
    return stats;
  }

  if (!candidateTasks || candidateTasks.length === 0) {
    if (options.missionId) {
      try {
        const runningCount = await MissionTask.countDocuments({
          missionId: options.missionId,
          status: 'running',
        });
        stats.skippedActive = runningCount;
      } catch (err) {
        if (isDatabaseOutage(err)) throw err;
      }
    }
    return stats;
  }

  // Find distinct candidate mission IDs
  const candidateMissionIds = [...new Set(candidateTasks.map((t) => t.missionId.toString()))];

  let failedMissions;
  try {
    failedMissions = await Mission.find({
      _id: { $in: candidateMissionIds },
      status: 'failed',
    }).select('_id');
  } catch (err) {
    if (isDatabaseOutage(err)) throw err;
    console.error('[MISSION RECOVERY] Error querying failed missions for terminal tasks:', err.message);
    stats.errors++;
    return stats;
  }

  const failedMissionIdSet = new Set(failedMissions.map((m) => m._id.toString()));

  // Count active running tasks belonging to failed missions to report skippedActive
  if (failedMissionIdSet.size > 0) {
    try {
      const runningCount = await MissionTask.countDocuments({
        missionId: { $in: Array.from(failedMissionIdSet) },
        status: 'running',
      });
      stats.skippedActive = runningCount;
    } catch (err) {
      if (isDatabaseOutage(err)) throw err;
    }
  }

  for (const task of candidateTasks) {
    if (stopRequested && isPeriodicSweepRunning) {
      console.log('[MISSION RECOVERY] Stop requested; aborting terminal mission tasks sweep.');
      break;
    }

    // Only process tasks whose parent mission is confirmed to be in terminal 'failed' status
    if (!failedMissionIdSet.has(task.missionId.toString())) {
      continue;
    }

    try {
      // Test hook: injected error for error isolation testing
      if (typeof options.__injectedTerminalTaskError === 'function') {
        await options.__injectedTerminalTaskError(task);
      }

      // Atomic status CAS: ensure status is STILL 'pending' or 'queued'
      // If a concurrent worker claimed this task (status changed to 'running') or completed it,
      // this CAS matches 0 documents and leaves worker ownership untouched.
      const reconciled = await MissionTask.findOneAndUpdate(
        {
          _id: task._id,
          status: { $in: ['pending', 'queued'] },
        },
        {
          $set: {
            status: 'failed',
            error: 'Mission is in terminal failed state; task reconciled during recovery.',
          },
        },
        { returnDocument: 'after' }
      );

      if (reconciled) {
        stats.reconciledToFailed++;
        stats.reconciledCount++;

        await recordEvent({
          missionId: task.missionId,
          taskId: task._id,
          type: EVENT_TYPES.TASK_FAILED,
          reason: 'Mission is in terminal failed state; task reconciled during recovery.',
          action: 'Reconcile orphaned pending task under terminal failed mission',
          outcome: 'failed',
          metadata: {
            recovery: true,
            terminalMissionRecovery: true,
            previousStatus: task.status,
          },
        }).catch(() => {});
      }
    } catch (taskErr) {
      if (isDatabaseOutage(taskErr)) {
        throw taskErr;
      }
      stats.errors++;
      console.error(`[MISSION RECOVERY] Recoverable error reconciling terminal mission task ${task._id}:`, taskErr.message);
    }
  }

  return stats;
}

/**
 * Reconciles abandoned running missions.
 *
 * Safety invariants:
 * 1. Never alters completed or failed missions.
 * 2. If deadlineAt is missing or invalid: transitions to failed safely.
 * 3. If deadlineAt is expired (<= now): transitions to failed through status CAS; does not resume tasks.
 * 4. If deadlineAt is valid and unexpired:
 *    - Confirms no active worker lease remains on any running task.
 *    - Reconciles stale tasks on this mission first.
 *    - If unblocked, safely triggers executeMission to resume sequential pipeline.
 *
 * @param {object} [options={}]
 * @param {number} [options.leaseDurationMs]
 * @param {boolean} [options.executeSync=false] - Awaits executeMission synchronously if true (useful for tests)
 * @param {object} [options.missionOptions={}] - Optional options forwarded to executeMission
 * @returns {Promise<{failedExpired: number, failedInvalidDeadline: number, resumed: number, skippedActive: number}>}
 */
async function reconcileAbandonedMissions(options = {}) {
  const leaseDurationMs = typeof options.leaseDurationMs === 'number' && options.leaseDurationMs > 0
    ? options.leaseDurationMs
    : LEASE_DURATION_MS;

  const nowMs = Date.now();
  const query = { status: 'running' };
  if (options.missionId) {
    query._id = options.missionId;
  }
  const runningMissions = await Mission.find(query);

  const stats = {
    failedExpired: 0,
    failedInvalidDeadline: 0,
    resumed: 0,
    skippedActive: 0,
    errors: 0,
  };

  for (const mission of runningMissions) {
    if (stopRequested && isPeriodicSweepRunning) {
      console.log('[MISSION RECOVERY] Stop requested; aborting abandoned missions sweep.');
      break;
    }
    try {
      // 1. Missing or invalid deadlineAt: Fail safe without granting a new budget
    if (!mission.deadlineAt || Number.isNaN(new Date(mission.deadlineAt).getTime())) {
      const failed = await Mission.findOneAndUpdate(
        { _id: mission._id, status: 'running' },
        { $set: { status: 'failed' } },
        { returnDocument: 'after' }
      );
      if (failed) {
        stats.failedInvalidDeadline++;
        const failureReason = 'Mission running with missing or invalid deadlineAt; failed safely during recovery.';
        await recordStageTransition(mission._id, {
          stage: 'failed',
          status: 'failed',
          metadata: { error: failureReason },
        }).catch((err) => {
          console.warn(`[MISSION RECOVERY] Failed to record stage transition for mission ${mission._id}:`, err.message);
        });
        await computeMissionMetrics(mission._id).catch((err) => {
          console.warn(`[MISSION RECOVERY] Failed to compute metrics for mission ${mission._id}:`, err.message);
        });
        await recordEvent({
          missionId: mission._id,
          userId: mission.userId,
          type: EVENT_TYPES.MISSION_FAILED,
          reason: failureReason,
          action: 'Mark mission failed on missing deadline',
          outcome: 'failed',
        }).catch((err) => {
          console.warn(`[MISSION RECOVERY] Failed to record failure event for mission ${mission._id}:`, err.message);
        });
      }
      continue;
    }

    // 2. Expired deadlineAt: Transition to failed safely
    const deadlineMs = new Date(mission.deadlineAt).getTime();
    if (deadlineMs <= nowMs) {
      const failed = await Mission.findOneAndUpdate(
        { _id: mission._id, status: 'running' },
        { $set: { status: 'failed' } },
        { returnDocument: 'after' }
      );
      if (failed) {
        stats.failedExpired++;
        const failureReason = `Mission execution deadline exceeded (${new Date(deadlineMs).toISOString()}) during recovery.`;
        await recordStageTransition(mission._id, {
          stage: 'failed',
          status: 'failed',
          metadata: { error: failureReason },
        }).catch((err) => {
          console.warn(`[MISSION RECOVERY] Failed to record stage transition for mission ${mission._id}:`, err.message);
        });
        await computeMissionMetrics(mission._id).catch((err) => {
          console.warn(`[MISSION RECOVERY] Failed to compute metrics for mission ${mission._id}:`, err.message);
        });
        await recordEvent({
          missionId: mission._id,
          userId: mission.userId,
          type: EVENT_TYPES.MISSION_FAILED,
          reason: failureReason,
          action: 'Mark mission failed on deadline expiry',
          outcome: 'failed',
        }).catch((err) => {
          console.warn(`[MISSION RECOVERY] Failed to record failure event for mission ${mission._id}:`, err.message);
        });
      }
      continue;
    }

    // 3. Unexpired mission:
    // First, reconcile any stale tasks specifically for this mission
    await reconcileStaleTasks({
      ...options,
      leaseDurationMs,
      missionId: mission._id,
    });

    // Check if any task still has an active (non-stale) lease
    const staleThreshold = new Date(nowMs - leaseDurationMs);
    const activeTask = await MissionTask.findOne({
      missionId: mission._id,
      status: 'running',
      'executionMetadata.heartbeatAt': { $gt: staleThreshold },
    });

    if (activeTask) {
      // Active worker is alive; do not interfere
      stats.skippedActive++;
      continue;
    }

    // Check if pipeline has pending tasks, failed tasks, or all tasks completed
    const hasPendingTasks = await MissionTask.exists({
      missionId: mission._id,
      status: 'pending',
    });

    const hasFailedPriorTasks = await MissionTask.exists({
      missionId: mission._id,
      status: 'failed',
    });

    const hasTasks = await MissionTask.exists({
      missionId: mission._id,
    });

    const hasIncompleteTasks = await MissionTask.exists({
      missionId: mission._id,
      status: { $ne: 'completed' },
    });

    const allTasksCompleted = Boolean(hasTasks && !hasIncompleteTasks);

    // If a task failed without retry, orchestrator will cleanly fail the mission when executed.
    // If all tasks completed, orchestrator will atomically finalize the mission as completed.
    if (hasPendingTasks || hasFailedPriorTasks || allTasksCompleted) {
      if (stopRequested && isPeriodicSweepRunning) {
        console.log(`[MISSION RECOVERY] Stop requested; skipping resumption of mission ${mission._id}.`);
        break;
      }
      stats.resumed++;
      if (options.executeSync) {
        await executeMission(mission._id, options.missionOptions || {});
      } else {
        setImmediate(() => {
          if (stopRequested) return;
          executeMission(mission._id, options.missionOptions || {}).catch((err) => {
            console.error(`[MISSION RECOVERY] Error resuming mission ${mission._id}:`, err.message);
          });
        });
      }
    }
    } catch (missionErr) {
      if (isDatabaseOutage(missionErr)) {
        throw missionErr;
      }
      stats.errors++;
      console.error(`[MISSION RECOVERY] Recoverable error reconciling abandoned mission ${mission._id}:`, missionErr.message);
    }
  }

  return stats;
}

/**
 * Runs coordinated crash recovery and stale worker reconciliation.
 * Reconciles stale tasks first, then reconciles abandoned missions.
 *
 * Bounded with optional timeoutMs to prevent hanging server startup.
 *
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=10000] - Maximum duration in ms before timing out
 * @returns {Promise<{tasks: object, terminalTasks?: object, missions: object}>}
 */
async function runStartupRecovery(options = {}) {
  const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : 10000;

  const recoveryWork = async () => {
    console.log('[STARTUP RECOVERY] Starting crash recovery & stale worker reconciliation...');
    const taskStats = await reconcileStaleTasks(options);
    console.log(`[STARTUP RECOVERY] Stale tasks: ${taskStats.reclaimedToPending} reclaimed to pending, ${taskStats.failedExhausted} failed (exhausted), ${taskStats.invalidFailed || 0} invalid failed, ${taskStats.skippedActive} active skipped.`);

    const terminalStats = await reconcileTerminalMissionTasks(options);
    console.log(`[STARTUP RECOVERY] Terminal mission tasks: ${terminalStats.reconciledToFailed} reconciled to failed, ${terminalStats.skippedActive} active skipped.`);

    const missionStats = await reconcileAbandonedMissions(options);
    console.log(`[STARTUP RECOVERY] Abandoned missions: ${missionStats.failedExpired} expired, ${missionStats.failedInvalidDeadline} invalid deadline, ${missionStats.resumed} resumed, ${missionStats.skippedActive} active skipped.`);

    return {
      tasks: taskStats,
      terminalTasks: terminalStats,
      missions: missionStats,
    };
  };

  if (timeoutMs > 0) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Startup recovery timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([recoveryWork(), timeoutPromise]);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  return await recoveryWork();
}

let periodicTimer = null;
let isPeriodicSweepRunning = false;
let currentSweepPromise = null;
let stopRequested = false;

/**
 * Starts a periodic background recovery sweeper.
 *
 * Safety invariants:
 * 1. Default interval is 30,000ms; validated to be a positive number.
 * 2. Idempotent: repeated calls do not create duplicate timers.
 * 3. In-flight guard: overlapping sweeps are prevented; a tick yields if a sweep is already in progress.
 * 4. DB outage awareness: skips tight polling if database connection is not ready.
 *
 * @param {object} [options={}]
 * @param {number} [options.intervalMs=30000] - Interval between recovery sweeps in ms
 * @param {object} [options.recoveryOptions={}] - Options forwarded to reconcile functions
 * @param {boolean} [options.unref=true] - Whether to unref the timer
 * @returns {boolean} True if started, false if already running
 */
function startPeriodicRecovery(options = {}) {
  const intervalMs = (typeof options.intervalMs === 'number' && options.intervalMs > 0)
    ? options.intervalMs
    : 30000;

  if (periodicTimer) {
    // Already active; idempotent no-op
    return false;
  }

  stopRequested = false;

  const runSweep = async () => {
    if (stopRequested) return;
    if (isPeriodicSweepRunning) {
      console.log('[PERIODIC RECOVERY] Prior sweep still in progress; skipping tick.');
      return;
    }

    if (mongoose.connection && mongoose.connection.readyState !== 1) {
      console.warn('[PERIODIC RECOVERY] Database not connected; skipping sweep.');
      return;
    }

    isPeriodicSweepRunning = true;
    try {
      currentSweepPromise = (async () => {
        const recoveryOpts = options.recoveryOptions || {};
        const taskStats = await reconcileStaleTasks(recoveryOpts);
        if (stopRequested) return { tasks: taskStats, missions: { resumed: 0 } };
        const terminalStats = await reconcileTerminalMissionTasks(recoveryOpts);
        if (stopRequested) return { tasks: taskStats, terminalTasks: terminalStats, missions: { resumed: 0 } };
        const missionStats = await reconcileAbandonedMissions(recoveryOpts);
        return { tasks: taskStats, terminalTasks: terminalStats, missions: missionStats };
      })();
      await currentSweepPromise;
    } catch (sweepErr) {
      console.error('[PERIODIC RECOVERY] Error during background sweep:', sweepErr.message);
    } finally {
      isPeriodicSweepRunning = false;
      currentSweepPromise = null;
    }
  };

  periodicTimer = setInterval(runSweep, intervalMs);
  if (periodicTimer.unref && options.unref !== false) {
    periodicTimer.unref();
  }

  return true;
}

/**
 * Stops the periodic background recovery sweeper cleanly.
 *
 * Safety invariants:
 * 1. Clears interval timer immediately to prevent future ticks.
 * 2. If a sweep is currently in flight, awaits it up to bounded timeoutMs.
 * 3. Idempotent: safe to call multiple times.
 *
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=5000] - Maximum duration in ms to wait for in-flight sweep
 * @returns {Promise<{stopped: boolean, inFlightDrained: boolean}>}
 */
async function stopPeriodicRecovery(options = {}) {
  stopRequested = true;

  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }

  const timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs >= 0)
    ? options.timeoutMs
    : 5000;

  let inFlightDrained = true;

  try {
    if (currentSweepPromise && timeoutMs > 0) {
      let timer;
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[PERIODIC RECOVERY] In-flight sweep did not settle within ${timeoutMs}ms timeout.`);
          inFlightDrained = false;
          resolve();
        }, timeoutMs);
      });

      try {
        await Promise.race([
          currentSweepPromise.catch(() => {}),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      stopped: true,
      inFlightDrained,
    };
  } finally {
    if (!isPeriodicSweepRunning) {
      stopRequested = false;
    }
  }
}

function getPeriodicRecoveryState() {
  return {
    isActive: Boolean(periodicTimer),
    isSweepRunning: isPeriodicSweepRunning,
  };
}

module.exports = {
  reconcileStaleTasks,
  reconcileAbandonedMissions,
  reconcileTerminalMissionTasks,
  runStartupRecovery,
  startPeriodicRecovery,
  stopPeriodicRecovery,
  getPeriodicRecoveryState,
  isDatabaseOutage,
  MAX_TASK_RETRIES,
  LEASE_DURATION_MS,
};
