const researchAgent = require('./researchAgent');
const browserAgent = require('./browserAgent');
const analystAgent = require('./analystAgent');
const criticAgent = require('./criticAgent');
const builderAgent = require('./builderAgent');
const qaAgent = require('./qaAgent');

/**
 * Single source of truth for all registered NEXORA agents
 */
const AGENT_REGISTRY = Object.freeze({
  research: researchAgent,
  browser: browserAgent,
  analyst: analystAgent,
  critic: criticAgent,
  builder: builderAgent,
  qa: qaAgent,
});

/**
 * Retrieves an agent instance by its unique identifier.
 * Throws a controlled application error if the agent is unknown.
 * 
 * @param {string} agentId - The unique agent identifier
 * @returns {object} The requested agent instance
 */
function getAgent(agentId) {
  if (!agentId || typeof agentId !== 'string') {
    throw new Error(`Invalid agent ID: '${agentId}'. Agent ID must be a non-empty string.`);
  }

  const normalizedId = agentId.trim().toLowerCase();
  const agent = AGENT_REGISTRY[normalizedId];

  if (!agent) {
    const available = Object.keys(AGENT_REGISTRY).join(', ');
    throw new Error(`Unknown agent ID '${agentId}'. Available agents: [${available}]`);
  }

  return agent;
}

/**
 * Returns a list of all registered agent instances
 * 
 * @returns {Array<object>}
 */
function listAgents() {
  return Object.values(AGENT_REGISTRY);
}

/**
 * Returns a list of all registered agent ID strings
 * 
 * @returns {Array<string>}
 */
function listAgentIds() {
  return Object.keys(AGENT_REGISTRY);
}

module.exports = {
  getAgent,
  listAgents,
  listAgentIds,
  AGENT_REGISTRY,
};
