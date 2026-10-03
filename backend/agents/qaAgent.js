const { createAgent } = require('./baseAgent');
const { validateTaskArtifact } = require('../services/qa/qaService');

/**
 * Real QA Agent Execution Handler
 * 
 * Performs independent quality assurance validation of deliverable Artifacts
 * against persisted Mission, Evidence, Analysis, and Critique documents.
 * Persists an authoritative QAReport to MongoDB.
 * 
 * @param {object} task - Normalized task object
 * @param {object} [context={}] - Execution context
 * @returns {Promise<object>}
 */
async function executeQATask(task, context = {}) {
  // 1. Task validation
  if (!task || typeof task !== 'object') {
    throw new Error('QA Agent: task object is required');
  }

  const taskId = task.taskId || (task._id ? task._id.toString() : null);
  if (!taskId) {
    throw new Error('QA Agent: task.taskId is required');
  }

  const missionId = task.missionId ? task.missionId.toString() : null;
  if (!missionId) {
    throw new Error('QA Agent: task.missionId is required');
  }

  // 2. Controlled failure injection hook for testing
  if (context.options?.failQA === true) {
    throw new Error(`Injected failure for QA Agent on task [${taskId}]`);
  }

  // 3. Delegate to QA Service
  const result = await validateTaskArtifact({
    missionId,
    taskId,
    options: context.options || {},
    missionObjective: context.missionObjective,
  });

  return result;
}

const qaAgent = createAgent({
  id: 'qa',
  name: 'QA Agent',
  description: 'Automated test suite execution, assertion validations, and quality assurance verification.',
  capabilities: ['qa', 'testing', 'assertions', 'quality-assurance'],
  executeHandler: executeQATask,
});

module.exports = qaAgent;
