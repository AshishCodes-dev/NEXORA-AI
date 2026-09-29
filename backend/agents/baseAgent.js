/**
 * Base Agent Factory
 * 
 * Provides a standardized contract and constructor for all NEXORA specialized agents.
 * Every agent exposes:
 * - id: unique identifier
 * - name: human-readable name
 * - description: operational purpose
 * - capabilities: array of operational capabilities
 * - execute(task, context): async execution function returning a normalized result
 */

/**
 * Creates a specialized agent conforming to the NEXORA agent contract.
 * 
 * @param {object} config
 * @param {string} config.id - Unique agent ID (e.g. 'research', 'browser')
 * @param {string} config.name - Display name of the agent
 * @param {string} config.description - Functional description
 * @param {string[]} config.capabilities - Array of capability tags
 * @param {Function} [config.executeHandler] - Custom execution handler
 * @returns {object} Agent instance conforming to the standard contract
 */
function createAgent({ id, name, description, capabilities, executeHandler }) {
  if (!id || typeof id !== 'string') {
    throw new Error('Agent id must be a non-empty string');
  }
  if (!name || typeof name !== 'string') {
    throw new Error('Agent name must be a non-empty string');
  }
  if (!Array.isArray(capabilities)) {
    throw new Error('Agent capabilities must be an array');
  }

  return {
    id,
    name,
    description: description || '',
    capabilities,
    execute: async (task, context = {}) => {
      if (!task || typeof task !== 'object') {
        throw new Error(`Agent [${id}] execute: valid task object is required`);
      }

      const taskId = task.taskId || (task._id ? task._id.toString() : 'unknown');

      // Test hook: controlled failure injection
      if (
        context.options?.failAgentId === id ||
        (context.options?.failTaskId && context.options.failTaskId.toString() === taskId)
      ) {
        throw new Error(`Injected failure for Agent [${id}] on task [${taskId}]`);
      }

      if (typeof executeHandler === 'function') {
        return await executeHandler(task, context);
      }

      // Standard simulated execution result
      // NOTE: This explicitly denotes SIMULATED execution. Real external agent actions
      // are deferred to later implementation phases.
      return {
        status: 'simulated',
        agentId: id,
        taskId,
        message: `SIMULATED AGENT EXECUTION: ${name} execution stub reached successfully.`,
        data: {
          executionType: 'simulated',
          agentName: name,
          capabilities,
          timestamp: new Date().toISOString(),
        },
      };
    },
  };
}

module.exports = {
  createAgent,
};
