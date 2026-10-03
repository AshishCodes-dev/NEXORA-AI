const mongoose = require('mongoose');
const MissionTask = require('../models/MissionTask');

/**
 * Validates and persists mission task documents for a given mission.
 * 
 * @param {mongoose.Types.ObjectId|string} missionId - The target Mission ID
 * @param {Array<{title: string, description: string, order: number}>} taskDefinitions - Array of task definitions
 * @returns {Promise<Array<import('mongoose').Document>>} Array of created or existing MissionTask documents
 */
async function createMissionTasks(missionId, taskDefinitions) {
  // 1. Validate missionId
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    throw new Error('Invalid or missing missionId');
  }

  // 2. Validate taskDefinitions
  if (!Array.isArray(taskDefinitions) || taskDefinitions.length === 0) {
    throw new Error('taskDefinitions must be a non-empty array');
  }

  for (let i = 0; i < taskDefinitions.length; i++) {
    const task = taskDefinitions[i];
    if (!task || typeof task.title !== 'string' || !task.title.trim()) {
      throw new Error(`Invalid task definition at index ${i}: missing or invalid title`);
    }
    if (typeof task.description !== 'string' || !task.description.trim()) {
      throw new Error(`Invalid task definition at index ${i}: missing or invalid description`);
    }
    if (typeof task.order !== 'number' || task.order < 1) {
      throw new Error(`Invalid task definition at index ${i}: order must be a number >= 1`);
    }
  }

  // 3. Prevent duplicate creation if already invoked for this mission
  const existingTasks = await MissionTask.find({ missionId }).sort({ order: 1 });
  if (existingTasks && existingTasks.length > 0) {
    return existingTasks;
  }

  // 4. Preserve task order and construct documents
  const sortedDefs = [...taskDefinitions].sort((a, b) => a.order - b.order);
  const taskDocs = sortedDefs.map((def) => ({
    missionId,
    title: def.title.trim(),
    description: def.description.trim(),
    status: 'pending',
    order: def.order,
    agentId: def.agentId || null,
    url: def.url || null,
    executionMetadata: def.missionObjective ? { missionObjective: def.missionObjective } : null,
  }));

  // 5. Persist tasks
  const createdTasks = await MissionTask.insertMany(taskDocs);
  return createdTasks;
}

module.exports = {
  createMissionTasks,
};
