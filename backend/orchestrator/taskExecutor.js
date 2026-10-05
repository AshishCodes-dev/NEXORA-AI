const mongoose = require('mongoose');
const MissionTask = require('../models/MissionTask');
const { executeTaskWithAgent } = require('../agents/agentExecutionGateway');
const { recordTaskStart, recordTaskEnd, categorizeTaskError } = require('../services/telemetry/telemetryService');

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

  // Dispatch task to specialized agent through the Agent Execution Gateway
  const context = {
    options,
    missionObjective,
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
 * Executes a single MissionTask through its formal lifecycle:
 * pending -> queued -> running -> completed (or running -> failed).
 * 
 * MongoDB is updated and persisted after each transition.
 * Invalid transitions or jumps (e.g. pending -> completed) are rejected.
 * 
 * @param {mongoose.Types.ObjectId|string} taskId - The ID of the MissionTask to execute
 * @param {object} [options={}] - Execution options (e.g. testing delays/failures)
 * @returns {Promise<import('mongoose').Document>} The updated MissionTask document
 */
async function executeMissionTask(taskId, options = {}) {
  // 1. Task ID Validation
  if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
    throw new Error('Invalid or missing taskId');
  }

  // 2. Transition: pending -> queued (guarded atomic update)
  const queuedTask = await MissionTask.findOneAndUpdate(
    { _id: taskId, status: 'pending' },
    { $set: { status: 'queued' } },
    { returnDocument: 'after' }
  );

  if (!queuedTask) {
    const existing = await MissionTask.findById(taskId);
    if (!existing) {
      throw new Error(`Task ${taskId} not found`);
    }
    if (existing.status === 'completed') {
      throw new Error(`Cannot execute completed task ${taskId}`);
    }
    if (existing.status === 'running') {
      throw new Error(`Cannot execute already running task ${taskId}`);
    }
    if (existing.status === 'failed') {
      throw new Error(`Cannot execute failed task ${taskId}`);
    }
    throw new Error(`Invalid state transition: task ${taskId} is currently in '${existing.status}' state`);
  }

  // 3. Transition: queued -> running (guarded atomic update)
  const runningTask = await MissionTask.findOneAndUpdate(
    { _id: taskId, status: 'queued' },
    { $set: { status: 'running' } },
    { returnDocument: 'after' }
  );

  if (!runningTask) {
    const existing = await MissionTask.findById(taskId);
    throw new Error(`Invalid state transition: cannot transition task ${taskId} from '${existing ? existing.status : 'unknown'}' to 'running'`);
  }

  // 4. Execute deterministic task work with timeout protection
  const taskStartTime = Date.now();
  const attemptNum = options.attempt || 1;
  recordTaskStart(runningTask.missionId, runningTask._id, {
    agentId: runningTask.agentId,
    attempt: attemptNum,
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

    // 5b. Transition: running -> failed (recording error message)
    console.error(`[TASK EXECUTOR] Task ${taskId} failed:`, workError.message);
    await MissionTask.findOneAndUpdate(
      { _id: taskId, status: 'running' },
      {
        $set: {
          status: 'failed',
          error: workError.message,
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
  DEFAULT_TASK_TIMEOUT_MS,
};
