const { createAgent } = require('./baseAgent');

const criticAgent = createAgent({
  id: 'critic',
  name: 'Critic Agent',
  description: 'Logic auditing, consistency assertions, safety constraint checks, and plan verification.',
  capabilities: ['critique', 'validation', 'audit', 'constraint-checking'],
});

module.exports = criticAgent;
