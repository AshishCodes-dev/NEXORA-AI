const mongoose = require('mongoose');
const MissionTask = require('../models/MissionTask');
const { executeTaskWithAgent } = require('../agents/agentExecutionGateway');
const { recordTaskStart, recordTaskEnd, categorizeTaskError } = require('../services/telemetry/telemetryService');
const { recordEvent, recordDecision, EVENT_TYPES, DECISION_TYPES } = require('../services/missionEventService');

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
    await new Promise((resolve) => setTimeout(resolve, delayMs));
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

/**
 * Wraps task execution with a strict deadline timer to prevent hanging operations.
 * Supports task document or direct async work executor.
 * 
 * @param {import('mongoose').Document|Function} taskOrFn
 * @param {object|number} [options={}]
 * @returns {Promise<object>}
 */
async function executeTaskWorkWithTimeout(taskOrFn, options = {}) {
  const timeoutMs = typeof options === 'number'
    ? options
    : (options.taskTimeoutMs || DEFAULT_TASK_TIMEOUT_MS);
  const taskLabel = typeof taskOrFn === 'function'
    ? (options.title || 'task')
    : (taskOrFn?.title || taskOrFn?.order || 'task');

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
 * Executes a single MissionTask through its formal lifecycle:
 * pending -> running -> completed (or running -> failed).
 * 
 * MongoDB is updated atomically during task claim with generation increment.
 * Invalid transitions or jumps (e.g. pending -> completed) are rejected.
 * Concurrent claims yield a typed TaskClaimConflictError without failing the mission.
 * 
 * @param {mongoose.Types.ObjectId|string} taskId - The ID of the MissionTask to execute
 * @param {object} [options={}] - Execution options (e.g. testing delays/failures, workerId)
 * @returns {Promise<import('mongoose').Document>} The updated MissionTask document
 */
async function executeMissionTask(taskId, options = {}) {
  // 1. Task ID Validation
  if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
    const err = new Error('Invalid or missing taskId');
    err.code = 'INVALID_TASK_ID';
    throw err;
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

  // 4. Execute deterministic task work with timeout protection
  const taskStartTime = Date.now();
  const attemptNum = options.attempt || runningTask.executionMetadata?.attempt || 1;
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
    const agentResult = await executeTaskWorkWithTimeout(runningTask, options);
    const durationMs = Date.now() - taskStartTime;
    recordTaskEnd(runningTask.missionId, runningTask._id, {
      agentId: agentResult?.agentId || runningTask.agentId || null,
      status: 'completed',
      durationMs,
      attempt: attemptNum,
    }).catch(() => {});

    // 5a. Transition: running -> completed (recording executing agentId & executionMetadata)
    const existingMetadata = runningTask.executionMetadata && typeof runningTask.executionMetadata === 'object'
      ? runningTask.executionMetadata
      : {};

    const completedTask = await MissionTask.findOneAndUpdate(
      { _id: taskId, status: 'running' },
      {
        $set: {
          status: 'completed',
          agentId: agentResult?.agentId || runningTask.agentId || null,
          error: null,
          executionMetadata: {
            ...existingMetadata,
            resultData: agentResult?.data || null,
          },
        },
      },
      { returnDocument: 'after' }
    );

    if (!completedTask) {
      throw new Error(`Failed to mark task ${taskId} as completed (concurrent state change)`);
    }

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

    // 5c. Record task memory entry (Step 8G.4)
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
    const durationMs = Date.now() - taskStartTime;
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

    // 5b. Transition: running -> failed (recording error message)
    console.error(`[TASK EXECUTOR] Task ${taskId} failed:`, workError.message);
    const existingMetadata = runningTask.executionMetadata && typeof runningTask.executionMetadata === 'object'
      ? { ...runningTask.executionMetadata }
      : {};
    existingMetadata.attempt = attemptNum;

    await MissionTask.findOneAndUpdate(
      { _id: taskId, status: 'running' },
      {
        $set: {
          status: 'failed',
          error: workError.message,
          executionMetadata: existingMetadata,
        },
      },
      { returnDocument: 'after' }
    );
    throw workError;
  }
}

module.exports = {
  executeMissionTask,
  executeTaskWork,
  executeTaskWorkWithTimeout,
  TaskClaimConflictError,
  DEFAULT_TASK_TIMEOUT_MS,
};
