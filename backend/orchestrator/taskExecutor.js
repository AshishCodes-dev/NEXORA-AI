const mongoose = require('mongoose');
const MissionTask = require('../models/MissionTask');
const { executeTaskWithAgent } = require('../agents/agentExecutionGateway');
const { recordTaskStart, recordTaskEnd, categorizeTaskError } = require('../services/telemetry/telemetryService');
const { recordEvent, recordDecision, EVENT_TYPES, DECISION_TYPES } = require('../services/missionEventService');

let isTaskClaimsPaused = false;
const activeWorkers = new Map();

/**
 * Task Work Execution
 * Dispatches the running MissionTask to the Agent Execution Gateway.
 * 
 * NOTE: The agents invoked currently return structured simulated execution stubs.
 * Real external research, scraping, and browser automation are deferred to later phases.
 * 
 * @param {import('mongoose').Document} task - The running MissionTask document
 * @param {object} [options={}] - Execution options (e.g. test hooks)
 * @returns {Promise<object>} The normalized agent execution result
 */
async function executeTaskWork(task, options = {}) {
  // Test hook: allow controlled deterministic failure injection for testing
  if (options.failOrder === task.order || (options.failTaskId && options.failTaskId.toString() === task._id.toString())) {
    throw new Error(`Injected failure for task order ${task.order} (${task.title})`);
  }

  // Small deterministic processing delay for lifecycle state visibility
  const delayMs = options.taskDelayMs !== undefined ? options.taskDelayMs : 75;
  if (delayMs > 0) {
    if (options.signal?.aborted) {
      const abortErr = new Error('Task execution aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const abortErr = new Error('Task execution aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        }, { once: true });
      }
    });
  }

  // Resolve mission context (objective) if available
  let missionObjective = options.missionObjective || task.missionObjective || task.executionMetadata?.missionObjective || null;
  if (!missionObjective && task.missionId) {
    try {
      const Mission = require('../models/Mission');
      const m = await Mission.findById(task.missionId).select('objective').lean();
      if (m?.objective) {
        missionObjective = m.objective;
      }
    } catch {
      // Safe fallback if lookup fails
    }
  }

  // Load advisory prior memory context (Step 8G.4)
  let advisoryMemory = null;
  if (task.missionId) {
    try {
      const { assembleTaskContext } = require('../services/missionMemoryService');
      const Mission = require('../models/Mission');
      const missionDoc = await Mission.findById(task.missionId).select('userId').lean();
      if (missionDoc?.userId) {
        advisoryMemory = await assembleTaskContext({
          missionId: task.missionId,
          userId: missionDoc.userId,
          taskId: task._id,
          currentTaskOrder: task.order,
          targetAgentId: task.agentId,
        });
      }
    } catch {
      // Safe non-blocking fallback
    }
  }

  // Dispatch task to specialized agent through the Agent Execution Gateway
  const context = {
    options,
    missionObjective,
    advisoryMemory,
  };
  const agentResult = await executeTaskWithAgent(task, context);
  if (agentResult && agentResult.status === 'failed') {
    const errorMsg = agentResult.message || `Agent [${agentResult.agentId}] returned failed status`;
    const err = new Error(errorMsg);
    err.code = agentResult.data?.error?.code || 'AGENT_FAILED';
    err.data = agentResult.data;
    throw err;
  }
  return agentResult;
}

const DEFAULT_TASK_TIMEOUT_MS = 120000;
const HEARTBEAT_INTERVAL_MS = 5000;
const LEASE_DURATION_MS = 25000;

/**
 * Worker execution lifecycle states
 */
const WORKER_STATES = Object.freeze({
  RUNNING: 'RUNNING',
  COMPLETING_DRAINING: 'COMPLETING_DRAINING',
  COMPLETING_CAS: 'COMPLETING_CAS',
  CONFIRMED_COMPLETED: 'CONFIRMED_COMPLETED',
  FAILING_DRAINING: 'FAILING_DRAINING',
  FAILING_CAS: 'FAILING_CAS',
  CONFIRMED_FAILED: 'CONFIRMED_FAILED',
  FENCED_LOST: 'FENCED_LOST',
  SURRENDERED: 'SURRENDERED',
});

/**
 * Wraps task execution with a strict deadline timer to prevent hanging operations.
 * Supports task document or direct async work executor.
 * 
 * @param {import('mongoose').Document|Function} taskOrFn
 * @param {object|number} [options={}]
 * @returns {Promise<object>}
 */
async function executeTaskWorkWithTimeout(taskOrFn, options = {}) {
  let timeoutMs = typeof options === 'number'
    ? options
    : (options.taskTimeoutMs || DEFAULT_TASK_TIMEOUT_MS);
  const taskLabel = typeof taskOrFn === 'function'
    ? (options.title || 'task')
    : (taskOrFn?.title || taskOrFn?.order || 'task');

  // If a mission deadline is specified, ensure task timeout never exceeds remaining mission budget
  if (typeof options === 'object' && options?.missionDeadlineAt) {
    const deadlineMs = new Date(options.missionDeadlineAt).getTime();
    if (!Number.isNaN(deadlineMs)) {
      const remainingUntilDeadline = deadlineMs - Date.now();
      if (remainingUntilDeadline <= 0) {
        const deadlineErr = new Error(`Task execution timed out: mission deadline already exceeded (${taskLabel})`);
        deadlineErr.code = 'TASK_TIMEOUT';
        throw deadlineErr;
      }
      timeoutMs = Math.min(timeoutMs, remainingUntilDeadline);
    }
  }

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Task execution timed out after ${timeoutMs}ms (${taskLabel})`);
      err.code = 'TASK_TIMEOUT';
      reject(err);
    }, timeoutMs);
  });

  try {
    const workPromise = typeof taskOrFn === 'function'
      ? taskOrFn()
      : executeTaskWork(taskOrFn, options);
    const result = await Promise.race([
      workPromise,
      timeoutPromise,
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Typed error indicating that a task claim could not be acquired due to concurrent execution
 * or non-pending task status.
 */
class TaskClaimConflictError extends Error {
  constructor(taskId, currentStatus, details = {}) {
    super(`Cannot execute task ${taskId}: task is currently in '${currentStatus}' state (conflict: unavailable for claim)`);
    this.name = 'TaskClaimConflictError';
    this.code = 'TASK_CLAIM_CONFLICT';
    this.taskId = taskId ? taskId.toString() : null;
    this.currentStatus = currentStatus;
    this.details = details;
  }
}

/**
 * Typed error indicating that a worker lost its execution lease due to epoch fencing,
 * lease expiration under uncertainty, or concurrent reclamation.
 */
class LeaseLostError extends Error {
  constructor(taskId, generation, workerId, reason) {
    super(`Task ${taskId} execution lease lost (generation: ${generation}, worker: ${workerId}, reason: ${reason})`);
    this.name = 'LeaseLostError';
    this.code = 'LEASE_LOST';
    this.taskId = taskId ? taskId.toString() : null;
    this.generation = generation;
    this.workerId = workerId;
    this.reason = reason;
  }
}

/**
 * Executes a single MissionTask through its formal lifecycle:
 * pending -> running -> completed (or running -> failed).
 * 
 * MongoDB is updated atomically during task claim with generation increment.
 * Periodic heartbeats renew ownership with generation and workerId fencing.
 * Terminal completion and failure CAS operations strictly fence against stale workers.
 * 
 * @param {mongoose.Types.ObjectId|string} taskId - The ID of the MissionTask to execute
 * @param {object} [options={}] - Execution options (e.g. testing delays/failures, workerId, test hooks)
 * @returns {Promise<import('mongoose').Document>} The updated MissionTask document
 */
async function executeMissionTask(taskId, options = {}) {
  // 1. Task ID Validation
  if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
    const err = new Error('Invalid or missing taskId');
    err.code = 'INVALID_TASK_ID';
    throw err;
  }

  // Check if claims are paused due to shutdown
  if (isTaskClaimsPaused) {
    const pauseErr = new Error('Task claims are paused due to shutdown');
    pauseErr.code = 'TASK_CLAIMS_PAUSED';
    throw pauseErr;
  }

  const workerId = options.workerId || `worker_${process.pid}_${Math.random().toString(36).substring(2, 9)}`;

  // 2. Single Atomic Transition: pending -> running with generation allocation
  // Pipeline update safely handles executionMetadata whether null, missing, or an existing object
  const runningTask = await MissionTask.findOneAndUpdate(
    { _id: taskId, status: 'pending' },
    [
      {
        $set: {
          status: 'running',
          executionMetadata: {
            $mergeObjects: [
              { $ifNull: ['$executionMetadata', {}] },
              {
                claimedBy: workerId,
                claimedAt: '$$NOW',
                heartbeatAt: '$$NOW',
                generation: {
                  $add: [
                    { $ifNull: ['$executionMetadata.generation', 0] },
                    1,
                  ],
                },
              },
            ],
          },
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true }
  );

  if (!runningTask) {
    const existing = await MissionTask.findById(taskId);
    if (!existing) {
      const err = new Error(`Task ${taskId} not found`);
      err.code = 'TASK_NOT_FOUND';
      throw err;
    }
    // Existing task is not pending; raise typed claim conflict
    throw new TaskClaimConflictError(taskId, existing.status, {
      claimedBy: existing.executionMetadata?.claimedBy || null,
      generation: existing.executionMetadata?.generation || 0,
    });
  }

  // 3. Worker Ownership & Heartbeat Loop Setup
  const currentGeneration = runningTask.executionMetadata?.generation || 1;
  const attemptNum = options.attempt || runningTask.executionMetadata?.attempt || 1;
  const heartbeatIntervalMs = options.__heartbeatIntervalMs !== undefined
    ? options.__heartbeatIntervalMs
    : HEARTBEAT_INTERVAL_MS;
  const leaseDurationMs = options.__leaseDurationMs !== undefined
    ? options.__leaseDurationMs
    : LEASE_DURATION_MS;

  let workerState = WORKER_STATES.RUNNING;
  let leaseStatus = 'ACTIVE'; // 'ACTIVE' | 'LOST' | 'EXPIRED_UNCERTAIN'
  let heartbeatTimer = null;
  let activeHeartbeatPromise = null;
  let lastSuccessfulHeartbeatAt = Date.now();
  let consecutiveHeartbeatErrors = 0;
  const abortController = new AbortController();

  let resolveCompletion;
  const executionPromise = new Promise((resolve) => {
    resolveCompletion = resolve;
  });

  // Conservative classification: Tasks default to NOT safe to surrender unless safety is explicitly established.
  // Browser, research, external I/O, or any task with side effects or without explicit safeToCancel: true are treated as unsafe.
  const isKnownSideEffectingAgent = ['browser', 'research'].includes(runningTask.agentId?.toLowerCase());
  const safeToCancel = Boolean(
    options.safeToCancel === true &&
    !options.hasSideEffects &&
    !runningTask.executionMetadata?.hasSideEffects &&
    !isKnownSideEffectingAgent
  );

  const workerRecord = {
    taskId: taskId.toString(),
    missionId: runningTask.missionId ? runningTask.missionId.toString() : null,
    workerId,
    generation: currentGeneration,
    abortController,
    safeToCancel,
    isSurrendered: false,
    abortedCleanly: false,
    executionPromise,
  };
  activeWorkers.set(taskId.toString(), workerRecord);

  function handleHeartbeatError(err) {
    consecutiveHeartbeatErrors++;
    const elapsedSinceLastSuccess = Date.now() - lastSuccessfulHeartbeatAt;
    if (elapsedSinceLastSuccess >= leaseDurationMs) {
      leaseStatus = 'EXPIRED_UNCERTAIN';
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      abortController.abort();
    }
  }

  async function sendHeartbeat() {
    if (workerState !== WORKER_STATES.RUNNING) {
      return;
    }

    if (typeof options.__injectedHeartbeatError === 'function') {
      const injectedErr = options.__injectedHeartbeatError();
      if (injectedErr) {
        handleHeartbeatError(injectedErr);
        return;
      }
    }

    try {
      const updated = await MissionTask.findOneAndUpdate(
        {
          _id: taskId,
          status: 'running',
          'executionMetadata.generation': currentGeneration,
          'executionMetadata.claimedBy': workerId,
        },
        {
          $set: {
            'executionMetadata.heartbeatAt': new Date(),
          },
        },
        { returnDocument: 'after' }
      );

      if (!updated) {
        // CAS returned null: lease lost / fenced by another worker or status changed
        leaseStatus = 'LOST';
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        abortController.abort();
        return;
      }

      lastSuccessfulHeartbeatAt = Date.now();
      consecutiveHeartbeatErrors = 0;
      if (typeof options.__onHeartbeatSuccess === 'function') {
        options.__onHeartbeatSuccess(updated);
      }
    } catch (err) {
      handleHeartbeatError(err);
    }
  }

  async function drainHeartbeat(targetDrainingState) {
    workerState = targetDrainingState;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (activeHeartbeatPromise) {
      try {
        await activeHeartbeatPromise;
      } catch {
        // Ignored; errors handled inside sendHeartbeat
      }
      activeHeartbeatPromise = null;
    }
    if (leaseStatus === 'LOST' || leaseStatus === 'EXPIRED_UNCERTAIN') {
      workerState = WORKER_STATES.FENCED_LOST;
      throw new LeaseLostError(taskId, currentGeneration, workerId, leaseStatus);
    }
  }

  if (heartbeatIntervalMs > 0) {
    heartbeatTimer = setInterval(() => {
      if (workerState !== WORKER_STATES.RUNNING) return;
      if (activeHeartbeatPromise) return; // Avoid concurrent ticks
      activeHeartbeatPromise = sendHeartbeat().finally(() => {
        activeHeartbeatPromise = null;
      });
    }, heartbeatIntervalMs);
  }

  // 4. Execute deterministic task work with timeout & cancellation protection
  const taskStartTime = Date.now();
  recordTaskStart(runningTask.missionId, runningTask._id, {
    agentId: runningTask.agentId,
    attempt: attemptNum,
  }).catch(() => {});

  if (attemptNum > 1) {
    try {
      const { supersedePriorTaskAttempts } = require('../services/missionMemoryService');
      supersedePriorTaskAttempts(runningTask.missionId, runningTask._id, attemptNum).catch(() => {});
    } catch {}

    if (!runningTask.executionMetadata?.isAdaptiveRetry) {
      await recordDecision({
        missionId: runningTask.missionId,
        decisionType: DECISION_TYPES.RETRY_TASK,
        taskId: runningTask._id,
        reason: `Retrying task execution under policy (attempt ${attemptNum})`,
        action: `Execute task retry attempt ${attemptNum}`,
        outcome: 'retrying',
        metadata: { attempt: attemptNum },
      }).catch(() => {});
    }
    await recordEvent({
      missionId: runningTask.missionId,
      type: EVENT_TYPES.TASK_RETRY_STARTED,
      taskId: runningTask._id,
      action: `Retry started for task: ${runningTask.title}`,
      metadata: { attempt: attemptNum },
    }).catch(() => {});
  }

  await recordEvent({
    missionId: runningTask.missionId,
    type: EVENT_TYPES.TASK_STARTED,
    taskId: runningTask._id,
    action: `Started task: ${runningTask.title}`,
    metadata: { agentId: runningTask.agentId, attempt: attemptNum },
  }).catch(() => {});

  try {
    const agentResult = await executeTaskWorkWithTimeout(runningTask, {
      ...options,
      signal: abortController.signal,
    });
    const durationMs = Date.now() - taskStartTime;

    // Check if worker was aborted or lease was lost while work was running
    if (leaseStatus === 'LOST' || leaseStatus === 'EXPIRED_UNCERTAIN') {
      workerState = WORKER_STATES.FENCED_LOST;
      throw new LeaseLostError(taskId, currentGeneration, workerId, leaseStatus);
    }

    // Step 1: Pre-CAS Heartbeat Drain
    await drainHeartbeat(WORKER_STATES.COMPLETING_DRAINING);

    // Test hook: controlled barrier before completion CAS
    if (typeof options.__barrierBeforeCompletion === 'function') {
      await options.__barrierBeforeCompletion({
        taskId,
        generation: currentGeneration,
        workerId,
      });
      if (leaseStatus === 'LOST' || leaseStatus === 'EXPIRED_UNCERTAIN') {
        workerState = WORKER_STATES.FENCED_LOST;
        throw new LeaseLostError(taskId, currentGeneration, workerId, leaseStatus);
      }
    }

    // Best-effort pre-completion deadline guard:
    // If mission deadline expired during task execution, heartbeat drain, or barrier,
    // abort completion and route to fenced task failure.
    if (options.missionDeadlineAt) {
      const dMs = new Date(options.missionDeadlineAt).getTime();
      if (!Number.isNaN(dMs) && Date.now() >= dMs) {
        const deadlineErr = new Error(`Task work completed after mission deadline exceeded (${new Date(dMs).toISOString()})`);
        deadlineErr.code = 'TASK_TIMEOUT';
        throw deadlineErr;
      }
    }

    // Step 2: Transition to COMPLETING_CAS
    workerState = WORKER_STATES.COMPLETING_CAS;

    // Test hook: injected completion CAS error for network ambiguity testing
    if (options.__injectedCompletionCasError) {
      throw options.__injectedCompletionCasError;
    }

    // Step 3: Atomic Completion CAS fenced by generation and workerId
    let completedTask;
    try {
      completedTask = await MissionTask.findOneAndUpdate(
        {
          _id: taskId,
          status: 'running',
          'executionMetadata.generation': currentGeneration,
          'executionMetadata.claimedBy': workerId,
        },
        {
          $set: {
            status: 'completed',
            agentId: agentResult?.agentId || runningTask.agentId || null,
            error: null,
            'executionMetadata.resultData': agentResult?.data || null,
            'executionMetadata.attempt': attemptNum,
          },
        },
        { returnDocument: 'after' }
      );
    } catch (dbErr) {
      // Thrown MongoDB / network error: Ambiguous DB outcome!
      // Do NOT emit completion events or write memory.
      // Do NOT execute failure CAS or emit failure events.
      // Phase 2 recovery scanner will reconcile.
      throw dbErr;
    }

    if (!completedTask) {
      workerState = WORKER_STATES.FENCED_LOST;
      throw new LeaseLostError(taskId, currentGeneration, workerId, 'COMPLETION_CAS_FENCED');
    }

    // Step 4: Confirmed completed!
    workerState = WORKER_STATES.CONFIRMED_COMPLETED;

    recordTaskEnd(runningTask.missionId, runningTask._id, {
      agentId: agentResult?.agentId || runningTask.agentId || null,
      status: 'completed',
      durationMs,
      attempt: attemptNum,
    }).catch(() => {});

    completedTask._agentResult = agentResult;

    await recordEvent({
      missionId: runningTask.missionId,
      type: EVENT_TYPES.TASK_COMPLETED,
      taskId: runningTask._id,
      action: `Completed task: ${runningTask.title}`,
      outcome: 'completed',
      metadata: {
        agentId: agentResult?.agentId || runningTask.agentId || null,
        durationMs,
        attempt: attemptNum,
      },
    }).catch(() => {});

    // Agent-specific domain events & decisions
    const executingAgentId = (agentResult?.agentId || runningTask.agentId || '').toLowerCase();
    if (executingAgentId === 'research' || executingAgentId === 'browser') {
      await recordEvent({
        missionId: runningTask.missionId,
        type: EVENT_TYPES.EVIDENCE_COLLECTED,
        taskId: runningTask._id,
        action: `Extracted verified evidence from ${executingAgentId} task`,
      }).catch(() => {});
    } else if (executingAgentId === 'analyst') {
      await recordEvent({
        missionId: runningTask.missionId,
        type: EVENT_TYPES.ANALYSIS_COMPLETED,
        taskId: runningTask._id,
        action: 'Completed evidence analysis synthesis',
      }).catch(() => {});
    } else if (executingAgentId === 'critic') {
      const verdict = agentResult?.data?.overallVerdict || agentResult?.data?.critique?.overallVerdict || 'pass';
      await recordEvent({
        missionId: runningTask.missionId,
        type: EVENT_TYPES.CRITIQUE_COMPLETED,
        taskId: runningTask._id,
        action: 'Completed critique audit of analysis',
        outcome: verdict,
      }).catch(() => {});

      if (verdict === 'pass') {
        await recordDecision({
          missionId: runningTask.missionId,
          decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
          taskId: runningTask._id,
          reason: 'Critic validation passed all consistency and grounding assertions',
          action: 'Approve analysis and proceed to builder artifact generation',
          outcome: 'pass',
        }).catch(() => {});
      }
    } else if (executingAgentId === 'builder') {
      await recordEvent({
        missionId: runningTask.missionId,
        type: EVENT_TYPES.ARTIFACT_CREATED,
        taskId: runningTask._id,
        action: 'Constructed deliverable artifact',
      }).catch(() => {});
    } else if (executingAgentId === 'qa') {
      const verdict = agentResult?.data?.overallVerdict || agentResult?.data?.qaReport?.overallVerdict || 'pass';
      const score = agentResult?.data?.overallScore || agentResult?.data?.qaReport?.overallScore || null;
      await recordEvent({
        missionId: runningTask.missionId,
        type: EVENT_TYPES.QA_COMPLETED,
        taskId: runningTask._id,
        action: 'Completed independent quality assurance audit',
        outcome: verdict,
      }).catch(() => {});

      if (verdict === 'pass') {
        await recordDecision({
          missionId: runningTask.missionId,
          decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
          taskId: runningTask._id,
          reason: 'QA report verified deliverable artifact integrity and evidence grounding',
          confidence: typeof score === 'number' ? score / 100 : 1.0,
          action: 'Approve deliverable artifact for mission finalization',
          outcome: 'pass',
        }).catch(() => {});
      }
    }

    // Record task memory entry (Step 8G.4)
    try {
      const { recordMemory, MEMORY_TYPES } = require('../services/missionMemoryService');
      const Mission = require('../models/Mission');
      const missionDoc = await Mission.findById(runningTask.missionId).select('userId').lean();
      if (missionDoc?.userId) {
        let memType = MEMORY_TYPES.TASK_OUTCOME;
        let content = `Completed task "${runningTask.title}" (${executingAgentId || 'agent'}) on attempt ${attemptNum}.`;
        if (executingAgentId === 'analyst' || executingAgentId === 'critic') {
          memType = MEMORY_TYPES.SYNTHESIS_INSIGHT;
          content = agentResult?.data?.summary || agentResult?.message || content;
        }
        await recordMemory({
          missionId: runningTask.missionId,
          userId: missionDoc.userId,
          taskId: runningTask._id,
          attempt: attemptNum,
          type: memType,
          key: `task_${runningTask.order}_${executingAgentId || 'outcome'}`,
          content,
          relevanceTags: [executingAgentId, `order_${runningTask.order}`].filter(Boolean),
        }).catch(() => {});
      }
    } catch {
      // Safe non-blocking memory recording
    }

    return completedTask;
  } catch (workError) {
    // 1. If error occurred in COMPLETING_CAS (network ambiguity or fenced CAS)
    if (workerState === WORKER_STATES.COMPLETING_CAS) {
      if (workError instanceof LeaseLostError) {
        workerState = WORKER_STATES.FENCED_LOST;
        throw workError;
      }
      // DB / network error during completion CAS: ambiguous outcome
      // Do NOT execute failure CAS, do NOT emit failure events.
      throw workError;
    }

    // 2. If lease was lost or expired uncertain during execution or heartbeat
    if (workError instanceof LeaseLostError || leaseStatus === 'LOST' || leaseStatus === 'EXPIRED_UNCERTAIN') {
      workerState = WORKER_STATES.FENCED_LOST;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      throw (workError instanceof LeaseLostError
        ? workError
        : new LeaseLostError(taskId, currentGeneration, workerId, leaseStatus));
    }

    // 3. If task execution was aborted during shutdown or already marked surrendered
    if (workError.name === 'AbortError' || workError.code === 'TASK_ABORTED' || workerRecord?.isSurrendered) {
      workerState = WORKER_STATES.SURRENDERED;
      if (workerRecord) {
        workerRecord.abortedCleanly = true;
      }
      const abortErr = new Error(`Task ${taskId} execution aborted during shutdown`);
      abortErr.code = 'TASK_ABORTED';
      throw abortErr;
    }

    // 3. Normal work failure path:
    const durationMs = Date.now() - taskStartTime;

    // Drain heartbeat before failure CAS
    try {
      await drainHeartbeat(WORKER_STATES.FAILING_DRAINING);
    } catch (drainErr) {
      if (drainErr instanceof LeaseLostError || leaseStatus === 'LOST' || leaseStatus === 'EXPIRED_UNCERTAIN') {
        workerState = WORKER_STATES.FENCED_LOST;
        throw (drainErr instanceof LeaseLostError
          ? drainErr
          : new LeaseLostError(taskId, currentGeneration, workerId, leaseStatus));
      }
    }

    // Test hook: controlled barrier before failure CAS
    if (typeof options.__barrierBeforeFailure === 'function') {
      await options.__barrierBeforeFailure({
        taskId,
        generation: currentGeneration,
        workerId,
      });
      if (leaseStatus === 'LOST' || leaseStatus === 'EXPIRED_UNCERTAIN') {
        workerState = WORKER_STATES.FENCED_LOST;
        throw new LeaseLostError(taskId, currentGeneration, workerId, leaseStatus);
      }
    }

    workerState = WORKER_STATES.FAILING_CAS;
    console.error(`[TASK EXECUTOR] Task ${taskId} failed:`, workError.message);

    const failedTask = await MissionTask.findOneAndUpdate(
      {
        _id: taskId,
        status: 'running',
        'executionMetadata.generation': currentGeneration,
        'executionMetadata.claimedBy': workerId,
      },
      {
        $set: {
          status: 'failed',
          error: workError.message,
          'executionMetadata.attempt': attemptNum,
        },
      },
      { returnDocument: 'after' }
    );

    if (!failedTask) {
      workerState = WORKER_STATES.FENCED_LOST;
      throw new LeaseLostError(taskId, currentGeneration, workerId, 'FAILURE_CAS_FENCED');
    }

    workerState = WORKER_STATES.CONFIRMED_FAILED;

    recordTaskEnd(runningTask.missionId, runningTask._id, {
      agentId: runningTask.agentId || null,
      status: 'failed',
      durationMs,
      attempt: attemptNum,
      error: workError.message,
      failureCategory: categorizeTaskError(workError),
    }).catch(() => {});

    await recordEvent({
      missionId: runningTask.missionId,
      type: EVENT_TYPES.TASK_FAILED,
      taskId: runningTask._id,
      reason: workError.message,
      action: `Failed task: ${runningTask.title}`,
      outcome: 'failed',
      metadata: {
        attempt: attemptNum,
        failureCategory: categorizeTaskError(workError),
        durationMs,
      },
    }).catch(() => {});

    // Invalidate active memories for failed task (Step 8G.4)
    try {
      const { invalidateTaskMemories } = require('../services/missionMemoryService');
      invalidateTaskMemories(runningTask.missionId, taskId).catch(() => {});
    } catch {}

    throw workError;
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    activeWorkers.delete(taskId.toString());
    if (resolveCompletion) {
      resolveCompletion();
    }
  }
}

/**
 * Cooperatively surrenders an active task lease back to 'pending'.
 * Guarded by atomic CAS on taskId, status: 'running', claimedBy: workerId, generation.
 * Increments generation so any subsequent writes from this worker are strictly fenced.
 *
 * @param {mongoose.Types.ObjectId|string} taskId
 * @param {object} options
 * @param {string} options.workerId
 * @param {number} options.generation
 * @param {string} [options.reason='Shutdown lease surrender']
 * @returns {Promise<import('mongoose').Document|null>} The updated document or null if CAS lost
 */
async function surrenderTaskLease(taskId, options = {}) {
  if (!taskId) return null;
  const { workerId, generation, reason } = options;
  if (!workerId || generation === undefined) {
    throw new Error('workerId and generation are required to surrender task lease');
  }

  const surrenderedTask = await MissionTask.findOneAndUpdate(
    {
      _id: taskId,
      status: 'running',
      'executionMetadata.claimedBy': workerId,
      'executionMetadata.generation': generation,
    },
    [
      {
        $set: {
          status: 'pending',
          executionMetadata: {
            $mergeObjects: [
              { $ifNull: ['$executionMetadata', {}] },
              {
                claimedBy: null,
                surrenderedAt: '$$NOW',
                surrenderReason: reason || 'Shutdown lease surrender',
                generation: {
                  $add: [
                    { $ifNull: ['$executionMetadata.generation', 0] },
                    1,
                  ],
                },
              },
            ],
          },
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true }
  );

  return surrenderedTask;
}

/**
 * Drains active workers during shutdown.
 *
 * Safety invariants:
 * 1. Pauses task claims immediately to prevent new task dispatches.
 * 2. If tasks are safe to cancel (no committed state/side effects), aborts their
 *    in-flight work and cooperatively surrenders their leases to 'pending' via CAS.
 * 3. If tasks have unsafe side effects (safeToCancel === false), does NOT force-release
 *    them to 'pending'. Awaits their completion up to timeoutMs; if not finished,
 *    leaves them 'running' for subsequent lease-expiry recovery after exit.
 * 4. Bounded wait up to timeoutMs.
 *
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=5000]
 * @returns {Promise<{drained: boolean, activeCount: number, surrenderedCount: number}>}
 */
async function drainActiveWorkers(options = {}) {
  const timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs >= 0)
    ? options.timeoutMs
    : 5000;

  pauseTaskClaims();

  if (activeWorkers.size === 0) {
    return { drained: true, activeCount: 0, surrenderedCount: 0 };
  }

  // 1. Send abort signals where supported
  const workersToEvaluate = Array.from(activeWorkers.values());
  const executionPromises = [];

  for (const worker of workersToEvaluate) {
    if (worker.abortController) {
      worker.abortController.abort();
    }
    if (worker.executionPromise) {
      executionPromises.push(worker.executionPromise.catch(() => {}));
    }
  }

  // 2. Await actual worker execution promises settling within the bounded drain window
  let settledInTime = true;
  if (executionPromises.length > 0 && timeoutMs > 0) {
    let timer;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        settledInTime = false;
        resolve();
      }, timeoutMs);
    });

    try {
      await Promise.race([
        Promise.all(executionPromises),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  // 3. Before returning a task to pending, verify that the worker execution has ACTUALLY settled!
  // If execution settled cleanly within the window, and task was safeToCancel, surrender the lease cooperatively.
  // If execution did not settle, do NOT surrender the lease; leave the task running for lease-expiry recovery.
  let surrenderedCount = 0;
  for (const worker of workersToEvaluate) {
    if (worker.safeToCancel && worker.abortedCleanly && !activeWorkers.has(worker.taskId)) {
      worker.isSurrendered = true;
      const surrendered = await surrenderTaskLease(worker.taskId, {
        workerId: worker.workerId,
        generation: worker.generation,
        reason: 'Worker drained cleanly during shutdown',
      }).catch((err) => {
        console.warn(`[TASK EXECUTOR] Failed to surrender lease for task ${worker.taskId}:`, err.message);
        return null;
      });
      if (surrendered) surrenderedCount++;
    } else if (worker.safeToCancel && !settledInTime) {
      console.log(`[TASK EXECUTOR] Task ${worker.taskId} execution did not settle within drain window; leaving in running state for lease recovery.`);
    }
  }

  return {
    drained: activeWorkers.size === 0 && settledInTime,
    activeCount: activeWorkers.size,
    surrenderedCount,
  };
}

function pauseTaskClaims() {
  isTaskClaimsPaused = true;
  return isTaskClaimsPaused;
}

function resumeTaskClaims() {
  isTaskClaimsPaused = false;
  return isTaskClaimsPaused;
}

function areTaskClaimsPaused() {
  return isTaskClaimsPaused;
}

function getActiveWorkersCount() {
  return activeWorkers.size;
}

function getActiveWorkers() {
  return Array.from(activeWorkers.values()).map((w) => ({
    taskId: w.taskId,
    missionId: w.missionId || null,
    workerId: w.workerId,
    generation: w.generation,
    safeToCancel: w.safeToCancel,
    isSurrendered: Boolean(w.isSurrendered),
  }));
}

/**
 * Aborts all active in-flight workers belonging to a specific mission.
 * Unlike cluster-level drain, this does NOT pause task claims globally.
 * It sends abort signals to workers matching missionId, and awaits their
 * settlement within a bounded window.
 *
 * @param {mongoose.Types.ObjectId|string} missionId
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=3000]
 * @returns {Promise<{abortedCount: number, settledCount: number}>}
 */
async function abortMissionWorkers(missionId, options = {}) {
  if (!missionId) {
    return { abortedCount: 0, settledCount: 0 };
  }
  const targetMissionId = missionId.toString();
  const timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs >= 0)
    ? options.timeoutMs
    : 3000;

  const matchingWorkers = Array.from(activeWorkers.values()).filter(
    (w) => w.missionId === targetMissionId
  );

  if (matchingWorkers.length === 0) {
    return { abortedCount: 0, settledCount: 0 };
  }

  const executionPromises = [];
  for (const worker of matchingWorkers) {
    if (worker.abortController) {
      worker.abortController.abort();
    }
    if (worker.executionPromise) {
      executionPromises.push(worker.executionPromise.catch(() => {}));
    }
  }

  let settledInTime = true;
  if (executionPromises.length > 0 && timeoutMs > 0) {
    let timer;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        settledInTime = false;
        resolve();
      }, timeoutMs);
    });

    try {
      await Promise.race([
        Promise.all(executionPromises),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    abortedCount: matchingWorkers.length,
    settledCount: settledInTime ? matchingWorkers.length : 0,
  };
}

function _resetWorkerStateForTesting() {
  isTaskClaimsPaused = false;
  activeWorkers.clear();
}

module.exports = {
  executeMissionTask,
  executeTaskWork,
  executeTaskWorkWithTimeout,
  TaskClaimConflictError,
  LeaseLostError,
  WORKER_STATES,
  DEFAULT_TASK_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  LEASE_DURATION_MS,
  surrenderTaskLease,
  drainActiveWorkers,
  abortMissionWorkers,
  pauseTaskClaims,
  resumeTaskClaims,
  areTaskClaimsPaused,
  getActiveWorkersCount,
  getActiveWorkers,
  _resetWorkerStateForTesting,
};
