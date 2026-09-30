const { createAgent } = require('./baseAgent');
const { buildTaskArtifact } = require('../services/builder/artifactService');

/**
 * Real Builder Agent Execution Handler
 * 
 * Synthesizes a structured, evidence-grounded deliverable Artifact
 * from verified Analysis, Evidence, and Critique data.
 * 
 * @param {object} task - Normalized task object
 * @param {object} [context={}] - Execution context
 * @returns {Promise<object>}
 */
async function executeBuilderTask(task, context = {}) {
  // 1. Task validation
  if (!task || typeof task !== 'object') {
    throw new Error('Builder Agent: task object is required');
  }

  const taskId = task.taskId || (task._id ? task._id.toString() : null);
  if (!taskId) {
    throw new Error('Builder Agent: task.taskId is required');
  }

  const missionId = task.missionId ? task.missionId.toString() : null;
  if (!missionId) {
    throw new Error('Builder Agent: task.missionId is required');
  }

  // 2. Controlled failure injection hook for testing
  if (context.options?.failBuilder === true) {
    throw new Error(`Injected failure for Builder Agent on task [${taskId}]`);
  }

  // 3. Delegate to Artifact Service
  const result = await buildTaskArtifact({
    missionId,
    taskId,
    options: context.options || {},
  });

  return result;
}

const builderAgent = createAgent({
  id: 'builder',
  name: 'Builder Agent',
  description: 'Artifact generation, code synthesis, structural scaffolding, and deliverable assembly.',
  capabilities: ['builder', 'code-generation', 'artifact-construction', 'scaffolding'],
  executeHandler: executeBuilderTask,
});

module.exports = builderAgent;
