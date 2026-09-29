const { GoogleGenAI } = require('@google/genai');

/**
 * Target Gemini model for structured task decomposition
 * Defaults to 'gemini-3.8-flash' as designated in Step 7B.1 specification,
 * overridable via GEMINI_MODEL environment variable.
 */
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

/**
 * Strict JSON schema for mission task decomposition
 */
const MISSION_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
          },
          description: {
            type: 'string',
          },
          order: {
            type: 'integer',
            minimum: 1,
          },
        },
        required: ['title', 'description', 'order'],
      },
    },
  },
  required: ['tasks'],
};

/**
 * System instruction prompt defining the role and boundary of the NEXORA mission planner
 */
const SYSTEM_INSTRUCTION = `You are the planning engine for NEXORA, an autonomous AI workspace.

Your job is to decompose a user's mission into concrete, ordered, executable tasks.

Rules:
- Understand the actual objective.
- Produce only tasks necessary to accomplish it.
- Tasks must be specific to the objective.
- Avoid generic filler tasks.
- Do not claim that research has already happened.
- Do not invent evidence.
- Do not invent URLs.
- Do not claim external tools were used.
- Do not execute the tasks.
- Only create the plan.
- Keep tasks logically ordered.
- Produce between 2 and 8 tasks when appropriate.
- Each task must have a clear title and actionable description.
- Order must start at 1 and increment sequentially.`;

/**
 * Initializes and returns the official GoogleGenAI client
 * Throws a clear error if GEMINI_API_KEY is not configured
 * 
 * @param {string} [customApiKey] - Optional API key override (e.g. for testing)
 * @returns {GoogleGenAI}
 */
function getGeminiClient(customApiKey) {
  const rawKey = customApiKey !== undefined ? customApiKey : (process.env.GEMINI_API_KEY || '');
  const apiKey = (rawKey || '').trim();

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing. Please set GEMINI_API_KEY in your environment or backend/.env file.');
  }

  return new GoogleGenAI({ apiKey });
}

/**
 * Validates the raw parsed output from Gemini against strict structural and integrity rules
 * 
 * @param {any} raw - Parsed response payload
 * @returns {{ tasks: Array<{ title: string, description: string, order: number }> }}
 */
function validateMissionPlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Malformed model output: response must be a valid JSON object');
  }

  if (!Array.isArray(raw.tasks)) {
    throw new Error('Malformed model output: missing or invalid "tasks" array');
  }

  const { tasks } = raw;

  if (tasks.length === 0 || tasks.length > 10) {
    throw new Error(`Malformed model output: task count must be between 1 and 10 (received ${tasks.length})`);
  }

  const validatedTasks = [];
  const seenOrders = new Set();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    if (!task || typeof task !== 'object') {
      throw new Error(`Invalid task structure at index ${i}`);
    }

    if (typeof task.title !== 'string' || !task.title.trim()) {
      throw new Error(`Invalid task title at index ${i}: title must be a non-empty string`);
    }

    if (typeof task.description !== 'string' || !task.description.trim()) {
      throw new Error(`Invalid task description at index ${i}: description must be a non-empty string`);
    }

    if (typeof task.order !== 'number' || !Number.isInteger(task.order) || task.order < 1) {
      throw new Error(`Invalid task order at index ${i}: order must be an integer >= 1`);
    }

    if (seenOrders.has(task.order)) {
      throw new Error(`Duplicate task order detected at index ${i}: order ${task.order} already assigned`);
    }
    seenOrders.add(task.order);

    validatedTasks.push({
      title: task.title.trim(),
      description: task.description.trim(),
      order: task.order,
    });
  }

  // Sort by order to ensure chronological ordering
  validatedTasks.sort((a, b) => a.order - b.order);

  // Verify orders start at 1 and are sequential without gaps (1, 2, 3, ...)
  for (let i = 0; i < validatedTasks.length; i++) {
    const expectedOrder = i + 1;
    if (validatedTasks[i].order !== expectedOrder) {
      throw new Error(`Non-sequential task orders: expected order ${expectedOrder} at position ${i}, but found ${validatedTasks[i].order}`);
    }
  }

  return { tasks: validatedTasks };
}

/**
 * Generates an objective-specific structured mission plan using the Gemini API
 * 
 * @param {string} objective - The user's operational directive
 * @param {object} [options={}] - Optional configuration (e.g. model override, customApiKey)
 * @returns {Promise<{ tasks: Array<{ title: string, description: string, order: number }> }>}
 */
async function generateMissionPlan(objective, options = {}) {
  // 1. Input validation
  if (typeof objective !== 'string' || !objective.trim()) {
    throw new Error('Mission objective is required and must be a non-empty string');
  }

  const trimmedObjective = objective.trim();
  const modelName = options.model || DEFAULT_MODEL;

  // 2. Initialize client (fails clearly if API key is absent)
  const ai = getGeminiClient(options.apiKey);

  const promptContent = `User mission:\n\n${trimmedObjective}`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: modelName,
      contents: promptContent,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: MISSION_PLAN_SCHEMA,
        temperature: 0.2, // Low temperature for deterministic, structured decomposition
      },
    });
  } catch (apiError) {
    // Sanitize error logging to ensure API keys are never leaked in error logs or thrown exceptions
    const rawMsg = apiError.message || String(apiError);
    const sanitizedMsg = rawMsg.replace(/AIzaSy[A-Za-z0-9_-]{33}/g, '[REDACTED_API_KEY]');

    console.error(`[GEMINI SERVICE ERROR] Call to model '${modelName}' failed:`, sanitizedMsg);

    if (apiError.status === 429 || sanitizedMsg.includes('429') || sanitizedMsg.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('Gemini API rate limit exceeded. Please wait a moment before trying again.');
    }

    if (apiError.status === 403 || sanitizedMsg.includes('403') || sanitizedMsg.includes('PERMISSION_DENIED')) {
      throw new Error('Gemini API access denied. Ensure the Generative Language API is enabled for your project.');
    }

    if (apiError.status === 400 || sanitizedMsg.includes('API_KEY_INVALID') || sanitizedMsg.includes('API key not valid')) {
      throw new Error('Invalid Gemini API key. Please check your GEMINI_API_KEY configuration.');
    }

    throw new Error(`Gemini AI service error: ${sanitizedMsg}`);
  }

  // 3. Extract and parse response text
  const responseText = response?.text;
  if (!responseText || typeof responseText !== 'string' || !responseText.trim()) {
    throw new Error('Empty or invalid response received from Gemini model');
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(responseText.trim());
  } catch (parseError) {
    console.error('[GEMINI SERVICE ERROR] Failed to parse model JSON output:', responseText.slice(0, 150));
    throw new Error('Failed to parse structured response from Gemini model');
  }

  // 4. Validate output integrity against strict domain rules
  const validatedPlan = validateMissionPlan(parsedJson);

  return validatedPlan;
}

module.exports = {
  generateMissionPlan,
  validateMissionPlan,
  getGeminiClient,
  MISSION_PLAN_SCHEMA,
  DEFAULT_MODEL,
};
