const express = require('express');
const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const authMiddleware = require('../middleware/authMiddleware');
const { createMissionExecutionPlan, executeMission } = require('../orchestrator/missionOrchestrator');
const { getMissionResult } = require('../services/missionResultService');
const { getMissionState } = require('../services/missionStateService');
const { getMissionEvents, recordEvent, EVENT_TYPES } = require('../services/missionEventService');
const { recordMissionCreated, getMissionTelemetry, getMissionMetrics } = require('../services/telemetry/telemetryService');

const router = express.Router();

// Protect all mission endpoints with authentication middleware
router.use(authMiddleware);

/**
 * Helper to format Mission document cleanly without leaking internal MongoDB metadata
 */
const formatMission = (doc) => ({
  id: doc._id.toString(),
  objective: doc.objective,
  status: doc.status,
  createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
  userId: doc.userId ? doc.userId.toString() : null
});

/**
 * Helper to format MissionTask document cleanly
 */
const formatTask = (doc) => ({
  id: doc._id.toString(),
  title: doc.title,
  description: doc.description,
  status: doc.status,
  order: doc.order
});

const MIN_OBJECTIVE_LENGTH = 3;
const MAX_OBJECTIVE_LENGTH = 2000;

/**
 * POST /api/missions
 * Creates and persists a new mission belonging to the authenticated user,
 * then generates the deterministic task decomposition plan.
 */
router.post('/', async (req, res) => {
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
    const { limit, skip, type, decisionType } = req.query;

    // req.user.id is guaranteed by authMiddleware; query/body params are strictly ignored
    const result = await getMissionEvents(missionId, req.user.id, { limit, skip, type, decisionType });

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
