const express = require('express');
const Mission = require('../models/Mission');
const authMiddleware = require('../middleware/authMiddleware');

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
 * POST /api/missions
 * Creates and persists a new mission belonging to the authenticated user
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

  try {
    // Sourced exclusively from req.user.id (req.body.userId is completely ignored)
    const mission = await Mission.create({
      objective: trimmedObjective,
      status: 'queued',
      userId: req.user.id
    });

    return res.status(201).json({
      success: true,
      mission: formatMission(mission)
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

module.exports = router;
