const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const {
  MissionEvent,
  EVENT_TYPES,
  DECISION_TYPES,
  EVENT_LIMITS,
  sanitizeEventString,
  sanitizeEventMetadata,
} = require('../models/MissionEvent');

/**
 * Service Query Limits
 */
const QUERY_LIMITS = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
};

/**
 * Cleanly formats a MissionEvent document for public API consumption
 *
 * @param {object} doc
 * @returns {object}
 */
function formatEvent(doc) {
  if (!doc) return null;
  return {
    id: doc._id ? doc._id.toString() : null,
    missionId: doc.missionId ? doc.missionId.toString() : null,
    userId: doc.userId ? doc.userId.toString() : null,
    type: doc.type,
    decisionType: doc.decisionType || null,
    taskId: doc.taskId ? doc.taskId.toString() : null,
    reason: doc.reason || null,
    evidenceRefs: Array.isArray(doc.evidenceRefs) ? doc.evidenceRefs : [],
    confidence: typeof doc.confidence === 'number' ? doc.confidence : null,
    action: doc.action || null,
    outcome: doc.outcome || null,
    metadata: doc.metadata || null,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
  };
}

/**
 * Helper to resolve the authoritative userId for a mission if not passed by internal caller
 *
 * @param {string|mongoose.Types.ObjectId} missionId
 * @param {string|mongoose.Types.ObjectId|null} [providedUserId=null]
 * @returns {Promise<mongoose.Types.ObjectId|null>}
 */
async function resolveMissionUserId(missionId, providedUserId = null) {
  if (providedUserId && mongoose.Types.ObjectId.isValid(providedUserId)) {
    return new mongoose.Types.ObjectId(providedUserId);
  }
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    return null;
  }
  const mission = await Mission.findById(missionId).select('userId').lean();
  return mission?.userId ? new mongoose.Types.ObjectId(mission.userId) : null;
}

/**
 * Records an immutable historical lifecycle event for a mission.
 * Historical/audit enrichment — safe failure behavior ensures callers are never blocked.
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.missionId - Target Mission ID
 * @param {string|mongoose.Types.ObjectId} [params.userId] - Authoritative owner ID
 * @param {string} params.type - Canonical event type from EVENT_TYPES
 * @param {string|mongoose.Types.ObjectId} [params.taskId=null] - MissionTask ID if task-scoped
 * @param {string} [params.reason=null] - Reason for the event
 * @param {string} [params.action=null] - Action executed or initiated
 * @param {string} [params.outcome=null] - Event outcome or status
 * @param {object} [params.metadata=null] - Bounded, sanitized metadata
 * @returns {Promise<{ success: boolean, event?: object, error?: string }>}
 */
async function recordEvent({
  missionId,
  userId = null,
  type,
  taskId = null,
  reason = null,
  action = null,
  outcome = null,
  metadata = null,
} = {}) {
  try {
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return { success: false, error: 'Invalid or missing missionId' };
    }
    if (!type || typeof type !== 'string' || !EVENT_TYPES[type]) {
      return { success: false, error: `Invalid or unrecognized event type: ${type}` };
    }

    const resolvedUserId = await resolveMissionUserId(missionId, userId);
    if (!resolvedUserId) {
      return { success: false, error: `Could not resolve owner userId for mission ${missionId}` };
    }

    const mId = new mongoose.Types.ObjectId(missionId);
    const tId = taskId && mongoose.Types.ObjectId.isValid(taskId) ? new mongoose.Types.ObjectId(taskId) : null;

    const sanitizedReason = sanitizeEventString(reason, EVENT_LIMITS.MAX_REASON_LENGTH);
    const sanitizedAction = sanitizeEventString(action, EVENT_LIMITS.MAX_ACTION_LENGTH);
    const sanitizedOutcome = sanitizeEventString(outcome, EVENT_LIMITS.MAX_OUTCOME_LENGTH);
    const sanitizedMeta = sanitizeEventMetadata(metadata);

    const eventDoc = await MissionEvent.create({
      missionId: mId,
      userId: resolvedUserId,
      type,
      decisionType: null,
      taskId: tId,
      reason: sanitizedReason,
      action: sanitizedAction,
      outcome: sanitizedOutcome,
      metadata: sanitizedMeta,
    });

    return {
      success: true,
      event: formatEvent(eventDoc),
    };
  } catch (err) {
    console.warn(`[MISSION EVENT SERVICE] Failed to record event [${type}] for mission ${missionId}:`, err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Records an immutable deliberate decision made by NEXORA.
 * Answers: WHAT? WHY? BASED ON WHAT? WHAT ACTION? WHAT OUTCOME?
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.missionId - Target Mission ID
 * @param {string|mongoose.Types.ObjectId} [params.userId] - Authoritative owner ID
 * @param {string} params.decisionType - Canonical decision type from DECISION_TYPES
 * @param {string|mongoose.Types.ObjectId} [params.taskId=null] - MissionTask ID if task-scoped
 * @param {string} [params.reason=null] - Why the decision was chosen
 * @param {Array<string>} [params.evidenceRefs=[]] - Bounded references to evidence IDs/URLs
 * @param {number} [params.confidence=null] - Bounded confidence [0.0 - 1.0] if meaningful
 * @param {string} [params.action=null] - What action followed the decision
 * @param {string} [params.outcome=null] - Outcome or status resulting from decision
 * @param {object} [params.metadata=null] - Bounded, sanitized metadata
 * @returns {Promise<{ success: boolean, event?: object, error?: string }>}
 */
async function recordDecision({
  missionId,
  userId = null,
  decisionType,
  taskId = null,
  reason = null,
  evidenceRefs = [],
  confidence = null,
  action = null,
  outcome = null,
  metadata = null,
} = {}) {
  try {
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return { success: false, error: 'Invalid or missing missionId' };
    }
    if (!decisionType || typeof decisionType !== 'string' || !DECISION_TYPES[decisionType]) {
      return { success: false, error: `Invalid or unrecognized decision type: ${decisionType}` };
    }

    const resolvedUserId = await resolveMissionUserId(missionId, userId);
    if (!resolvedUserId) {
      return { success: false, error: `Could not resolve owner userId for mission ${missionId}` };
    }

    const mId = new mongoose.Types.ObjectId(missionId);
    const tId = taskId && mongoose.Types.ObjectId.isValid(taskId) ? new mongoose.Types.ObjectId(taskId) : null;

    // Validate confidence if provided
    let validConfidence = null;
    if (confidence !== null && confidence !== undefined) {
      const numConf = Number(confidence);
      if (isNaN(numConf) || numConf < 0.0 || numConf > 1.0) {
        return { success: false, error: `confidence must be a number between 0.0 and 1.0, got: ${confidence}` };
      }
      validConfidence = numConf;
    }

    // Bounded and sanitized evidenceRefs
    const cleanEvidenceRefs = [];
    if (Array.isArray(evidenceRefs)) {
      for (const ref of evidenceRefs) {
        if (cleanEvidenceRefs.length >= EVENT_LIMITS.MAX_EVIDENCE_REFS) break;
        if (typeof ref === 'string' && ref.trim()) {
          const sanitizedRef = sanitizeEventString(ref, EVENT_LIMITS.MAX_EVIDENCE_REF_LENGTH);
          if (sanitizedRef) cleanEvidenceRefs.push(sanitizedRef);
        } else if (ref && mongoose.Types.ObjectId.isValid(ref)) {
          cleanEvidenceRefs.push(ref.toString());
        }
      }
    }

    const sanitizedReason = sanitizeEventString(reason, EVENT_LIMITS.MAX_REASON_LENGTH);
    const sanitizedAction = sanitizeEventString(action, EVENT_LIMITS.MAX_ACTION_LENGTH);
    const sanitizedOutcome = sanitizeEventString(outcome, EVENT_LIMITS.MAX_OUTCOME_LENGTH);
    const sanitizedMeta = sanitizeEventMetadata(metadata);

    const eventDoc = await MissionEvent.create({
      missionId: mId,
      userId: resolvedUserId,
      type: EVENT_TYPES.DECISION,
      decisionType,
      taskId: tId,
      reason: sanitizedReason,
      evidenceRefs: cleanEvidenceRefs,
      confidence: validConfidence,
      action: sanitizedAction,
      outcome: sanitizedOutcome,
      metadata: sanitizedMeta,
    });

    return {
      success: true,
      event: formatEvent(eventDoc),
    };
  } catch (err) {
    console.warn(`[MISSION EVENT SERVICE] Failed to record decision [${decisionType}] for mission ${missionId}:`, err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Retrieves the immutable historical event & decision log for a mission.
 * Strictly enforces mission ownership & anti-enumeration (404 for non-existent or cross-user).
 *
 * @param {string|mongoose.Types.ObjectId} missionId
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {object} [options={}]
 * @param {number} [options.limit=50] - Max events to return (bounded to 100)
 * @param {number} [options.skip=0] - Offset for pagination
 * @param {string} [options.type] - Optional filter by event type
 * @param {string} [options.decisionType] - Optional filter by decision type
 * @returns {Promise<{ notFound?: boolean, success?: boolean, missionId?: string, count?: number, total?: number, events?: Array<object> }>}
 */
async function getMissionEvents(missionId, userId, options = {}) {
  // 1. Validation & Tenant Isolation Guard
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    return { notFound: true };
  }
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { notFound: true };
  }

  const missionObjectId = new mongoose.Types.ObjectId(missionId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Read-only ownership lookup on Mission
  const mission = await Mission.findOne({
    _id: missionObjectId,
    userId: userObjectId,
  }).select('_id userId').lean();

  if (!mission) {
    return { notFound: true };
  }

  // 2. Query construction
  const filter = {
    missionId: missionObjectId,
  };

  if (options.type && typeof options.type === 'string' && EVENT_TYPES[options.type]) {
    filter.type = options.type;
  }

  if (options.decisionType && typeof options.decisionType === 'string' && DECISION_TYPES[options.decisionType]) {
    filter.decisionType = options.decisionType;
  }

  const limit = Math.min(
    Math.max(parseInt(options.limit, 10) || QUERY_LIMITS.DEFAULT_PAGE_SIZE, 1),
    QUERY_LIMITS.MAX_PAGE_SIZE
  );
  const skip = Math.max(parseInt(options.skip, 10) || 0, 0);

  // 3. Execution: deterministic chronological sort (server timestamp ASC, _id ASC)
  const [events, total] = await Promise.all([
    MissionEvent.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    MissionEvent.countDocuments(filter),
  ]);

  return {
    success: true,
    missionId: mission._id.toString(),
    count: events.length,
    total,
    limit,
    skip,
    events: events.map(formatEvent),
  };
}

module.exports = {
  recordEvent,
  recordDecision,
  getMissionEvents,
  formatEvent,
  EVENT_TYPES,
  DECISION_TYPES,
  EVENT_LIMITS,
  QUERY_LIMITS,
};
