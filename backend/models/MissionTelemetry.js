const mongoose = require('mongoose');

/**
 * Stage Event Schema
 * Represents a single lifecycle stage execution record for a mission.
 */
const stageEventSchema = new mongoose.Schema(
  {
    stage: {
      type: String,
      required: true,
      enum: [
        'created',
        'planning',
        'research',
        'browser',
        'analysis',
        'critique',
        'building',
        'qa',
        'completed',
        'failed',
      ],
    },
    status: {
      type: String,
      required: true,
      enum: ['started', 'completed', 'failed'],
    },
    startedAt: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    durationMs: {
      type: Number,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false }
);

/**
 * Task Telemetry Schema
 * Captures execution timing, attempt counts, and failure information per task.
 */
const taskTelemetrySchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MissionTask',
      required: true,
    },
    agentId: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: ['started', 'completed', 'failed'],
    },
    attempt: {
      type: Number,
      default: 1,
      min: 1,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    durationMs: {
      type: Number,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    failureCategory: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false }
);

/**
 * Provider Telemetry Schema
 * Captures AI/model latency and success metrics without storing prompts or API keys.
 */
const providerTelemetrySchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      default: 'gemini',
    },
    model: {
      type: String,
      required: true,
    },
    operation: {
      type: String,
      required: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
      required: true,
    },
    latencyMs: {
      type: Number,
      required: true,
      min: 0,
    },
    success: {
      type: Boolean,
      required: true,
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MissionTask',
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

/**
 * Mission-Level Aggregated Metrics Schema
 */
const metricsSchema = new mongoose.Schema(
  {
    totalDurationMs: { type: Number, default: 0 },
    taskCount: { type: Number, default: 0 },
    successfulTasks: { type: Number, default: 0 },
    failedTasks: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },
    evidenceCount: { type: Number, default: 0 },
    providerCallCount: { type: Number, default: 0 },
    providerFailureCount: { type: Number, default: 0 },
    qaScore: { type: Number, default: null },
  },
  { _id: false }
);

/**
 * Mission Telemetry Root Schema
 * Dedicated bounded document storing telemetry and derived metrics for a mission.
 */
const missionTelemetrySchema = new mongoose.Schema(
  {
    missionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mission',
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    currentStage: {
      type: String,
      default: 'created',
    },
    status: {
      type: String,
      default: 'pending',
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    totalDurationMs: {
      type: Number,
      default: null,
    },
    stages: {
      type: [stageEventSchema],
      default: [],
    },
    tasks: {
      type: [taskTelemetrySchema],
      default: [],
    },
    providerCalls: {
      type: [providerTelemetrySchema],
      default: [],
    },
    metrics: {
      type: metricsSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const MissionTelemetry = mongoose.model('MissionTelemetry', missionTelemetrySchema);

module.exports = MissionTelemetry;
