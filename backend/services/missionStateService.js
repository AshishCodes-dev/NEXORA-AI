const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');

/**
 * Bounds & safety limits for state responses
 */
const LIMITS = {
  MAX_MESSAGE_LENGTH: 300,
  MAX_CODE_LENGTH: 50,
};

/**
 * Sensitive patterns to sanitize blocking messages
 */
const SENSITIVE_PATTERNS = [
  { regex: /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, replace: '$1[REDACTED]' },
  { regex: /(AIzaSy[A-Za-z0-9_-]+)/g, replace: '[REDACTED_API_KEY]' },
  { regex: /(password\s*[:=]\s*)[^\s&,;]+/gi, replace: '$1[REDACTED]' },
  { regex: /(secret\s*[:=]\s*)[^\s&,;]+/gi, replace: '$1[REDACTED]' },
  { regex: /(cookie\s*[:=]\s*)[^\s&,;]+/gi, replace: '$1[REDACTED]' },
  { regex: /(jwt\s*[:=]\s*)[^\s&,;]+/gi, replace: '$1[REDACTED]' },
  { regex: /(\btoken\s*[:=]\s*)(?!Bearer)[^\s&,;]+/gi, replace: '$1[REDACTED]' },
];

/**
 * Sanitizes and bounds error / blocking messages
 *
 * @param {string} str
 * @param {number} [maxLength=LIMITS.MAX_MESSAGE_LENGTH]
 * @returns {string|null}
 */
function sanitizeBlockingMessage(str, maxLength = LIMITS.MAX_MESSAGE_LENGTH) {
  if (typeof str !== 'string' || !str.trim()) return null;

  let sanitized = str;
  for (const { regex, replace } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(regex, replace);
  }
  sanitized = sanitized.replace(/[\r\n]+/g, ' ').trim();

  if (sanitized.length <= maxLength) return sanitized;
  const suffix = '... [truncated]';
  if (maxLength <= suffix.length) {
    return sanitized.slice(0, maxLength);
  }
  return sanitized.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Maps an error message to a standardized, bounded error code
 *
 * @param {string} errMsg
 * @returns {string}
 */
function categorizeBlockingCode(errMsg) {
  if (!errMsg) return 'UNKNOWN_ERROR';
  const msg = String(errMsg).toUpperCase();

  if (msg.includes('TASK_TIMEOUT') || msg.includes('TIMEOUT') || msg.includes('TIMED OUT')) {
    return 'TASK_TIMEOUT';
  }
  if (
    msg.includes('BLOCKED_URL') ||
    msg.includes('PRIVATE_OR_RESERVED_IP') ||
    msg.includes('SSRF') ||
    msg.includes('SECURITY POLICY')
  ) {
    return 'SECURITY_VIOLATION';
  }
  if (msg.includes('INVALID_URL') || msg.includes('UNSAFE_PROTOCOL')) {
    return 'INVALID_URL';
  }
  if (msg.includes('REDIRECT_BLOCKED')) {
    return 'REDIRECT_BLOCKED';
  }
  if (msg.includes('AGENT_FAILED') || msg.includes('AGENT EXECUTION FAILED')) {
    return 'AGENT_FAILED';
  }
  if (msg.includes('VALIDATION_ERROR') || msg.includes('SCHEMA')) {
    return 'VALIDATION_ERROR';
  }
  if (
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('NETWORK')
  ) {
    return 'NETWORK_ERROR';
  }
  return 'TASK_EXECUTION_FAILED';
}

/**
 * Maps a MissionTask to its authoritative functional pipeline stage
 *
 * @param {object} task
 * @returns {'research'|'browser'|'analysis'|'critique'|'building'|'qa'}
 */
function mapTaskToStage(task) {
  if (!task) return 'research';
  const agentId = (task.agentId || '').toLowerCase();

  // 1. Explicit agentId takes absolute precedence
  if (agentId === 'browser') return 'browser';
  if (agentId === 'research') return 'research';
  if (agentId === 'analyst') return 'analysis';
  if (agentId === 'critic') return 'critique';
  if (agentId === 'builder') return 'building';
  if (agentId === 'qa') return 'qa';

  // 2. Fallback to descriptive text heuristic only if agentId is missing
  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();

  if (/\b(browser|extract|navigate|visit|dom|webpage)\b/.test(text)) {
    return 'browser';
  }
  if (/\b(research|gather|search|sources|candidate)\b/.test(text)) {
    return 'research';
  }
  if (/\b(analy|reasoning|evaluate|synthesis)\b/.test(text)) {
    return 'analysis';
  }
  if (/\b(critic|audit|review)\b/.test(text)) {
    return 'critique';
  }
  if (/\b(qa|quality|test|assertions)\b/.test(text)) {
    return 'qa';
  }
  if (/\b(build|artifact|deliverable|report)\b/.test(text)) {
    return 'building';
  }

  return 'research';
}

/**
 * Derives the authoritative pipeline STAGE from Mission and MissionTask state
 *
 * Precedence:
 * 1. Terminal mission completed -> 'completed'
 * 2. Terminal mission failed -> 'failed'
 * 3. Actively running task -> task's mapped stage
 * 4. Queued task -> task's mapped stage
 * 5. Mission running with pending tasks -> next pending task's stage
 * 6. Mission planning phase -> 'planning'
 * 7. Initial created phase -> 'created'
 *
 * @param {object} mission
 * @param {Array<object>} tasks
 * @returns {string}
 */
/**
 * Normalizes input tasks collection to a safe array of non-null objects
 *
 * @param {any} tasks
 * @returns {Array<object>}
 */
function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter((t) => t != null && typeof t === 'object');
}

/**
 * Derives the authoritative pipeline STAGE from Mission and MissionTask state
 *
 * Precedence:
 * 1. Terminal mission completed -> 'completed'
 * 2. Terminal mission failed -> 'failed'
 * 3. Actively running task -> task's mapped stage
 * 4. Queued task -> task's mapped stage
 * 5. Mission running with pending tasks -> next pending task's stage
 * 6. Mission planning phase -> 'planning'
 * 7. Initial created phase -> 'created'
 *
 * @param {object} mission
 * @param {Array<object>} tasks
 * @returns {string}
 */
function deriveMissionStage(mission, tasks = []) {
  if (!mission) return 'created';

  // 1. Terminal completion
  if (mission.status === 'completed') {
    return 'completed';
  }

  // 2. Terminal failure
  if (mission.status === 'failed') {
    return 'failed';
  }

  const safeTasks = normalizeTasks(tasks);

  // 3. Check for actively running task
  const runningTasks = safeTasks.filter((t) => t.status === 'running');
  if (runningTasks.length > 0) {
    runningTasks.sort((a, b) => ((a.order || 0) - (b.order || 0)) || String(a._id || '').localeCompare(String(b._id || '')));
    return mapTaskToStage(runningTasks[0]);
  }

  // 4. Check for queued task
  const queuedTasks = safeTasks.filter((t) => t.status === 'queued');
  if (queuedTasks.length > 0) {
    queuedTasks.sort((a, b) => ((a.order || 0) - (b.order || 0)) || String(a._id || '').localeCompare(String(b._id || '')));
    return mapTaskToStage(queuedTasks[0]);
  }

  // 5. Mission is running
  if (mission.status === 'running') {
    const pendingTasks = safeTasks.filter((t) => t.status === 'pending');
    if (pendingTasks.length > 0) {
      pendingTasks.sort((a, b) => ((a.order || 0) - (b.order || 0)) || String(a._id || '').localeCompare(String(b._id || '')));
      return mapTaskToStage(pendingTasks[0]);
    }
    const failedTask = safeTasks.find((t) => t.status === 'failed');
    if (failedTask) {
      return mapTaskToStage(failedTask);
    }
    if (safeTasks.length > 0 && safeTasks.every((t) => t.status === 'completed')) {
      return 'completed';
    }
  }

  // 6. Mission is in planning phase
  if (mission.status === 'planning') {
    return 'planning';
  }

  // 7. Mission is queued / initialized
  if (mission.status === 'queued') {
    return 'created';
  }

  return 'created';
}

/**
 * Derives the authoritative operational STATE from Mission and MissionTask state
 *
 * Allowed states: 'idle', 'running', 'waiting', 'retrying', 'blocked', 'completed', 'failed'
 *
 * Precedence:
 * 1. Terminal completed -> 'completed'
 * 2. Terminal failed -> 'failed'
 * 3. Unresolved task failure without active retry -> 'blocked'
 * 4. Active retry running/queued -> 'retrying'
 * 5. Actively running task or planning mission -> 'running'
 * 6. External wait / cooldown condition -> 'waiting'
 * 7. Default / unstarted -> 'idle'
 *
 * @param {object} mission
 * @param {Array<object>} tasks
 * @returns {'idle'|'running'|'waiting'|'retrying'|'blocked'|'completed'|'failed'}
 */
function deriveMissionOperationalState(mission, tasks = []) {
  if (!mission) return 'idle';

  // 1. Terminal completed
  if (mission.status === 'completed') {
    return 'completed';
  }

  // 2. Terminal failed
  if (mission.status === 'failed') {
    return 'failed';
  }

  const safeTasks = normalizeTasks(tasks);

  // 3. Blocked: if any task has status 'failed'
  const hasFailedTask = safeTasks.some((t) => t.status === 'failed');
  if (hasFailedTask) {
    // Check if there is an active retry in progress for the failed task
    const isRetrying = safeTasks.some(
      (t) => (t.status === 'running' || t.status === 'queued') &&
             ((t.executionMetadata?.attempt && t.executionMetadata.attempt > 1) || t.isRetrying)
    );
    if (!isRetrying) {
      return 'blocked';
    }
  }

  // 4. Retrying: task is running or queued with attempt > 1
  const isCurrentlyRetrying = safeTasks.some(
    (t) => (t.status === 'running' || t.status === 'queued') &&
           ((t.executionMetadata?.attempt && t.executionMetadata.attempt > 1) || t.isRetrying)
  );
  if (isCurrentlyRetrying) {
    return 'retrying';
  }

  // 5. Running: active task or mission actively running/planning
  const hasActiveTask = safeTasks.some((t) => t.status === 'running' || t.status === 'queued');
  if (hasActiveTask) {
    return 'running';
  }

  if (mission.status === 'running') {
    // Running mission with pending tasks
    const hasPendingTasks = safeTasks.some((t) => t.status === 'pending');
    if (hasPendingTasks) {
      return 'running';
    }
    // Check if waiting on dynamic task insertion or cooldown
    return 'running';
  }

  if (mission.status === 'planning') {
    return 'running';
  }

  // 6. Idle: queued or waiting to be dispatched
  if (mission.status === 'queued') {
    return 'idle';
  }

  return 'idle';
}

/**
 * Computes deterministic progress metrics from actual MissionTask collection
 *
 * Rules:
 * - totalTasks: actual task count
 * - pendingTasks: count where status === 'pending' || status === 'queued'
 * - runningTasks: count where status === 'running'
 * - completedTasks: count where status === 'completed'
 * - failedTasks: count where status === 'failed'
 * - percentage: floor((completedTasks / totalTasks) * 100) or 0 if totalTasks === 0
 *
 * @param {Array<object>} tasks
 * @returns {{ totalTasks: number, pendingTasks: number, runningTasks: number, completedTasks: number, failedTasks: number, percentage: number }}
 */
function computeTaskProgress(tasks = []) {
  const safeTasks = normalizeTasks(tasks);

  if (safeTasks.length === 0) {
    return {
      totalTasks: 0,
      pendingTasks: 0,
      runningTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      percentage: 0,
    };
  }

  const totalTasks = safeTasks.length;
  let pendingTasks = 0;
  let runningTasks = 0;
  let completedTasks = 0;
  let failedTasks = 0;

  for (const t of safeTasks) {
    if (t.status === 'completed') {
      completedTasks++;
    } else if (t.status === 'running') {
      runningTasks++;
    } else if (t.status === 'failed') {
      failedTasks++;
    } else {
      // 'pending' or 'queued'
      pendingTasks++;
    }
  }

  const percentage = totalTasks === 0
    ? 0
    : Math.min(100, Math.floor((completedTasks / totalTasks) * 100));

  return {
    totalTasks,
    pendingTasks,
    runningTasks,
    completedTasks,
    failedTasks,
    percentage,
  };
}

/**
 * Resolves the currently active task deterministically
 *
 * Selection rule:
 * Filters tasks with status === 'running'.
 * If multiple, sorts deterministically by order ASC, then _id ASC.
 * Returns null if no task is running.
 *
 * @param {Array<object>} tasks
 * @returns {{ taskId: string, agentId: string|null, status: string }|null}
 */
function resolveActiveTask(tasks = []) {
  const safeTasks = normalizeTasks(tasks);
  if (safeTasks.length === 0) return null;

  const runningTasks = safeTasks.filter((t) => t.status === 'running');
  if (runningTasks.length === 0) return null;

  runningTasks.sort((a, b) => {
    if (a.order !== b.order) return (a.order || 0) - (b.order || 0);
    return String(a._id || a.id || '').localeCompare(String(b._id || b.id || ''));
  });

  const active = runningTasks[0];
  return {
    taskId: active._id ? active._id.toString() : String(active.id),
    agentId: active.agentId || null,
    status: active.status,
  };
}

/**
 * Resolves bounded, sanitized blocking reason if the mission is blocked or failed
 *
 * @param {object} mission
 * @param {Array<object>} tasks
 * @param {string} operationalState
 * @returns {{ code: string, message: string }|null}
 */
function resolveBlockingReason(mission, tasks = [], operationalState) {
  if (operationalState !== 'blocked' && operationalState !== 'failed') {
    return null;
  }

  const safeTasks = normalizeTasks(tasks);
  const failedTask = safeTasks.find((t) => t.status === 'failed');
  if (failedTask && failedTask.error) {
    const code = categorizeBlockingCode(failedTask.error);
    const message = sanitizeBlockingMessage(failedTask.error);
    return {
      code,
      message: message || 'Task execution failed',
    };
  }

  if (mission?.status === 'failed') {
    return {
      code: 'MISSION_FAILED',
      message: 'Mission execution failed or was aborted',
    };
  }

  return null;
}

/**
 * Retrieves the authoritative Mission State Intelligence for a given mission
 *
 * Read-only gate with strict cross-user isolation and anti-enumeration.
 *
 * @param {string} missionId - Mission identifier
 * @param {string} userId - Authenticated user identifier (req.user.id)
 * @returns {Promise<{ notFound?: boolean, success?: boolean, missionId?: string, stage?: string, state?: string, progress?: object, activeTask?: object|null, blockingReason?: object|null }>}
 */
async function getMissionState(missionId, userId) {
  // 1. Validate ObjectId formats (prevents format-based enumeration)
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    return { notFound: true };
  }
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { notFound: true };
  }

  const missionObjectId = new mongoose.Types.ObjectId(missionId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 2. Load Mission strictly enforcing authenticated user ownership (read-only)
  const mission = await Mission.findOne({
    _id: missionObjectId,
    userId: userObjectId,
  }).lean();

  if (!mission) {
    return { notFound: true };
  }

  // 3. Load MissionTasks strictly for this mission, sorted by order ASC, _id ASC (read-only)
  const tasks = await MissionTask.find({ missionId: missionObjectId })
    .sort({ order: 1, _id: 1 })
    .lean();

  const safeTasks = normalizeTasks(tasks);

  // 4. Compute authoritative State Intelligence
  const stage = deriveMissionStage(mission, safeTasks);
  const state = deriveMissionOperationalState(mission, safeTasks);
  const progress = computeTaskProgress(safeTasks);
  const activeTask = resolveActiveTask(safeTasks);
  const blockingReason = resolveBlockingReason(mission, safeTasks, state);

  return {
    success: true,
    missionId: mission._id.toString(),
    stage,
    state,
    progress,
    activeTask,
    blockingReason,
  };
}

module.exports = {
  getMissionState,
  deriveMissionStage,
  deriveMissionOperationalState,
  computeTaskProgress,
  resolveActiveTask,
  resolveBlockingReason,
  normalizeTasks,
  mapTaskToStage,
  sanitizeBlockingMessage,
  categorizeBlockingCode,
  LIMITS,
};
