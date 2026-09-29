/**
 * NEXORA Mission Planner
 * 
 * Orchestrates mission task decomposition.
 * Primary: Attempts AI-powered plan generation via Gemini service.
 * Fallback: Safely degrades to deterministic task decomposition if Gemini is
 * unconfigured, rate-limited, unreachable, or returns invalid structure.
 */

const { generateMissionPlan } = require('../services/geminiService');

/**
 * Returns the deterministic fallback task plan (4 sequential phases)
 * 
 * @param {string} objective - The mission objective
 * @returns {Array<{title: string, description: string, order: number}>}
 */
function getDeterministicTasks(objective) {
  if (typeof objective !== 'string' || !objective.trim()) {
    throw new Error('Mission objective must be a non-empty string');
  }

  return [
    {
      title: 'Analyze mission objective',
      description: 'Break down the requested objective into actionable work.',
      order: 1,
    },
    {
      title: 'Gather required information',
      description: 'Identify and collect the information required to complete the mission.',
      order: 2,
    },
    {
      title: 'Analyze collected information',
      description: 'Analyze the gathered information against the mission objective.',
      order: 3,
    },
    {
      title: 'Prepare mission output',
      description: 'Prepare a structured result that addresses the original objective.',
      order: 4,
    },
  ];
}

/**
 * Categorizes an error message into a safe diagnostic reason code.
 * Ensures secrets, keys, and tokens are never exposed.
 * 
 * @param {string} rawError - The raw error message
 * @returns {string} Safe diagnostic code
 */
function categorizeError(rawError) {
  const msg = rawError || '';
  if (msg.includes('GEMINI_API_KEY is missing') || msg.includes('missing')) {
    return 'MISSING_API_KEY';
  }
  if (msg.includes('Invalid Gemini API key') || msg.includes('API_KEY_INVALID') || msg.includes('400')) {
    return 'PROVIDER_AUTH_ERROR';
  }
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return 'PROVIDER_RATE_LIMIT';
  }
  if (msg.includes('access denied') || msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
    return 'PROVIDER_PERMISSION_DENIED';
  }
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
    return 'PROVIDER_NETWORK_ERROR';
  }
  if (msg.includes('Malformed') || msg.includes('Invalid task') || msg.includes('parse') || msg.includes('Non-sequential')) {
    return 'PROVIDER_OUTPUT_VALIDATION_ERROR';
  }
  return 'PROVIDER_ERROR';
}

/**
 * Generates the task execution plan for a mission objective.
 * 
 * Attempts AI planning via Gemini first. If the provider fails, times out,
 * or is misconfigured, automatically falls back to deterministic planning.
 * 
 * @param {string} objective - The mission operational directive
 * @param {object} [options={}] - Optional overrides (e.g. forceDeterministic, test hooks)
 * @returns {Promise<{tasks: Array<{title: string, description: string, order: number}>, source: string, reason?: string}>}
 */
async function generatePlan(objective, options = {}) {
  // 1. Objective validation
  if (typeof objective !== 'string' || !objective.trim()) {
    throw new Error('Mission objective must be a non-empty string');
  }

  const trimmedObjective = objective.trim();

  // Test / override hook: allow deterministic forced path
  if (options.forceDeterministic) {
    return {
      tasks: getDeterministicTasks(trimmedObjective),
      source: 'deterministic-fallback',
      reason: 'FORCE_DETERMINISTIC_REQUESTED',
    };
  }

  // 2. Attempt AI planning via Gemini service
  try {
    const aiResult = await generateMissionPlan(trimmedObjective, options);

    if (aiResult && Array.isArray(aiResult.tasks) && aiResult.tasks.length > 0) {
      return {
        tasks: aiResult.tasks,
        source: 'gemini',
      };
    }

    throw new Error('Gemini provider returned empty task list');
  } catch (aiError) {
    // 3. Safe diagnostic logging without exposing secrets, headers, or tokens
    const reason = categorizeError(aiError.message);
    console.warn(`[AI_PLANNER] Gemini unavailable; using deterministic fallback. reason: ${reason}`);

    // 4. Safe fallback to deterministic tasks
    const fallbackTasks = getDeterministicTasks(trimmedObjective);
    return {
      tasks: fallbackTasks,
      source: 'deterministic-fallback',
      reason,
    };
  }
}

// Preserve backward-compatible alias for existing tests
const planMission = getDeterministicTasks;

module.exports = {
  generatePlan,
  getDeterministicTasks,
  planMission,
  categorizeError,
};
