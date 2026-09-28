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
  },
  {
    timestamps: true,
  }
);

const Mission = mongoose.model('Mission', missionSchema);

module.exports = Mission;
