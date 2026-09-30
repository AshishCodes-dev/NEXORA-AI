const mongoose = require('mongoose');

/**
 * Artifact Model
 * 
 * Stores structured, evidence-grounded deliverables synthesized from
 * verified Analysis findings, Evidence records, and Critic evaluations.
 */
const artifactSchema = new mongoose.Schema(
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
    artifactType: {
      type: String,
      enum: ['report', 'summary', 'comparison', 'plan', 'brief', 'answer'],
      required: true,
      default: 'report',
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    executiveSummary: {
      type: String,
      required: true,
      trim: true,
    },
    sections: [
      {
        heading: {
          type: String,
          required: true,
          trim: true,
        },
        content: {
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
    keyFindings: [
      {
        statement: {
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
        confidence: {
          type: String,
          enum: ['high', 'medium', 'low'],
          required: true,
        },
      },
    ],
    limitations: [
      {
        type: String,
        trim: true,
      },
    ],
    unresolvedQuestions: [
      {
        type: String,
        trim: true,
      },
    ],
    sourceReferences: [
      {
        evidenceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Evidence',
          required: true,
        },
        sourceTitle: {
          type: String,
          required: true,
          trim: true,
        },
        sourceUrl: {
          type: String,
          required: true,
          trim: true,
        },
      },
    ],
    buildMethod: {
      type: String,
      enum: ['gemini', 'deterministic'],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying artifact by mission and task
artifactSchema.index({ missionId: 1, taskId: 1 });

module.exports = mongoose.model('Artifact', artifactSchema);
