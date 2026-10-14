const express = require('express');
const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const { MissionEvent } = require('../models/MissionEvent');
const authMiddleware = require('../middleware/authMiddleware');
const { createMissionExecutionPlan, executeMission, cancelMission } = require('../orchestrator/missionOrchestrator');
const { getMissionResult } = require('../services/missionResultService');
const { getMissionState } = require('../services/missionStateService');
const { getMissionEvents, recordEvent, EVENT_TYPES } = require('../services/missionEventService');
const { recordMissionCreated, getMissionTelemetry, getMissionMetrics } = require('../services/telemetry/telemetryService');
const { missionRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Protect all mission endpoints with authentication middleware
router.use(authMiddleware);

/**
 * Helper to format Mission document cleanly without leaking internal MongoDB metadata
 */
const formatMission = (doc) => {
  if (!doc) return null;
  const id = doc._id ? doc._id.toString() : (doc.id ? doc.id.toString() : null);
  const createdAt = doc.createdAt instanceof Date
    ? doc.createdAt.toISOString()
    : (typeof doc.createdAt === 'string'
      ? doc.createdAt
      : (doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString()));
  const userId = doc.userId
    ? (doc.userId._id ? doc.userId._id.toString() : doc.userId.toString())
    : null;
  return {
    id,
    objective: doc.objective,
    status: doc.status,
    createdAt,
    userId,
  };
};

/**
 * Helper to format MissionTask document cleanly
 */
const formatTask = (doc) => {
  if (!doc) return null;
  const id = doc._id ? doc._id.toString() : (doc.id ? doc.id.toString() : null);
  return {
    id,
    title: doc.title,
    description: doc.description,
    status: doc.status,
    order: doc.order,
  };
};

const MIN_OBJECTIVE_LENGTH = 3;
const MAX_OBJECTIVE_LENGTH = 2000;

/**
 * POST /api/missions
 * Creates and persists a new mission belonging to the authenticated user,
 * then generates the deterministic task decomposition plan.
 */
router.post('/', missionRateLimiter, async (req, res) => {
  const { objective } = req.body || {};

  // Validation: objective must exist and be a string
  if (typeof objective !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Mission objective is required and must be a string'
    });
  }

  // Trim whitespace
  const trimmedObjective = objective.trim();

  // Validation: reject empty objective
  if (!trimmedObjective) {
    return res.status(400).json({
      success: false,
      error: 'Mission objective cannot be empty'
    });
  }

  // Validation: minimum length
  if (trimmedObjective.length < MIN_OBJECTIVE_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `Mission objective must be at least ${MIN_OBJECTIVE_LENGTH} characters long`
    });
  }

  // Validation: maximum length
  if (trimmedObjective.length > MAX_OBJECTIVE_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `Mission objective exceeds maximum allowed length of ${MAX_OBJECTIVE_LENGTH} characters`
    });
  }

  try {
    // Sourced exclusively from req.user.id (req.body.userId is completely ignored)
    const mission = await Mission.create({
      objective: trimmedObjective,
      status: 'planning',
      userId: req.user.id
    });

    recordMissionCreated({ missionId: mission._id, userId: mission.userId }).catch(() => {});
    recordEvent({
      missionId: mission._id,
      userId: mission.userId,
      type: EVENT_TYPES.MISSION_CREATED,
      action: 'Mission directive received and persisted',
    }).catch(() => {});
    recordEvent({
      missionId: mission._id,
      userId: mission.userId,
      type: EVENT_TYPES.MISSION_PLANNING_STARTED,
      action: 'Generating mission execution plan',
    }).catch(() => {});

    let executionPlan;
    try {
      executionPlan = await createMissionExecutionPlan(mission);
    } catch (orchestrationError) {
      console.error('[MISSION ORCHESTRATION ERROR]', orchestrationError.message);
      // Clean up orphaned mission to avoid partial/broken state
      await Mission.findByIdAndDelete(mission._id).catch(() => {});
      return res.status(500).json({
        success: false,
        error: 'Failed to generate mission execution plan.'
      });
    }

    // Return response promptly without blocking for asynchronous task execution
    res.status(201).json({
      success: true,
      mission: formatMission(mission),
      tasks: (executionPlan.tasks || []).map(formatTask)
    });

    // Trigger mission execution asynchronously (safe background dispatch)
    setImmediate(() => {
      executeMission(mission._id).catch((execErr) => {
        console.error(`[ASYNC MISSION EXECUTION ERROR] Mission ${mission._id}:`, execErr.message);
      });
    });
  } catch (error) {
    console.error('[MISSIONS ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to persist mission directive. Database storage error.'
    });
  }
});

/**
 * GET /api/missions
 * Retrieves all missions belonging to the currently authenticated user
 */
router.get('/', async (req, res) => {
  try {
    // Filter strictly by authenticated user's ID, sorted newest first
    const missions = await Mission.find({ userId: req.user.id }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: missions.length,
      missions: missions.map(formatMission)
    });
  } catch (error) {
    console.error('[MISSIONS ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve persisted missions.'
    });
  }
});

/**
 * GET /api/missions/:missionId
 * Retrieves detailed mission document and task hierarchy for the authenticated user
 */
router.get('/:missionId', async (req, res) => {
  try {
    const { missionId } = req.params;
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    const mission = await Mission.findOne({ _id: missionId, userId: req.user.id });
    if (!mission) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    const tasks = await MissionTask.find({ missionId }).sort({ order: 1 });

    return res.status(200).json({
      success: true,
      mission: formatMission(mission),
      tasks: tasks.map(formatTask)
    });
  } catch (error) {
    console.error('[MISSIONS ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve mission.'
    });
  }
});

/**
 * POST /api/missions/:missionId/cancel
 * Safely cancels a mission and aborts in-flight tasks belonging to the authenticated user
 */
router.post('/:missionId/cancel', async (req, res) => {
  try {
    const { missionId } = req.params;
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    let cancelReason = 'Mission cancelled by user';
    if (typeof req.body?.reason === 'string' && req.body.reason.trim()) {
      cancelReason = req.body.reason.trim().slice(0, 500);
    }
    const result = await cancelMission(missionId, {
      userId: req.user.id,
      reason: cancelReason,
    });

    if (result.notFound) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: result.cancelled ? 'Mission cancelled successfully' : 'Mission is already terminal',
      cancelled: Boolean(result.cancelled),
      mission: formatMission(result.mission)
    });
  } catch (error) {
    console.error('[MISSION CANCEL ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to cancel mission.'
    });
  }
});

/**
 * POST /api/missions/:missionId/tasks/:taskId/retry
 * Retries an eligible failed task belonging to a mission owned by the authenticated user.
 */
router.post('/:missionId/tasks/:taskId/retry', async (req, res) => {
  try {
    const { missionId, taskId } = req.params;

    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Tenant isolation: verify mission ownership
    const mission = await Mission.findOne({ _id: missionId, userId: req.user.id });
    if (!mission) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    // Terminal guard: cannot retry tasks on cancelled or completed missions
    const isCancelled = mission.status === 'cancelled' || await MissionEvent.exists({
      missionId: mission._id,
      $or: [
        { type: EVENT_TYPES.MISSION_CANCELLED },
        { type: EVENT_TYPES.MISSION_FAILED, 'metadata.cancelled': true },
      ],
    });
    if (isCancelled) {
      const msg = 'Cannot retry task on a cancelled mission.';
      return res.status(400).json({
        success: false,
        error: msg,
        message: msg,
      });
    }

    if (mission.status === 'completed') {
      const msg = 'Cannot retry task on a completed mission.';
      return res.status(400).json({
        success: false,
        error: msg,
        message: msg,
      });
    }

    // Task verification
    const task = await MissionTask.findOne({ _id: taskId, missionId: mission._id });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
        message: 'Task not found',
      });
    }

    if (task.status === 'completed') {
      const msg = 'Cannot retry an already completed task.';
      return res.status(400).json({
        success: false,
        error: msg,
        message: msg,
      });
    }

    if (task.status === 'running') {
      const msg = 'Task is currently running.';
      return res.status(409).json({
        success: false,
        error: msg,
        message: msg,
      });
    }

    if (task.status === 'pending') {
      const msg = 'Task is already pending execution.';
      return res.status(400).json({
        success: false,
        error: msg,
        message: msg,
      });
    }

    // Only failed tasks are eligible
    if (task.status !== 'failed') {
      const msg = `Task in '${task.status}' state is not eligible for retry.`;
      return res.status(400).json({
        success: false,
        error: msg,
        message: msg,
      });
    }

    // Check retry budget
    const currentAttempt = task.executionMetadata?.attempt || 1;
    const maxRetries = task.retryLimit || 3;
    if (currentAttempt > maxRetries) {
      const msg = `Task retry budget exhausted (${currentAttempt}/${maxRetries}).`;
      return res.status(400).json({
        success: false,
        error: msg,
        message: msg,
      });
    }

    const nextAttempt = currentAttempt + 1;

    // Safely construct updated executionMetadata object to avoid null path error
    const rawMeta = task.executionMetadata;
    const baseMeta = rawMeta && typeof rawMeta === 'object'
      ? (typeof rawMeta.toObject === 'function' ? rawMeta.toObject() : { ...rawMeta })
      : {};
    const updatedMetadata = {
      ...baseMeta,
      attempt: nextAttempt,
      lastRetryAt: new Date(),
      isManualRetry: true,
    };

    // Atomic Compare-And-Set transition to re-queue task as pending
    const updatedTask = await MissionTask.findOneAndUpdate(
      { _id: task._id, status: 'failed' },
      {
        $set: {
          status: 'pending',
          workerId: null,
          leaseExpiresAt: null,
          error: null,
          executionMetadata: updatedMetadata,
        },
        $inc: { generation: 1, retryCount: 1 },
      },
      { returnDocument: 'after' }
    );

    if (!updatedTask) {
      return res.status(409).json({
        success: false,
        error: 'Task state changed concurrently; retry rejected.'
      });
    }

    // If mission was marked failed due to this task, resume it to running
    if (mission.status === 'failed') {
      await Mission.updateOne(
        { _id: mission._id, status: 'failed' },
        { $set: { status: 'running' } }
      );
      mission.status = 'running';
    }

    // Record canonical retry lifecycle event
    await recordEvent({
      missionId: mission._id,
      userId: req.user.id,
      type: EVENT_TYPES.TASK_RETRY_STARTED,
      taskId: task._id,
      action: `Manual task retry initiated for attempt ${nextAttempt}`,
      outcome: 'retrying',
      metadata: { attempt: nextAttempt, manual: true },
    }).catch((eventErr) => {
      console.warn('[RETRY EVENT WARNING]', eventErr.message);
    });

    // Dispatch background worker execution to resume pipeline
    setImmediate(() => {
      executeMission(mission._id).catch((execErr) => {
        console.error(`[RETRY ASYNC EXECUTION ERROR] Mission ${mission._id}:`, execErr.message);
      });
    });

    return res.status(200).json({
      success: true,
      message: 'Task retry initiated successfully',
      task: formatTask(updatedTask),
      mission: formatMission(mission)
    });
  } catch (error) {
    console.error('[TASK RETRY ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retry task.'
    });
  }
});

/**
 * POST /api/missions/:missionId/execute
 * Triggers or resumes execution of an existing mission belonging to the authenticated user
 */
router.post('/:missionId/execute', async (req, res) => {
  try {
    const { missionId } = req.params;
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    const mission = await Mission.findOne({ _id: missionId, userId: req.user.id });
    if (!mission) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    if (mission.status === 'completed') {
      return res.status(200).json({
        success: true,
        message: 'Mission already completed',
        status: 'completed',
        mission: formatMission(mission)
      });
    }

    if (mission.status === 'failed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot execute a failed mission. Create a new mission or retry.',
        status: 'failed',
        mission: formatMission(mission)
      });
    }

    if (req.query.sync === 'true') {
      const execResult = await executeMission(missionId);
      return res.status(200).json({
        success: true,
        message: 'Mission execution completed',
        status: execResult.mission?.status || 'completed',
        mission: formatMission(execResult.mission || mission)
      });
    }

    setImmediate(() => {
      executeMission(mission._id).catch((execErr) => {
        console.error(`[ASYNC MISSION EXECUTION ERROR] Mission ${mission._id}:`, execErr.message);
      });
    });

    return res.status(202).json({
      success: true,
      message: 'Mission execution dispatched',
      status: mission.status === 'planning' ? 'running' : mission.status,
      mission: formatMission(mission)
    });
  } catch (error) {
    console.error('[MISSION EXECUTE ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to execute mission.'
    });
  }
});

/**
 * GET /api/missions/:missionId/result
 * Retrieves the complete aggregated final result of a mission owned by the authenticated user.
 */
router.get('/:missionId/result', async (req, res) => {
  try {
    const { missionId } = req.params;
    // req.user.id is guaranteed by authMiddleware; query/body params are strictly ignored
    const result = await getMissionResult(missionId, req.user.id);

    if (result.notFound) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[MISSION RESULT ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve mission result'
    });
  }
});

/**
 * GET /api/missions/:missionId/telemetry
 * Retrieves lifecycle events, task timings, and provider metrics for the mission
 */
router.get('/:missionId/telemetry', async (req, res) => {
  try {
    const { missionId } = req.params;
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    const mission = await Mission.findOne({ _id: missionId, userId: req.user.id });
    if (!mission) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    const telemetry = await getMissionTelemetry(missionId);
    return res.status(200).json({
      success: true,
      telemetry: telemetry || null
    });
  } catch (error) {
    console.error('[MISSION TELEMETRY ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve mission telemetry'
    });
  }
});

/**
 * GET /api/missions/:missionId/metrics
 * Retrieves deterministic execution metrics for the mission
 */
router.get('/:missionId/metrics', async (req, res) => {
  try {
    const { missionId } = req.params;
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    const mission = await Mission.findOne({ _id: missionId, userId: req.user.id });
    if (!mission) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    const metrics = await getMissionMetrics(missionId);
    return res.status(200).json({
      success: true,
      metrics: metrics || null
    });
  } catch (error) {
    console.error('[MISSION METRICS ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve mission metrics'
    });
  }
});

/**
 * GET /api/missions/:missionId/state
 * Retrieves authoritative real-time Mission State Intelligence
 */
router.get('/:missionId/state', async (req, res) => {
  try {
    const { missionId } = req.params;
    // req.user.id is guaranteed by authMiddleware; query/body params are strictly ignored
    const result = await getMissionState(missionId, req.user.id);

    if (result.notFound) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[MISSION STATE ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve mission state'
    });
  }
});

/**
 * GET /api/missions/:missionId/events
 * Retrieves immutable historical events and decisions for a mission owned by the authenticated user.
 */
router.get('/:missionId/events', async (req, res) => {
  try {
    const { missionId } = req.params;
    const { limit, skip, type, decisionType, sinceSeq } = req.query;

    // req.user.id is guaranteed by authMiddleware; query/body params are strictly ignored
    const result = await getMissionEvents(missionId, req.user.id, { limit, skip, type, decisionType, sinceSeq });

    if (result.notFound) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found'
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[MISSION EVENTS ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve mission events'
    });
  }
});

/**
 * GET /api/missions/:missionId/memory
 * Retrieves bounded active memories for a mission owned by the authenticated user.
 */
router.get('/:missionId/memory', async (req, res) => {
  try {
    const { missionId } = req.params;
    const { type, tags, query, limit, includeStale } = req.query;

    const { getMissionMemories } = require('../services/missionMemoryService');
    const result = await getMissionMemories(missionId, req.user.id, {
      type,
      tags: tags ? (Array.isArray(tags) ? tags : String(tags).split(',')) : [],
      query,
      limit,
      includeStale,
    });

    if (result.notFound) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found',
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[MISSION MEMORY ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve mission memories',
    });
  }
});

/**
 * GET /api/missions/:missionId/graph
 * Retrieves mission-scoped Evidence/Decision graph for the authenticated user.
 */
router.get('/:missionId/graph', async (req, res) => {
  try {
    const { missionId } = req.params;
    const { includeAdvisory, includeEvents, maxNodes, maxEdges, depth } = req.query;

    const { buildMissionGraph } = require('../services/missionGraphService');
    const result = await buildMissionGraph(missionId, req.user.id, {
      includeAdvisory,
      includeEvents,
      maxNodes,
      maxEdges,
      depth,
    });

    if (result.notFound) {
      return res.status(404).json({
        success: false,
        error: 'Mission not found',
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[MISSION GRAPH ROUTE ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve mission graph',
    });
  }
});

module.exports = router;
