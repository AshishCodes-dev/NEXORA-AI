const { createAgent } = require('./baseAgent');

const qaAgent = createAgent({
  id: 'qa',
  name: 'QA Agent',
  description: 'Automated test suite execution, assertion validations, and quality assurance verification.',
  capabilities: ['qa', 'testing', 'assertions', 'quality-assurance'],
});

module.exports = qaAgent;
