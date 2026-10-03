const { createAgent } = require('./baseAgent');
const { critiqueTaskAnalysis } = require('../services/critic/critiqueService');

/**
 * Real Critic Agent Execution Handler
 * 
 * Evaluates whether an existing persisted Analysis is actually supported by
 * the persisted Evidence records belonging to the same mission and task.
 * Audits citation integrity, detects contradictions, identifies gaps,
 * and persists the Critique document to MongoDB.
 * 
 * @param {object} task - Normalized task object
 * @param {object} [context={}] - Execution context
 * @returns {Promise<object>}
 */
async function executeCriticTask(task, context = {}) {
  // 1. Task validation
  if (!task || typeof task !== 'object') {
    throw new Error('Critic Agent: task object is required');
  }

  const taskId = task.taskId || (task._id ? task._id.toString() : null);
  if (!taskId) {
    throw new Error('Critic Agent: task.taskId is required');
  }

  const missionId = task.missionId ? task.missionId.toString() : null;
  if (!missionId) {
    throw new Error('Critic Agent: task.missionId is required');
  }

  // 2. Controlled failure injection hook for testing
  if (context.options?.failCritic === true) {
    throw new Error(`Injected failure for Critic Agent on task [${taskId}]`);
  }

  // 3. Delegate to Critique Service
  const result = await critiqueTaskAnalysis({
    missionId,
    taskId,
    missionObjective: task.missionObjective || context.missionObjective || context.options?.missionObjective || null,
    options: context.options || {},
  });

  return result;
}

const criticAgent = createAgent({
  id: 'critic',
  name: 'Critic Agent',
  description: 'Logic auditing, consistency assertions, safety constraint checks, and plan verification.',
  capabilities: ['critique', 'validation', 'audit', 'constraint-checking'],
  executeHandler: executeCriticTask,
});

module.exports = criticAgent;
