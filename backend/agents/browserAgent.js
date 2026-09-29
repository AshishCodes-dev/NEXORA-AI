const { createAgent } = require('./baseAgent');

const browserAgent = createAgent({
  id: 'browser',
  name: 'Browser Agent',
  description: 'Automated DOM exploration, headless runtime navigation, and web telemetry retrieval.',
  capabilities: ['browser', 'navigation', 'dom-inspection', 'web-telemetry'],
});

module.exports = browserAgent;
