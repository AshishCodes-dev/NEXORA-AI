const mongoose = require('mongoose');

const missionTaskSchema = new mongoose.Schema(
  {
    missionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mission',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'queued', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    order: {
      type: Number,
      required: true,
      min: 1,
    },
    agentId: {
      type: String,
      trim: true,
      default: null,
    },
    url: {
      type: String,
      trim: true,
      default: null,
    },
    error: {
      type: String,
      trim: true,
      default: null,
    },
    executionMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const MissionTask = mongoose.model('MissionTask', missionTaskSchema);

module.exports = MissionTask;
