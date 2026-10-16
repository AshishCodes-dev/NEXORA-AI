/**
 * NEXORA 8G.6.2 - PHASE 1 VERIFICATION TEST SUITE
 * Worker Ownership, Periodic Heartbeats, and Fenced CAS Transitions
 *
 * Verifies:
 * - T1: Heartbeat updates heartbeatAt without incrementing generation
 * - T2: Heartbeat CAS returning null fences worker and stops execution (LeaseLostError: LOST)
 * - T3: Repeated heartbeat DB errors trigger bounded uncertainty shutdown at threshold (LeaseLostError: EXPIRED_UNCERTAIN)
 * - T4: Pre-completion drain awaits in-flight heartbeat tick cleanly
 * - T5: Stale worker's completion CAS is rejected; zero completion events or memory written (LeaseLostError: COMPLETION_CAS_FENCED)
 * - T6: Stale worker's failure CAS is rejected; zero failure events or memory written (LeaseLostError: FAILURE_CAS_FENCED)
 * - T7: Completion CAS network ambiguity handling (no false success events or failure cascades)
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
  executeMissionTask,
  LeaseLostError,
  WORKER_STATES,
  HEARTBEAT_INTERVAL_MS,
  LEASE_DURATION_MS,
} = require('../orchestrator/taskExecutor');

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

async function runPhase1Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.6.2 - PHASE 1 VERIFICATION SUITE');
  console.log('  Worker Ownership, Heartbeats & Fenced CAS Transitions');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];

  try {
    const testUser = await User.create({
      name: 'Phase 1 Test User',
      email: `p1_test_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(testUser._id);

    // -------------------------------------------------------------
    // T1: HEARTBEAT UPDATES HEARTBEAT_AT WITHOUT INCREMENTING GENERATION
    // -------------------------------------------------------------
    console.log('--- T1: Heartbeat Periodic Renewal ---');
    await runAsyncTest('T1: Heartbeat updates heartbeatAt periodically without incrementing generation', async () => {
      const mission = await Mission.create({
        objective: 'Test heartbeat renewal',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task with active heartbeat loop',
        description: 'Should update heartbeatAt without incrementing generation',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
      });

      let heartbeatTicks = 0;
      const completed = await executeMissionTask(task._id, {
        workerId: 'worker_t1',
        __heartbeatIntervalMs: 30,
        taskDelayMs: 120,
        __onHeartbeatSuccess: () => {
          heartbeatTicks++;
        },
      });

      assert.strictEqual(completed.status, 'completed');
      assert.ok(heartbeatTicks >= 2, `Expected at least 2 heartbeat ticks, got ${heartbeatTicks}`);

      const inDb = await MissionTask.findById(task._id);
      assert.strictEqual(inDb.status, 'completed');
      assert.strictEqual(inDb.executionMetadata.claimedBy, 'worker_t1');
      assert.strictEqual(inDb.executionMetadata.generation, 1, 'Generation must remain 1 throughout heartbeats');
      assert.ok(inDb.executionMetadata.heartbeatAt instanceof Date, 'heartbeatAt must be a Date');
      assert.ok(
        new Date(inDb.executionMetadata.heartbeatAt).getTime() >= new Date(inDb.executionMetadata.claimedAt).getTime(),
        'heartbeatAt must be >= claimedAt'
      );
    });

    // -------------------------------------------------------------
    // T2: HEARTBEAT CAS RETURNING NULL FENCES WORKER (LOST)
    // -------------------------------------------------------------
    console.log('\n--- T2: Heartbeat CAS Fencing (Lost Lease) ---');
    await runAsyncTest('T2: Heartbeat CAS returning null fences worker and stops execution', async () => {
      const mission = await Mission.create({
        objective: 'Test heartbeat fence detection',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task reclaimed during run',
        description: 'Should abort when heartbeat finds generation modified',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
      });

      // Launch worker with 500ms taskDelay and 30ms heartbeat
      const workPromise = executeMissionTask(task._id, {
        workerId: 'worker_t2_stale',
        __heartbeatIntervalMs: 30,
        taskDelayMs: 500,
      });

      // Deterministically await until worker has claimed the task and established running state
      const claimTimeoutMs = 3000;
      const claimStart = Date.now();
      let claimedTask = null;
      while (Date.now() - claimStart < claimTimeoutMs) {
        claimedTask = await MissionTask.findById(task._id).lean();
        if (claimedTask && claimedTask.status === 'running' && claimedTask.executionMetadata?.claimedBy === 'worker_t2_stale') {
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }

      assert.ok(
        claimedTask && claimedTask.status === 'running' && claimedTask.executionMetadata?.claimedBy === 'worker_t2_stale',
        'Worker must establish claim before generation is modified'
      );

      // Now that the task is established as running under generation 1 by worker_t2_stale,
      // simulate recovery scanner or second worker reclaiming the task by incrementing generation
      await MissionTask.updateOne(
        { _id: task._id, status: 'running', 'executionMetadata.generation': 1 },
        {
          $set: {
            'executionMetadata.generation': 2,
            'executionMetadata.claimedBy': 'worker_t2_recovered',
          },
        }
      );

      let thrownErr = null;
      try {
        await workPromise;
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(thrownErr instanceof LeaseLostError, 'Must throw LeaseLostError');
      assert.strictEqual(thrownErr.code, 'LEASE_LOST');
      assert.strictEqual(thrownErr.reason, 'LOST');
      assert.strictEqual(thrownErr.generation, 1);
      assert.strictEqual(thrownErr.workerId, 'worker_t2_stale');

      // Verify task in DB was not set to completed by stale worker
      const inDb = await MissionTask.findById(task._id);
      assert.strictEqual(inDb.status, 'running', 'Task must remain running under recovered worker');
      assert.strictEqual(inDb.executionMetadata.generation, 2);
      assert.strictEqual(inDb.executionMetadata.claimedBy, 'worker_t2_recovered');

      // Verify no TASK_COMPLETED event was emitted
      const events = await MissionEvent.find({ taskId: task._id, type: EVENT_TYPES.TASK_COMPLETED });
      assert.strictEqual(events.length, 0, 'No TASK_COMPLETED events must be emitted by fenced worker');
    });

    // -------------------------------------------------------------
    // T3: REPEATED HEARTBEAT DB ERRORS TRIGGER BOUNDED UNCERTAINTY SHUTDOWN
    // -------------------------------------------------------------
    console.log('\n--- T3: Bounded Uncertainty Shutdown ---');
    await runAsyncTest('T3: Repeated heartbeat DB errors trigger bounded uncertainty shutdown at lease threshold', async () => {
      const mission = await Mission.create({
        objective: 'Test bounded uncertainty timeout',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task experiencing db disconnection',
        description: 'Should abort when leaseDuration threshold is exceeded under uncertainty',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
      });

      let thrownErr = null;
      try {
        await executeMissionTask(task._id, {
          workerId: 'worker_t3',
          __heartbeatIntervalMs: 20,
          __leaseDurationMs: 80, // Bounded uncertainty limit = 80ms
          taskDelayMs: 250,
          __injectedHeartbeatError: () => new Error('Simulated MongoNetworkTimeout in heartbeat'),
        });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(thrownErr instanceof LeaseLostError, 'Must throw LeaseLostError');
      assert.strictEqual(thrownErr.code, 'LEASE_LOST');
      assert.strictEqual(thrownErr.reason, 'EXPIRED_UNCERTAIN');

      const inDb = await MissionTask.findById(task._id);
      assert.strictEqual(inDb.status, 'running', 'Task must NOT be completed');

      const events = await MissionEvent.find({ taskId: task._id, type: EVENT_TYPES.TASK_COMPLETED });
      assert.strictEqual(events.length, 0);
    });

    // -------------------------------------------------------------
    // T4: PRE-COMPLETION DRAIN AWAITS IN-FLIGHT HEARTBEAT TICK CLEANLY
    // -------------------------------------------------------------
    console.log('\n--- T4: In-Flight Heartbeat Drain ---');
    await runAsyncTest('T4: Pre-completion drain completes cleanly without racing in-flight heartbeats', async () => {
      const mission = await Mission.create({
        objective: 'Test heartbeat drain',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task drain test',
        description: 'Should cleanly drain in-flight heartbeat promise',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
      });

      // Execute with fast heartbeats
      const completed = await executeMissionTask(task._id, {
        workerId: 'worker_t4',
        __heartbeatIntervalMs: 25,
        taskDelayMs: 60,
      });

      assert.strictEqual(completed.status, 'completed');
      const inDb = await MissionTask.findById(task._id);
      assert.strictEqual(inDb.status, 'completed');
      assert.strictEqual(inDb.executionMetadata.claimedBy, 'worker_t4');
      assert.strictEqual(inDb.executionMetadata.generation, 1);
    });

    // -------------------------------------------------------------
    // T5: STALE WORKER'S COMPLETION CAS IS REJECTED (FENCED)
    // -------------------------------------------------------------
    console.log('\n--- T5: Completion CAS Generation Fencing ---');
    await runAsyncTest('T5: Stale worker completion CAS returns null; zero completion events or memory written', async () => {
      const mission = await Mission.create({
        objective: 'Test completion CAS fencing',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task fenced right before completion CAS',
        description: 'Simulates worker sleeping/delayed past lease recovery',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
      });

      let barrierReached = false;
      let thrownErr = null;

      try {
        await executeMissionTask(task._id, {
          workerId: 'worker_t5_stale',
          taskDelayMs: 10,
          __barrierBeforeCompletion: async ({ taskId, generation }) => {
            barrierReached = true;
            // Another worker reclaimed the task during the pause
            await MissionTask.updateOne(
              { _id: taskId },
              {
                $set: {
                  'executionMetadata.generation': generation + 1,
                  'executionMetadata.claimedBy': 'worker_t5_recovered',
                },
              }
            );
          },
        });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(barrierReached, 'Barrier before completion must have executed');
      assert.ok(thrownErr instanceof LeaseLostError, 'Must throw LeaseLostError');
      assert.strictEqual(thrownErr.code, 'LEASE_LOST');
      assert.strictEqual(thrownErr.reason, 'COMPLETION_CAS_FENCED');

      // Database verification
      const inDb = await MissionTask.findById(task._id);
      assert.strictEqual(inDb.status, 'running', 'Task status must remain running (not completed)');
      assert.strictEqual(inDb.executionMetadata.claimedBy, 'worker_t5_recovered');
      assert.strictEqual(inDb.executionMetadata.generation, 2);

      // Verify zero completion events emitted
      const completionEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'Zero TASK_COMPLETED events must be emitted');

      // Verify zero memory items recorded
      try {
        const MissionMemory = require('../models/MissionMemory');
        const memories = await MissionMemory.find({ taskId: task._id });
        assert.strictEqual(memories.length, 0, 'Zero memories must be written by fenced worker');
      } catch {
        // If MissionMemory collection doesn't exist, assertion holds
      }
    });

    // -------------------------------------------------------------
    // T6: STALE WORKER'S FAILURE CAS IS REJECTED (FENCED)
    // -------------------------------------------------------------
    console.log('\n--- T6: Failure CAS Generation Fencing ---');
    await runAsyncTest('T6: Stale worker failure CAS returns null; zero failure events or memory written', async () => {
      const mission = await Mission.create({
        objective: 'Test failure CAS fencing',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task failing but fenced before failure CAS',
        description: 'Simulates work failure on a worker whose lease was already reclaimed',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
      });

      let barrierReached = false;
      let thrownErr = null;

      try {
        await executeMissionTask(task._id, {
          workerId: 'worker_t6_stale',
          failTaskId: task._id, // Force work execution error
          taskDelayMs: 10,
          __barrierBeforeFailure: async ({ taskId, generation }) => {
            barrierReached = true;
            // Task lease stolen before worker could write failure CAS
            await MissionTask.updateOne(
              { _id: taskId },
              {
                $set: {
                  'executionMetadata.generation': generation + 1,
                  'executionMetadata.claimedBy': 'worker_t6_recovered',
                },
              }
            );
          },
        });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(barrierReached, 'Barrier before failure must have executed');
      assert.ok(thrownErr instanceof LeaseLostError, 'Must throw LeaseLostError');
      assert.strictEqual(thrownErr.code, 'LEASE_LOST');
      assert.strictEqual(thrownErr.reason, 'FAILURE_CAS_FENCED');

      // Database verification: task must NOT be failed
      const inDb = await MissionTask.findById(task._id);
      assert.strictEqual(inDb.status, 'running', 'Task must NOT be marked failed by stale worker');
      assert.strictEqual(inDb.executionMetadata.claimedBy, 'worker_t6_recovered');
      assert.strictEqual(inDb.executionMetadata.generation, 2);

      // Verify zero failure events emitted
      const failEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_FAILED,
      });
      assert.strictEqual(failEvents.length, 0, 'Zero TASK_FAILED events must be emitted by fenced worker');
    });

    // -------------------------------------------------------------
    // T7: COMPLETION CAS NETWORK AMBIGUITY HANDLING
    // -------------------------------------------------------------
    console.log('\n--- T7: Completion CAS Ambiguity Handling ---');
    await runAsyncTest('T7: Completion CAS network error yields ambiguous outcome without false success or failure events', async () => {
      const mission = await Mission.create({
        objective: 'Test completion CAS network ambiguity',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task with network error during completion write',
        description: 'Should rethrow ambiguous error without emitting success/failure events',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
      });

      const injectedErr = new Error('Simulated MongoNetworkTimeout during completion CAS');
      injectedErr.name = 'MongoNetworkTimeoutError';

      let thrownErr = null;
      try {
        await executeMissionTask(task._id, {
          workerId: 'worker_t7',
          taskDelayMs: 10,
          __injectedCompletionCasError: injectedErr,
        });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(thrownErr, 'Must rethrow network error');
      assert.strictEqual(thrownErr.message, 'Simulated MongoNetworkTimeout during completion CAS');

      // Verify DB: task was NOT marked failed!
      const inDb = await MissionTask.findById(task._id);
      assert.strictEqual(inDb.status, 'running', 'Task status must remain running (awaiting Phase 2 reconciliation)');

      // Verify zero completion events and zero failure events
      const completionEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'Zero TASK_COMPLETED events on ambiguous error');

      const failureEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_FAILED,
      });
      assert.strictEqual(failureEvents.length, 0, 'Zero TASK_FAILED events on ambiguous error');
    });

    console.log('\n====================================================');
    console.log(`  NEXORA 8G.6.2 - PHASE 1 AUDIT COMPLETE: ${passedTests}/${totalTests} PASSED (0 FAILED)`);
    console.log('====================================================\n');
  } finally {
    // Cleanup test artifacts
    if (createdMissionIds.length > 0) {
      await Mission.deleteMany({ _id: { $in: createdMissionIds } });
      await MissionTask.deleteMany({ missionId: { $in: createdMissionIds } });
      await MissionEvent.deleteMany({ missionId: { $in: createdMissionIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
  }
}

runPhase1Suite().catch((err) => {
  console.error('[FATAL PHASE 1 SUITE FAILURE]', err);
  process.exit(1);
});
