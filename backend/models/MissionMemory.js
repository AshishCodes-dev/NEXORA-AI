const mongoose = require('mongoose');

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
 * Memory Configuration & Limits
 */
const MEMORY_CONFIG = {
  MAX_MEMORIES_PER_MISSION: 50,
  MAX_CONTENT_LENGTH: 1000,
  MAX_KEY_LENGTH: 100,
  MAX_TAGS: 10,
  MAX_TAG_LENGTH: 40,
  MAX_RETRIEVAL_LIMIT: 10,
  MAX_EVIDENCE_REFS: 10,
  MAX_METADATA_KEYS: 10,
  MAX_METADATA_STRING_LENGTH: 300,
};

const MEMORY_TYPES = {
  TASK_OUTCOME: 'TASK_OUTCOME',
  VERIFIED_EVIDENCE: 'VERIFIED_EVIDENCE',
  DECISION_CONTEXT: 'DECISION_CONTEXT',
  SYNTHESIS_INSIGHT: 'SYNTHESIS_INSIGHT',
};

const MEMORY_STATUSES = {
  ACTIVE: 'active',
  STALE: 'stale',
  SUPERSEDED: 'superseded',
  INVALIDATED: 'invalidated',
};

const VALID_TYPES = Object.values(MEMORY_TYPES);
const VALID_STATUSES = Object.values(MEMORY_STATUSES);

/**
 * Sanitizes and bounds memory strings, removing sensitive credentials
 *
 * @param {string} str
 * @param {number} maxLength
 * @returns {string|null}
 */
function sanitizeMemoryString(str, maxLength = MEMORY_CONFIG.MAX_CONTENT_LENGTH) {
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
 * Determines whether a metadata key represents sensitive credentials or prototype pollution
 *
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveMetadataKey(key) {
  if (!key || typeof key !== 'string') return true;
  const k = key.trim().toLowerCase();
  // Exact prototype pollution property names
  if (k === '__proto__' || k === 'constructor' || k === 'prototype') return true;
  // Exact sensitive credential names
  if (/^(password|passwd|passphrase|secret|credentials?|cookie|cookies|jwt|bearer|authorization|auth|token|hash|session|sessionid)$/i.test(k)) return true;
  // Substrings for explicit password/secret/cookie/jwt/authorization credentials (excluding benign words like 'author')
  if (/(password|passwd|passphrase|secret|cookie|jwt|authorization|sessionid?)/i.test(k) && !/(author)/i.test(k)) return true;
  // Suffix/delimited matches for token and key credentials
  if (/(^|[_\-.])token($|[_\-.])/i.test(k)) return true;
  if (/(api|access|auth|bearer|session|refresh|id|private)[_\-.]?token$/i.test(k)) return true;
  if (/(api|access|auth|secret|private)[_\-.]?key$/i.test(k)) return true;
  return false;
}

/**
 * Sanitizes metadata with strict allowlist, depth limit, and limits
 *
 * @param {object} meta
 * @param {number} [depth=0]
 * @returns {object|null}
 */
function sanitizeMemoryMetadata(meta, depth = 0) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || depth > 2) return null;

  const clean = {};
  let keyCount = 0;

  for (const [key, val] of Object.entries(meta)) {
    if (keyCount >= MEMORY_CONFIG.MAX_METADATA_KEYS) break;
    // Strict security filter: ignore sensitive keys and proto pollution keys
    if (isSensitiveMetadataKey(key)) continue;

    if (typeof val === 'string') {
      const sanitizedStr = sanitizeMemoryString(val, MEMORY_CONFIG.MAX_METADATA_STRING_LENGTH);
      if (sanitizedStr !== null) {
        clean[key] = sanitizedStr;
        keyCount++;
      }
    } else if (typeof val === 'number' || typeof val === 'boolean' || val === null) {
      clean[key] = val;
      keyCount++;
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val) && depth < 2) {
      const nestedClean = sanitizeMemoryMetadata(val, depth + 1);
      if (nestedClean && Object.keys(nestedClean).length > 0) {
        clean[key] = nestedClean;
        keyCount++;
      }
    }
  }

  return clean;
}

/**
 * MissionMemory Schema
 * Bounded, mission-scoped memory document storing advisory prior outcomes,
 * verified evidence references, and synthesis context.
 */
const missionMemorySchema = new mongoose.Schema(
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
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MissionTask',
      default: null,
      index: true,
    },
    attempt: {
      type: Number,
      default: 1,
      min: [1, 'attempt must be at least 1'],
    },
    type: {
      type: String,
      required: [true, 'type is required'],
      enum: {
        values: VALID_TYPES,
        message: 'Invalid memory type: {VALUE}',
      },
      index: true,
    },
    key: {
      type: String,
      required: [true, 'key is required'],
      trim: true,
      maxlength: [MEMORY_CONFIG.MAX_KEY_LENGTH, `key exceeds max length of ${MEMORY_CONFIG.MAX_KEY_LENGTH}`],
    },
    content: {
      type: String,
      required: [true, 'content is required'],
      trim: true,
      maxlength: [MEMORY_CONFIG.MAX_CONTENT_LENGTH, `content exceeds max length of ${MEMORY_CONFIG.MAX_CONTENT_LENGTH}`],
    },
    evidenceRefs: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Evidence',
        },
      ],
      default: [],
      validate: {
        validator: function (arr) {
          return !arr || arr.length <= MEMORY_CONFIG.MAX_EVIDENCE_REFS;
        },
        message: `evidenceRefs exceeds max count of ${MEMORY_CONFIG.MAX_EVIDENCE_REFS}`,
      },
    },
    relevanceTags: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: MEMORY_CONFIG.MAX_TAG_LENGTH,
        },
      ],
      default: [],
      validate: {
        validator: function (arr) {
          return !arr || arr.length <= MEMORY_CONFIG.MAX_TAGS;
        },
        message: `relevanceTags exceeds max count of ${MEMORY_CONFIG.MAX_TAGS}`,
      },
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: VALID_STATUSES,
        message: 'Invalid memory status: {VALUE}',
      },
      default: MEMORY_STATUSES.ACTIVE,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound indexes for bounded, deterministic query performance
missionMemorySchema.index({ missionId: 1, status: 1, createdAt: -1 });
missionMemorySchema.index({ userId: 1, missionId: 1, type: 1 });
missionMemorySchema.index({ missionId: 1, taskId: 1, attempt: 1 });
missionMemorySchema.index({ missionId: 1, relevanceTags: 1 });

const MissionMemory = mongoose.model('MissionMemory', missionMemorySchema);

module.exports = {
  MissionMemory,
  MEMORY_CONFIG,
  MEMORY_TYPES,
  MEMORY_STATUSES,
  sanitizeMemoryString,
  sanitizeMemoryMetadata,
  isSensitiveMetadataKey,
};
