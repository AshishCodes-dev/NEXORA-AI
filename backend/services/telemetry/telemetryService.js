const mongoose = require('mongoose');
const MissionTelemetry = require('../../models/MissionTelemetry');

/**
 * Bounds & safety limits
 */
const LIMITS = {
  MAX_ERROR_LENGTH: 500,
  MAX_OPERATION_LENGTH: 100,
  MAX_STAGES: 50,
  MAX_TASKS: 100,
  MAX_PROVIDER_CALLS: 200,
};

/**
 * Sanitizes and bounds error messages to prevent secret leakage and response bloat
 */
function sanitizeTelemetryString(str, maxLength = LIMITS.MAX_ERROR_LENGTH) {
  if (typeof str !== 'string') return '';
  const sanitized = str
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
    .replace(/(AIzaSy[A-Za-z0-9_-]+)/g, '[REDACTED_API_KEY]')
    .replace(/(password\s*[:=]\s*)[^\s&,;]+/gi, '$1[REDACTED]')
    .replace(/(secret\s*[:=]\s*)[^\s&,;]+/gi, '$1[REDACTED]')
    .replace(/(cookie\s*[:=]\s*)[^\s&,;]+/gi, '$1[REDACTED]')
    .replace(/(jwt\s*[:=]\s*)[^\s&,;]+/gi, '$1[REDACTED]')
    .replace(/(\btoken\s*[:=]\s*)(?!Bearer)[^\s&,;]+/gi, '$1[REDACTED]')
    .replace(/[\r\n]+/g, ' ')
    .trim();

  if (sanitized.length <= maxLength) return sanitized;
  const suffix = '... [truncated]';
  if (maxLength <= suffix.length) {
    return sanitized.slice(0, maxLength);
  }
  return sanitized.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Categorizes task failures deterministically based on error codes and messages
 */
function categorizeTaskError(err) {
  if (!err) return 'INTERNAL_ERROR';
  const code = err.code || '';
  const msg = (err.message || String(err)).toLowerCase();

  if (code === 'TASK_TIMEOUT' || msg.includes('timed out') || msg.includes('timeout')) {
    return 'TASK_TIMEOUT';
  }
  if (
    code === 'BLOCKED_URL' ||
    code === 'INVALID_URL' ||
    code === 'REDIRECT_BLOCKED' ||
    msg.includes('ssrf') ||
    msg.includes('security policy')
  ) {
    return 'SECURITY_VIOLATION';
  }
  if (code === 'AGENT_FAILED' || msg.includes('agent') && msg.includes('failed')) {
    return 'AGENT_FAILED';
  }
  if (err.name === 'ValidationError' || msg.includes('validation') || msg.includes('schema')) {
    return 'VALIDATION_ERROR';
  }
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || msg.includes('network')) {
    return 'NETWORK_ERROR';
  }
  return 'INTERNAL_ERROR';
}

/**
 * Strips sensitive keys and bounds metadata object
 */
function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const clean = {};
  for (const [key, val] of Object.entries(meta)) {
    if (/^(password|secret|key|token|auth|cookie|jwt)/i.test(key)) continue;
    if (typeof val === 'string') {
      clean[key] = sanitizeTelemetryString(val, 200);
    } else if (typeof val === 'number' || typeof val === 'boolean' || val === null) {
      clean[key] = val;
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/**
 * Initializes or ensures a MissionTelemetry document for a mission
 */
async function recordMissionCreated({ missionId, userId = null, timestamp = new Date() }) {
  try {
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) return null;
    const mId = new mongoose.Types.ObjectId(missionId);
    const uId = (userId && mongoose.Types.ObjectId.isValid(userId)) ? new mongoose.Types.ObjectId(userId) : null;

    const initialStage = {
      stage: 'created',
      status: 'completed',
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 0,
      metadata: null,
    };

    const telemetry = await MissionTelemetry.findOneAndUpdate(
      { missionId: mId },
      {
        $setOnInsert: {
          missionId: mId,
          userId: uId,
          status: 'pending',
          currentStage: 'created',
          startedAt: timestamp,
          stages: [initialStage],
          tasks: [],
          providerCalls: [],
          metrics: {
            totalDurationMs: 0,
            taskCount: 0,
            successfulTasks: 0,
            failedTasks: 0,
            retryCount: 0,
            evidenceCount: 0,
            providerCallCount: 0,
            providerFailureCount: 0,
            qaScore: null,
          },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    return telemetry;
  } catch (err) {
    if (err.code === 11000) {
      try {
        return await MissionTelemetry.findOne({ missionId: mId });
      } catch {
        return null;
      }
    }
    console.warn('[TELEMETRY NOTICE] Failed to record mission creation:', err.message);
    return null;
  }
}

/**
 * Records a lifecycle stage transition for a mission
 */
async function recordStageTransition(missionId, { stage, status = 'started', metadata = null }) {
  try {
    if (!missionId || !stage || !mongoose.Types.ObjectId.isValid(missionId)) return null;
    const mId = new mongoose.Types.ObjectId(missionId);
    const now = new Date();

    const telemetry = await MissionTelemetry.findOne({ missionId: mId });
    if (!telemetry) {
      await recordMissionCreated({ missionId: mId, timestamp: now });
    }

    const doc = await MissionTelemetry.findOne({ missionId: mId });
    if (!doc) return null;

    // Close any previous currently-active stage
    if (doc.stages.length > 0) {
      const lastStage = doc.stages[doc.stages.length - 1];
      if (lastStage.status === 'started' && !lastStage.completedAt) {
        lastStage.completedAt = now;
        lastStage.durationMs = Math.max(0, now.getTime() - new Date(lastStage.startedAt).getTime());
        if (stage === 'failed') {
          lastStage.status = 'failed';
        } else {
          lastStage.status = 'completed';
        }
      }
    }

    // Add new stage
    const isTerminal = stage === 'completed' || stage === 'failed';
    const newStageEntry = {
      stage,
      status: isTerminal ? stage : status,
      startedAt: now,
      completedAt: isTerminal || status === 'completed' ? now : null,
      durationMs: isTerminal || status === 'completed' ? 0 : null,
      metadata: sanitizeMetadata(metadata),
    };

    if (doc.stages.length >= LIMITS.MAX_STAGES) {
      doc.stages.shift(); // Bound history length
    }
    doc.stages.push(newStageEntry);

    doc.currentStage = stage;
    if (stage === 'completed') {
      doc.status = 'completed';
      doc.completedAt = now;
      doc.totalDurationMs = Math.max(0, now.getTime() - new Date(doc.startedAt).getTime());
      doc.metrics.totalDurationMs = doc.totalDurationMs;
    } else if (stage === 'failed') {
      doc.status = 'failed';
      doc.completedAt = now;
      doc.totalDurationMs = Math.max(0, now.getTime() - new Date(doc.startedAt).getTime());
      doc.metrics.totalDurationMs = doc.totalDurationMs;
    } else {
      doc.status = 'running';
    }

    await doc.save();
    return doc;
  } catch (err) {
    console.warn('[TELEMETRY NOTICE] Failed to record stage transition:', err.message);
    return null;
  }
}

/**
 * Records the start of an individual task execution
 */
async function recordTaskStart(missionId, taskId, { agentId = null, attempt = 1, metadata = null }) {
  try {
    if (!missionId || !taskId || !mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(taskId)) return null;
    const mId = new mongoose.Types.ObjectId(missionId);
    const tId = new mongoose.Types.ObjectId(taskId);
    const now = new Date();

    const taskEntry = {
      taskId: tId,
      agentId: agentId || null,
      status: 'started',
      attempt: Number(attempt) || 1,
      startedAt: now,
      completedAt: null,
      durationMs: null,
      error: null,
      failureCategory: null,
      metadata: sanitizeMetadata(metadata),
    };

    await MissionTelemetry.findOneAndUpdate(
      { missionId: mId },
      {
        $push: {
          tasks: {
            $each: [taskEntry],
            $slice: -LIMITS.MAX_TASKS,
          },
        },
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.warn('[TELEMETRY NOTICE] Failed to record task start:', err.message);
    return null;
  }
}

/**
 * Records the completion or failure of an individual task execution
 */
async function recordTaskEnd(missionId, taskId, {
  agentId = null,
  status = 'completed',
  durationMs = null,
  attempt = 1,
  error = null,
  failureCategory = null,
  metadata = null,
}) {
  try {
    if (!missionId || !taskId || !mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(taskId)) return null;
    const mId = new mongoose.Types.ObjectId(missionId);
    const tId = new mongoose.Types.ObjectId(taskId);
    const now = new Date();
    const attemptNum = Number(attempt) || 1;
    const duration = durationMs !== null ? Math.max(0, Number(durationMs) || 0) : null;

    // 1. Attempt atomic in-place update of existing task entry matching { taskId, attempt }
    const setUpdates = {
      'tasks.$[elem].status': status,
      'tasks.$[elem].completedAt': now,
    };
    if (duration !== null) {
      setUpdates['tasks.$[elem].durationMs'] = duration;
    }
    if (agentId) {
      setUpdates['tasks.$[elem].agentId'] = agentId;
    }
    if (error) {
      setUpdates['tasks.$[elem].error'] = sanitizeTelemetryString(error);
      setUpdates['tasks.$[elem].failureCategory'] = failureCategory || categorizeTaskError({ message: error });
    }
    if (metadata) {
      setUpdates['tasks.$[elem].metadata'] = sanitizeMetadata(metadata);
    }

    const updated = await MissionTelemetry.findOneAndUpdate(
      { missionId: mId },
      { $set: setUpdates },
      {
        arrayFilters: [{ 'elem.taskId': tId, 'elem.attempt': attemptNum }],
        returnDocument: 'after',
      }
    );

    const matchedTask = updated?.tasks?.find(
      t => t.taskId && t.taskId.toString() === tId.toString() && t.attempt === attemptNum
    );

    if (matchedTask) {
      // If duration was not provided explicitly, compute from startedAt
      if (duration === null && matchedTask.startedAt && (matchedTask.durationMs === null || matchedTask.durationMs === undefined)) {
        const computedDur = Math.max(0, now.getTime() - new Date(matchedTask.startedAt).getTime());
        await MissionTelemetry.updateOne(
          { missionId: mId, 'tasks.taskId': tId, 'tasks.attempt': attemptNum },
          { $set: { 'tasks.$.durationMs': computedDur } }
        );
      }
      return true;
    }

    // 2. If no matching task was present (e.g. recordTaskStart was missed), push completed entry atomically
    const newEntry = {
      taskId: tId,
      agentId,
      status,
      attempt: attemptNum,
      startedAt: new Date(now.getTime() - (duration || 0)),
      completedAt: now,
      durationMs: duration || 0,
      error: error ? sanitizeTelemetryString(error) : null,
      failureCategory: error ? (failureCategory || categorizeTaskError({ message: error })) : null,
      metadata: sanitizeMetadata(metadata),
    };

    await MissionTelemetry.findOneAndUpdate(
      { missionId: mId },
      {
        $push: {
          tasks: {
            $each: [newEntry],
            $slice: -LIMITS.MAX_TASKS,
          },
        },
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.warn('[TELEMETRY NOTICE] Failed to record task end:', err.message);
    return null;
  }
}

/**
 * Records an AI provider call latency and status
 */
async function recordProviderCall({
  missionId = null,
  taskId = null,
  provider = 'gemini',
  model,
  operation,
  latencyMs,
  success,
  error = null,
}) {
  try {
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) return null;
    const mId = new mongoose.Types.ObjectId(missionId);
    const tId = (taskId && mongoose.Types.ObjectId.isValid(taskId)) ? new mongoose.Types.ObjectId(taskId) : null;
    const now = new Date();
    const duration = Math.max(0, Number(latencyMs) || 0);

    const callEntry = {
      provider: provider || 'gemini',
      model: sanitizeTelemetryString(model || 'unknown', 50),
      operation: sanitizeTelemetryString(operation || 'generateContent', LIMITS.MAX_OPERATION_LENGTH),
      startedAt: new Date(now.getTime() - duration),
      completedAt: now,
      latencyMs: duration,
      success: Boolean(success),
      taskId: tId,
      error: error ? sanitizeTelemetryString(error) : null,
    };

    await MissionTelemetry.findOneAndUpdate(
      { missionId: mId },
      {
        $push: {
          providerCalls: {
            $each: [callEntry],
            $slice: -LIMITS.MAX_PROVIDER_CALLS,
          },
        },
        $inc: {
          'metrics.providerCallCount': 1,
          'metrics.providerFailureCount': success ? 0 : 1,
        },
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.warn('[TELEMETRY NOTICE] Failed to record provider call:', err.message);
    return null;
  }
}

/**
 * Authoritatively computes and updates deterministic mission-level execution metrics
 */
async function computeMissionMetrics(missionId) {
  try {
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) return null;
    const mId = new mongoose.Types.ObjectId(missionId);

    const doc = await MissionTelemetry.findOne({ missionId: mId });
    if (!doc) return null;

    // 1. Durations
    let totalDurationMs = doc.totalDurationMs;
    if (totalDurationMs === null || totalDurationMs === undefined) {
      if (doc.completedAt && doc.startedAt) {
        totalDurationMs = Math.max(0, new Date(doc.completedAt).getTime() - new Date(doc.startedAt).getTime());
      } else if (doc.startedAt) {
        totalDurationMs = Math.max(0, Date.now() - new Date(doc.startedAt).getTime());
      } else {
        totalDurationMs = 0;
      }
    }

    // 2. Task counts (derived deterministically from recorded task records)
    // Avoid double counting by grouping by taskId
    const taskMap = new Map();
    let retryCount = 0;
    for (const t of doc.tasks) {
      const idStr = t.taskId.toString();
      if (!taskMap.has(idStr) || t.status === 'completed') {
        taskMap.set(idStr, t.status);
      }
      if (t.attempt > 1) {
        retryCount += (t.attempt - 1);
      }
    }

    let successfulTasks = 0;
    let failedTasks = 0;
    for (const status of taskMap.values()) {
      if (status === 'completed') successfulTasks++;
      if (status === 'failed') failedTasks++;
    }

    // Also verify against MissionTask collection if available
    let totalTaskCount = taskMap.size;
    try {
      const MissionTask = require('../../models/MissionTask');
      const dbTaskCount = await MissionTask.countDocuments({ missionId: mId });
      if (dbTaskCount > totalTaskCount) {
        totalTaskCount = dbTaskCount;
      }
    } catch {
      // Safe fallback
    }

    // 3. Evidence count
    let evidenceCount = 0;
    try {
      const Evidence = require('../../models/Evidence');
      evidenceCount = await Evidence.countDocuments({ missionId: mId });
    } catch {
      // Safe fallback
    }

    // 4. Provider call counts
    const providerCallCount = doc.providerCalls.length;
    const providerFailureCount = doc.providerCalls.filter(c => !c.success).length;

    // 5. Authoritative QA Score
    let qaScore = null;
    try {
      const QAReport = require('../../models/QAReport');
      const qaReport = await QAReport.findOne({ missionId: mId }).select('overallScore verdict').lean();
      if (qaReport && typeof qaReport.overallScore === 'number') {
        qaScore = qaReport.overallScore;
      }
    } catch {
      // Safe fallback
    }

    const calculatedMetrics = {
      totalDurationMs,
      taskCount: totalTaskCount,
      successfulTasks,
      failedTasks,
      retryCount,
      evidenceCount,
      providerCallCount,
      providerFailureCount,
      qaScore,
    };

    doc.metrics = calculatedMetrics;
    doc.totalDurationMs = totalDurationMs;
    await doc.save();

    return calculatedMetrics;
  } catch (err) {
    console.warn('[TELEMETRY NOTICE] Failed to compute mission metrics:', err.message);
    return null;
  }
}

/**
 * Returns read-only sanitized mission telemetry for API consumption
 */
async function getMissionTelemetry(missionId, options = {}) {
  try {
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) return null;
    const mId = new mongoose.Types.ObjectId(missionId);

    const doc = await MissionTelemetry.findOne({ missionId: mId }).lean();
    if (!doc) return null;

    return {
      missionId: doc.missionId.toString(),
      currentStage: doc.currentStage,
      status: doc.status,
      startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
      completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
      totalDurationMs: doc.totalDurationMs,
      stages: (doc.stages || []).map(s => ({
        stage: s.stage,
        status: s.status,
        startedAt: s.startedAt ? s.startedAt.toISOString() : null,
        completedAt: s.completedAt ? s.completedAt.toISOString() : null,
        durationMs: s.durationMs,
        metadata: s.metadata,
      })),
      tasks: (doc.tasks || []).map(t => ({
        taskId: t.taskId ? t.taskId.toString() : null,
        agentId: t.agentId,
        status: t.status,
        attempt: t.attempt,
        startedAt: t.startedAt ? t.startedAt.toISOString() : null,
        completedAt: t.completedAt ? t.completedAt.toISOString() : null,
        durationMs: t.durationMs,
        error: t.error,
        failureCategory: t.failureCategory,
      })),
      providerCalls: (doc.providerCalls || []).map(p => ({
        provider: p.provider,
        model: p.model,
        operation: p.operation,
        latencyMs: p.latencyMs,
        success: p.success,
        error: p.error,
      })),
      metrics: doc.metrics || {},
    };
  } catch (err) {
    console.warn('[TELEMETRY NOTICE] Failed to retrieve mission telemetry:', err.message);
    return null;
  }
}

/**
 * Returns read-only mission metrics
 */
async function getMissionMetrics(missionId) {
  try {
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) return null;
    const mId = new mongoose.Types.ObjectId(missionId);

    const doc = await MissionTelemetry.findOne({ missionId: mId }).select('metrics totalDurationMs').lean();
    if (doc && doc.metrics) {
      return {
        totalDurationMs: doc.metrics.totalDurationMs || doc.totalDurationMs || 0,
        taskCount: doc.metrics.taskCount || 0,
        successfulTasks: doc.metrics.successfulTasks || 0,
        failedTasks: doc.metrics.failedTasks || 0,
        retryCount: doc.metrics.retryCount || 0,
        evidenceCount: doc.metrics.evidenceCount || 0,
        providerCallCount: doc.metrics.providerCallCount || 0,
        providerFailureCount: doc.metrics.providerFailureCount || 0,
        qaScore: doc.metrics.qaScore !== undefined ? doc.metrics.qaScore : null,
      };
    }

    // If not yet persisted, compute without mutation
    return await computeMissionMetrics(missionId);
  } catch (err) {
    console.warn('[TELEMETRY NOTICE] Failed to get mission metrics:', err.message);
    return null;
  }
}

module.exports = {
  recordMissionCreated,
  recordStageTransition,
  recordTaskStart,
  recordTaskEnd,
  recordProviderCall,
  computeMissionMetrics,
  getMissionTelemetry,
  getMissionMetrics,
  sanitizeTelemetryString,
  categorizeTaskError,
  LIMITS,
};
