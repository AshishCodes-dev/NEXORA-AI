const { planMission } = require('./missionPlanner');
const { createMissionTasks } = require('./taskManager');

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

module.exports = {
  createMissionExecutionPlan,
};
