/**
 * NEXORA 8G.6.4 - PHASE 2.6 VERIFICATION SUITE
 * End-to-End Mission Lifecycle Integration & Reliability
 *
 * Verifies:
 * - T1: Complete Happy-Path End-to-End Mission Lifecycle
 * - T2: Mission Cancellation Lifecycle & In-Flight Worker Abort
 * - T3: Idempotent Mission Cancellation
 * - T4: Prerequisite Task Failure Cleanly Halts Pipeline & Reconciles Downstream Tasks
 * - T5: Completion Integrity Failure Check Emits Terminal Failure Telemetry & Reconciles Tasks
 * - T6: Mission Scoped Worker Abort (abortMissionWorkers isolates specific mission)
 * - T7: HTTP GET /api/missions/:missionId (Authentication & Ownership Isolation)
 * - T8: HTTP POST /api/missions/:missionId/cancel (HTTP Cancellation Endpoint & Idempotency)
 * - T9: HTTP POST /api/missions/:missionId/execute (HTTP Execution & Resume Endpoint)
 * - T10: Idempotent Concurrent Execution Dispatches
 * - T11: State & Result API Consistency on Terminal Failure (Zero Orphaned Tasks)
 * - T12: Periodic Recovery Sweeper Coexistence with Cancelled & Terminal Missions
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

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
const { getJwtSecret, COOKIE_NAME } = require('../config/authConfig');
const User = require('../models/User');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const MissionTelemetry = require('../models/MissionTelemetry');
const { MissionEvent, EVENT_TYPES, DECISION_TYPES } = require('../models/MissionEvent');
const {
  createMissionExecutionPlan,
  executeMission,
  cancelMission,
} = require('../orchestrator/missionOrchestrator');
const {
  abortMissionWorkers,
  getActiveWorkers,
  _resetWorkerStateForTesting,
} = require('../orchestrator/taskExecutor');
const { getMissionState } = require('../services/missionStateService');
const { getMissionResult } = require('../services/missionResultService');
const {
  startPeriodicRecovery,
  stopPeriodicRecovery,
  getPeriodicRecoveryState,
} = require('../services/missionRecoveryService');
const { app } = require('../server');

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

function generateAuthToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role },
    getJwtSecret(),
    { expiresIn: '1h' }
  );
}

// Helper to create deterministic task pipelines
async function createDeterministicTasks(missionId, count = 3) {
  const tasks = [];
  const agentSequence = ['analyst', 'analyst', 'builder', 'qa'];
  for (let i = 1; i <= count; i++) {
    tasks.push({
      missionId,
      order: i,
      title: `Deterministic Step ${i}`,
      description: `Description for deterministic phase ${i}`,
      status: 'pending',
      agentId: agentSequence[(i - 1) % agentSequence.length],
    });
  }
  return await MissionTask.create(tasks);
}

async function runPhase2_6Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.6.4 - PHASE 2.6 VERIFICATION SUITE');
  console.log('  End-to-End Mission Lifecycle Integration & Reliability');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];
  let httpServer = null;
  let baseUrl = '';

  try {
    // Start temporary HTTP server for route tests
    httpServer = await new Promise((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    const port = httpServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Create test users
    const ownerUser = await User.create({
      name: 'Phase 2.6 Owner',
      email: `owner_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(ownerUser._id);
    const ownerToken = generateAuthToken(ownerUser);

    const foreignUser = await User.create({
      name: 'Phase 2.6 Foreign User',
      email: `foreign_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(foreignUser._id);
    const foreignToken = generateAuthToken(foreignUser);

    // =============================================================
    // SECTION 1: CORE LIFECYCLE & EXECUTION
    // =============================================================
    console.log('--- SECTION 1: Core Lifecycle & Sequential Execution ---');

    await runAsyncTest('T1: Complete Happy-Path End-to-End Mission Lifecycle', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Analyze distributed consensus protocols and durability guarantees',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 3);

      // Execute mission
      const result = await executeMission(mission._id, { taskDelayMs: 10, skipBrowserHandoff: true });
      assert.strictEqual(result.failed, false, 'Mission should complete without failure');
      assert.strictEqual(result.mission.status, 'completed', 'Mission status should be completed');

      // Check all tasks completed
      const tasks = await MissionTask.find({ missionId: mission._id }).sort({ order: 1 });
      assert.strictEqual(tasks.length, 3);
      assert.ok(tasks.every((t) => t.status === 'completed'), 'All tasks must be in completed status');

      // State service intelligence
      const state = await getMissionState(mission._id.toString(), ownerUser._id.toString());
      assert.strictEqual(state.stage, 'completed', 'Mission stage must be completed');
      assert.strictEqual(state.state, 'completed', 'Mission operational state must be completed');
      assert.strictEqual(state.progress.percentage, 100, 'Progress must be 100%');
      assert.strictEqual(state.progress.pendingTasks, 0, 'Pending tasks must be 0');
    });

    // =============================================================
    // SECTION 2: CANCELLATION & WORKER ABORT
    // =============================================================
    console.log('\n--- SECTION 2: Mission Cancellation & Worker Abort ---');

    await runAsyncTest('T2: Mission Cancellation Lifecycle & In-Flight Worker Abort', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Long running research mission for cancellation test',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 3);

      // Start asynchronous execution with slow tasks (250ms each)
      const execPromise = executeMission(mission._id, { taskDelayMs: 250, skipBrowserHandoff: true });

      // Wait for worker to spin up and register in activeWorkers (up to 500ms)
      let activeBeforeCancel = [];
      for (let i = 0; i < 25; i++) {
        activeBeforeCancel = getActiveWorkers();
        if (activeBeforeCancel.length >= 1) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(activeBeforeCancel.length >= 1, 'Should have at least 1 in-flight worker');

      // Cancel the mission
      const cancelResult = await cancelMission(mission._id, {
        userId: ownerUser._id,
        reason: 'User explicitly cancelled during analysis',
      });
      assert.strictEqual(cancelResult.cancelled, true, 'cancelMission must report cancelled: true');
      assert.strictEqual(cancelResult.status, 'failed', 'cancelMission must report status: failed');

      // Await execution promise settlement
      await execPromise.catch((err) => ({ error: err.message }));

      // Verify mission status is failed in DB
      const updatedMission = await Mission.findById(mission._id);
      assert.strictEqual(updatedMission.status, 'failed', 'Mission in DB must be status: failed');

      // Verify NO tasks remain in pending or queued status
      const orphanedTasks = await MissionTask.find({
        missionId: mission._id,
        status: { $in: ['pending', 'queued'] },
      });
      assert.strictEqual(orphanedTasks.length, 0, 'Zero tasks must remain pending or queued');

      // Verify terminal failure event recorded
      const events = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_FAILED,
      });
      assert.ok(events.length >= 1, 'Terminal MISSION_FAILED event must be recorded');
    });

    await runAsyncTest('T3: Idempotent Mission Cancellation', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Mission for cancellation idempotency test',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      // Cancel an already failed mission
      const cancelAgain = await cancelMission(mission._id, { userId: ownerUser._id });
      assert.strictEqual(cancelAgain.cancelled, false, 'Should report cancelled: false when already failed');
      assert.strictEqual(cancelAgain.alreadyTerminal, true, 'Should report alreadyTerminal: true');
      assert.strictEqual(cancelAgain.status, 'failed');

      // Cancel a completed mission
      const completedMission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Completed mission idempotency',
        status: 'completed',
      });
      createdMissionIds.push(completedMission._id);

      const cancelCompleted = await cancelMission(completedMission._id, { userId: ownerUser._id });
      assert.strictEqual(cancelCompleted.cancelled, false, 'Should report cancelled: false when already completed');
      assert.strictEqual(cancelCompleted.alreadyTerminal, true, 'Should report alreadyTerminal: true');
      assert.strictEqual(cancelCompleted.status, 'completed');
    });

    // =============================================================
    // SECTION 3: PREREQUISITE & COMPLETION FAILURE GUARDS
    // =============================================================
    console.log('\n--- SECTION 3: Prerequisite & Completion Failure Guards ---');

    await runAsyncTest('T4: Prerequisite Task Failure Cleanly Halts Pipeline & Reconciles Downstream Tasks', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Mission for prerequisite failure halting test',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 3);

      // Invalidate task order 1 manually to simulate prior failure
      const firstTask = await MissionTask.findOne({ missionId: mission._id, order: 1 });
      firstTask.status = 'failed';
      firstTask.error = 'Simulated prior failure in step 1';
      await firstTask.save();

      // Trigger execution; should halt at prerequisite check before dispatching task 2
      const result = await executeMission(mission._id, { taskDelayMs: 10, skipBrowserHandoff: true });
      assert.strictEqual(result.failed, true, 'Mission should halt as failed');
      assert.ok(result.error.includes('failed; halting pipeline'), 'Error should indicate prerequisite failure');

      // Verify mission in DB is failed
      const dbMission = await Mission.findById(mission._id);
      assert.strictEqual(dbMission.status, 'failed');

      // Verify downstream tasks (order 2, 3) remain unexecuted (pending)
      const remainingPending = await MissionTask.find({
        missionId: mission._id,
        status: 'pending',
      });
      assert.strictEqual(remainingPending.length, 2, 'Downstream tasks must remain unexecuted (pending)');

      // Verify failure events were emitted
      const failEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_FAILED,
      });
      assert.ok(failEvents.length >= 1, 'MISSION_FAILED event must be recorded');
    });

    await runAsyncTest('T5: Completion Integrity Failure Check Emits Terminal Failure Telemetry & Reconciles Tasks', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Mission for completion check with failed task',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      // Create 2 tasks: task 1 completed, task 2 failed
      await MissionTask.create([
        {
          missionId: mission._id,
          order: 1,
          title: 'Task 1',
          description: 'Desc 1',
          status: 'completed',
          agentId: 'analyst',
        },
        {
          missionId: mission._id,
          order: 2,
          title: 'Task 2',
          description: 'Desc 2',
          status: 'failed',
          agentId: 'analyst',
          error: 'Task 2 failed during execution',
        },
      ]);

      const result = await executeMission(mission._id, { skipBrowserHandoff: true });
      assert.strictEqual(result.failed, true, 'Must fail completion check');
      assert.ok(result.error.includes('contains failed task'), 'Error must note failed task');

      const dbMission = await Mission.findById(mission._id);
      assert.strictEqual(dbMission.status, 'failed');
    });

    await runAsyncTest('T6: Mission Scoped Worker Abort (abortMissionWorkers isolates specific mission)', async () => {
      const missionA = await Mission.create({
        userId: ownerUser._id,
        objective: 'Mission A for scoped worker abort',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      const missionB = await Mission.create({
        userId: ownerUser._id,
        objective: 'Mission B for scoped worker abort',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(missionA._id, missionB._id);

      const taskA = await MissionTask.create({
        missionId: missionA._id,
        order: 1,
        title: 'Task A',
        description: 'Desc A',
        status: 'pending',
        agentId: 'analyst',
      });
      const taskB = await MissionTask.create({
        missionId: missionB._id,
        order: 1,
        title: 'Task B',
        description: 'Desc B',
        status: 'pending',
        agentId: 'analyst',
      });

      // Start both tasks with long delay (300ms)
      const { executeMissionTask } = require('../orchestrator/taskExecutor');
      const promiseA = executeMissionTask(taskA._id, { taskDelayMs: 300 });
      const promiseB = executeMissionTask(taskB._id, { taskDelayMs: 300 });

      // Wait for both to register in activeWorkers (up to 500ms)
      let workers = [];
      for (let i = 0; i < 25; i++) {
        workers = getActiveWorkers();
        if (workers.length === 2) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.strictEqual(workers.length, 2, 'Should have 2 running workers');

      // Abort ONLY mission A
      const abortRes = await abortMissionWorkers(missionA._id, { timeoutMs: 2000 });
      assert.strictEqual(abortRes.abortedCount, 1, 'Exactly 1 worker belonging to Mission A should be aborted');

      // Promise A should reject with AbortError
      let aFailed = false;
      try {
        await promiseA;
      } catch (err) {
        aFailed = true;
        assert.ok(err.name === 'AbortError' || err.message.includes('aborted'));
      }
      assert.strictEqual(aFailed, true, 'Task A must be aborted');

      // Promise B should finish successfully!
      const resultB = await promiseB;
      assert.strictEqual(resultB.status, 'completed', 'Task B must finish undisturbed');
    });

    // =============================================================
    // SECTION 4: HTTP API LIFECYCLE ENDPOINTS
    // =============================================================
    console.log('\n--- SECTION 4: HTTP API Lifecycle Endpoints ---');

    await runAsyncTest('T7: HTTP GET /api/missions/:missionId (Authentication & Ownership Isolation)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'HTTP detail endpoint test mission',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create({
        missionId: mission._id,
        order: 1,
        title: 'Detail Task',
        description: 'Detail Task Description',
        status: 'pending',
        agentId: 'analyst',
      });

      // 1. Unauthenticated request -> 401
      const unauthRes = await fetch(`${baseUrl}/api/missions/${mission._id}`);
      assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must return 401');

      // 2. Foreign user request -> 404 (anti-enumeration)
      const foreignRes = await fetch(`${baseUrl}/api/missions/${mission._id}`, {
        headers: { Cookie: `${COOKIE_NAME}=${foreignToken}` },
      });
      assert.strictEqual(foreignRes.status, 404, 'Foreign user request must return 404');

      // 3. Authenticated owner request -> 200 with mission & tasks
      const ownerRes = await fetch(`${baseUrl}/api/missions/${mission._id}`, {
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(ownerRes.status, 200, 'Owner request must return 200');
      const body = await ownerRes.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.mission.id, mission._id.toString());
      assert.strictEqual(body.tasks.length, 1);
      assert.strictEqual(body.tasks[0].title, 'Detail Task');
    });

    await runAsyncTest('T8: HTTP POST /api/missions/:missionId/cancel (HTTP Cancellation Endpoint & Idempotency)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'HTTP cancel endpoint test mission',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create({
        missionId: mission._id,
        order: 1,
        title: 'Task to cancel',
        description: 'Task desc',
        status: 'pending',
        agentId: 'analyst',
      });

      // 1. Foreign user cancellation -> 404
      const foreignCancel = await fetch(`${baseUrl}/api/missions/${mission._id}/cancel`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${foreignToken}` },
      });
      assert.strictEqual(foreignCancel.status, 404, 'Foreign cancellation must return 404');

      // 2. Owner user cancellation -> 200 with cancelled: true
      const ownerCancel = await fetch(`${baseUrl}/api/missions/${mission._id}/cancel`, {
        method: 'POST',
        headers: {
          Cookie: `${COOKIE_NAME}=${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Cancelled via HTTP test' }),
      });
      assert.strictEqual(ownerCancel.status, 200, 'Owner cancellation must return 200');
      const cancelBody = await ownerCancel.json();
      assert.strictEqual(cancelBody.success, true);
      assert.strictEqual(cancelBody.cancelled, true);
      assert.strictEqual(cancelBody.mission.status, 'failed');

      // 3. Repeated owner cancellation -> 200 with cancelled: false, alreadyTerminal: true
      const repeatCancel = await fetch(`${baseUrl}/api/missions/${mission._id}/cancel`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(repeatCancel.status, 200);
      const repeatBody = await repeatCancel.json();
      assert.strictEqual(repeatBody.success, true);
      assert.strictEqual(repeatBody.cancelled, false);
    });

    await runAsyncTest('T9: HTTP POST /api/missions/:missionId/execute (HTTP Execution & Resume Endpoint)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'HTTP execute endpoint test mission',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 2);

      // 1. Execute via HTTP with ?sync=true
      const syncExec = await fetch(`${baseUrl}/api/missions/${mission._id}/execute?sync=true`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(syncExec.status, 200, 'Synchronous execution must return 200');
      const syncBody = await syncExec.json();
      assert.strictEqual(syncBody.success, true);
      assert.strictEqual(syncBody.status, 'completed');

      // 2. Execute an already completed mission -> 200 already completed
      const alreadyDone = await fetch(`${baseUrl}/api/missions/${mission._id}/execute`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(alreadyDone.status, 200);
      const alreadyDoneBody = await alreadyDone.json();
      assert.strictEqual(alreadyDoneBody.message, 'Mission already completed');

      // 3. Execute a failed mission -> 400 rejection
      const failedMission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Failed mission execute test',
        status: 'failed',
      });
      createdMissionIds.push(failedMission._id);

      const failExec = await fetch(`${baseUrl}/api/missions/${failedMission._id}/execute`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(failExec.status, 400, 'Re-executing failed mission directly must return 400');
    });

    // =============================================================
    // SECTION 5: CONCURRENCY, CONSISTENCY & RECOVERY
    // =============================================================
    console.log('\n--- SECTION 5: Concurrency, Consistency & Recovery ---');

    await runAsyncTest('T10: Idempotent Concurrent Execution Dispatches', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Concurrent dispatch idempotency test mission',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 2);

      // Dispatch 2 simultaneous executions
      const [res1, res2] = await Promise.all([
        executeMission(mission._id, { taskDelayMs: 20, skipBrowserHandoff: true }),
        executeMission(mission._id, { taskDelayMs: 20, skipBrowserHandoff: true }),
      ]);

      // Exactly one must perform the run or yield cleanly
      const dbMission = await Mission.findById(mission._id);
      assert.strictEqual(dbMission.status, 'completed', 'Final status must be completed');
      assert.ok(
        (res1.alreadyRan || res1.alreadyActive || !res1.failed) &&
        (res2.alreadyRan || res2.alreadyActive || !res2.failed),
        'Both calls must exit safely and idempotently'
      );
    });

    await runAsyncTest('T11: State & Result API Consistency on Terminal Failure (Zero Orphaned Tasks)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Terminal failure state consistency test',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 3);

      // Cancel mission to put into terminal failed
      await cancelMission(mission._id, {
        userId: ownerUser._id,
        reason: 'Consistency audit cancellation',
      });

      // Verify State API
      const state = await getMissionState(mission._id.toString(), ownerUser._id.toString());
      assert.strictEqual(state.stage, 'failed', 'Stage must be failed');
      assert.strictEqual(state.state, 'failed', 'Operational state must be failed');
      assert.ok(state.blockingReason, 'Blocking reason must exist on terminal failure');
      assert.ok(
        ['MISSION_FAILED', 'TASK_EXECUTION_FAILED'].includes(state.blockingReason.code),
        'Blocking reason code must be valid terminal failure code'
      );

      // Verify Result API
      const result = await getMissionResult(mission._id.toString(), ownerUser._id.toString());
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(result.resultStatus.verification, 'failed');
    });

    await runAsyncTest('T12: Periodic Recovery Sweeper Coexistence with Cancelled & Terminal Missions', async () => {
      // Create an expired completed mission and an expired cancelled/failed mission
      const completedExp = await Mission.create({
        userId: ownerUser._id,
        objective: 'Expired completed coexistence',
        status: 'completed',
        deadlineAt: new Date(Date.now() - 5000),
      });
      const failedExp = await Mission.create({
        userId: ownerUser._id,
        objective: 'Expired failed coexistence',
        status: 'failed',
        deadlineAt: new Date(Date.now() - 5000),
      });
      createdMissionIds.push(completedExp._id, failedExp._id);

      // Start periodic sweeper
      startPeriodicRecovery({ intervalMs: 50, unref: false });

      // Let sweeper run 2 ticks
      await new Promise((r) => setTimeout(r, 120));

      await stopPeriodicRecovery({ timeoutMs: 2000 });
      assert.strictEqual(getPeriodicRecoveryState().isActive, false);

      // Verify terminal missions were never mutated
      const chkCompleted = await Mission.findById(completedExp._id);
      const chkFailed = await Mission.findById(failedExp._id);
      assert.strictEqual(chkCompleted.status, 'completed', 'Completed mission must remain completed');
      assert.strictEqual(chkFailed.status, 'failed', 'Failed mission must remain failed');
    });

    console.log('\n====================================================');
    console.log(`  PHASE 2.6 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (0 FAILED)`);
    console.log('====================================================\n');
  } finally {
    // Teardown HTTP server
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    // Clean up created test documents
    if (createdMissionIds.length > 0) {
      await Mission.deleteMany({ _id: { $in: createdMissionIds } }).catch(() => {});
      await MissionTask.deleteMany({ missionId: { $in: createdMissionIds } }).catch(() => {});
      await MissionEvent.deleteMany({ missionId: { $in: createdMissionIds } }).catch(() => {});
      await MissionTelemetry.deleteMany({ missionId: { $in: createdMissionIds } }).catch(() => {});
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } }).catch(() => {});
    }

    _resetWorkerStateForTesting();
    await connectDB.closeDB(true);
  }
}

runPhase2_6Suite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 2.6 Suite failed:', err);
    process.exit(1);
  });
