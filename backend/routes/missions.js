const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// In-memory mission store
const missions = [];

/**
 * POST /api/missions
 * Creates and queues a new mission
 */
router.post('/', (req, res) => {
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

  // Generate unique mission
  const mission = {
    id: `nx_${crypto.randomUUID()}`,
    objective: trimmedObjective,
    status: 'queued',
    createdAt: new Date().toISOString()
  };

  missions.push(mission);

  return res.status(201).json({
    success: true,
    mission
  });
});

/**
 * GET /api/missions
 * Retrieves all in-memory missions (telemetry & inspection)
 */
router.get('/', (req, res) => {
  return res.status(200).json({
    success: true,
    count: missions.length,
    missions
  });
});

module.exports = router;
