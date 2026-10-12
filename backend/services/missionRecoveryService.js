const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const { recordEvent, EVENT_TYPES } = require('./missionEventService');
const { executeMission } = require('../orchestrator/missionOrchestrator');
const { LEASE_DURATION_MS } = require('../orchestrator/taskExecutor');

const MAX_TASK_RETRIES = 2;

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
 * @returns {Promise<{reclaimedToPending: number, failedExhausted: number, skippedActive: number, invalidSkipped: number}>}
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
  };

  for (const task of runningTasks) {
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
  };

  for (const mission of runningMissions) {
    // 1. Missing or invalid deadlineAt: Fail safe without granting a new budget
    if (!mission.deadlineAt || Number.isNaN(new Date(mission.deadlineAt).getTime())) {
      const failed = await Mission.findOneAndUpdate(
        { _id: mission._id, status: 'running' },
        { $set: { status: 'failed' } },
        { returnDocument: 'after' }
      );
      if (failed) {
        stats.failedInvalidDeadline++;
        await recordEvent({
          missionId: mission._id,
          userId: mission.userId,
          type: EVENT_TYPES.MISSION_FAILED,
          reason: 'Mission running with missing or invalid deadlineAt; failed safely during recovery.',
          action: 'Mark mission failed on missing deadline',
          outcome: 'failed',
        }).catch(() => {});
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
        await recordEvent({
          missionId: mission._id,
          userId: mission.userId,
          type: EVENT_TYPES.MISSION_FAILED,
          reason: `Mission execution deadline exceeded (${new Date(deadlineMs).toISOString()}) during recovery.`,
          action: 'Mark mission failed on deadline expiry',
          outcome: 'failed',
        }).catch(() => {});
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

    // Check if pipeline has pending tasks or can proceed to finalization
    const hasPendingTasks = await MissionTask.exists({
      missionId: mission._id,
      status: 'pending',
    });

    const hasFailedPriorTasks = await MissionTask.exists({
      missionId: mission._id,
      status: 'failed',
    });

    // If a task failed without retry, orchestrator will cleanly fail the mission when executed
    if (hasPendingTasks || hasFailedPriorTasks) {
      stats.resumed++;
      if (options.executeSync) {
        await executeMission(mission._id, options.missionOptions || {});
      } else {
        setImmediate(() => {
          executeMission(mission._id, options.missionOptions || {}).catch((err) => {
            console.error(`[MISSION RECOVERY] Error resuming mission ${mission._id}:`, err.message);
          });
        });
      }
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
 * @returns {Promise<{tasks: object, missions: object}>}
 */
async function runStartupRecovery(options = {}) {
  const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : 10000;

  const recoveryWork = async () => {
    console.log('[STARTUP RECOVERY] Starting crash recovery & stale worker reconciliation...');
    const taskStats = await reconcileStaleTasks(options);
    console.log(`[STARTUP RECOVERY] Stale tasks: ${taskStats.reclaimedToPending} reclaimed to pending, ${taskStats.failedExhausted} failed (exhausted), ${taskStats.invalidFailed || 0} invalid failed, ${taskStats.skippedActive} active skipped.`);

    const missionStats = await reconcileAbandonedMissions(options);
    console.log(`[STARTUP RECOVERY] Abandoned missions: ${missionStats.failedExpired} expired, ${missionStats.failedInvalidDeadline} invalid deadline, ${missionStats.resumed} resumed, ${missionStats.skippedActive} active skipped.`);

    return {
      tasks: taskStats,
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

module.exports = {
  reconcileStaleTasks,
  reconcileAbandonedMissions,
  runStartupRecovery,
  MAX_TASK_RETRIES,
  LEASE_DURATION_MS,
};
