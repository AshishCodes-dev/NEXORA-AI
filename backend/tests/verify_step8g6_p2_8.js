/**
 * NEXORA 8G.6.5 - PHASE 2.6.1 VERIFICATION SUITE
 * Terminal Mission Task Reconciliation & Recovery Invariants
 *
 * Verifies:
 * - T1: Interrupted Cancellation Recovery (pending/queued tasks reconciled to failed)
 * - T2: Unaffected Completed Tasks (completed tasks under failed missions remain completed)
 * - T3: Unaffected Active Running Tasks (active workers with valid leases remain running; skippedActive reported)
 * - T4: Non-Terminal Missions Untouched (pending/queued tasks on non-failed missions untouched)
 * - T5: Repeated Sweeps Idempotency (subsequent sweeps yield 0 mutations and 0 duplicate events)
 * - T6: Terminal Mission State & Result Consistency (zero orphaned tasks; clean API responses)
 * - T7: Scoped Mission Recovery (options.missionId targets specific mission without cross-mission interference)
 * - T8: Coordinated Startup Recovery Integration (runStartupRecovery coordinates terminal task reconciliation)
 * - T9: Periodic Background Sweeper Integration (startPeriodicRecovery reconciles terminal tasks automatically)
 * - T10: Per-Item Error Isolation (transient error on one task does not halt remaining tasks)
 * - T11: Database Connectivity Outage Propagation (genuine DB outage throws cleanly)
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const mongoose = require('mongoose');

// Set test environment
process.env.NODE_ENV = 'test';

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
  reconcileTerminalMissionTasks,
  reconcileStaleTasks,
  reconcileAbandonedMissions,
  runStartupRecovery,
  startPeriodicRecovery,
  stopPeriodicRecovery,
  getPeriodicRecoveryState,
} = require('../services/missionRecoveryService');
const { getMissionState } = require('../services/missionStateService');
const { getMissionResult } = require('../services/missionResultService');

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

async function runPhase2_6_1Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.6.5 - PHASE 2.6.1 VERIFICATION SUITE');
  console.log('  Terminal Mission Task Reconciliation & Invariants');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];

  try {
    const testUser = await User.create({
      name: 'Phase 2.6.1 Test User',
      email: `p2_6_1_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(testUser._id);

    // =============================================================
    // SECTION 1: Interrupted Cancellation & Task Reconciliation
    // =============================================================
    console.log('--- SECTION 1: Interrupted Cancellation & Task Reconciliation ---');

    await runAsyncTest('T1: Interrupted Cancellation Recovery (pending and queued tasks reconciled to failed)', async () => {
      // Simulate crash during cancellation: Mission transitioned to failed, but tasks left pending/queued
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Interrupted cancellation recovery test mission',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      const task1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Completed Task 1',
        description: 'Previously completed step',
        agentId: 'researcher',
        order: 1,
        status: 'completed',
        executionMetadata: { resultData: { summary: 'Done' } },
      });

      const task2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Pending Task 2',
        description: 'Orphaned pending task',
        agentId: 'analyst',
        order: 2,
        status: 'pending',
      });

      const task3 = await MissionTask.create({
        missionId: mission._id,
        title: 'Queued Task 3',
        description: 'Orphaned queued task',
        agentId: 'critic',
        order: 3,
        status: 'queued',
      });

      const stats = await reconcileTerminalMissionTasks({ missionId: mission._id });
      assert.strictEqual(stats.reconciledToFailed, 2, 'Must reconcile exactly 2 orphaned tasks');
      assert.strictEqual(stats.reconciledCount, 2);

      // Verify tasks in database
      const t1Db = await MissionTask.findById(task1._id);
      const t2Db = await MissionTask.findById(task2._id);
      const t3Db = await MissionTask.findById(task3._id);

      assert.strictEqual(t1Db.status, 'completed', 'Completed task must remain completed');
      assert.strictEqual(t2Db.status, 'failed', 'Pending task must transition to failed');
      assert.strictEqual(t3Db.status, 'failed', 'Queued task must transition to failed');
      assert.ok(t2Db.error.includes('terminal failed state'));
      assert.ok(t3Db.error.includes('terminal failed state'));

      // Verify TASK_FAILED events emitted
      const events = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.TASK_FAILED,
      });
      assert.strictEqual(events.length, 2, 'Exactly 2 TASK_FAILED events emitted for reconciled tasks');
    });

    await runAsyncTest('T2: Unaffected Completed Tasks (completed tasks under failed missions remain completed)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Completed task preservation test',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      const completedTask = await MissionTask.create({
        missionId: mission._id,
        title: 'Completed Step',
        description: 'Must remain untouched',
        agentId: 'analyst',
        order: 1,
        status: 'completed',
        executionMetadata: {
          claimedBy: 'worker_old',
          generation: 1,
          resultData: { verified: true },
        },
      });

      const stats = await reconcileTerminalMissionTasks({ missionId: mission._id });
      assert.strictEqual(stats.reconciledToFailed, 0, 'Zero completed tasks reconciled');

      const dbTask = await MissionTask.findById(completedTask._id);
      assert.strictEqual(dbTask.status, 'completed');
      assert.deepStrictEqual(dbTask.executionMetadata.resultData, { verified: true });
    });

    // =============================================================
    // SECTION 2: Active Worker Fencing & Lease Preservation
    // =============================================================
    console.log('\n--- SECTION 2: Active Worker Fencing & Lease Preservation ---');

    await runAsyncTest('T3: Unaffected Active Running Tasks (active workers with valid leases remain running; skippedActive reported)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Active running task preservation test',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      // Active running task with fresh heartbeat
      const runningTask = await MissionTask.create({
        missionId: mission._id,
        title: 'Active In-Flight Task',
        description: 'Has live worker heartbeat and active lease',
        agentId: 'browser',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_live_123',
          generation: 1,
          heartbeatAt: new Date(),
        },
      });

      const pendingTask = await MissionTask.create({
        missionId: mission._id,
        title: 'Pending Task Behind Active Worker',
        description: 'Should be reconciled',
        agentId: 'analyst',
        order: 2,
        status: 'pending',
      });

      const stats = await reconcileTerminalMissionTasks({ missionId: mission._id });
      assert.strictEqual(stats.reconciledToFailed, 1, 'Only pending task reconciled');
      assert.strictEqual(stats.skippedActive, 1, 'Active running task reported as skippedActive');

      // Verify running task is completely untouched
      const dbRunning = await MissionTask.findById(runningTask._id);
      assert.strictEqual(dbRunning.status, 'running', 'Running task must NOT be overwritten');
      assert.strictEqual(dbRunning.executionMetadata.claimedBy, 'worker_live_123');
      assert.strictEqual(dbRunning.executionMetadata.generation, 1);

      // Verify pending task was reconciled
      const dbPending = await MissionTask.findById(pendingTask._id);
      assert.strictEqual(dbPending.status, 'failed');
    });

    await runAsyncTest('T4: Non-Terminal Missions Untouched (pending/queued tasks on non-failed missions untouched)', async () => {
      const runningMission = await Mission.create({
        userId: testUser._id,
        objective: 'Healthy running mission',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      const planningMission = await Mission.create({
        userId: testUser._id,
        objective: 'Healthy planning mission',
        status: 'planning',
      });
      createdMissionIds.push(runningMission._id, planningMission._id);

      const runPending = await MissionTask.create({
        missionId: runningMission._id,
        title: 'Pending on Running Mission',
        description: 'Should NOT be reconciled',
        order: 1,
        status: 'pending',
      });
      const planQueued = await MissionTask.create({
        missionId: planningMission._id,
        title: 'Queued on Planning Mission',
        description: 'Should NOT be reconciled',
        order: 1,
        status: 'queued',
      });

      const statsRunning = await reconcileTerminalMissionTasks({ missionId: runningMission._id });
      assert.strictEqual(statsRunning.reconciledToFailed, 0, 'No tasks on running mission reconciled');

      const statsPlanning = await reconcileTerminalMissionTasks({ missionId: planningMission._id });
      assert.strictEqual(statsPlanning.reconciledToFailed, 0, 'No tasks on planning mission reconciled');

      const check1 = await MissionTask.findById(runPending._id);
      const check2 = await MissionTask.findById(planQueued._id);
      assert.strictEqual(check1.status, 'pending');
      assert.strictEqual(check2.status, 'queued');
    });

    // =============================================================
    // SECTION 3: Idempotency & Terminal Consistency
    // =============================================================
    console.log('\n--- SECTION 3: Idempotency & Terminal Consistency ---');

    await runAsyncTest('T5: Repeated Sweeps Idempotency (subsequent sweeps yield 0 mutations and 0 duplicate events)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Sweeps idempotency test mission',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task for double sweep',
        description: 'To be reconciled on sweep 1',
        order: 1,
        status: 'pending',
      });

      // Sweep 1
      const sweep1 = await reconcileTerminalMissionTasks({ missionId: mission._id });
      assert.strictEqual(sweep1.reconciledToFailed, 1);

      const eventsAfter1 = await MissionEvent.find({ missionId: mission._id, type: EVENT_TYPES.TASK_FAILED });
      assert.strictEqual(eventsAfter1.length, 1);

      // Sweep 2
      const sweep2 = await reconcileTerminalMissionTasks({ missionId: mission._id });
      assert.strictEqual(sweep2.reconciledToFailed, 0, 'Second sweep must reconcile 0 tasks');
      assert.strictEqual(sweep2.reconciledCount, 0);

      // Verify no duplicate events
      const eventsAfter2 = await MissionEvent.find({ missionId: mission._id, type: EVENT_TYPES.TASK_FAILED });
      assert.strictEqual(eventsAfter2.length, 1, 'Zero duplicate events emitted');
    });

    await runAsyncTest('T6: Terminal Mission State & Result Consistency (zero orphaned tasks; clean API responses)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Terminal consistency test mission',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create([
        {
          missionId: mission._id,
          title: 'Step 1 Completed',
          description: 'Finished',
          order: 1,
          status: 'completed',
        },
        {
          missionId: mission._id,
          title: 'Step 2 Pending',
          description: 'Orphaned pending',
          order: 2,
          status: 'pending',
        },
      ]);

      // Reconcile terminal tasks
      await reconcileTerminalMissionTasks({ missionId: mission._id });

      // Verify zero orphaned tasks
      const orphaned = await MissionTask.find({
        missionId: mission._id,
        status: { $in: ['pending', 'queued'] },
      });
      assert.strictEqual(orphaned.length, 0, 'Zero orphaned tasks must exist');

      // Verify State API
      const state = await getMissionState(mission._id.toString(), testUser._id.toString());
      assert.strictEqual(state.stage, 'failed');
      assert.strictEqual(state.state, 'failed');

      // Verify Result API
      const result = await getMissionResult(mission._id.toString(), testUser._id.toString());
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'failed');
    });

    await runAsyncTest('T7: Scoped Mission Recovery (options.missionId targets specific mission without cross-mission interference)', async () => {
      const missionA = await Mission.create({
        userId: testUser._id,
        objective: 'Mission A Failed',
        status: 'failed',
      });
      const missionB = await Mission.create({
        userId: testUser._id,
        objective: 'Mission B Failed',
        status: 'failed',
      });
      createdMissionIds.push(missionA._id, missionB._id);

      const taskA = await MissionTask.create({
        missionId: missionA._id,
        title: 'Task A Pending',
        description: 'Scoped target',
        order: 1,
        status: 'pending',
      });
      const taskB = await MissionTask.create({
        missionId: missionB._id,
        title: 'Task B Pending',
        description: 'Should remain untouched in scoped run',
        order: 1,
        status: 'pending',
      });

      // Target only Mission A
      const stats = await reconcileTerminalMissionTasks({ missionId: missionA._id });
      assert.strictEqual(stats.reconciledToFailed, 1);

      const dbTaskA = await MissionTask.findById(taskA._id);
      const dbTaskB = await MissionTask.findById(taskB._id);
      assert.strictEqual(dbTaskA.status, 'failed', 'Mission A task must be reconciled');
      assert.strictEqual(dbTaskB.status, 'pending', 'Mission B task must remain pending');
    });

    // =============================================================
    // SECTION 4: Coordinated Sweeper Integration
    // =============================================================
    console.log('\n--- SECTION 4: Coordinated Sweeper Integration ---');

    await runAsyncTest('T8: Coordinated Startup Recovery Integration (runStartupRecovery coordinates terminal task reconciliation)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Startup recovery coordination test',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Pending Task for Startup Recovery',
        description: 'Should be reconciled during runStartupRecovery',
        order: 1,
        status: 'pending',
      });

      const recoveryResult = await runStartupRecovery({
        missionId: mission._id,
        timeoutMs: 5000,
      });

      assert.ok(recoveryResult.terminalTasks, 'terminalTasks stats must be present in runStartupRecovery result');
      assert.strictEqual(recoveryResult.terminalTasks.reconciledToFailed, 1);

      const dbTask = await MissionTask.findById(task._id);
      assert.strictEqual(dbTask.status, 'failed');
    });

    await runAsyncTest('T9: Periodic Background Sweeper Integration (startPeriodicRecovery reconciles terminal tasks automatically)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Periodic background sweeper test',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Orphaned task for periodic sweeper',
        description: 'Should be recovered by background sweep',
        order: 1,
        status: 'pending',
      });

      // Start sweeper with fast 50ms interval scoped to test mission
      const started = startPeriodicRecovery({
        intervalMs: 50,
        recoveryOptions: { missionId: mission._id },
        unref: false,
      });
      assert.strictEqual(started, true);

      // Wait for 2 ticks (150ms)
      await new Promise((r) => setTimeout(r, 150));

      await stopPeriodicRecovery({ timeoutMs: 2000 });
      assert.strictEqual(getPeriodicRecoveryState().isActive, false);

      const dbTask = await MissionTask.findById(task._id);
      assert.strictEqual(dbTask.status, 'failed', 'Periodic sweeper must reconcile pending task under failed mission');
    });

    // =============================================================
    // SECTION 5: Error Isolation & Outage Propagation
    // =============================================================
    console.log('\n--- SECTION 5: Error Isolation & Outage Propagation ---');

    await runAsyncTest('T10: Per-Item Error Isolation (transient error on one task does not halt remaining tasks)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Error isolation test mission',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      const task1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 (Fault Injected)',
        description: 'Simulates transient error',
        order: 1,
        status: 'pending',
      });
      const task2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 (Normal)',
        description: 'Should succeed despite task 1 fault',
        order: 2,
        status: 'pending',
      });

      const stats = await reconcileTerminalMissionTasks({
        missionId: mission._id,
        __injectedTerminalTaskError: async (t) => {
          if (t._id.equals(task1._id)) {
            throw new Error('Simulated transient document write error on task 1');
          }
        },
      });

      assert.strictEqual(stats.errors, 1, 'Exactly 1 recoverable error recorded');
      assert.strictEqual(stats.reconciledToFailed, 1, 'Task 2 successfully reconciled');

      const dbTask1 = await MissionTask.findById(task1._id);
      const dbTask2 = await MissionTask.findById(task2._id);
      assert.strictEqual(dbTask1.status, 'pending', 'Faulted task remains pending for next sweep');
      assert.strictEqual(dbTask2.status, 'failed', 'Healthy task successfully transitioned to failed');
    });

    await runAsyncTest('T11: Database Connectivity Outage Propagation (genuine DB outage throws cleanly)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Database outage propagation test',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create({
        missionId: mission._id,
        title: 'Task for outage test',
        description: 'Will encounter cluster outage',
        order: 1,
        status: 'pending',
      });

      const simulatedOutage = new Error('MongoNetworkError: connection closed to cluster replica set');
      simulatedOutage.name = 'MongoNetworkError';

      await assert.rejects(
        async () => {
          await reconcileTerminalMissionTasks({
            missionId: mission._id,
            __injectedTerminalTaskError: async () => {
              throw simulatedOutage;
            },
          });
        },
        /MongoNetworkError/,
        'Cluster database outage must be re-thrown cleanly and not swallowed as success'
      );
    });

    console.log('\n====================================================');
    console.log(`  PHASE 2.6.1 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (0 FAILED)`);
    console.log('====================================================\n');
  } finally {
    // Cleanup fixtures
    try {
      if (createdMissionIds.length > 0) {
        await Mission.deleteMany({ _id: { $in: createdMissionIds } });
        await MissionTask.deleteMany({ missionId: { $in: createdMissionIds } });
        await MissionEvent.deleteMany({ missionId: { $in: createdMissionIds } });
      }
      if (createdUserIds.length > 0) {
        await User.deleteMany({ _id: { $in: createdUserIds } });
      }
    } catch {
      // Ignore cleanup errors
    }
    await mongoose.disconnect();
    console.log('[DATABASE] MongoDB disconnected');
  }
}

runPhase2_6_1Suite().catch((err) => {
  console.error('[TEST SUITE FATAL ERROR]:', err);
  process.exit(1);
});
