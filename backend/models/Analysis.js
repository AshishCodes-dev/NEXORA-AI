const mongoose = require('mongoose');

/**
 * Analysis Model
 * 
 * Stores evidence-grounded analytical findings, gaps, and contradictions.
 * Every analysis record is strictly bound to a Mission and MissionTask,
 * and maintains explicit reference provenance to the underlying Evidence IDs.
 */
const analysisSchema = new mongoose.Schema(
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
    evidenceCount: {
      type: Number,
      required: true,
      min: 0,
    },
    findings: [
      {
        statement: {
          type: String,
          required: true,
          trim: true,
        },
        supportingEvidenceIds: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Evidence',
          },
        ],
        confidence: {
          type: String,
          enum: ['high', 'medium', 'low'],
          required: true,
        },
      },
    ],
    gaps: [
      {
        type: String,
        trim: true,
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
    analysisMethod: {
      type: String,
      enum: ['gemini', 'deterministic'],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient lookup by mission and task
analysisSchema.index({ missionId: 1, taskId: 1 });

module.exports = mongoose.model('Analysis', analysisSchema);
