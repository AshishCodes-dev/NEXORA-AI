const express = require('express');
const Mission = require('../models/Mission');

const router = express.Router();

/**
 * Helper to format Mission document cleanly without leaking MongoDB internals
 */
const formatMission = (doc) => ({
  id: doc._id.toString(),
  objective: doc.objective,
  status: doc.status,
  createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString()
});

/**
 * POST /api/missions
 * Creates and persists a new mission in MongoDB
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
    const mission = await Mission.create({
      objective: trimmedObjective,
      status: 'queued'
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
 * Retrieves all persisted missions from MongoDB
 */
router.get('/', async (req, res) => {
  try {
    const missions = await Mission.find().sort({ createdAt: -1 });
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
