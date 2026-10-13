const mongoose = require('mongoose');

const missionSchema = new mongoose.Schema(
  {
    objective: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      default: 'queued',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    deadlineAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

missionSchema.index({ status: 1, deadlineAt: 1 });

const Mission = mongoose.model('Mission', missionSchema);

module.exports = Mission;
