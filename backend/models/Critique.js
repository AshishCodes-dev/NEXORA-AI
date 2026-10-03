const mongoose = require('mongoose');

/**
 * Critique Model
 * 
 * Stores evidence-grounded evaluation and verification of an Analysis document.
 * Assesses whether Analysis findings are accurately supported by Evidence
 * belonging to the same mission and task, audits reference integrity,
 * detects contradictions/gaps, and renders an overall verdict.
 */
const critiqueSchema = new mongoose.Schema(
  {
    missionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mission',
      required: true,
      index: true,
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MissionTask',
      required: true,
      index: true,
    },
    overallVerdict: {
      type: String,
      enum: ['pass', 'needs_revision', 'fail'],
      required: true,
    },
    summary: {
      type: String,
      required: true,
      trim: true,
    },
    findingReviews: [
      {
        statement: {
          type: String,
          required: true,
          trim: true,
        },
        verdict: {
          type: String,
          enum: ['supported', 'partially_supported', 'unsupported', 'contradicted'],
          required: true,
        },
        evidenceIds: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Evidence',
          },
        ],
        issues: [
          {
            type: String,
            trim: true,
          },
        ],
        confidence: {
          type: String,
          enum: ['high', 'medium', 'low'],
          required: true,
        },
      },
    ],
    unsupportedFindings: [
      {
        findingIndex: {
          type: Number,
          required: true,
        },
        statement: {
          type: String,
          required: true,
          trim: true,
        },
        reason: {
          type: String,
          required: true,
          trim: true,
        },
      },
    ],
    contradictions: [
      {
        description: {
          type: String,
          required: true,
          trim: true,
        },
        evidenceIds: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Evidence',
          },
        ],
      },
    ],
    evidenceGaps: [
      {
        type: String,
        trim: true,
      },
    ],
    citationIntegrity: {
      valid: {
        type: Boolean,
        required: true,
      },
      invalidEvidenceIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
        },
      ],
      orphanReferenceCount: {
        type: Number,
        required: true,
        default: 0,
      },
    },
    critiqueMethod: {
      type: String,
      enum: ['gemini', 'deterministic'],
      required: true,
    },
    evidenceIntelligence: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying critique by mission and task
critiqueSchema.index({ missionId: 1, taskId: 1 });

module.exports = mongoose.model('Critique', critiqueSchema);
