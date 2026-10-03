const { createAgent } = require('./baseAgent');
const { executeBrowserOperation } = require('../services/browser/browserService');
const { createBrowserFailureResult } = require('../services/browser/browserResult');
const { persistBrowserEvidence } = require('../services/browser/browserEvidenceService');

/**
 * Extracts a target URL from task fields, context, or textual description.
 * 
 * @param {object} task
 * @param {object} context
 * @returns {string|null}
 */
function resolveTargetUrl(task = {}, context = {}) {
  // 1. Direct explicit parameters
  if (task.url && typeof task.url === 'string') return task.url.trim();
  if (task.targetUrl && typeof task.targetUrl === 'string') return task.targetUrl.trim();
  if (context.url && typeof context.url === 'string') return context.url.trim();
  if (context.targetUrl && typeof context.targetUrl === 'string') return context.targetUrl.trim();
  if (task.input?.url && typeof task.input.url === 'string') return task.input.url.trim();
  if (context.input?.url && typeof context.input.url === 'string') return context.input.url.trim();

  // 2. Scan title and description for URL patterns
  const combinedText = `${task.title || ''} ${task.description || ''}`;
  const urlMatch = combinedText.match(/https?:\/\/[^\s"'<>)\]]+/i);
  if (urlMatch) {
    return urlMatch[0].trim();
  }

  return null;
}

/**
 * Resolves the browser operation: 'navigate', 'read', or 'extract'.
 * 
 * @param {object} task
 * @param {object} context
 * @returns {'navigate'|'read'|'extract'}
 */
function resolveOperation(task = {}, context = {}) {
  // 1. Explicit operation
  const explicit = task.operation || context.operation || task.input?.operation || context.input?.operation;
  if (explicit && typeof explicit === 'string') {
    const norm = explicit.trim().toLowerCase();
    if (['navigate', 'read', 'extract'].includes(norm)) {
      return norm;
    }
  }

  // 2. Deterministic inference from task keywords
  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
  if (/\b(extract|headings?|links?|metadata|schema)\b/.test(text)) {
    return 'extract';
  }
  if (/\b(read|content|body|text|full text|article)\b/.test(text)) {
    return 'read';
  }
  if (/\b(navigate|visit|reach|open|ping|status|reachability)\b/.test(text)) {
    return 'navigate';
  }

  // Default to extract for maximum structural utility
  return 'extract';
}

/**
 * Real Browser Agent Execution Handler
 * 
 * Dispatches real headless Playwright browser automation against verified target URLs,
 * captures structured observations, and persists grounded Evidence records into MongoDB.
 * 
 * @param {object} task - MissionTask definition
 * @param {object} [context={}] - Gateway execution context
 * @returns {Promise<object>} Standardized agent outcome
 */
async function executeBrowserTask(task, context = {}) {
  const taskId = task.taskId || (task._id ? task._id.toString() : 'browser-task');
  const missionId = task.missionId
    ? task.missionId.toString()
    : (context.missionId ? context.missionId.toString() : null);

  const targetUrl = resolveTargetUrl(task, context);
  const operation = resolveOperation(task, context);

  // If no explicit URL could be determined, return controlled failure without launching Chromium
  if (!targetUrl) {
    return createBrowserFailureResult({
      taskId,
      operation,
      errorCode: 'BROWSER_TARGET_MISSING',
      errorMessage: 'No explicit browser target URL was provided.',
      url: '',
      timingMs: 0,
    });
  }

  // Execute real Playwright browser operation
  const browserResult = await executeBrowserOperation({
    taskId,
    operation,
    url: targetUrl,
    options: context.options || {},
  });

  // If browser execution failed, return controlled failure
  if (browserResult.status !== 'completed') {
    return browserResult;
  }

  // Persist Evidence records to MongoDB if execution is bound to a mission
  let createdEvidence = [];
  if (missionId && taskId) {
    try {
      createdEvidence = await persistBrowserEvidence({
        missionId,
        taskId,
        browserResult,
        taskTitle: task.title || '',
      });
    } catch (evidenceErr) {
      console.error('[BROWSER AGENT] Evidence persistence error:', evidenceErr.message);
      return createBrowserFailureResult({
        taskId,
        operation,
        errorCode: 'EVIDENCE_PERSISTENCE_FAILED',
        errorMessage: `Failed to persist browser evidence: ${evidenceErr.message}`,
        url: targetUrl,
        timingMs: browserResult.data?.timingMs || 0,
      });
    }
  }

  // Return normalized agent output containing evidence and browser observations
  return {
    status: 'completed',
    agentId: 'browser',
    taskId,
    message: createdEvidence.length > 0
      ? `Real browser execution completed. Extracted and persisted ${createdEvidence.length} verified evidence items from '${browserResult.data?.title || targetUrl}'.`
      : browserResult.message,
    data: {
      operation: browserResult.data?.operation || operation,
      requestedUrl: targetUrl,
      finalUrl: browserResult.data?.finalUrl || targetUrl,
      title: browserResult.data?.title || '',
      httpStatus: browserResult.data?.httpStatus || 200,
      timingMs: browserResult.data?.timingMs || 0,
      evidenceCount: createdEvidence.length,
      evidence: createdEvidence.map(e => ({
        id: e._id ? e._id.toString() : null,
        claim: e.claim,
        sourceUrl: e.sourceUrl,
        sourceTitle: e.sourceTitle,
      })),
      extractedText: browserResult.data?.text || '',
      headings: browserResult.data?.headings || [],
      links: browserResult.data?.links || [],
      metadata: {
        description: browserResult.data?.description || '',
        truncated: browserResult.data?.truncated || false,
      },
      error: null,
    },
  };
}

const browserAgent = createAgent({
  id: 'browser',
  name: 'Browser Agent',
  description: 'Automated DOM exploration, headless runtime navigation, and web telemetry retrieval.',
  capabilities: ['browser', 'navigation', 'dom-inspection', 'web-telemetry', 'content-extraction'],
  executeHandler: executeBrowserTask,
});

module.exports = browserAgent;
