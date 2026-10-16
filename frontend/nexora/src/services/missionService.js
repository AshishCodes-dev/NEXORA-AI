/**
 * Centralized Mission API & Telemetry Client
 * NEXORA Phase 2.9 — Real Mission Telemetry Integration
 *
 * Guarantees:
 * - Centralizes backend base URL via import.meta.env.VITE_API_URL || 'http://localhost:5000'
 * - Uses credentials: 'include' for HttpOnly cookie session transmission
 * - Sourced strictly by missionId without transmitting client-side credentials
 * - Subscribes to real backend events via GET /api/missions/:id/events?sinceSeq=...
 * - Provides event transformation and evidence mapping for UI consumption
 */

import { API_BASE_URL } from './apiConfig';

export { API_BASE_URL };

export class MissionApiError extends Error {
  constructor(message, status = null, code = null) {
    super(message);
    this.name = 'MissionApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Backward compatibility alias for existing callers of MissionResultError
 */
export const MissionResultError = MissionApiError;

/**
 * Helper to format a Date into HH:MM:SS string
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatTimeString(date = new Date()) {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Dispatches a new mission directive to the backend API.
 *
 * @param {object} params
 * @param {string} params.objective - The user directive
 * @param {string} [params.priority='medium']
 * @param {string} [params.modelTier='balanced']
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ success: boolean, mission: object, tasks?: Array<object> }>}
 */
export async function createMission({ objective, priority = 'medium', modelTier = 'balanced' } = {}, options = {}) {
  if (!objective || typeof objective !== 'string' || !objective.trim()) {
    throw new MissionApiError('Mission objective cannot be empty.', 400, 'INVALID_DIRECTIVE');
  }

  const url = `${API_BASE_URL}/api/missions`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      credentials: 'include',
      signal: options.signal,
      body: JSON.stringify({
        objective: objective.trim(),
        priority,
        modelTier,
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new MissionApiError(
      'NEXORA backend unavailable. Ensure the server is online.',
      null,
      'NETWORK_ERROR'
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new MissionApiError(
      `Server returned unexpected non-JSON response (HTTP ${response.status})`,
      response.status,
      'PARSE_ERROR'
    );
  }

  if (!response.ok || !data?.success) {
    if (response.status === 401) {
      throw new MissionApiError(
        data?.message || data?.error || 'Authentication required. Please log in.',
        401,
        'UNAUTHENTICATED'
      );
    }
    throw new MissionApiError(
      data?.message || data?.error || `Mission initialization failed (HTTP ${response.status})`,
      response.status,
      'SERVER_ERROR'
    );
  }

  return data;
}

/**
 * Retrieves chronological events and decisions for a mission with sequence cursor support.
 *
 * @param {string} missionId - MongoDB ObjectId string
 * @param {object} [options={}]
 * @param {number} [options.sinceSeq] - Sequence cursor (fetches events with seq > sinceSeq)
 * @param {number} [options.limit=50] - Maximum number of events to fetch
 * @param {AbortSignal} [options.signal] - AbortSignal for in-flight cancellation
 * @returns {Promise<{
 *   success: boolean,
 *   missionId: string,
 *   count: number,
 *   total: number,
 *   skip: number,
 *   sinceSeq?: number,
 *   nextSeq: number,
 *   events: Array<object>
 * }>}
 */
export async function getMissionEvents(missionId, options = {}) {
  if (!missionId || typeof missionId !== 'string' || !missionId.trim()) {
    throw new MissionApiError('Mission ID is required', 400, 'INVALID_MISSION_ID');
  }

  const cleanMissionId = missionId.trim();
  const queryParams = new URLSearchParams();

  if (options.sinceSeq !== undefined && options.sinceSeq !== null) {
    queryParams.set('sinceSeq', String(options.sinceSeq));
  }
  if (options.limit !== undefined && options.limit !== null) {
    queryParams.set('limit', String(options.limit));
  }

  const queryString = queryParams.toString();
  const url = `${API_BASE_URL}/api/missions/${encodeURIComponent(cleanMissionId)}/events${queryString ? `?${queryString}` : ''}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'include',
      signal: options.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new MissionApiError(
      'NEXORA backend gateway unreachable. Check network connection.',
      null,
      'NETWORK_ERROR'
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new MissionApiError(
      `Unexpected non-JSON response from backend (HTTP ${response.status})`,
      response.status,
      'PARSE_ERROR'
    );
  }

  if (!response.ok || !data?.success) {
    if (response.status === 401) {
      throw new MissionApiError(
        data?.message || data?.error || 'Authentication required. Please log in.',
        401,
        'UNAUTHENTICATED'
      );
    }
    if (response.status === 404) {
      throw new MissionApiError(
        data?.error || 'Mission not found or access denied.',
        404,
        'NOT_FOUND'
      );
    }
    throw new MissionApiError(
      data?.error || data?.message || `Failed to fetch events (HTTP ${response.status})`,
      response.status,
      'SERVER_ERROR'
    );
  }

  return data;
}

/**
 * Fetches the complete aggregated final result for a mission.
 *
 * @param {string} missionId - MongoDB ObjectId string of the mission
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal] - Optional AbortSignal for request cancellation
 * @returns {Promise<object>}
 */
export async function getMissionResult(missionId, options = {}) {
  if (!missionId || typeof missionId !== 'string' || !missionId.trim()) {
    throw new MissionApiError('Mission ID is required', 400, 'INVALID_MISSION_ID');
  }

  const cleanMissionId = missionId.trim();
  const url = `${API_BASE_URL}/api/missions/${encodeURIComponent(cleanMissionId)}/result`;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'include',
      signal: options.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new MissionApiError(
      'NEXORA backend gateway unreachable. Check network connection.',
      null,
      'NETWORK_ERROR'
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new MissionApiError(
      `Unexpected non-JSON response from backend (HTTP ${response.status})`,
      response.status,
      'PARSE_ERROR'
    );
  }

  if (!response.ok || !data?.success) {
    if (response.status === 401) {
      throw new MissionApiError(
        data?.message || 'Authentication required. Please log in.',
        401,
        'UNAUTHENTICATED'
      );
    }
    if (response.status === 404) {
      throw new MissionApiError(
        data?.error || 'Mission not found or access denied.',
        404,
        'NOT_FOUND'
      );
    }
    throw new MissionApiError(
      data?.error || `Failed to retrieve mission result (HTTP ${response.status})`,
      response.status,
      'SERVER_ERROR'
    );
  }

  return data;
}

/**
 * Checks backend health status.
 *
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ status: string, message: string }>}
 */
export async function checkBackendHealth(options = {}) {
  const url = `${API_BASE_URL}/api/health`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new MissionApiError(`Health check failed (HTTP ${response.status})`, response.status, 'HEALTH_FAILED');
  }

  return await response.json();
}

/**
 * Agent ID to UI Module ID mapping
 */
const AGENT_MODULE_MAP = {
  research: 'MOD.01',
  browser: 'MOD.02',
  analyst: 'MOD.03',
  critic: 'MOD.04',
  builder: 'MOD.05',
  qa: 'MOD.06',
};

/**
 * Maps raw backend event to UI agent identifier
 *
 * @param {object} rawEvent
 * @returns {{ agentTag: string, activeAgentId: string|null }}
 */
export function mapEventToAgent(rawEvent = {}) {
  const metadata = rawEvent.metadata || {};
  const agentKey = String(metadata.agentId || rawEvent.agentId || '').trim().toLowerCase();

  if (agentKey && AGENT_MODULE_MAP[agentKey]) {
    return {
      agentTag: agentKey.toUpperCase(),
      activeAgentId: AGENT_MODULE_MAP[agentKey],
    };
  }

  // Infer from event type or action
  const type = String(rawEvent.type || '').toUpperCase();
  const decisionType = String(rawEvent.decisionType || '').toUpperCase();

  if (type.includes('RESEARCH') || decisionType === 'SELECT_SOURCE') {
    return { agentTag: 'RESEARCH', activeAgentId: 'MOD.01' };
  }
  if (type.includes('BROWSER') || decisionType === 'ADD_BROWSER_TASK') {
    return { agentTag: 'BROWSER', activeAgentId: 'MOD.02' };
  }
  if (type.includes('ANALYSIS') || type.includes('ANALYST')) {
    return { agentTag: 'ANALYST', activeAgentId: 'MOD.03' };
  }
  if (type.includes('CRITIQUE') || type.includes('CRITIC') || decisionType === 'BLOCK_MISSION') {
    return { agentTag: 'CRITIC', activeAgentId: 'MOD.04' };
  }
  if (type.includes('ARTIFACT') || type.includes('BUILD')) {
    return { agentTag: 'BUILDER', activeAgentId: 'MOD.05' };
  }
  if (type.includes('QA')) {
    return { agentTag: 'QA', activeAgentId: 'MOD.06' };
  }
  if (type === 'MISSION_PLANNING_STARTED' || decisionType === 'RETRY_TASK' || decisionType === 'CONTINUE_PIPELINE') {
    return { agentTag: 'PLANNER', activeAgentId: 'MOD.03' };
  }

  return { agentTag: 'CORE', activeAgentId: null };
}

/**
 * Maps raw backend event to system state constant
 *
 * @param {object} rawEvent
 * @returns {string|null}
 */
export function mapEventToSystemState(rawEvent = {}) {
  const type = String(rawEvent.type || '').toUpperCase();
  const metadata = rawEvent.metadata || {};
  const agentKey = String(metadata.agentId || rawEvent.agentId || '').trim().toLowerCase();

  if (type === 'MISSION_COMPLETED') return 'COMPLETE';
  if (type === 'MISSION_FAILED') return 'IDLE';
  if (type === 'MISSION_PLANNING_STARTED') return 'PLANNING';

  if (agentKey === 'research' || type.includes('RESEARCH')) return 'RESEARCHING';
  if (agentKey === 'browser' || type.includes('BROWSER')) return 'RESEARCHING';
  if (agentKey === 'analyst' || type.includes('ANALYSIS')) return 'ANALYZING';
  if (agentKey === 'critic' || type.includes('CRITIQUE')) return 'VERIFYING';
  if (agentKey === 'builder' || type.includes('ARTIFACT') || type.includes('BUILD')) return 'BUILDING';
  if (agentKey === 'qa' || type.includes('QA')) return 'QA';

  return null;
}

/**
 * Formats a raw backend event into a UI-safe execution feed event
 *
 * @param {object} rawEvent - Raw event from GET /api/missions/:id/events
 * @param {boolean} [isMissionTerminal=false]
 * @returns {object} Formatted event for ExecutionFeed
 */
export function formatTelemetryEvent(rawEvent, isMissionTerminal = false) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return {
      id: `evt-${Date.now()}`,
      seq: 0,
      timestamp: new Date().toISOString(),
      timeString: formatTimeString(new Date()),
      missionId: null,
      type: 'UNKNOWN',
      agentId: 'CORE',
      agentTag: 'CORE',
      title: 'OPERATIONAL LOG',
      description: 'System event recorded.',
      status: 'active',
      systemState: 'IDLE',
      activeAgentId: null,
      secondaryAgentId: null,
    };
  }

  const { agentTag, activeAgentId } = mapEventToAgent(rawEvent);
  const sysState = mapEventToSystemState(rawEvent);

  const createdAt = rawEvent.createdAt ? new Date(rawEvent.createdAt) : new Date();
  const timeStr = formatTimeString(createdAt);

  const type = String(rawEvent.type || 'EVENT').toUpperCase();
  const metadata = rawEvent.metadata || {};

  // Construct a concise, informative title
  let title = '';
  switch (type) {
    case 'MISSION_CREATED':
      title = 'MISSION INITIALIZED';
      break;
    case 'MISSION_PLANNING_STARTED':
      title = 'DECOMPOSING DIRECTIVE';
      break;
    case 'TASK_STARTED':
      title = metadata.title
        ? `TASK [${metadata.order || 1}]: ${metadata.title}`.toUpperCase()
        : 'TASK INITIALIZED';
      break;
    case 'TASK_COMPLETED':
      title = metadata.title
        ? `COMPLETED: ${metadata.title}`.toUpperCase()
        : 'TASK COMPLETED';
      break;
    case 'TASK_FAILED':
      title = metadata.title
        ? `FAILED: ${metadata.title}`.toUpperCase()
        : 'TASK EXECUTION FAILED';
      break;
    case 'TASK_RETRY_STARTED':
      title = `TASK RETRY (ATTEMPT ${metadata.attempt || 2})`;
      break;
    case 'TASK_ADDED':
      title = 'DYNAMIC TASK INJECTED';
      break;
    case 'EVIDENCE_COLLECTED':
      title = 'EVIDENCE RECORDED';
      break;
    case 'ANALYSIS_COMPLETED':
      title = 'SYNTHESIS MATRIX COMPILED';
      break;
    case 'CRITIQUE_COMPLETED':
      title = 'INVARIANT AUDIT COMPLETED';
      break;
    case 'ARTIFACT_CREATED':
      title = metadata.artifactType
        ? `ARTIFACT GENERATED: ${metadata.artifactType}`.toUpperCase()
        : 'ARTIFACT GENERATED';
      break;
    case 'QA_COMPLETED':
      title = 'QA VERDICT FINALIZED';
      break;
    case 'DECISION':
      title = rawEvent.decisionType
        ? `DECISION // ${rawEvent.decisionType}`.toUpperCase()
        : 'AUTONOMOUS DECISION';
      break;
    case 'MISSION_COMPLETED':
      title = 'MISSION COMPLETE // ALL INVARIANTS SATISFIED';
      break;
    case 'MISSION_FAILED':
      title = 'MISSION TERMINATED // PIPELINE ABORTED';
      break;
    default:
      // Graceful degradation for unknown event types
      title = type.replace(/_/g, ' ').toUpperCase();
      break;
  }

  // Construct a readable, technical description without leaking secrets
  let description = '';
  if (rawEvent.action) {
    description = rawEvent.action;
    if (rawEvent.outcome) {
      description += ` — ${rawEvent.outcome}`;
    }
  } else if (rawEvent.reason) {
    description = rawEvent.reason;
    if (rawEvent.outcome) {
      description += ` (${rawEvent.outcome})`;
    }
  } else if (rawEvent.outcome) {
    description = rawEvent.outcome;
  } else if (metadata.objective) {
    description = `Directive objective: "${metadata.objective}"`;
  } else {
    description = `Telemetry record ${rawEvent.seq ? `#${rawEvent.seq}` : ''} received from ${agentTag}.`;
  }

  // Determine status pill
  let status = 'active';
  if (type === 'MISSION_COMPLETED' || type === 'TASK_COMPLETED' || isMissionTerminal) {
    status = 'completed';
  } else if (type === 'TASK_FAILED' || type === 'MISSION_FAILED') {
    status = 'failed';
  }

  return {
    id: rawEvent.id || (rawEvent._id ? String(rawEvent._id) : `evt-${rawEvent.seq || Date.now()}`),
    seq: rawEvent.seq || null,
    timestamp: createdAt.toISOString(),
    timeString: timeStr,
    missionId: rawEvent.missionId || null,
    type,
    agentId: metadata.agentId || agentTag,
    agentTag,
    title,
    description,
    status,
    systemState: sysState,
    activeAgentId,
    secondaryAgentId: null,
  };
}

/**
 * Derives evidence stream updates from raw backend events
 *
 * @param {object} rawEvent
 * @returns {{ category: string, status: string, placeholder: string, timeString: string }|null}
 */
export function deriveEvidenceUpdate(rawEvent = {}) {
  const type = String(rawEvent.type || '').toUpperCase();
  const metadata = rawEvent.metadata || {};
  const agentKey = String(metadata.agentId || rawEvent.agentId || '').trim().toLowerCase();
  const now = rawEvent.createdAt ? new Date(rawEvent.createdAt) : new Date();
  const timeString = formatTimeString(now);

  if (type === 'EVIDENCE_COLLECTED' || agentKey === 'research' || type.includes('RESEARCH')) {
    const isDone = type === 'TASK_COMPLETED' || type === 'EVIDENCE_COLLECTED';
    return {
      category: 'RESEARCH',
      status: isDone ? 'READY' : 'COLLECTING',
      placeholder: isDone
        ? (rawEvent.action || rawEvent.outcome || 'Verified sources captured into semantic index.')
        : 'Querying external endpoints... Filtering through security gate.',
      timeString,
    };
  }

  if (agentKey === 'browser' || type.includes('BROWSER') || rawEvent.decisionType === 'ADD_BROWSER_TASK') {
    const isDone = type === 'TASK_COMPLETED';
    return {
      category: 'BROWSER',
      status: isDone ? 'READY' : 'COLLECTING',
      placeholder: isDone
        ? (rawEvent.action || rawEvent.outcome || 'DOM structural extraction complete.')
        : 'Headless Chromium session active... Inspecting target DOM.',
      timeString,
    };
  }

  if (agentKey === 'analyst' || type === 'ANALYSIS_COMPLETED') {
    const isDone = type === 'ANALYSIS_COMPLETED' || type === 'TASK_COMPLETED';
    return {
      category: 'ANALYST',
      status: isDone ? 'READY' : 'COLLECTING',
      placeholder: isDone
        ? (rawEvent.outcome || 'Analytical heuristics and metrics synthesized.')
        : 'Synthesizing evidence vectors and generating structural model...',
      timeString,
    };
  }

  if (agentKey === 'critic' || agentKey === 'qa' || type === 'CRITIQUE_COMPLETED' || type === 'QA_COMPLETED') {
    const isDone = type === 'CRITIQUE_COMPLETED' || type === 'QA_COMPLETED';
    return {
      category: 'CRITIC',
      status: isDone ? 'VERIFIED' : 'COLLECTING',
      placeholder: isDone
        ? (rawEvent.outcome || 'Invariants checked. All verification rubrics passed.')
        : 'Evaluating logic assertions and verifying empirical grounding...',
      timeString,
    };
  }

  return null;
}

/**
 * Safely cancels a mission and aborts active workers.
 *
 * @param {string} missionId - MongoDB ObjectId string of the mission
 * @param {object} [options={}]
 * @param {string} [options.reason='Mission cancelled by user']
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ success: boolean, message: string, cancelled: boolean, mission: object }>}
 */
export async function cancelMission(missionId, options = {}) {
  if (!missionId || typeof missionId !== 'string' || !missionId.trim()) {
    throw new MissionApiError('Mission ID is required', 400, 'INVALID_MISSION_ID');
  }

  const cleanMissionId = missionId.trim();
  const url = `${API_BASE_URL}/api/missions/${encodeURIComponent(cleanMissionId)}/cancel`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      credentials: 'include',
      signal: options.signal,
      body: JSON.stringify({
        reason: options.reason || 'Mission cancelled by user',
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new MissionApiError(
      'NEXORA backend gateway unreachable. Check network connection.',
      null,
      'NETWORK_ERROR'
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new MissionApiError(
      `Unexpected non-JSON response from backend (HTTP ${response.status})`,
      response.status,
      'PARSE_ERROR'
    );
  }

  if (!response.ok || !data?.success) {
    if (response.status === 401) {
      throw new MissionApiError(
        data?.message || 'Authentication required. Please log in.',
        401,
        'UNAUTHENTICATED'
      );
    }
    if (response.status === 404) {
      throw new MissionApiError(
        data?.error || 'Mission not found or access denied.',
        404,
        'NOT_FOUND'
      );
    }
    throw new MissionApiError(
      data?.error || data?.message || `Failed to cancel mission (HTTP ${response.status})`,
      response.status,
      'SERVER_ERROR'
    );
  }

  return data;
}

/**
 * Retries an eligible failed task in an active mission.
 *
 * @param {string} missionId - MongoDB ObjectId of the mission
 * @param {string} taskId - MongoDB ObjectId of the failed task
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ success: boolean, message: string, task: object, mission: object }>}
 */
export async function retryTask(missionId, taskId, options = {}) {
  if (!missionId || typeof missionId !== 'string' || !missionId.trim()) {
    throw new MissionApiError('Mission ID is required', 400, 'INVALID_MISSION_ID');
  }
  if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
    throw new MissionApiError('Task ID is required', 400, 'INVALID_TASK_ID');
  }

  const cleanMissionId = missionId.trim();
  const cleanTaskId = taskId.trim();
  const url = `${API_BASE_URL}/api/missions/${encodeURIComponent(cleanMissionId)}/tasks/${encodeURIComponent(cleanTaskId)}/retry`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'include',
      signal: options.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new MissionApiError(
      'NEXORA backend gateway unreachable. Check network connection.',
      null,
      'NETWORK_ERROR'
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new MissionApiError(
      `Unexpected non-JSON response from backend (HTTP ${response.status})`,
      response.status,
      'PARSE_ERROR'
    );
  }

  if (!response.ok || !data?.success) {
    if (response.status === 401) {
      throw new MissionApiError(
        data?.message || 'Authentication required. Please log in.',
        401,
        'UNAUTHENTICATED'
      );
    }
    if (response.status === 404) {
      throw new MissionApiError(
        data?.error || 'Mission or task not found.',
        404,
        'NOT_FOUND'
      );
    }
    if (response.status === 409) {
      throw new MissionApiError(
        data?.error || 'Task state changed concurrently or task is already running.',
        409,
        'CONFLICT'
      );
    }
    throw new MissionApiError(
      data?.error || data?.message || `Failed to retry task (HTTP ${response.status})`,
      response.status,
      'SERVER_ERROR'
    );
  }

  return data;
}
