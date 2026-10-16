/**
 * NEXORA 8G.6.2 - PHASE 2.4.1 VERIFICATION TEST SUITE
 * Recovery of Abandoned Missions with All Tasks Completed
 *
 * Verifies:
 * - T1: Abandoned mission with all tasks completed resumes and finalizes to completed via canonical orchestrator
 * - T2: Mixed task states (completed + pending) resumes pipeline execution without premature completion
 * - T3: Mixed task states (completed + active running worker) is NOT resumed (skippedActive)
 * - T4: Mixed task states (completed + failed) halts and transitions mission to failed (prerequisite guard)
 * - T5: Mission with zero tasks is NOT treated as all-completed and is not completed
 * - T6: Expired mission with all tasks completed transitions to failed on deadline, never completed
 * - T7: Concurrent recovery on all-completed mission guarantees single-winner idempotency with zero duplicate terminal events
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const mongoose = require('mongoose');

// Load environment variables
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  } else {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim();
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    });
  }
}

const connectDB = require('../config/db');
const User = require('../models/User');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const { MissionEvent, EVENT_TYPES } = require('../models/MissionEvent');
const {
  reconcileStaleTasks,
  reconcileAbandonedMissions,
  runStartupRecovery,
} = require('../services/missionRecoveryService');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runPhase2_4Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.6.2 - PHASE 2.4.1 VERIFICATION SUITE');
  console.log('  Recovery of Missions with All Tasks Completed');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];

  try {
    const testUser = await User.create({
      name: 'Phase 2.4 Test User',
      email: `p2_4_test_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(testUser._id);

    // =============================================================
    // SECTION 1: ALL-COMPLETED TASKS RECOVERY & CANONICAL FINALIZATION
    // =============================================================
    console.log('--- SECTION 1: All-Completed Tasks Mission Recovery ---');

    // -------------------------------------------------------------
    // T1: ALL-COMPLETED TASKS RECOVERY
    // -------------------------------------------------------------
    await runAsyncTest('T1: Abandoned mission with all tasks completed resumes and finalizes to completed via canonical orchestrator', async () => {
      const mission = await Mission.create({
        objective: 'Test T1 All-Completed Mission Recovery',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 30000),
        deadlineAt: new Date(Date.now() + 60000), // unexpired
      });
      createdMissionIds.push(mission._id);

      // Two tasks both completed before crash
      await MissionTask.create([
        {
          missionId: mission._id,
          title: 'Completed Task 1',
          description: 'First completed step',
          agentId: 'research',
          order: 1,
          status: 'completed',
          executionMetadata: {
            claimedBy: 'worker_1',
            generation: 1,
            attempt: 1,
            resultData: { summary: 'Research data gathered' },
          },
        },
        {
          missionId: mission._id,
          title: 'Completed Task 2',
          description: 'Second completed step',
          agentId: 'analyst',
          order: 2,
          status: 'completed',
          executionMetadata: {
            claimedBy: 'worker_2',
            generation: 1,
            attempt: 1,
            resultData: { summary: 'Analysis completed' },
          },
        },
      ]);

      const stats = await reconcileAbandonedMissions({ missionId: mission._id, executeSync: true });
      assert.strictEqual(stats.resumed, 1, 'Mission must be resumed for finalization');

      // Canonical orchestrator must have transitioned mission to completed
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'completed', 'Mission status must be completed');

      // Canonical MISSION_COMPLETED event must be recorded
      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 1, 'Exactly one MISSION_COMPLETED event emitted');
      assert.strictEqual(completionEvents[0].outcome, 'completed');
    });

    // -------------------------------------------------------------
    // T2: MIXED TASK STATES (COMPLETED + PENDING) RESUMES PIPELINE
    // -------------------------------------------------------------
    await runAsyncTest('T2: Mixed task states (completed + pending) resumes pipeline execution without premature completion', async () => {
      const mission = await Mission.create({
        objective: 'Test T2 Mixed Completed and Pending',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 20000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      // Task 1 was completed, Task 2 was pending
      await MissionTask.create([
        {
          missionId: mission._id,
          title: 'Completed Task 1',
          description: 'Step 1 already completed',
          agentId: 'analyst',
          order: 1,
          status: 'completed',
          executionMetadata: {
            claimedBy: 'worker_1',
            generation: 1,
            attempt: 1,
          },
        },
        {
          missionId: mission._id,
          title: 'Pending Task 2',
          description: 'Step 2 pending execution',
          agentId: 'analyst',
          order: 2,
          status: 'pending',
        },
      ]);

      const stats = await reconcileAbandonedMissions({ missionId: mission._id, executeSync: true });
      assert.strictEqual(stats.resumed, 1, 'Mission must be resumed to execute pending tasks');

      // Mission must complete after executing Task 2
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'completed');

      const task2InDb = await MissionTask.findOne({ missionId: mission._id, order: 2 });
      assert.strictEqual(task2InDb.status, 'completed', 'Pending task must have executed to completion');
    });

    // -------------------------------------------------------------
    // T3: ACTIVE WORKER LEASE SKIPPED
    // -------------------------------------------------------------
    await runAsyncTest('T3: Mixed task states (completed + active running worker) is NOT resumed (skippedActive)', async () => {
      const mission = await Mission.create({
        objective: 'Test T3 Completed and Active Worker',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create([
        {
          missionId: mission._id,
          title: 'Completed Task 1',
          description: 'Step 1 completed',
          agentId: 'analyst',
          order: 1,
          status: 'completed',
        },
        {
          missionId: mission._id,
          title: 'Active Running Task 2',
          description: 'Worker alive with recent heartbeat',
          agentId: 'analyst',
          order: 2,
          status: 'running',
          executionMetadata: {
            claimedBy: 'worker_live_now',
            generation: 1,
            attempt: 1,
            heartbeatAt: new Date(Date.now() - 2000), // 2s ago (< 25s lease)
          },
        },
      ]);

      const stats = await reconcileAbandonedMissions({ missionId: mission._id, executeSync: true });
      assert.strictEqual(stats.skippedActive, 1, 'Active worker must be recorded as skippedActive');
      assert.strictEqual(stats.resumed, 0, 'Must NOT resume or complete mission while active worker is running');

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'running', 'Mission status must remain running');
    });

    // -------------------------------------------------------------
    // T4: MIXED STATES (COMPLETED + FAILED) HALTS PIPELINE
    // -------------------------------------------------------------
    await runAsyncTest('T4: Mixed task states (completed + failed) halts and transitions mission to failed (prerequisite guard)', async () => {
      const mission = await Mission.create({
        objective: 'Test T4 Completed and Failed Tasks',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 30000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create([
        {
          missionId: mission._id,
          title: 'Completed Task 1',
          description: 'Step 1 completed',
          agentId: 'analyst',
          order: 1,
          status: 'completed',
        },
        {
          missionId: mission._id,
          title: 'Failed Task 2',
          description: 'Step 2 failed without retries',
          agentId: 'analyst',
          order: 2,
          status: 'failed',
          error: 'Fatal task error',
        },
        {
          missionId: mission._id,
          title: 'Pending Task 3',
          description: 'Step 3 must not be dispatched',
          agentId: 'analyst',
          order: 3,
          status: 'pending',
        },
      ]);

      const stats = await reconcileAbandonedMissions({ missionId: mission._id, executeSync: true });
      assert.strictEqual(stats.resumed, 1, 'Mission resumed to execute prerequisite failure guard');

      // Mission must be transitioned to failed, NOT completed
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed', 'Mission must be failed due to failed task');

      // Zero MISSION_COMPLETED events
      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'Zero MISSION_COMPLETED events permitted');

      // Downstream task 3 must remain pending
      const task3InDb = await MissionTask.findOne({ missionId: mission._id, order: 3 });
      assert.strictEqual(task3InDb.status, 'pending', 'Downstream task must remain pending');
    });

    // -------------------------------------------------------------
    // T5: ZERO-TASK MISSION IS NOT TREATED AS COMPLETED
    // -------------------------------------------------------------
    await runAsyncTest('T5: Mission with zero tasks is NOT treated as all-completed and is not completed', async () => {
      const mission = await Mission.create({
        objective: 'Test T5 Zero Tasks Mission',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 30000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const stats = await reconcileAbandonedMissions({ missionId: mission._id, executeSync: true });
      assert.strictEqual(stats.resumed, 0, 'Zero task mission must NOT be resumed as all-completed');

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'running', 'Mission status must not be modified to completed');

      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'Zero MISSION_COMPLETED events emitted for empty mission');
    });

    // -------------------------------------------------------------
    // T6: EXPIRED MISSION WITH COMPLETED TASKS FAILS ON DEADLINE
    // -------------------------------------------------------------
    await runAsyncTest('T6: Expired mission with all tasks completed transitions to failed on deadline, never completed', async () => {
      const expiredDeadline = new Date(Date.now() - 10000); // 10s ago
      const mission = await Mission.create({
        objective: 'Test T6 Expired Completed Mission',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 70000),
        deadlineAt: expiredDeadline,
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create([
        {
          missionId: mission._id,
          title: 'Completed Task 1',
          description: 'Step 1 completed before deadline',
          agentId: 'analyst',
          order: 1,
          status: 'completed',
        },
        {
          missionId: mission._id,
          title: 'Completed Task 2',
          description: 'Step 2 completed before deadline',
          agentId: 'analyst',
          order: 2,
          status: 'completed',
        },
      ]);

      const stats = await reconcileAbandonedMissions({ missionId: mission._id, executeSync: true });
      assert.ok(stats.failedExpired >= 1, 'Expired mission must be failed by deadline guard');

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed', 'Expired mission must be failed, NOT completed');

      // Canonical MISSION_FAILED event
      const failEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_FAILED,
      });
      assert.strictEqual(failEvents.length, 1, 'Exactly one MISSION_FAILED event emitted');
      assert.ok(failEvents[0].reason.includes('deadline exceeded'));

      // Zero MISSION_COMPLETED events
      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'Zero MISSION_COMPLETED events on expired deadline');
    });

    // -------------------------------------------------------------
    // T7: CONCURRENT RECOVERY IDEMPOTENCY ON ALL-COMPLETED MISSION
    // -------------------------------------------------------------
    await runAsyncTest('T7: Concurrent recovery on all-completed mission guarantees single-winner idempotency with zero duplicate terminal events', async () => {
      const mission = await Mission.create({
        objective: 'Test T7 Concurrent Recovery Idempotency',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 30000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create([
        {
          missionId: mission._id,
          title: 'Completed Task 1',
          description: 'Step 1 completed',
          agentId: 'analyst',
          order: 1,
          status: 'completed',
        },
        {
          missionId: mission._id,
          title: 'Completed Task 2',
          description: 'Step 2 completed',
          agentId: 'analyst',
          order: 2,
          status: 'completed',
        },
      ]);

      // Launch two concurrent recovery instances targeting this mission
      const [resA, resB] = await Promise.all([
        reconcileAbandonedMissions({ missionId: mission._id, executeSync: true }),
        reconcileAbandonedMissions({ missionId: mission._id, executeSync: true }),
      ]);

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'completed', 'Mission must be transitioned to completed');

      // Exactly ONE winning MISSION_COMPLETED event must exist
      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 1, 'Exactly one MISSION_COMPLETED event emitted; zero duplicate terminal events permitted');
    });

    console.log('\n====================================================');
    console.log(`  NEXORA 8G.6.2 - PHASE 2.4.1 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
    console.log('====================================================\n');

  } finally {
    // Cleanup fixtures
    if (createdMissionIds.length > 0) {
      await Mission.deleteMany({ _id: { $in: createdMissionIds } });
      await MissionTask.deleteMany({ missionId: { $in: createdMissionIds } });
      await MissionEvent.deleteMany({ missionId: { $in: createdMissionIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
    console.log('[DATABASE] MongoDB disconnected');
  }
}

if (require.main === module) {
  runPhase2_4Suite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[FATAL PHASE 2.4.1 SUITE FAILURE]', err);
      process.exit(1);
    });
}

module.exports = { runPhase2_4Suite };
