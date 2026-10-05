const mongoose = require('mongoose');

/**
 * QAReport Model
 * 
 * Stores independent quality assurance verification and audit reports
 * evaluating deliverable Artifacts against persisted Mission, Evidence,
 * Analysis, and Critique documents.
 */
const qaReportSchema = new mongoose.Schema(
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
    overallScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    summary: {
      type: String,
      required: true,
      trim: true,
    },
    checks: [
      {
        checkType: {
          type: String,
          enum: [
            'artifact_integrity',
            'evidence_integrity',
            'source_integrity',
            'claim_support',
            'critique_alignment',
            'completeness',
            'mission_alignment',
            'quality',
            'grounding_evidence_exists',
            'grounding_mission_isolation',
            'grounding_source_match',
            'grounding_reference_integrity',
            'grounding_metadata_valid',
          ],
          required: true,
        },
        status: {
          type: String,
          enum: ['pass', 'warning', 'fail'],
          required: true,
        },
        message: {
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
        details: {
          type: String,
          trim: true,
        },
      },
    ],
    invalidEvidenceIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
      },
    ],
    unsupportedFindings: [
      {
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
        evidenceIds: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Evidence',
          },
        ],
      },
    ],
    critiqueViolations: [
      {
        description: {
          type: String,
          required: true,
          trim: true,
        },
        relatedEvidenceIds: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Evidence',
          },
        ],
      },
    ],
    missingRequirements: [
      {
        type: String,
        trim: true,
      },
    ],
    warnings: [
      {
        type: String,
        trim: true,
      },
    ],
    qaMethod: {
      type: String,
      enum: ['gemini', 'deterministic'],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying QA reports by mission and task
qaReportSchema.index({ missionId: 1, taskId: 1 });

module.exports = mongoose.model('QAReport', qaReportSchema);
