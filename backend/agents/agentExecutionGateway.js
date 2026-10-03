const { getAgent } = require('./agentRegistry');

/**
 * Deterministically resolves the most appropriate agent ID for a given task.
 * Routing is derived from task characteristics (keywords in title and description).
 * 
 * Rules:
 * - Browser/web/DOM navigation -> 'browser'
 * - QA/test/assertions/quality -> 'qa'
 * - Critic/audit/verification/constraints -> 'critic'
 * - Builder/code/artifact/output -> 'builder'
 * - Research/gather/information/search -> 'research'
 * - Analyst/analyze/reasoning/evaluate -> 'analyst'
 * 
 * @param {object} task - The task being routed
 * @param {object} [context={}] - Execution context
 * @returns {string} Assigned agent identifier
 */
function routeTaskToAgent(task, context = {}) {
  // 1. Explicit override in context or task metadata
  if (context.agentId) return context.agentId;
  if (task.agentId) return task.agentId;

  const textToEvaluate = `${task.title || ''} ${task.description || ''}`.toLowerCase();

  // 2. Deterministic keyword matching (ordered by specificity)
  if (/\b(browser|web|url|website|site|page|dom|scrape|navigate)\b/.test(textToEvaluate)) {
    return 'browser';
  }

  if (/\b(qa|test|tests|testing|harness|unit test|quality assurance|test suite)\b/.test(textToEvaluate)) {
    return 'qa';
  }

  if (/\b(critic|audit|auditing|verify|verification|validate|validation|consistency|constraint|constraints|check logic)\b/.test(textToEvaluate)) {
    return 'critic';
  }

  if (/\b(builder|output|artifact|code|build|construct|prepare mission output|generate code|scaffold|assemble)\b/.test(textToEvaluate)) {
    return 'builder';
  }

  if (/\b(analyst|analyze|analysis|reasoning|compare|comparison|evaluate|evaluation|break down)\b/.test(textToEvaluate)) {
    return 'analyst';
  }

  if (/\b(research|gather|collect|information|retrieval|search|investigate|index)\b/.test(textToEvaluate)) {
    return 'research';
  }

  // 3. Fallback based on deterministic plan phase order
  if (task.order === 1) return 'analyst';
  if (task.order === 2) return 'research';
  if (task.order === 3) return 'analyst';
  if (task.order === 4) return 'builder';
  if (task.order === 5) return 'qa';

  return 'analyst';
}

/**
 * Dispatches and executes a MissionTask with the appropriate specialized agent.
 * 
 * @param {object} task - The MissionTask document or task definition
 * @param {object} [context={}] - Contextual metadata (mission info, execution options)
 * @returns {Promise<{status: string, agentId: string, taskId: string, message: string, data: object}>}
 */
async function executeTaskWithAgent(task, context = {}) {
  // 1. Task validation
  if (!task || typeof task !== 'object') {
    throw new Error('Invalid task: task object is required');
  }

  const taskId = task.taskId || (task._id ? task._id.toString() : null);
  if (!taskId) {
    throw new Error('Invalid task: missing taskId or _id');
  }

  const missionObjective = task.missionObjective ||
    task.executionMetadata?.missionObjective ||
    context.missionObjective ||
    context.options?.missionObjective ||
    undefined;

  const normalizedTask = {
    taskId,
    missionId: task.missionId ? task.missionId.toString() : null,
    agentId: task.agentId || undefined,
    title: task.title || '',
    description: task.description || '',
    order: task.order || 1,
    url: task.url || undefined,
    targetUrl: task.targetUrl || undefined,
    input: task.input || undefined,
    operation: task.operation || undefined,
    missionObjective,
  };

  // 2. Determine target agent
  const targetAgentId = routeTaskToAgent(normalizedTask, context);

  // 3. Look up agent from registry (throws controlled error if unknown)
  const agent = getAgent(targetAgentId);

  // 4. Execute agent
  const rawResult = await agent.execute(normalizedTask, context);

  // 5. Validate & normalize result
  if (!rawResult || typeof rawResult !== 'object') {
    throw new Error(`Agent [${targetAgentId}] returned invalid result: result must be an object`);
  }

  return {
    status: rawResult.status || 'simulated',
    agentId: rawResult.agentId || targetAgentId,
    taskId,
    message: rawResult.message || `SIMULATED AGENT EXECUTION: Agent ${targetAgentId} executed successfully.`,
    data: rawResult.data || {},
  };
}

module.exports = {
  executeTaskWithAgent,
  routeTaskToAgent,
};
