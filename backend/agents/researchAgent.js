const { createAgent } = require('./baseAgent');

const researchAgent = createAgent({
  id: 'research',
  name: 'Research Agent',
  description: 'Deep intelligence retrieval, semantic vector analysis, and domain knowledge synthesis.',
  capabilities: ['research', 'retrieval', 'synthesis', 'knowledge-indexing'],
});

module.exports = researchAgent;
