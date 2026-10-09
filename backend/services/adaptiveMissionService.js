const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const Evidence = require('../models/Evidence');
const {
  MissionEvent,
  DECISION_TYPES,
  EVENT_TYPES,
  EVENT_LIMITS,
  sanitizeEventString,
  sanitizeEventMetadata,
} = require('../models/MissionEvent');
const { recordDecision, recordEvent } = require('./missionEventService');
const { createBrowserTasksFromResearch } = require('./research/browserHandoffService');

/**
 * Adaptive Mission Configuration & Limits
 */
const ADAPTIVE_CONFIG = {
  MAX_ADAPTIVE_ACTIONS_PER_MISSION: 3,
  MAX_TASK_RETRIES: 2,
  MIN_EVIDENCE_THRESHOLD: 2,
  DEFAULT_MAX_ADAPTIVE_TASKS: 3,
  MAX_REASON_LENGTH: 500,
  MAX_ACTION_LENGTH: 300,
};

/**
 * Known non-retryable error patterns.
 * Failures matching these patterns indicate fundamental authorization, validation,
 * or security blocks that will not be resolved by retrying.
 */
const NON_RETRYABLE_PATTERNS = [
  /API_KEY_INVALID/i,
  /PROVIDER_AUTH_ERROR/i,
  /unauthorized/i,
  /forbidden/i,
  /invalid credentials/i,
  /invalid api key/i,
  /\b401\b/,
  /\b403\b/,
  /ValidationError/i,
  /CastError/i,
  /SSRF/i,
  /PRIVATE_OR_RESERVED_IP/i,
  /policy rejected/i,
  /prompt injection/i,
  /not found/i,
  /\b404\b/,
  /deadline exceeded/i,
  /maximum allowable duration/i,
];

/**
 * Known transient / retryable error patterns.
 * Failures matching these patterns indicate transient network, rate-limiting,
 * timeout, or upstream server hiccups that may succeed on a subsequent attempt.
 */
const RETRYABLE_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /fetch failed/i,
  /socket hang up/i,
  /network timeout/i,
  /rate limit/i,
  /too many requests/i,
  /\b429\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /bad gateway/i,
  /service unavailable/i,
  /gateway timeout/i,
  /Navigation timeout/i,
  /timeout/i,
  /timed out/i,
  /transient/i,
  /temporary/i,
  /retryable/i,
];

/**
 * Deterministically evaluates whether a given error represents a transient, retryable failure.
 *
 * @param {Error|string|object} error
 * @returns {boolean}
 */
function isErrorRetryable(error) {
  if (!error) return false;
  const message = typeof error === 'string' ? error : error.message || String(error);

  // Check explicit non-retryable patterns first (precedence)
  for (const pattern of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(message)) {
      return false;
    }
  }

  // Check retryable patterns
  for (const pattern of RETRYABLE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  // Default: unclassified errors are treated as non-retryable for safety
  return false;
}

/**
 * Resolves the current count of adaptive actions taken by a mission.
 * Queries canonical historical decisions from MissionEvent or respects options override.
 *
 * @param {string|mongoose.Types.ObjectId} missionId
 * @param {object} [options={}]
 * @returns {Promise<number>}
 */
async function getAdaptiveActionCount(missionId, options = {}) {
  if (typeof options.adaptiveActionCount === 'number') {
    return options.adaptiveActionCount;
  }
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) return 0;
  return await MissionEvent.countDocuments({
    missionId: new mongoose.Types.ObjectId(missionId),
    type: EVENT_TYPES.DECISION,
    decisionType: { $in: [DECISION_TYPES.RETRY_TASK, DECISION_TYPES.ADD_BROWSER_TASK] },
  });
}

/**
 * Evaluates a task execution failure and decides whether to adaptively retry or block the mission.
 *
 * Decision rules:
 * 1. If mission deadline exceeded -> BLOCK_MISSION
 * 2. If adaptive action budget exhausted -> BLOCK_MISSION
 * 3. If task attempt count >= maxRetries -> BLOCK_MISSION
 * 4. If error is non-retryable -> BLOCK_MISSION
 * 5. If retryable and budget available -> RETRY_TASK (re-queues task as 'pending')
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.missionId
 * @param {string|mongoose.Types.ObjectId} params.taskId
 * @param {Error|object} params.error
 * @param {number} [params.currentAttempt=1]
 * @param {number} [params.missionStartTime=Date.now()]
 * @param {number} [params.maxMissionDurationMs=600000]
 * @param {object} [params.options={}]
 * @returns {Promise<{ action: 'RETRY'|'BLOCK', decisionType: string, reason: string, attempt?: number, error?: string }>}
 */
async function evaluateTaskFailure({
  missionId,
  taskId,
  error,
  currentAttempt = 1,
  missionStartTime = Date.now(),
  maxMissionDurationMs = 600000,
  options = {},
} = {}) {
  try {
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return { action: 'BLOCK', decisionType: DECISION_TYPES.BLOCK_MISSION, reason: 'Invalid missionId' };
    }
    if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
      return { action: 'BLOCK', decisionType: DECISION_TYPES.BLOCK_MISSION, reason: 'Invalid taskId' };
    }

    const missionObjectId = new mongoose.Types.ObjectId(missionId);
    const taskObjectId = new mongoose.Types.ObjectId(taskId);

    const mission = await Mission.findById(missionObjectId).select('_id userId executionMetadata').lean();
    if (!mission) {
      return { action: 'BLOCK', decisionType: DECISION_TYPES.BLOCK_MISSION, reason: 'Mission not found' };
    }

    const task = await MissionTask.findById(taskObjectId).lean();
    if (!task) {
      return { action: 'BLOCK', decisionType: DECISION_TYPES.BLOCK_MISSION, reason: 'Task not found' };
    }

    const rawErrorMessage = error ? (error.message || String(error)) : 'Unknown task execution error';
    const cleanErrorMessage = sanitizeEventString(rawErrorMessage, 300) || 'Task execution failed';

    // 1. Mission Deadline Check
    const elapsedMs = Date.now() - missionStartTime;
    if (elapsedMs >= maxMissionDurationMs) {
      const reason = `Mission execution duration (${elapsedMs}ms) exceeded maximum allowable timeout (${maxMissionDurationMs}ms). Halting pipeline.`;
      await recordDecision({
        missionId: missionObjectId,
        userId: mission.userId,
        decisionType: DECISION_TYPES.BLOCK_MISSION,
        taskId: taskObjectId,
        reason,
        action: 'Halt mission execution pipeline on deadline breach',
        outcome: 'failed',
        metadata: { elapsedMs, maxMissionDurationMs },
      }).catch(() => {});

      return { action: 'BLOCK', decisionType: DECISION_TYPES.BLOCK_MISSION, reason };
    }

    // 2. Adaptive Action Budget Check
    const maxAdaptiveActions = options.maxAdaptiveActions || ADAPTIVE_CONFIG.MAX_ADAPTIVE_ACTIONS_PER_MISSION;
    const currentAdaptiveCount = await getAdaptiveActionCount(missionObjectId, options);

    if (currentAdaptiveCount >= maxAdaptiveActions) {
      const reason = `Adaptive action budget exhausted (${currentAdaptiveCount}/${maxAdaptiveActions}). Cannot perform additional adaptive retry.`;
      await recordDecision({
        missionId: missionObjectId,
        userId: mission.userId,
        decisionType: DECISION_TYPES.BLOCK_MISSION,
        taskId: taskObjectId,
        reason,
        action: 'Halt mission execution pipeline on budget exhaustion',
        outcome: 'failed',
        metadata: { currentAdaptiveCount, maxAdaptiveActions },
      }).catch(() => {});

      return { action: 'BLOCK', decisionType: DECISION_TYPES.BLOCK_MISSION, reason };
    }

    // 3. Task Attempt Budget Check
    const maxRetries = options.maxTaskRetries || ADAPTIVE_CONFIG.MAX_TASK_RETRIES;
    if (currentAttempt >= maxRetries) {
      const reason = `Task retry budget exhausted (${currentAttempt}/${maxRetries}) for task: "${task.title}". Halting pipeline.`;
      await recordDecision({
        missionId: missionObjectId,
        userId: mission.userId,
        decisionType: DECISION_TYPES.BLOCK_MISSION,
        taskId: taskObjectId,
        reason,
        action: 'Halt mission execution pipeline on task retry exhaustion',
        outcome: 'failed',
        metadata: { currentAttempt, maxRetries, lastError: cleanErrorMessage },
      }).catch(() => {});

      return { action: 'BLOCK', decisionType: DECISION_TYPES.BLOCK_MISSION, reason };
    }

    // 4. Retryability Evaluation
    const retryable = isErrorRetryable(error);
    if (!retryable) {
      const reason = `Non-retryable error encountered: ${cleanErrorMessage}. Halting pipeline.`;
      await recordDecision({
        missionId: missionObjectId,
        userId: mission.userId,
        decisionType: DECISION_TYPES.BLOCK_MISSION,
        taskId: taskObjectId,
        reason,
        action: 'Halt mission execution pipeline on non-retryable error',
        outcome: 'failed',
        metadata: { error: cleanErrorMessage, retryable: false },
      }).catch(() => {});

      return { action: 'BLOCK', decisionType: DECISION_TYPES.BLOCK_MISSION, reason };
    }

    // 5. Adaptive Action: RETRY_TASK
    const nextAttempt = currentAttempt + 1;
    const retryReason = `Transient failure detected (${cleanErrorMessage}). Re-queuing task under adaptive retry policy (attempt ${nextAttempt}/${maxRetries}).`;

    await recordDecision({
      missionId: missionObjectId,
      userId: mission.userId,
      decisionType: DECISION_TYPES.RETRY_TASK,
      taskId: taskObjectId,
      reason: retryReason,
      action: `Re-queue task for adaptive retry attempt ${nextAttempt}`,
      outcome: 'retrying',
      metadata: {
        attempt: nextAttempt,
        maxRetries,
        triggerError: cleanErrorMessage,
      },
    }).catch(() => {});

    // Safely normalize existing metadata to prevent null field errors in MongoDB
    const existingMetadata = task.executionMetadata && typeof task.executionMetadata === 'object'
      ? { ...task.executionMetadata }
      : {};
    existingMetadata.attempt = nextAttempt;
    existingMetadata.lastRetryAt = new Date();
    existingMetadata.isAdaptiveRetry = true;

    // Atomically reset task state to 'pending' with incremented attempt
    await MissionTask.findByIdAndUpdate(taskObjectId, {
      $set: {
        status: 'pending',
        error: cleanErrorMessage,
        executionMetadata: existingMetadata,
      },
    });

    return {
      action: 'RETRY',
      decisionType: DECISION_TYPES.RETRY_TASK,
      attempt: nextAttempt,
      taskId: taskObjectId.toString(),
      reason: retryReason,
    };
  } catch (err) {
    console.error('[ADAPTIVE MISSION SERVICE] Failure evaluation exception:', err.message);
    // Safe deterministic failure fallback: block rather than allowing corrupted continuation
    return {
      action: 'BLOCK',
      decisionType: DECISION_TYPES.BLOCK_MISSION,
      reason: `Adaptive evaluation exception: ${err.message}`,
    };
  }
}

/**
 * Evaluates whether evidence gathered is sufficient for downstream synthesis.
 * If insufficient and candidate sources exist, adaptively adds bounded Browser tasks.
 *
 * Decision rules:
 * 1. If evidenceCount >= threshold -> CONTINUE_PIPELINE
 * 2. If evidenceCount < threshold AND budget available AND new candidates exist -> ADD_BROWSER_TASK
 * 3. If evidenceCount < threshold AND no candidates or duplicates -> CONTINUE_PIPELINE (with reason)
 * 4. If budget exhausted -> CONTINUE_PIPELINE (with reason)
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.missionId
 * @param {string|mongoose.Types.ObjectId} params.taskId
 * @param {object} params.executedResult - Completed research task
 * @param {string} [params.missionObjective]
 * @param {number} [params.currentTaskOrder=2]
 * @param {object} [params.options={}]
 * @returns {Promise<{ action: 'CONTINUE'|'ADAPT_ADD_TASK', decisionType: string, reason: string, evidenceCount?: number, tasksCreated?: Array<object> }>}
 */
async function evaluateEvidenceSufficiency({
  missionId,
  taskId,
  executedResult,
  missionObjective,
  currentTaskOrder = 2,
  options = {},
} = {}) {
  try {
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return { action: 'CONTINUE', decisionType: DECISION_TYPES.CONTINUE_PIPELINE, reason: 'Invalid missionId' };
    }

    const missionObjectId = new mongoose.Types.ObjectId(missionId);
    const taskObjectId = taskId && mongoose.Types.ObjectId.isValid(taskId)
      ? new mongoose.Types.ObjectId(taskId)
      : null;

    const mission = await Mission.findById(missionObjectId).select('_id userId objective executionMetadata').lean();
    if (!mission) {
      return { action: 'CONTINUE', decisionType: DECISION_TYPES.CONTINUE_PIPELINE, reason: 'Mission not found' };
    }

    // 1. Measure ground truth evidence count persisted for this mission
    const totalEvidenceCount = await Evidence.countDocuments({ missionId: missionObjectId });
    const minThreshold = options.minEvidenceThreshold || ADAPTIVE_CONFIG.MIN_EVIDENCE_THRESHOLD;

    // Resolve Candidate Sources for Adaptive Expansion
    const candidates = executedResult?.data?.candidates ||
      executedResult?._agentResult?.data?.candidates ||
      executedResult?.executionMetadata?.resultData?.candidates ||
      [];

    const hasCandidates = Array.isArray(candidates) && candidates.length > 0;

    // Check verified deep evidence from completed browser tasks
    let browserEvidenceCount = 0;
    if (hasCandidates) {
      const browserTasks = await MissionTask.find({ missionId: missionObjectId, agentId: 'browser' }).select('_id').lean();
      const browserTaskIds = browserTasks.map((t) => t._id);
      if (browserTaskIds.length > 0) {
        browserEvidenceCount = await Evidence.countDocuments({
          missionId: missionObjectId,
          taskId: { $in: browserTaskIds },
        });
      }
    }

    // 2. Case: Evidence is Sufficient
    // If no candidates exist, totalEvidenceCount satisfies threshold.
    // If candidates exist, browserEvidenceCount satisfies threshold.
    const isSufficient = hasCandidates
      ? (browserEvidenceCount >= minThreshold)
      : (totalEvidenceCount >= minThreshold);

    const relevantEvidenceCount = hasCandidates ? browserEvidenceCount : totalEvidenceCount;

    if (isSufficient) {
      const reason = `Evidence sufficiency satisfied: ${relevantEvidenceCount} verified evidence items meet required threshold (>= ${minThreshold}).`;
      await recordDecision({
        missionId: missionObjectId,
        userId: mission.userId,
        decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
        taskId: taskObjectId,
        reason,
        action: 'Approve evidence foundation and continue to synthesis',
        outcome: 'pass',
        metadata: { evidenceCount: relevantEvidenceCount, minThreshold },
      }).catch(() => {});

      return {
        action: 'CONTINUE',
        decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
        evidenceCount: relevantEvidenceCount,
        reason,
      };
    }

    // 3. Case: Evidence is Insufficient — Check Adaptive Budget
    const maxAdaptiveActions = options.maxAdaptiveActions || ADAPTIVE_CONFIG.MAX_ADAPTIVE_ACTIONS_PER_MISSION;
    const currentAdaptiveCount = await getAdaptiveActionCount(missionObjectId, options);

    if (currentAdaptiveCount >= maxAdaptiveActions) {
      const reason = `Evidence count (${relevantEvidenceCount}) is below threshold (${minThreshold}), but adaptive action budget is exhausted (${currentAdaptiveCount}/${maxAdaptiveActions}). Continuing with available evidence.`;
      await recordDecision({
        missionId: missionObjectId,
        userId: mission.userId,
        decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
        taskId: taskObjectId,
        reason,
        action: 'Proceed with available evidence due to adaptive budget exhaustion',
        outcome: 'pass',
        metadata: { evidenceCount: relevantEvidenceCount, minThreshold, currentAdaptiveCount, maxAdaptiveActions },
      }).catch(() => {});

      return {
        action: 'CONTINUE',
        decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
        evidenceCount: relevantEvidenceCount,
        reason,
      };
    }

    // 4. Case: No Candidate Sources Discovered
    if (!hasCandidates) {
      const reason = `Evidence count (${totalEvidenceCount}) is below threshold (${minThreshold}), but no candidate sources were discovered for deep browsing. Continuing pipeline.`;
      await recordDecision({
        missionId: missionObjectId,
        userId: mission.userId,
        decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
        taskId: taskObjectId,
        reason,
        action: 'Proceed with available evidence (no browser candidates discovered)',
        outcome: 'pass',
        metadata: { evidenceCount: totalEvidenceCount, minThreshold },
      }).catch(() => {});

      return {
        action: 'CONTINUE',
        decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
        evidenceCount: totalEvidenceCount,
        reason,
      };
    }

    // 5. Duplicate Prevention: Filter out candidates whose URLs already exist in MissionTask
    const existingTasks = await MissionTask.find({ missionId: missionObjectId }).select('url title').lean();
    const existingUrlSet = new Set(
      existingTasks
        .filter((t) => t.url)
        .map((t) => t.url.trim().toLowerCase().replace(/\/+$/, ''))
    );

    const freshCandidates = candidates.filter((c) => {
      if (!c || !c.url) return false;
      const norm = c.url.trim().toLowerCase().replace(/\/+$/, '');
      return !existingUrlSet.has(norm);
    });

    if (freshCandidates.length === 0) {
      const reason = `Evidence count (${relevantEvidenceCount}) is below threshold (${minThreshold}), but all discovered candidate sources have already been scheduled. Continuing to prevent duplicate tasks.`;
      await recordDecision({
        missionId: missionObjectId,
        userId: mission.userId,
        decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
        taskId: taskObjectId,
        reason,
        action: 'Proceed to prevent duplicate equivalent adaptive tasks',
        outcome: 'pass',
        metadata: { evidenceCount: relevantEvidenceCount, totalCandidates: candidates.length },
      }).catch(() => {});

      return {
        action: 'CONTINUE',
        decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
        evidenceCount: relevantEvidenceCount,
        reason,
      };
    }

    // 6. Adaptive Action: Create bounded Browser Tasks
    const handoffResult = await createBrowserTasksFromResearch({
      missionId: missionObjectId,
      researchTaskId: taskObjectId,
      candidates: freshCandidates,
      currentTaskOrder,
      options: {
        ...options,
        missionObjective: missionObjective || mission.objective,
        taskTitle: executedResult?.title,
        maxTargets: options.maxAdaptiveTasks || options.maxTargets || ADAPTIVE_CONFIG.DEFAULT_MAX_ADAPTIVE_TASKS,
      },
    });

    if (handoffResult.count > 0) {
      const reason = `Evidence count (${relevantEvidenceCount}) is below threshold (${minThreshold}). Adaptively inserted ${handoffResult.count} dynamic Browser tasks to acquire grounded evidence.`;

      return {
        action: 'ADAPT_ADD_TASK',
        decisionType: DECISION_TYPES.ADD_BROWSER_TASK,
        evidenceCount: relevantEvidenceCount,
        tasksCreated: handoffResult.tasksCreated,
        count: handoffResult.count,
        reason,
      };
    }

    // If candidate validation rejected all fresh candidates (e.g. SSRF / policy)
    const reason = `Evidence count (${relevantEvidenceCount}) is below threshold (${minThreshold}), but candidate sources failed security policies. Continuing pipeline.`;
    await recordDecision({
      missionId: missionObjectId,
      userId: mission.userId,
      decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
      taskId: taskObjectId,
      reason,
      action: 'Proceed with available evidence (candidates rejected by security policies)',
      outcome: 'pass',
      metadata: { evidenceCount: relevantEvidenceCount },
    }).catch(() => {});

    return {
      action: 'CONTINUE',
      decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
      evidenceCount: relevantEvidenceCount,
      reason,
    };
  } catch (err) {
    console.error('[ADAPTIVE MISSION SERVICE] Evidence evaluation exception:', err.message);
    // Non-blocking safe default: continue rather than breaking pipeline
    return {
      action: 'CONTINUE',
      decisionType: DECISION_TYPES.CONTINUE_PIPELINE,
      reason: `Adaptive evaluation exception: ${err.message}`,
    };
  }
}

module.exports = {
  ADAPTIVE_CONFIG,
  isErrorRetryable,
  getAdaptiveActionCount,
  evaluateTaskFailure,
  evaluateEvidenceSufficiency,
};
