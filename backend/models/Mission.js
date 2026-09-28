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
    // Designed to support future user ownership (Firebase Auth integration)
    userId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Mission = mongoose.model('Mission', missionSchema);

module.exports = Mission;
