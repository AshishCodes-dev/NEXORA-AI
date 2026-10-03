const { createAgent } = require('./baseAgent');
const { analyzeTaskEvidence } = require('../services/analyst/analysisService');

/**
 * Real Analyst Agent Execution Handler
 * 
 * Consumes persisted Evidence records belonging to the given Mission and Task,
 * produces structured, evidence-grounded findings (via Gemini if available, or deterministic fallback),
 * and persists the Analysis document to MongoDB.
 * 
 * @param {object} task - Normalized task object
 * @param {object} [context={}] - Execution context
 * @returns {Promise<object>}
 */
async function executeAnalystTask(task, context = {}) {
  // 1. Task validation
  if (!task || typeof task !== 'object') {
    throw new Error('Analyst Agent: task object is required');
  }

  const taskId = task.taskId || (task._id ? task._id.toString() : null);
  if (!taskId) {
    throw new Error('Analyst Agent: task.taskId is required');
  }

  const missionId = task.missionId ? task.missionId.toString() : null;
  if (!missionId) {
    throw new Error('Analyst Agent: task.missionId is required');
  }

  // 2. Controlled failure injection hook for testing
  if (context.options?.failAnalyst === true) {
    throw new Error(`Injected failure for Analyst Agent on task [${taskId}]`);
  }

  // 3. Delegate to Analyst Service
  const result = await analyzeTaskEvidence({
    missionId,
    taskId,
    title: task.title || '',
    description: task.description || '',
    missionObjective: task.missionObjective || context.missionObjective || context.options?.missionObjective || null,
    options: context.options || {},
  });

  return result;
}

const analystAgent = createAgent({
  id: 'analyst',
  name: 'Analyst Agent',
  description: 'Evidence-grounded synthesis, comparative reasoning, constraint analysis, and insight extraction.',
  capabilities: ['evidence-analysis', 'comparative-reasoning', 'gap-detection', 'synthesis'],
  executeHandler: executeAnalystTask,
});

module.exports = analystAgent;
