const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const { generatePlan, planMission } = require('./missionPlanner');
const { createMissionTasks } = require('./taskManager');
const { executeMissionTask } = require('./taskExecutor');

/**
 * Creates the execution plan for a newly submitted mission.
 * Orchestrates plan generation through missionPlanner (AI with safe deterministic fallback)
 * and persists the tasks in MongoDB.
 * 
 * @param {object} mission - The persisted Mission document
 * @param {object} [options={}] - Optional planning options
 * @returns {Promise<{mission: object, tasks: Array<object>, planSource: string}>}
 */
async function createMissionExecutionPlan(mission, options = {}) {
  // 1. Validate mission
  if (!mission || !mission._id || typeof mission.objective !== 'string') {
    throw new Error('Valid mission document with _id and objective is required');
  }

  // 2. Generate plan via missionPlanner (Gemini with deterministic fallback)
  const planResult = await generatePlan(mission.objective, options);

  // 3. Persist mission tasks
  const tasks = await createMissionTasks(mission._id, planResult.tasks);

  // 4. Return execution plan
  return {
    mission,
    tasks,
    planSource: planResult.source,
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

  // 3. Load associated tasks to verify initial presence
  const initialTasks = await MissionTask.find({ missionId }).sort({ order: 1 });
  if (!initialTasks || initialTasks.length === 0) {
    await Mission.findByIdAndUpdate(missionId, { $set: { status: 'failed' } });
    throw new Error(`No tasks found for mission ${missionId}`);
  }

  // 4. Execute tasks strictly sequentially (dynamic pending queue)
  const executedTasks = [];
  const startTime = Date.now();
  const maxMissionDurationMs = options.totalTimeoutMs || 300000; // 5 minutes default
  try {
    while (true) {
      if (Date.now() - startTime > maxMissionDurationMs) {
        throw new Error(`Mission execution exceeded maximum allowable duration of ${maxMissionDurationMs}ms`);
      }

      const nextTask = await MissionTask.findOne({
        missionId,
        status: 'pending',
      }).sort({ order: 1 });

      if (!nextTask) {
        break;
      }

      const taskOptions = {
        ...options,
        missionObjective: mission.objective,
      };
      const executed = await executeMissionTask(nextTask._id, taskOptions);
      executedTasks.push(executed);

      // Dynamic Research -> Browser handoff
      // If the completed task was a research task and discovered candidates,
      // create and insert bounded, verified Browser inspection tasks before downstream tasks.
      const isResearchTask = executed.agentId === 'research' ||
        /\b(research|gather|information)\b/i.test(executed.title || '');

      if (isResearchTask && options.skipBrowserHandoff !== true) {
        const candidates = executed._agentResult?.data?.candidates ||
          executed.executionMetadata?.resultData?.candidates || [];

        if (Array.isArray(candidates) && candidates.length > 0) {
          const { createBrowserTasksFromResearch } = require('../services/research/browserHandoffService');
          await createBrowserTasksFromResearch({
            missionId,
            researchTaskId: executed._id,
            candidates,
            currentTaskOrder: executed.order,
            options: {
              ...options,
              missionObjective: mission.objective,
              taskTitle: executed.title,
            },
          });
        }
      }
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
