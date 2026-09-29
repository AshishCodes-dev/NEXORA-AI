const { createAgent } = require('./baseAgent');

const analystAgent = createAgent({
  id: 'analyst',
  name: 'Analyst Agent',
  description: 'Context compaction, comparative reasoning, inductive synthesis, and task decomposition.',
  capabilities: ['analysis', 'reasoning', 'evaluation', 'decomposition'],
});

module.exports = analystAgent;
