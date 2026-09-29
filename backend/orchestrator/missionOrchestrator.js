const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const { planMission } = require('./missionPlanner');
const { createMissionTasks } = require('./taskManager');
const { executeMissionTask } = require('./taskExecutor');

/**
 * Creates the deterministic execution plan for a newly submitted mission.
 * 
 * NOTE: This module only prepares the mission execution plan.
 * It does not execute tasks, call AI/LLMs, use timers, queues, or external services.
 * 
 * @param {object} mission - The persisted Mission document
 * @returns {Promise<{mission: object, tasks: Array<object>}>}
 */
async function createMissionExecutionPlan(mission) {
  // 1. Validate mission
  if (!mission || !mission._id || typeof mission.objective !== 'string') {
    throw new Error('Valid mission document with _id and objective is required');
  }

  // 2. Deterministic decomposition
  const taskDefinitions = planMission(mission.objective);

  // 3. Persist mission tasks
  const tasks = await createMissionTasks(mission._id, taskDefinitions);

  // 4. Return execution plan
  return {
    mission,
    tasks,
  };
}

/**
 * Executes a mission through its lifecycle:
 * planning -> running -> completed (or running -> failed).
 * 
 * Tasks are executed sequentially in strict order (1, 2, 3, 4).
 * Concurrency guard ensures a mission cannot be executed twice.
 * 
 * @param {mongoose.Types.ObjectId|string} missionId - The Mission ID to execute
 * @param {object} [options={}] - Execution options (e.g. testing delays/failures)
 * @returns {Promise<{mission: object, tasks: Array<object>, failed?: boolean, error?: string, alreadyRan?: boolean}>}
 */
async function executeMission(missionId, options = {}) {
  // 1. Validate missionId
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    throw new Error('Invalid or missing missionId');
  }

  // 2. Transition mission: planning/queued -> running (atomic guard against duplicate execution)
  const mission = await Mission.findOneAndUpdate(
    { _id: missionId, status: { $in: ['planning', 'queued'] } },
    { $set: { status: 'running' } },
    { returnDocument: 'after' }
  );

  if (!mission) {
    const existing = await Mission.findById(missionId);
    if (!existing) {
      throw new Error(`Mission ${missionId} not found`);
    }
    // Mission is already running, completed, or failed - exit safely without duplicating execution
    return { mission: existing, alreadyRan: true };
  }

  // 3. Load associated tasks ordered by `order`
  const tasks = await MissionTask.find({ missionId }).sort({ order: 1 });
  if (!tasks || tasks.length === 0) {
    await Mission.findByIdAndUpdate(missionId, { $set: { status: 'failed' } });
    throw new Error(`No tasks found for mission ${missionId}`);
  }

  // 4. Execute tasks strictly sequentially
  const executedTasks = [];
  try {
    for (const task of tasks) {
      const executed = await executeMissionTask(task._id, options);
      executedTasks.push(executed);
    }

    // 5. Transition mission: running -> completed
    const completedMission = await Mission.findByIdAndUpdate(
      missionId,
      { $set: { status: 'completed' } },
      { returnDocument: 'after' }
    );

    return {
      mission: completedMission,
      tasks: executedTasks,
      failed: false,
    };
  } catch (executionError) {
    // 6. Transition mission: running -> failed on any task error
    console.error(`[MISSION ORCHESTRATOR] Mission ${missionId} task execution failed:`, executionError.message);
    const failedMission = await Mission.findByIdAndUpdate(
      missionId,
      { $set: { status: 'failed' } },
      { returnDocument: 'after' }
    );

    return {
      mission: failedMission,
      tasks: executedTasks,
      error: executionError.message,
      failed: true,
    };
  }
}

module.exports = {
  createMissionExecutionPlan,
  executeMission,
};
