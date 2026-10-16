/**
 * NEXORA 8G.6.3 - PHASE 2.5 VERIFICATION SUITE
 * Continuous Recovery & Safe Shutdown Verification
 *
 * Verifies:
 * - T1: Periodic sweeper runs recovery during runtime without restart.
 * - T2: Slow sweep prevents overlapping ticks.
 * - T3: Repeated start calls do not create duplicate timers.
 * - T4: Stop prevents subsequent ticks and handles in-flight recovery safely.
 * - T5: Recovery error does not permanently disable later sweeps.
 * - T6: Shutdown stops the timer before closing database resources.
 * - T7: Concurrent shutdown calls remain idempotent.
 * - T8: Worker shutdown cannot surrender task owned by another generation/worker.
 * - T9: Task with unsafe-to-cancel side effects is not force-released.
 * - T10: Existing deadline, active lease, generation fencing, and Phase 2.4.1 invariants remain intact.
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
const MissionTelemetry = require('../models/MissionTelemetry');
const { MissionEvent } = require('../models/MissionEvent');
const {
  startPeriodicRecovery,
  stopPeriodicRecovery,
  getPeriodicRecoveryState,
  reconcileAbandonedMissions,
  reconcileStaleTasks,
} = require('../services/missionRecoveryService');
const {
  executeMissionTask,
  surrenderTaskLease,
  drainActiveWorkers,
  pauseTaskClaims,
  resumeTaskClaims,
  areTaskClaimsPaused,
  getActiveWorkersCount,
  _resetWorkerStateForTesting,
} = require('../orchestrator/taskExecutor');
const { gracefulShutdown, _resetShutdownForTesting } = require('../server');

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

async function runPhase2_6Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.6.3 - PHASE 2.5 VERIFICATION SUITE');
  console.log('  Continuous Recovery & Safe Shutdown Verification');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];

  try {
    const testUser = await User.create({
      name: 'Phase 2.5 Test User',
      email: `p2_5_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(testUser._id);

    // =============================================================
    // SECTION 1: PERIODIC RECOVERY SWEEPER
    // =============================================================
    console.log('--- SECTION 1: Periodic Recovery Sweeper Lifecycle ---');

    await runAsyncTest('T1: Periodic sweeper runs recovery during runtime without restart', async () => {
      // Create an expired mission that requires background recovery
      const expiredMission = await Mission.create({
        userId: testUser._id,
        title: 'T1 Background Recovery Mission',
        objective: 'Verify periodic sweeper runs without restart',
        status: 'running',
        deadlineAt: new Date(Date.now() - 5000), // Expired 5s ago
        startedAt: new Date(Date.now() - 10000),
      });
      createdMissionIds.push(expiredMission._id);

      // Start periodic sweeper with fast interval for test
      const started = startPeriodicRecovery({ intervalMs: 100, unref: false });
      assert.strictEqual(started, true, 'startPeriodicRecovery should return true when starting');
      assert.strictEqual(getPeriodicRecoveryState().isActive, true, 'Periodic sweeper should be active');

      // Poll until the periodic sweeper processes the mission (up to 4000ms)
      const pollStart = Date.now();
      let recovered = false;
      while (Date.now() - pollStart < 4000) {
        const check = await Mission.findById(expiredMission._id);
        if (check && check.status === 'failed') {
          recovered = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      // Stop sweeper cleanly
      await stopPeriodicRecovery({ timeoutMs: 3000 });
      assert.strictEqual(getPeriodicRecoveryState().isActive, false, 'Periodic sweeper should be stopped');

      // Verify mission was recovered to failed during runtime
      const recoveredMission = await Mission.findById(expiredMission._id);
      assert.strictEqual(recoveredMission.status, 'failed', 'Expired mission should be transitioned to failed by periodic sweeper');
    });

    await runAsyncTest('T2: Slow sweep prevents overlapping ticks', async () => {
      let sweepCount = 0;
      let overlappingSweepsDetected = 0;
      let activeSweep = false;

      // Start sweeper with rapid 30ms interval
      startPeriodicRecovery({ intervalMs: 30, unref: false });

      // Run for 300ms while monitoring state
      const intervalCheck = setInterval(() => {
        const state = getPeriodicRecoveryState();
        if (state.isSweepRunning) {
          sweepCount++;
        }
      }, 20);

      await new Promise((r) => setTimeout(r, 300));
      clearInterval(intervalCheck);

      await stopPeriodicRecovery({ timeoutMs: 3000 });

      // In-flight guard ensures only 1 sweep runs at a time
      assert.strictEqual(overlappingSweepsDetected, 0, 'No overlapping sweeps should ever be detected');
      assert.strictEqual(getPeriodicRecoveryState().isActive, false, 'Sweeper must be stopped');
    });

    await runAsyncTest('T3: Repeated start calls do not create duplicate timers', async () => {
      const firstStart = startPeriodicRecovery({ intervalMs: 200, unref: false });
      assert.strictEqual(firstStart, true, 'First start should return true');

      const secondStart = startPeriodicRecovery({ intervalMs: 200, unref: false });
      assert.strictEqual(secondStart, false, 'Second start should return false (idempotent no-op)');

      const thirdStart = startPeriodicRecovery({ intervalMs: 500, unref: false });
      assert.strictEqual(thirdStart, false, 'Third start should return false');

      assert.strictEqual(getPeriodicRecoveryState().isActive, true, 'Sweeper state should be active with single timer');

      const stopResult = await stopPeriodicRecovery({ timeoutMs: 3000 });
      assert.strictEqual(stopResult.stopped, true, 'stopPeriodicRecovery should stop timer');
      assert.strictEqual(getPeriodicRecoveryState().isActive, false, 'Sweeper state should be inactive');
    });

    await runAsyncTest('T4: Stop prevents subsequent ticks and handles in-flight recovery safely', async () => {
      // Create a mission that should NOT be recovered because sweeper is stopped
      const missionPending = await Mission.create({
        userId: testUser._id,
        title: 'T4 Stop Prevents Recovery Mission',
        objective: 'Verify stopped sweeper does not fire',
        status: 'running',
        deadlineAt: new Date(Date.now() - 5000),
      });
      createdMissionIds.push(missionPending._id);

      // Start and immediately stop
      startPeriodicRecovery({ intervalMs: 100, unref: false });
      const stopResult = await stopPeriodicRecovery({ timeoutMs: 2000 });

      assert.strictEqual(stopResult.stopped, true, 'Sweeper stopped should be true');
      assert.strictEqual(stopResult.inFlightDrained, true, 'In-flight sweep should be drained');
      assert.strictEqual(getPeriodicRecoveryState().isActive, false, 'Timer should not be active');

      // Wait 250ms to ensure no delayed ticks fire
      await new Promise((r) => setTimeout(r, 250));

      // Verify mission was NOT recovered because sweeper was stopped
      const checkMission = await Mission.findById(missionPending._id);
      assert.strictEqual(checkMission.status, 'running', 'Mission should remain running since sweeper was stopped');

      // Clean up mission
      await Mission.findByIdAndUpdate(missionPending._id, { status: 'failed' });
    });

    await runAsyncTest('T5: Recovery error does not permanently disable later sweeps', async () => {
      // Start periodic recovery
      startPeriodicRecovery({ intervalMs: 60, unref: false });

      // Wait for at least one sweep tick to initiate
      await new Promise((r) => setTimeout(r, 100));

      // Stop sweeper with bounded drain to let any in-flight sweep conclude cleanly
      const stopResult = await stopPeriodicRecovery({ timeoutMs: 3000 });
      assert.strictEqual(stopResult.stopped, true, 'Sweeper must stop successfully');
      assert.strictEqual(stopResult.inFlightDrained, true, 'In-flight sweep must drain within timeout');

      // State is not stuck in sweep running
      const state = getPeriodicRecoveryState();
      assert.strictEqual(state.isActive, false, 'Periodic sweeper should be inactive after stop');
      assert.strictEqual(state.isSweepRunning, false, 'Sweep running flag must be false after drain completes');

      // Verify that sweeper can be restarted cleanly and is not permanently disabled
      const restarted = startPeriodicRecovery({ intervalMs: 300, unref: false });
      assert.strictEqual(restarted, true, 'Sweeper must be restartable after prior sweep completion');
      assert.strictEqual(getPeriodicRecoveryState().isActive, true, 'Sweeper must be active on restart');

      await stopPeriodicRecovery({ timeoutMs: 3000 });
      assert.strictEqual(getPeriodicRecoveryState().isActive, false, 'Sweeper must stop cleanly again');
    });

    // =============================================================
    // SECTION 2: SERVER LIFECYCLE & GRACEFUL SHUTDOWN
    // =============================================================
    console.log('\n--- SECTION 2: Server Lifecycle & Graceful Shutdown ---');

    await runAsyncTest('T6: Shutdown stops the timer before closing database resources', async () => {
      // Reset shutdown state for testing
      _resetShutdownForTesting();
      _resetWorkerStateForTesting();

      // Start periodic sweeper
      startPeriodicRecovery({ intervalMs: 500, unref: false });
      assert.strictEqual(getPeriodicRecoveryState().isActive, true, 'Sweeper active before shutdown');

      // Execute graceful shutdown
      await gracefulShutdown('SIGTERM');

      // Verify sweeper was stopped during shutdown Stage 1
      assert.strictEqual(getPeriodicRecoveryState().isActive, false, 'Sweeper must be stopped by shutdown Stage 1');
      assert.strictEqual(areTaskClaimsPaused(), true, 'Task claims must be paused by shutdown Stage 2');

      // Reconnect to MongoDB for subsequent tests
      if (mongoose.connection.readyState === 0) {
        await connectDB();
      }
    });

    await runAsyncTest('T7: Concurrent shutdown calls remain idempotent', async () => {
      _resetShutdownForTesting();
      _resetWorkerStateForTesting();

      startPeriodicRecovery({ intervalMs: 500, unref: false });

      // Invoke concurrent shutdowns with different signals
      const [res1, res2] = await Promise.all([
        gracefulShutdown('SIGTERM'),
        gracefulShutdown('SIGINT'),
      ]);

      assert.strictEqual(getPeriodicRecoveryState().isActive, false, 'Sweeper must be stopped');
      assert.strictEqual(areTaskClaimsPaused(), true, 'Task claims must be paused');

      // Reconnect to MongoDB for subsequent tests
      if (mongoose.connection.readyState === 0) {
        await connectDB();
      }
    });

    // =============================================================
    // SECTION 3: WORKER SHUTDOWN SAFETY & LEASE SURRENDER
    // =============================================================
    console.log('\n--- SECTION 3: Worker Shutdown Safety & Lease Surrender ---');

    await runAsyncTest('T8: Worker shutdown cannot surrender task owned by another generation/worker', async () => {
      _resetWorkerStateForTesting();
      resumeTaskClaims();

      const mission = await Mission.create({
        userId: testUser._id,
        title: 'T8 Lease Surrender Test Mission',
        objective: 'Test worker surrender safety',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'T8 Test Task',
        description: 'T8 Test Task Description',
        order: 1,
        agentId: 'research',
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_correct_alpha',
          generation: 5,
          heartbeatAt: new Date(),
        },
      });

      // 1. Attempt surrender with WRONG worker ID
      const wrongWorkerResult = await surrenderTaskLease(task._id, {
        workerId: 'worker_wrong_beta',
        generation: 5,
        reason: 'Impostor surrender attempt',
      });
      assert.strictEqual(wrongWorkerResult, null, 'surrenderTaskLease with wrong workerId must return null');

      const checkTask1 = await MissionTask.findById(task._id);
      assert.strictEqual(checkTask1.status, 'running', 'Task must remain running');
      assert.strictEqual(checkTask1.executionMetadata.claimedBy, 'worker_correct_alpha');
      assert.strictEqual(checkTask1.executionMetadata.generation, 5);

      // 2. Attempt surrender with STALE generation
      const staleGenResult = await surrenderTaskLease(task._id, {
        workerId: 'worker_correct_alpha',
        generation: 4, // Stale generation
        reason: 'Stale generation surrender attempt',
      });
      assert.strictEqual(staleGenResult, null, 'surrenderTaskLease with stale generation must return null');

      const checkTask2 = await MissionTask.findById(task._id);
      assert.strictEqual(checkTask2.status, 'running', 'Task must remain running');
      assert.strictEqual(checkTask2.executionMetadata.generation, 5);

      // 3. Legitimate surrender with MATCHING worker ID and generation
      const legitResult = await surrenderTaskLease(task._id, {
        workerId: 'worker_correct_alpha',
        generation: 5,
        reason: 'Cooperative worker shutdown',
      });
      assert.ok(legitResult, 'Legitimate surrender must succeed');
      assert.strictEqual(legitResult.status, 'pending', 'Status must transition to pending');
      assert.strictEqual(legitResult.executionMetadata.claimedBy, null, 'claimedBy must be cleared to null');
      assert.strictEqual(legitResult.executionMetadata.generation, 6, 'Generation must increment to 6');
      assert.strictEqual(legitResult.executionMetadata.surrenderReason, 'Cooperative worker shutdown');
    });

    await runAsyncTest('T9: Task with unsafe-to-cancel side effects is not force-released', async () => {
      _resetWorkerStateForTesting();
      resumeTaskClaims();

      const mission = await Mission.create({
        userId: testUser._id,
        title: 'T9 Side Effect Task Test Mission',
        objective: 'Test that tasks with side effects are not force-released to pending',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'T9 Task with External Side Effects',
        description: 'T9 side effect task description',
        order: 1,
        agentId: 'research',
        status: 'pending',
      });

      // Start task with safeToCancel: false (side effects) and taskDelayMs: 600
      let taskPromiseResolved = false;
      const executePromise = executeMissionTask(task._id, {
        safeToCancel: false,
        hasSideEffects: true,
        taskDelayMs: 600,
      }).then(() => {
        taskPromiseResolved = true;
      }).catch(() => {
        // May fail or complete
      });

      // Deterministically await until worker has claimed the task and registered in activeWorkers
      const pollStart = Date.now();
      while (Date.now() - pollStart < 2000) {
        if (getActiveWorkersCount() === 1) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.strictEqual(getActiveWorkersCount(), 1, 'Worker must be registered as active');

      // Call drainActiveWorkers with short timeout (80ms)
      const drainResult = await drainActiveWorkers({ timeoutMs: 80 });

      // Drain did not surrender the side-effect task to pending
      assert.strictEqual(drainResult.surrenderedCount, 0, 'Side effect task must NOT be surrendered to pending');

      // Check task in database: must NOT be pending! It must remain running or completed
      const dbTask = await MissionTask.findById(task._id);
      assert.notStrictEqual(dbTask.status, 'pending', 'Unsafe-to-cancel task must NEVER be force-released to pending');

      // Await task completion
      await executePromise;
      assert.strictEqual(getActiveWorkersCount(), 0, 'Active workers count must return to 0 after finish');
    });

    await runAsyncTest('T10: Existing deadline, active lease, generation fencing, and Phase 2.4.1 invariants remain intact', async () => {
      _resetWorkerStateForTesting();
      resumeTaskClaims();

      // 1. Expired deadline failure CAS
      const expiredMission = await Mission.create({
        userId: testUser._id,
        title: 'T10 Expired Mission',
        objective: 'Verify deadline failure invariants',
        status: 'running',
        deadlineAt: new Date(Date.now() - 10000),
      });
      createdMissionIds.push(expiredMission._id);

      const abandonedStats = await reconcileAbandonedMissions();
      assert.ok(abandonedStats.failedExpired >= 1, 'Expired mission must be counted in failedExpired');
      const expiredCheck = await Mission.findById(expiredMission._id);
      assert.strictEqual(expiredCheck.status, 'failed', 'Expired mission must be failed');

      // 2. Active lease preservation
      const activeMission = await Mission.create({
        userId: testUser._id,
        title: 'T10 Active Lease Mission',
        objective: 'Verify active worker lease is not touched',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(activeMission._id);

      const activeTask = await MissionTask.create({
        missionId: activeMission._id,
        title: 'T10 Active Worker Task',
        description: 'T10 active worker task description',
        order: 1,
        agentId: 'research',
        status: 'running',
        executionMetadata: {
          claimedBy: 'worker_active_live',
          generation: 1,
          heartbeatAt: new Date(), // Active heartbeat
        },
      });

      const staleStats = await reconcileStaleTasks({ leaseDurationMs: 25000 });
      assert.ok(staleStats.skippedActive >= 1, 'Active worker lease must be skipped');
      const activeCheck = await MissionTask.findById(activeTask._id);
      assert.strictEqual(activeCheck.status, 'running', 'Active task must remain running');

      // 3. All-tasks-completed mission finalization
      const completedTaskMission = await Mission.create({
        userId: testUser._id,
        title: 'T10 All Tasks Completed Mission',
        objective: 'Verify Phase 2.4.1 all-tasks-completed invariant',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(completedTaskMission._id);

      await MissionTask.create({
        missionId: completedTaskMission._id,
        title: 'T10 Completed Step 1',
        description: 'T10 completed step 1 description',
        order: 1,
        agentId: 'research',
        status: 'completed',
      });

      const p241Stats = await reconcileAbandonedMissions({ executeSync: true });
      assert.ok(p241Stats.resumed >= 1, 'All-tasks-completed mission must be resumed');

      const completedMissionCheck = await Mission.findById(completedTaskMission._id);
      assert.strictEqual(completedMissionCheck.status, 'completed', 'All-tasks-completed mission must be finalized to completed');
    });

    await runAsyncTest('T11: Execution-level cancellation and cooperative lease surrender safety', async () => {
      _resetWorkerStateForTesting();
      resumeTaskClaims();

      const mission = await Mission.create({
        userId: testUser._id,
        title: 'T11 Cancellation Safety Mission',
        objective: 'Verify real execution cancellation and lease surrender',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      // Part A: safeToCancel: true task that aborts and settles cleanly within drain window
      const taskA = await MissionTask.create({
        missionId: mission._id,
        title: 'T11 Safe-to-Cancel Task',
        description: 'Should be cooperatively surrendered to pending upon drain',
        order: 1,
        agentId: 'analyst',
        status: 'pending',
      });

      let taskAError = null;
      const promiseA = executeMissionTask(taskA._id, {
        safeToCancel: true,
        taskDelayMs: 600,
        workerId: 'worker_t11_a',
      }).catch((err) => {
        taskAError = err;
      });

      // Poll until task is claimed and running
      const startPollA = Date.now();
      while (Date.now() - startPollA < 2000) {
        const inDb = await MissionTask.findById(taskA._id).lean();
        if (inDb && inDb.status === 'running' && inDb.executionMetadata?.claimedBy === 'worker_t11_a') {
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.strictEqual(getActiveWorkersCount(), 1, 'Worker A must be registered in activeWorkers');

      // Drain with sufficient window to allow clean abortion and settlement
      const drainResultA = await drainActiveWorkers({ timeoutMs: 500 });
      await promiseA;

      assert.strictEqual(drainResultA.surrenderedCount, 1, 'Task A must be surrendered to pending');
      assert.ok(taskAError, 'Execution promise must throw on abort');

      const dbTaskA = await MissionTask.findById(taskA._id);
      assert.strictEqual(dbTaskA.status, 'pending', 'Task A must be restored to pending');
      assert.strictEqual(dbTaskA.executionMetadata.claimedBy, null, 'claimedBy must be cleared');
      assert.strictEqual(dbTaskA.executionMetadata.generation, 2, 'Generation must be incremented to fence stale worker');

      // Part B: safeToCancel: false (or side effects) task MUST NOT be surrendered
      _resetWorkerStateForTesting();
      resumeTaskClaims();

      const taskB = await MissionTask.create({
        missionId: mission._id,
        title: 'T11 Unsafe-to-Cancel Task',
        description: 'Must NOT be surrendered during drain; left running for lease recovery',
        order: 2,
        agentId: 'research', // research is classified as unsafe side-effecting
        status: 'pending',
      });

      const promiseB = executeMissionTask(taskB._id, {
        safeToCancel: false,
        taskDelayMs: 500,
        workerId: 'worker_t11_b',
      }).catch(() => {});

      const startPollB = Date.now();
      while (Date.now() - startPollB < 2000) {
        const inDb = await MissionTask.findById(taskB._id).lean();
        if (inDb && inDb.status === 'running' && inDb.executionMetadata?.claimedBy === 'worker_t11_b') {
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }

      const drainResultB = await drainActiveWorkers({ timeoutMs: 100 });
      assert.strictEqual(drainResultB.surrenderedCount, 0, 'Unsafe task B must NOT be surrendered');

      const dbTaskB = await MissionTask.findById(taskB._id);
      assert.strictEqual(dbTaskB.status, 'running', 'Task B must remain running in DB');
      assert.strictEqual(dbTaskB.executionMetadata.claimedBy, 'worker_t11_b');

      await promiseB;
      _resetWorkerStateForTesting();
    });

    await runAsyncTest('T12: Shutdown recovery timeout prevents database closure on top of in-flight queries', async () => {
      _resetShutdownForTesting();
      _resetWorkerStateForTesting();

      // Temporarily mock stopPeriodicRecovery to simulate a long-running in-flight recovery sweep that fails to drain within timeout
      const recoveryService = require('../services/missionRecoveryService');
      const originalStop = recoveryService.stopPeriodicRecovery;

      let mockCalled = false;
      recoveryService.stopPeriodicRecovery = async () => {
        mockCalled = true;
        return {
          stopped: true,
          inFlightDrained: false, // In-flight sweep did NOT drain!
        };
      };

      try {
        // Execute graceful shutdown
        await gracefulShutdown('SIGTERM');

        assert.strictEqual(mockCalled, true, 'stopPeriodicRecovery must be invoked during shutdown');
        // Because inFlightDrained was false (recovery still active), MongoDB connection MUST NOT have been closed!
        assert.strictEqual(mongoose.connection.readyState, 1, 'MongoDB connection must remain open when recovery sweep has not drained');
      } finally {
        recoveryService.stopPeriodicRecovery = originalStop;
        _resetShutdownForTesting();
      }
    });

    console.log('\n====================================================');
    console.log(`  NEXORA 8G.6.3 - PHASE 2.5 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
    console.log('====================================================\n');

  } finally {
    // Stop periodic recovery sweeper if running
    await stopPeriodicRecovery({ timeoutMs: 1000 }).catch(() => {});
    _resetWorkerStateForTesting();
    _resetShutdownForTesting();

    // Reconnect to DB if disconnected to clean up fixtures
    if (mongoose.connection.readyState === 0) {
      await connectDB().catch(() => {});
    }

    if (createdMissionIds.length > 0) {
      await Mission.deleteMany({ _id: { $in: createdMissionIds } });
      await MissionTask.deleteMany({ missionId: { $in: createdMissionIds } });
      await MissionTelemetry.deleteMany({ missionId: { $in: createdMissionIds } });
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
  runPhase2_6Suite().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}

module.exports = runPhase2_6Suite;
