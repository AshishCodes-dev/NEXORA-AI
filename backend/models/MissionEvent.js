const mongoose = require('mongoose');

/**
 * Event & Decision Taxonomies - NEXORA Step 8G.2
 */
const EVENT_TYPES = {
  MISSION_CREATED: 'MISSION_CREATED',
  MISSION_PLANNING_STARTED: 'MISSION_PLANNING_STARTED',
  TASK_STARTED: 'TASK_STARTED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_FAILED: 'TASK_FAILED',
  TASK_RETRY_STARTED: 'TASK_RETRY_STARTED',
  TASK_ADDED: 'TASK_ADDED',
  EVIDENCE_COLLECTED: 'EVIDENCE_COLLECTED',
  ANALYSIS_COMPLETED: 'ANALYSIS_COMPLETED',
  CRITIQUE_COMPLETED: 'CRITIQUE_COMPLETED',
  ARTIFACT_CREATED: 'ARTIFACT_CREATED',
  QA_COMPLETED: 'QA_COMPLETED',
  MISSION_COMPLETED: 'MISSION_COMPLETED',
  MISSION_FAILED: 'MISSION_FAILED',
  DECISION: 'DECISION',
  EVENT: 'EVENT',
};

const DECISION_TYPES = {
  SELECT_SOURCE: 'SELECT_SOURCE',
  RETRY_TASK: 'RETRY_TASK',
  ADD_BROWSER_TASK: 'ADD_BROWSER_TASK',
  CONTINUE_PIPELINE: 'CONTINUE_PIPELINE',
  BLOCK_MISSION: 'BLOCK_MISSION',
  ACCEPT_EVIDENCE: 'ACCEPT_EVIDENCE',
  REJECT_EVIDENCE: 'REJECT_EVIDENCE',
};

const VALID_TYPES = Object.values(EVENT_TYPES);
const VALID_DECISION_TYPES = Object.values(DECISION_TYPES);

/**
 * Bounds & Safety Limits for MissionEvent documents
 */
const EVENT_LIMITS = {
  MAX_REASON_LENGTH: 500,
  MAX_ACTION_LENGTH: 300,
  MAX_OUTCOME_LENGTH: 200,
  MAX_EVIDENCE_REFS: 20,
  MAX_EVIDENCE_REF_LENGTH: 300,
  MAX_METADATA_KEYS: 20,
  MAX_METADATA_STRING_LENGTH: 300,
};

/**
 * Sensitive patterns for secret redaction
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
 * Sanitizes and bounds arbitrary text strings
 *
 * @param {string} str
 * @param {number} maxLength
 * @returns {string|null}
 */
function sanitizeEventString(str, maxLength = EVENT_LIMITS.MAX_REASON_LENGTH) {
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
 * Sanitizes and bounds metadata objects
 *
 * @param {object} meta
 * @returns {object|null}
 */
function sanitizeEventMetadata(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;

  const clean = {};
  let keyCount = 0;

  for (const [key, val] of Object.entries(meta)) {
    if (keyCount >= EVENT_LIMITS.MAX_METADATA_KEYS) break;
    if (/(password|secret|key|token|auth|cookie|jwt)/i.test(key)) continue;

    if (typeof val === 'string') {
      const sanitizedStr = sanitizeEventString(val, EVENT_LIMITS.MAX_METADATA_STRING_LENGTH);
      if (sanitizedStr !== null) {
        clean[key] = sanitizedStr;
        keyCount++;
      }
    } else if (typeof val === 'number' || typeof val === 'boolean' || val === null) {
      clean[key] = val;
      keyCount++;
    }
  }

  return clean;
}

/**
 * MissionEvent Schema
 * Dedicated bounded document storing immutable historical events and decisions for a mission.
 */
const missionEventSchema = new mongoose.Schema(
  {
    missionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mission',
      required: [true, 'missionId is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    type: {
      type: String,
      required: [true, 'type is required'],
      enum: {
        values: VALID_TYPES,
        message: 'Invalid event type: {VALUE}',
      },
    },
    decisionType: {
      type: String,
      default: null,
      enum: {
        values: [...VALID_DECISION_TYPES, null],
        message: 'Invalid decision type: {VALUE}',
      },
      validate: {
        validator: function (v) {
          if (this.type === 'DECISION') {
            return typeof v === 'string' && VALID_DECISION_TYPES.includes(v);
          }
          return v === null || v === undefined;
        },
        message: 'decisionType is required for DECISION records and must be null for non-decision events',
      },
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MissionTask',
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
      maxlength: [EVENT_LIMITS.MAX_REASON_LENGTH, `reason exceeds max length of ${EVENT_LIMITS.MAX_REASON_LENGTH}`],
    },
    evidenceRefs: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: EVENT_LIMITS.MAX_EVIDENCE_REF_LENGTH,
        },
      ],
      default: [],
      validate: {
        validator: function (arr) {
          return !arr || arr.length <= EVENT_LIMITS.MAX_EVIDENCE_REFS;
        },
        message: `evidenceRefs exceeds max count of ${EVENT_LIMITS.MAX_EVIDENCE_REFS}`,
      },
    },
    confidence: {
      type: Number,
      default: null,
      min: [0.0, 'confidence must be >= 0.0'],
      max: [1.0, 'confidence must be <= 1.0'],
    },
    action: {
      type: String,
      trim: true,
      default: null,
      maxlength: [EVENT_LIMITS.MAX_ACTION_LENGTH, `action exceeds max length of ${EVENT_LIMITS.MAX_ACTION_LENGTH}`],
    },
    outcome: {
      type: String,
      trim: true,
      default: null,
      maxlength: [EVENT_LIMITS.MAX_OUTCOME_LENGTH, `outcome exceeds max length of ${EVENT_LIMITS.MAX_OUTCOME_LENGTH}`],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Compound indexes for fast, deterministic mission event history access
missionEventSchema.index({ missionId: 1, createdAt: 1, _id: 1 });
missionEventSchema.index({ userId: 1, missionId: 1, createdAt: 1 });

const MissionEvent = mongoose.model('MissionEvent', missionEventSchema);

module.exports = {
  MissionEvent,
  EVENT_TYPES,
  DECISION_TYPES,
  EVENT_LIMITS,
  sanitizeEventString,
  sanitizeEventMetadata,
};
