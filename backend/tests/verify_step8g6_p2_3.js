/**
 * NEXORA 8G.6.2 - PHASE 2.3 VERIFICATION TEST SUITE
 * Crash Recovery & Stale Worker Reconciliation
 *
 * Verifies:
 * - T1: Stale task reclaimed within retry budget (attempt 1 -> 2, generation incremented, status: pending)
 * - T2: Stale task retry budget exhausted -> failed (attempt 2 -> failed, retry budget protected)
 * - T3: Active lease remains untouched (recent heartbeat within lease duration not reclaimed)
 * - T4: Old generation worker cannot write or emit duplicate completion after reclamation
 * - T5: Expired mission fails and is not resumed (status CAS to failed, tasks left un-dispatched)
 * - T6: Unexpired mission resumes safely (startup recovery reclaims stale task and completes pipeline)
 * - T7: Two concurrent recovery attempts yield exactly one winner (atomic CAS idempotency)
 * - T8: Startup recovery on empty database and error handling
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
const { executeMission } = require('../orchestrator/missionOrchestrator');
const {
  reconcileStaleTasks,
  reconcileAbandonedMissions,
  runStartupRecovery,
  MAX_TASK_RETRIES,
  LEASE_DURATION_MS,
} = require('../services/missionRecoveryService');
const { LeaseLostError } = require('../orchestrator/taskExecutor');

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

async function runPhase2_3Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.6.2 - PHASE 2.3 VERIFICATION SUITE');
  console.log('  Crash Recovery & Stale Worker Reconciliation');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];

  try {
    const testUser = await User.create({
      name: 'Phase 2.3 Test User',
      email: `p2_3_test_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(testUser._id);

    // =============================================================
    // SECTION 1: STALE TASK RECLAMATION & RETRY BUDGET BOUNDS
    // =============================================================
    console.log('--- SECTION 1: Stale Task Reconciliation & Fencing ---');

    // -------------------------------------------------------------
    // T1: STALE TASK RECLAIMED WITHIN RETRY BUDGET
    // -------------------------------------------------------------
    await runAsyncTest('T1: Stale task reclaimed within retry budget (attempt 1 -> 2, generation incremented, status: pending)', async () => {
      const mission = await Mission.create({
        objective: 'Test T1 Stale Task Recovery',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 60000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Crashed task attempt 1',
        description: 'Simulates worker dying while executing task',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_crashed_1',
          claimedAt: new Date(Date.now() - 35000),
          heartbeatAt: new Date(Date.now() - 30000), // 30s ago (> 25s lease)
          generation: 1,
          attempt: 1,
        },
      });

      const stats = await reconcileStaleTasks({ leaseDurationMs: 25000, missionId: mission._id });
      assert.strictEqual(stats.reclaimedToPending, 1, 'Exactly one task must be reclaimed to pending');

      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'pending', 'Task status must be reset to pending');
      assert.strictEqual(taskInDb.executionMetadata.generation, 2, 'Generation must increment to 2');
      assert.strictEqual(taskInDb.executionMetadata.attempt, 2, 'Attempt must increment to 2');
      assert.strictEqual(taskInDb.executionMetadata.claimedBy, null, 'claimedBy must be cleared to allow re-claim');
      assert.strictEqual(taskInDb.executionMetadata.heartbeatAt, null, 'heartbeatAt must be cleared');
      assert.ok(taskInDb.executionMetadata.reclaimedAt instanceof Date, 'reclaimedAt must be recorded');

      // Set test mission terminal to avoid leaking into global recovery scans
      await Mission.updateOne({ _id: mission._id }, { $set: { status: 'completed' } });
    });

    // -------------------------------------------------------------
    // T2: RETRY BUDGET EXHAUSTED -> FAILED
    // -------------------------------------------------------------
    await runAsyncTest('T2: Stale task with exhausted retry budget transitions to failed (attempt 2 -> failed)', async () => {
      const mission = await Mission.create({
        objective: 'Test T2 Exhausted Retry Task',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 60000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Crashed task attempt 2',
        description: 'Simulates worker dying on final attempt',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_crashed_2',
          claimedAt: new Date(Date.now() - 35000),
          heartbeatAt: new Date(Date.now() - 30000), // 30s ago (> 25s lease)
          generation: 2,
          attempt: 2, // At max retries!
        },
      });

      const stats = await reconcileStaleTasks({ leaseDurationMs: 25000, missionId: mission._id });
      assert.strictEqual(stats.failedExhausted, 1, 'Exactly one task must be marked failed');

      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'failed', 'Task status must be marked failed');
      assert.ok(taskInDb.error.includes('retry budget exhausted'), 'Error message must reflect budget exhaustion');
      assert.strictEqual(taskInDb.executionMetadata.generation, 3, 'Generation must increment to 3');
      assert.strictEqual(taskInDb.executionMetadata.attempt, 2, 'Attempt remains 2 (not incremented past max)');
      assert.strictEqual(taskInDb.executionMetadata.claimedBy, null, 'claimedBy must be cleared');

      // Verify TASK_FAILED event
      const failEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_FAILED,
      });
      assert.strictEqual(failEvents.length, 1, 'Exactly one TASK_FAILED event must be recorded');
      assert.ok(failEvents[0].reason.includes('retry budget exhausted'));

      // Set test mission terminal to avoid leaking into global recovery scans
      await Mission.updateOne({ _id: mission._id }, { $set: { status: 'failed' } });
    });

    // -------------------------------------------------------------
    // T3: ACTIVE LEASE REMAINS UNTOUCHED
    // -------------------------------------------------------------
    await runAsyncTest('T3: Active worker lease remains untouched by recovery scanner', async () => {
      const mission = await Mission.create({
        objective: 'Test T3 Active Worker Lease',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Active worker task',
        description: 'Simulates healthy in-flight task with fresh heartbeat',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_alive_now',
          claimedAt: new Date(Date.now() - 5000),
          heartbeatAt: new Date(Date.now() - 2000), // 2s ago (< 25s lease)
          generation: 1,
          attempt: 1,
        },
      });

      const stats = await reconcileStaleTasks({ leaseDurationMs: 25000, missionId: mission._id });
      assert.strictEqual(stats.reclaimedToPending, 0, 'No active tasks reclaimed');
      assert.strictEqual(stats.skippedActive, 1, 'Active task must be recorded as skippedActive');

      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'running', 'Status must remain running');
      assert.strictEqual(taskInDb.executionMetadata.claimedBy, 'worker_alive_now', 'claimedBy preserved');
      assert.strictEqual(taskInDb.executionMetadata.generation, 1, 'Generation must not change');

      // Set test mission terminal to avoid leaking into global recovery scans
      await Mission.updateOne({ _id: mission._id }, { $set: { status: 'completed' } });
    });

    // -------------------------------------------------------------
    // T4: OLD GENERATION CANNOT WRITE POST-RECLAMATION
    // -------------------------------------------------------------
    await runAsyncTest('T4: Old generation worker is strictly fenced and cannot write or emit completion after reclamation', async () => {
      const mission = await Mission.create({
        objective: 'Test T4 Generation Fencing Post-Reclamation',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 40000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task for post-reclamation fencing',
        description: 'Worker delayed while recovery advances generation',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_delayed_old',
          claimedAt: new Date(Date.now() - 35000),
          heartbeatAt: new Date(Date.now() - 30000),
          generation: 1,
          attempt: 1,
        },
      });

      // Recovery reclaims the task, advancing generation to 2
      await reconcileStaleTasks({ leaseDurationMs: 25000, missionId: mission._id });

      // Stale worker wakes up and attempts its COMPLETION CAS with generation: 1
      const staleWorkerCasResult = await MissionTask.findOneAndUpdate(
        {
          _id: task._id,
          status: 'running',
          'executionMetadata.generation': 1,
          'executionMetadata.claimedBy': 'worker_delayed_old',
        },
        {
          $set: {
            status: 'completed',
            'executionMetadata.resultData': { summary: 'Stale worker illegal result' },
          },
        },
        { returnDocument: 'after' }
      );

      assert.strictEqual(staleWorkerCasResult, null, 'Stale worker completion CAS must return null (fenced)');

      // Verify task in DB remains pending with generation: 2
      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'pending');
      assert.strictEqual(taskInDb.executionMetadata.generation, 2);

      // Verify zero TASK_COMPLETED events
      const completionEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'Zero TASK_COMPLETED events permitted from stale generation');

      // Set test mission terminal to avoid leaking into global recovery scans
      await Mission.updateOne({ _id: mission._id }, { $set: { status: 'completed' } });
    });

    // =============================================================
    // SECTION 2: MISSION RECONCILIATION & DEADLINE ENFORCEMENT
    // =============================================================
    console.log('\n--- SECTION 2: Mission Reconciliation & Deadline Enforcement ---');

    // -------------------------------------------------------------
    // T5: EXPIRED MISSION FAILS AND IS NOT RESUMED
    // -------------------------------------------------------------
    await runAsyncTest('T5: Expired abandoned mission transitions to failed through status CAS and is not resumed', async () => {
      const expiredDeadline = new Date(Date.now() - 10000); // 10s ago
      const mission = await Mission.create({
        objective: 'Test T5 Expired Mission Recovery',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 70000),
        deadlineAt: expiredDeadline,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Pending task on expired mission',
        description: 'Must not be executed',
        agentId: 'analyst',
        order: 1,
        status: 'pending',
      });

      const stats = await reconcileAbandonedMissions();
      assert.ok(stats.failedExpired >= 1, 'At least one mission failed due to expired deadline');

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed', 'Mission status must be transitioned to failed');

      // Task must remain pending (not executed or dispatched)
      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'pending', 'Task must NOT be dispatched on expired mission');

      // Verify canonical MISSION_FAILED event
      const failEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_FAILED,
      });
      assert.strictEqual(failEvents.length, 1, 'Exactly one MISSION_FAILED event emitted');
      assert.ok(failEvents[0].reason.includes('deadline exceeded'));
    });

    // -------------------------------------------------------------
    // T6: UNEXPIRED MISSION RESUMES SAFELY
    // -------------------------------------------------------------
    await runAsyncTest('T6: Unexpired abandoned mission resumes safely and completes pipeline', async () => {
      const mission = await Mission.create({
        objective: 'Test T6 Unexpired Mission Resumption',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 10000),
        deadlineAt: new Date(Date.now() + 120000), // 2 minutes remaining
      });
      createdMissionIds.push(mission._id);

      // Task 1 was abandoned in running state with stale heartbeat
      const task1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Abandoned Task 1',
        description: 'Should be reclaimed and then executed to completion',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_crashed_t6',
          claimedAt: new Date(Date.now() - 35000),
          heartbeatAt: new Date(Date.now() - 30000),
          generation: 1,
          attempt: 1,
        },
      });

      // Run coordinated startup recovery with executeSync: true
      const recoveryResult = await runStartupRecovery({
        leaseDurationMs: 25000,
        executeSync: true,
        timeoutMs: 10000,
        missionOptions: {
          forceDeterministic: true,
          skipBrowserHandoff: true,
        },
      });

      assert.strictEqual(recoveryResult.tasks.reclaimedToPending, 1, 'Task 1 must be reclaimed to pending');
      assert.strictEqual(recoveryResult.missions.resumed, 1, 'Mission must be resumed');

      // Verify task and mission completed cleanly
      const taskInDb = await MissionTask.findById(task1._id);
      assert.strictEqual(taskInDb.status, 'completed', 'Task 1 must finish with status completed');

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'completed', 'Mission must transition to completed');

      // Verify MISSION_COMPLETED event
      const completeEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completeEvents.length, 1, 'Exactly one MISSION_COMPLETED event must exist');
    });

    // =============================================================
    // SECTION 3: CONCURRENCY IDEMPOTENCY & STARTUP INTEGRATION
    // =============================================================
    console.log('\n--- SECTION 3: Concurrency Idempotency & Startup Integration ---');

    // -------------------------------------------------------------
    // T7: TWO CONCURRENT RECOVERY ATTEMPTS YIELD ONE WINNER
    // -------------------------------------------------------------
    await runAsyncTest('T7: Two concurrent recovery attempts yield exactly one winner with zero duplicate transitions', async () => {
      const mission = await Mission.create({
        objective: 'Test T7 Concurrent Recovery',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 40000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task for race between recovery instances',
        description: 'Two recovery instances race to reclaim this task',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_dead',
          claimedAt: new Date(Date.now() - 35000),
          heartbeatAt: new Date(Date.now() - 30000),
          generation: 1,
          attempt: 1,
        },
      });

      // Launch two recovery attempts concurrently
      const [resultA, resultB] = await Promise.all([
        reconcileStaleTasks({ leaseDurationMs: 25000, missionId: mission._id }),
        reconcileStaleTasks({ leaseDurationMs: 25000, missionId: mission._id }),
      ]);

      const totalReclaimed = resultA.reclaimedToPending + resultB.reclaimedToPending;
      assert.strictEqual(totalReclaimed, 1, 'Exactly one caller must win the reclamation CAS');

      // One caller reclaimed 1, the other reclaimed 0
      const counts = [resultA.reclaimedToPending, resultB.reclaimedToPending].sort();
      assert.deepStrictEqual(counts, [0, 1], 'One winner (1) and one loser (0)');

      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'pending');
      assert.strictEqual(taskInDb.executionMetadata.generation, 2, 'Generation incremented exactly once');
      assert.strictEqual(taskInDb.executionMetadata.attempt, 2, 'Attempt incremented exactly once');
    });

    // -------------------------------------------------------------
    // T8: STARTUP RECOVERY ON EMPTY DATABASE & ERROR HANDLING
    // -------------------------------------------------------------
    await runAsyncTest('T8: Startup recovery runs cleanly on empty database and handles errors gracefully', async () => {
      // 1. Clean run on empty mission/task filters
      const emptyResult = await runStartupRecovery({
        missionId: new mongoose.Types.ObjectId(), // Non-existent scope
        timeoutMs: 3000,
      });

      assert.strictEqual(emptyResult.tasks.reclaimedToPending, 0);
      assert.strictEqual(emptyResult.tasks.failedExhausted, 0);
      assert.strictEqual(emptyResult.missions.resumed, 0);

      // 2. Error handling: verify timeout safety
      await assert.rejects(
        async () => {
          await runStartupRecovery({
            missionId: new mongoose.Types.ObjectId(), // Isolated scope
            timeoutMs: 1, // Guaranteed timeout
          });
        },
        /Startup recovery timed out after 1ms/,
        'Timeout guard must reject when bounded time is exceeded'
      );
      // Allow background microtask tick to settle
      await new Promise((r) => setTimeout(r, 50));
    });

    // =============================================================
    // SECTION 4: INVALID METADATA SAFETY & CONCURRENT MUTATION GUARDS
    // =============================================================
    console.log('\n--- SECTION 4: Invalid Metadata Safety & Concurrent Mutations ---');

    // -------------------------------------------------------------
    // T9: INVALID OWNERSHIP METADATA WITH EXPIRED/UNVERIFIABLE LEASE
    // -------------------------------------------------------------
    await runAsyncTest('T9: Running task with invalid ownership metadata & expired lease fails safely without deadlocking', async () => {
      const mission = await Mission.create({
        objective: 'Test T9 Invalid Ownership Metadata',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 60000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      // Task in 'running' state but with unallocated/null generation and null claimedBy
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task with malformed ownership metadata',
        description: 'Missing generation and missing claimedBy with stale timestamp',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: null,
          generation: null, // Invalid/unallocated generation!
          attempt: 1,
          heartbeatAt: new Date(Date.now() - 35000), // Stale (> 25s)
        },
      });

      const stats = await reconcileStaleTasks({ leaseDurationMs: 25000, missionId: mission._id });
      assert.strictEqual(stats.invalidFailed, 1, 'Task must be recorded as invalidFailed');
      assert.strictEqual(stats.reclaimedToPending, 0, 'Must NOT reclaim to pending without valid generation');

      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'failed', 'Task must transition safely to failed');
      assert.ok(taskInDb.error.includes('invalid worker ownership metadata'), 'Error must identify invalid ownership metadata');

      // Verify TASK_FAILED event was recorded
      const failEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_FAILED,
      });
      assert.strictEqual(failEvents.length, 1, 'Exactly one TASK_FAILED event emitted');
      assert.strictEqual(failEvents[0].metadata?.invalidMetadata, true);

      // Verify that reconcileAbandonedMissions can now cleanly fail the mission rather than stalling
      const missionStats = await reconcileAbandonedMissions({ missionId: mission._id, leaseDurationMs: 25000, executeSync: true });
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed', 'Mission must halt/fail cleanly rather than stalling in-flight');
    });

    // -------------------------------------------------------------
    // T10: INVALID OWNERSHIP METADATA BUT ACTIVE LEASE
    // -------------------------------------------------------------
    await runAsyncTest('T10: Task with malformed metadata but active timestamp remains untouched', async () => {
      const mission = await Mission.create({
        objective: 'Test T10 Malformed Metadata Active Lease',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      // Task with invalid generation, but fresh heartbeat timestamp (2s ago)
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task with malformed metadata but active timestamp',
        description: 'Must not be touched while active worker might still be alive',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: null,
          generation: null,
          attempt: 1,
          heartbeatAt: new Date(Date.now() - 2000), // Fresh (< 25s)
        },
      });

      const stats = await reconcileStaleTasks({ leaseDurationMs: 25000, missionId: mission._id });
      assert.strictEqual(stats.skippedActive, 1, 'Must be skipped as active');
      assert.strictEqual(stats.invalidFailed, 0, 'Must NOT fail an active task');
      assert.strictEqual(stats.reclaimedToPending, 0, 'Must NOT reclaim an active task');

      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'running', 'Status must remain running');
    });

    // -------------------------------------------------------------
    // T11: CONCURRENT STATUS MUTATION PRESERVES TERMINAL OUTCOME
    // -------------------------------------------------------------
    await runAsyncTest('T11: Task whose status changes concurrently is preserved and not overwritten', async () => {
      const mission = await Mission.create({
        objective: 'Test T11 Concurrent Status Mutation',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 40000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task for concurrent completion race',
        description: 'Simulates worker completing task concurrently right before recovery CAS',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_concurrent_finisher',
          claimedAt: new Date(Date.now() - 35000),
          heartbeatAt: new Date(Date.now() - 30000),
          generation: 1,
          attempt: 1,
        },
      });

      // Concurrently transition task to completed before recovery runs
      await MissionTask.updateOne(
        { _id: task._id },
        {
          $set: {
            status: 'completed',
            'executionMetadata.resultData': { answer: 'valid completed outcome' },
          },
        }
      );

      // Now run recovery
      const stats = await reconcileStaleTasks({ leaseDurationMs: 25000, missionId: mission._id });
      assert.strictEqual(stats.reclaimedToPending, 0, 'Must NOT reclaim completed task');
      assert.strictEqual(stats.failedExhausted, 0, 'Must NOT fail completed task');
      assert.strictEqual(stats.invalidFailed, 0, 'Must NOT fail completed task');

      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'completed', 'Task status must remain completed');
      assert.strictEqual(taskInDb.executionMetadata.resultData?.answer, 'valid completed outcome', 'Result data must be preserved');
    });

    // -------------------------------------------------------------
    // T12: OCC PROTECTION - TASK MODIFIED AFTER SCANNER READ IS NOT OVERWRITTEN
    // -------------------------------------------------------------
    await runAsyncTest('T12: OCC protection: task modified after scanner read is not overwritten by invalid-metadata failure CAS', async () => {
      const mission = await Mission.create({
        objective: 'Test T12 OCC Protection Race',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 60000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task before concurrent write',
        description: 'Simulates task being modified concurrently after recovery scanner reads it',
        agentId: 'analyst',
        order: 1,
        status: 'running',
        executionMetadata: {
          claimedBy: null,
          generation: null, // Invalid metadata
          attempt: 1,
          heartbeatAt: new Date(Date.now() - 35000), // Stale (> 25s)
        },
      });

      // Run actual production reconcileStaleTasks with barrier right before the failure CAS
      const stats = await reconcileStaleTasks({
        leaseDurationMs: 25000,
        missionId: mission._id,
        __barrierBeforeInvalidFailureCas: async (staleTask) => {
          // Concurrent worker / process writes to this task after scanner read
          await MissionTask.updateOne(
            { _id: staleTask._id },
            {
              $set: {
                title: 'Task updated concurrently by active process',
                'executionMetadata.claimedBy': 'new_active_worker',
                'executionMetadata.generation': 1,
                'executionMetadata.heartbeatAt': new Date(),
              },
            }
          );
        },
      });

      // OCC filter on observed updatedAt must reject the failure CAS because updatedAt advanced
      assert.strictEqual(stats.invalidFailed, 0, 'Must NOT fail a task that changed concurrently');
      assert.strictEqual(stats.reclaimedToPending, 0, 'Must NOT reclaim task');

      // Verify task in DB retains the newer concurrent state
      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'running', 'Status must remain running');
      assert.strictEqual(taskInDb.title, 'Task updated concurrently by active process', 'Title must be preserved from concurrent write');
      assert.strictEqual(taskInDb.executionMetadata.claimedBy, 'new_active_worker', 'New claimedBy must be preserved');
      assert.strictEqual(taskInDb.executionMetadata.generation, 1, 'New generation must be preserved');

      // Verify zero TASK_FAILED events recorded
      const failEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_FAILED,
      });
      assert.strictEqual(failEvents.length, 0, 'Zero TASK_FAILED events emitted on OCC collision');
    });

    console.log('\n====================================================');
    console.log(`  NEXORA 8G.6.2 - PHASE 2.3 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
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
  runPhase2_3Suite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[FATAL PHASE 2.3 SUITE FAILURE]', err);
      process.exit(1);
    });
}

module.exports = { runPhase2_3Suite };
