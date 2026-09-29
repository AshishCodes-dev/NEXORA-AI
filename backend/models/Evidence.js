const mongoose = require('mongoose');

/**
 * Evidence Model
 * 
 * Stores verified research claims with strict source provenance.
 * Every evidence record is tied to a specific Mission and MissionTask,
 * and maintains the exact source URL, page title, claim summary,
 * verbatim evidence excerpt, and retrieval timestamp.
 */
const evidenceSchema = new mongoose.Schema(
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
    sourceUrl: {
      type: String,
      required: true,
      trim: true,
    },
    sourceTitle: {
      type: String,
      required: true,
      trim: true,
    },
    claim: {
      type: String,
      required: true,
      trim: true,
    },
    evidenceText: {
      type: String,
      required: true,
      trim: true,
    },
    retrievedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying all evidence by mission and task
evidenceSchema.index({ missionId: 1, taskId: 1 });

module.exports = mongoose.model('Evidence', evidenceSchema);
