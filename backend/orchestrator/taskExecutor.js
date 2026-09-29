const mongoose = require('mongoose');
const MissionTask = require('../models/MissionTask');
const { executeTaskWithAgent } = require('../agents/agentExecutionGateway');

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

  // Dispatch task to specialized agent through the Agent Execution Gateway
  const agentResult = await executeTaskWithAgent(task, { options });
  return agentResult;
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

  // 4. Execute deterministic task work
  try {
    await executeTaskWork(runningTask, options);

    // 5a. Transition: running -> completed
    const completedTask = await MissionTask.findOneAndUpdate(
      { _id: taskId, status: 'running' },
      { $set: { status: 'completed' } },
      { returnDocument: 'after' }
    );

    if (!completedTask) {
      throw new Error(`Failed to mark task ${taskId} as completed (concurrent state change)`);
    }

    return completedTask;
  } catch (workError) {
    // 5b. Transition: running -> failed
    console.error(`[TASK EXECUTOR] Task ${taskId} failed:`, workError.message);
    await MissionTask.findOneAndUpdate(
      { _id: taskId, status: 'running' },
      { $set: { status: 'failed' } },
      { returnDocument: 'after' }
    );
    throw workError;
  }
}

module.exports = {
  executeMissionTask,
  executeTaskWork,
};
