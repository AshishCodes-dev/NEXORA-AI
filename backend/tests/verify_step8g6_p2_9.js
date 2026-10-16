/**
 * NEXORA 8G.6.6 - PHASE 2.7 VERIFICATION SUITE
 * Mission Lifecycle Integrity & Concurrency Hardening
 *
 * Verifies:
 * - T1: Incomplete Task Guard (running task blocks premature mission completion)
 * - T2: Incomplete Task Guard (queued task blocks premature mission completion)
 * - T3: Incomplete Task Guard (pending task blocks premature mission completion)
 * - T4: Normal Pipeline Completion (all tasks completed allows atomic mission completion)
 * - T5: Failed Task Guard (failed task forces mission transition to failed)
 * - T6: Zero-Task Mission Guard (mission with zero tasks rejected from execution)
 * - T7: Adaptive Retry Blocked on Non-Running Mission (parent cancelled/failed mission blocks retry)
 * - T8: Concurrent Mission Cancellation During Requeue Barrier (aborts retry & preserves failed task)
 * - T9: Orchestrator Adaptive Retry Loop Cancellation Guard (halts loop when mission cancelled)
 * - T10: Pre-Completion Abort Signal Guard (worker abort prevents task completion CAS)
 * - T11: Pre-Completion Barrier Concurrent Mission Cancellation (prevents completion CAS and events)
 * - T12: Concurrent ExecuteMission Idempotency & Single Winner CAS (exactly one winner, zero dup events)
 * - T13: Terminal State Immutability (repeated execute calls on completed/failed missions yield alreadyRan)
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
const { MissionEvent, EVENT_TYPES, DECISION_TYPES } = require('../models/MissionEvent');
const { executeMission, cancelMission } = require('../orchestrator/missionOrchestrator');
const { executeMissionTask, abortMissionWorkers } = require('../orchestrator/taskExecutor');
const { evaluateTaskFailure } = require('../services/adaptiveMissionService');

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
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
}

async function runPhase2_7Suite() {
  console.log('\n====================================================');
  console.log('  NEXORA PHASE 2.7 VERIFICATION SUITE');
  console.log('  Mission Lifecycle Integrity & Concurrency Hardening');
  console.log('====================================================\n');

  await connectDB();
  console.log('[DATABASE] Connected to MongoDB');

  const createdMissionIds = [];
  const createdUserIds = [];

  try {
    const testUser = await User.create({
      name: 'Phase 2.7 Verification User',
      email: `phase27_${Date.now()}@nexora.test`,
      password: 'password123',
    });
    createdUserIds.push(testUser._id);

    console.log('\n--- SECTION 1: Incomplete Task Guards on Mission Completion ---');

    await runAsyncTest('T1: Incomplete Task Guard (running task blocks premature mission completion)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test incomplete task guard: running task',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Completed',
        description: 'Completed prerequisite task',
        order: 1,
        status: 'completed',
        agentId: 'analyst',
      });

      const task2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Running in Worker',
        description: 'Currently running task',
        order: 2,
        status: 'running',
        agentId: 'research',
        executionMetadata: {
          generation: 1,
          claimedBy: 'worker-p27-t1',
          heartbeatAt: new Date(),
        },
      });

      // Orchestrator executed when task 2 is still running
      const result = await executeMission(mission._id, {
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });

      assert.strictEqual(result.alreadyActive, true, 'Result must yield alreadyActive: true');
      assert.ok(result.activeTaskId.equals(task2._id), 'activeTaskId must match the in-flight running task');

      // Mission in DB must NOT be completed
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'running', 'Mission status must remain running and not prematurely completed');

      // Zero MISSION_COMPLETED events
      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'No MISSION_COMPLETED event should be emitted');
    });

    await runAsyncTest('T2: Incomplete Task Guard (queued task blocks premature mission completion)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test incomplete task guard: queued task',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Completed',
        description: 'Completed prerequisite task',
        order: 1,
        status: 'completed',
        agentId: 'analyst',
      });

      const task2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Queued',
        description: 'Currently queued task',
        order: 2,
        status: 'queued',
        agentId: 'research',
      });

      const result = await executeMission(mission._id, {
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });

      assert.strictEqual(result.alreadyActive, true, 'Result must yield alreadyActive: true');
      assert.ok(result.activeTaskId.equals(task2._id), 'activeTaskId must match queued task');

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'running', 'Mission status must remain running');

      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'No MISSION_COMPLETED event');
    });

    await runAsyncTest('T3: Incomplete Task Guard (pending task blocks premature mission completion)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test incomplete task guard: pending task directly at completion check',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Completed',
        description: 'Completed prerequisite task',
        order: 1,
        status: 'completed',
        agentId: 'analyst',
      });

      const task2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Pending',
        description: 'Pending task to be executed',
        order: 2,
        status: 'pending',
        agentId: 'research',
      });

      const result = await executeMission(mission._id, {
        forceDeterministic: true,
        taskDelayMs: 10,
        skipBrowserHandoff: true,
      });

      assert.strictEqual(result.failed, false, 'executeMission executed pending task 2 to completion');
      const task2InDb = await MissionTask.findById(task2._id);
      assert.strictEqual(task2InDb.status, 'completed', 'Task 2 must be completed');

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'completed', 'Mission completes after all tasks finish');
    });

    await runAsyncTest('T4: Normal Pipeline Completion (all tasks completed allows atomic mission completion)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test full normal pipeline completion',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1',
        description: 'First sequential task',
        order: 1,
        status: 'pending',
        agentId: 'analyst',
      });
      await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2',
        description: 'Second sequential task',
        order: 2,
        status: 'pending',
        agentId: 'builder',
      });

      const result = await executeMission(mission._id, {
        forceDeterministic: true,
        taskDelayMs: 10,
        skipBrowserHandoff: true,
      });

      assert.strictEqual(result.failed, false, 'Mission execution must succeed');
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'completed', 'Mission in DB must be completed');

      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 1, 'Exactly one MISSION_COMPLETED event emitted');
    });

    await runAsyncTest('T5: Failed Task Guard (failed task forces mission transition to failed)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test failed task guard on mission completion',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Completed',
        description: 'Completed prerequisite task',
        order: 1,
        status: 'completed',
        agentId: 'analyst',
      });
      await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Failed',
        description: 'Failed prerequisite task',
        order: 2,
        status: 'failed',
        error: 'Simulated prior task failure',
        agentId: 'research',
      });

      const result = await executeMission(mission._id, {
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });

      assert.strictEqual(result.failed, true, 'Result must report failed: true');
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed', 'Mission must be transitioned to failed');

      const failEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_FAILED,
      });
      assert.strictEqual(failEvents.length, 1, 'Exactly one MISSION_FAILED event');
    });

    await runAsyncTest('T6: Zero-Task Mission Guard (mission with zero tasks rejected from execution)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test zero tasks mission',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await assert.rejects(
        async () => {
          await executeMission(mission._id, {
            forceDeterministic: true,
            skipBrowserHandoff: true,
          });
        },
        /No tasks found for mission/
      );

      const missionInDb = await Mission.findById(mission._id);
      assert.notStrictEqual(missionInDb.status, 'completed', 'Zero task mission must never be marked completed');
    });

    console.log('\n--- SECTION 2: Adaptive Retry Lifecycle Hardening ---');

    await runAsyncTest('T7: Adaptive Retry Blocked on Non-Running Mission (cancelled/failed parent blocks retry)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test adaptive retry blocked on failed parent mission',
        status: 'failed', // Terminal parent mission!
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task on failed mission',
        description: 'Task under terminal mission',
        order: 1,
        status: 'failed',
        error: 'Network connection timeout',
        agentId: 'research',
        executionMetadata: {
          attempt: 1,
          generation: 1,
        },
      });

      const decision = await evaluateTaskFailure({
        missionId: mission._id,
        taskId: task._id,
        error: new Error('Network connection timeout'),
        currentAttempt: 1,
        missionStartTime: Date.now() - 5000,
        maxMissionDurationMs: 60000,
        options: { forceDeterministic: true },
      });

      assert.strictEqual(decision.action, 'BLOCK', 'Must return BLOCK when mission is not running');
      assert.ok(decision.reason.includes('terminal state') || decision.reason.includes('no longer running'), `Reason must explain parent not running, got: ${decision.reason}`);

      // Verify task in DB remains failed and was not requeued to pending
      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'failed', 'Task must remain failed');

      // Verify zero RETRY_TASK decision events
      const retryEvents = await MissionEvent.find({
        missionId: mission._id,
        decisionType: DECISION_TYPES.RETRY_TASK,
      });
      assert.strictEqual(retryEvents.length, 0, 'No RETRY_TASK decision event allowed');
    });

    await runAsyncTest('T8: Concurrent Mission Cancellation During Requeue Barrier (aborts retry & preserves failed task)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test concurrent cancellation during requeue barrier',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task failing during cancellation race',
        description: 'Recoverable failure task',
        order: 1,
        status: 'failed',
        error: 'Simulated recoverable socket error',
        agentId: 'research',
        executionMetadata: {
          attempt: 1,
          generation: 1,
        },
      });

      // Use __barrierBeforeRequeueCas to cancel the mission concurrently right before requeue CAS
      const decision = await evaluateTaskFailure({
        missionId: mission._id,
        taskId: task._id,
        error: new Error('Simulated recoverable socket error'),
        currentAttempt: 1,
        missionStartTime: Date.now() - 5000,
        maxMissionDurationMs: 60000,
        options: {
          forceDeterministic: true,
          __barrierBeforeRequeueCas: async () => {
            // Concurrently cancel the mission
            await Mission.updateOne(
              { _id: mission._id },
              { $set: { status: 'failed' } }
            );
          },
        },
      });

      assert.strictEqual(decision.action, 'BLOCK', 'Action must be BLOCK due to concurrent cancellation');
      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'failed', 'Task must remain failed, not reset to pending');

      const retryEvents = await MissionEvent.find({
        missionId: mission._id,
        decisionType: DECISION_TYPES.RETRY_TASK,
      });
      assert.strictEqual(retryEvents.length, 0, 'No RETRY_TASK event emitted');
    });

    await runAsyncTest('T9: Orchestrator Adaptive Retry Loop Cancellation Guard (halts loop when mission cancelled)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test orchestrator halts when mission cancelled during retry evaluation',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task triggering retry',
        description: 'Task with failure and cancellation',
        order: 1,
        status: 'pending',
        agentId: 'research',
        executionMetadata: { attempt: 1 },
      });

      // Execute mission with injected failure on order 1, and during failure evaluation barrier cancel mission
      const result = await executeMission(mission._id, {
        failOrder: 1,
        taskDelayMs: 10,
        forceDeterministic: true,
        skipBrowserHandoff: true,
        __barrierBeforeRequeueCas: async () => {
          // Concurrently mark mission failed
          await Mission.updateOne(
            { _id: mission._id },
            { $set: { status: 'failed' } }
          );
        },
      });

      assert.strictEqual(result.failed, true, 'Result must report failed: true');
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed', 'Mission must be failed');

      // Task must remain failed
      const taskInDb = await MissionTask.findById(task1._id);
      assert.strictEqual(taskInDb.status, 'failed', 'Task must remain in failed status');
    });

    console.log('\n--- SECTION 3: Task Worker Abort & Pre-Completion Barriers ---');

    await runAsyncTest('T10: Pre-Completion Abort Signal Guard (worker abort prevents task completion CAS)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test pre-completion abort signal guard',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task aborted at completion barrier',
        description: 'Task undergoing abort test',
        order: 1,
        status: 'pending',
        agentId: 'analyst',
      });

      // Execute task with barrier before completion: in barrier, abort workers with timeoutMs: 0
      await assert.rejects(
        async () => {
          await executeMissionTask(task._id, {
            taskDelayMs: 10,
            forceDeterministic: true,
            skipBrowserHandoff: true,
            __barrierBeforeCompletion: async () => {
              // Signal worker abort via abortMissionWorkers with timeoutMs: 0
              await abortMissionWorkers(mission._id, { timeoutMs: 0 });
            },
          });
        },
        (err) => {
          assert.strictEqual(err.code, 'TASK_ABORTED', `Expected TASK_ABORTED error code, got: ${err.code}`);
          return true;
        }
      );

      // Verify task in DB was NOT completed
      const taskInDb = await MissionTask.findById(task._id);
      assert.notStrictEqual(taskInDb.status, 'completed', 'Task must NOT be completed');

      // Verify zero completion events
      const completionEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'No TASK_COMPLETED event should be emitted');
    });

    await runAsyncTest('T11: Pre-Completion Barrier Concurrent Mission Cancellation (prevents completion CAS and events)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test concurrent cancellation during mission completion barrier',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      // Single task, already completed
      await MissionTask.create({
        missionId: mission._id,
        title: 'Completed Task',
        description: 'Finished task',
        order: 1,
        status: 'completed',
        agentId: 'analyst',
      });

      // Execute mission with barrier before mission completion CAS:
      // In barrier, cancel the mission!
      const result = await executeMission(mission._id, {
        forceDeterministic: true,
        skipBrowserHandoff: true,
        __barrierBeforeMissionCompletion: async () => {
          await cancelMission(mission._id, { reason: 'Cancelled during pre-completion barrier' });
        },
      });

      assert.strictEqual(result.failed, true, 'Result should report failed: true because mission was cancelled');
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed', 'Mission status must be failed');

      // Verify zero MISSION_COMPLETED events
      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'No MISSION_COMPLETED event should be emitted');

      // Exactly one MISSION_FAILED event
      const failureEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_FAILED,
      });
      assert.strictEqual(failureEvents.length, 1, 'Exactly one MISSION_FAILED event from cancellation');
    });

    console.log('\n--- SECTION 4: Concurrency & Idempotency Invariants ---');

    await runAsyncTest('T12: Concurrent ExecuteMission Idempotency & Single Winner CAS (exactly one winner, zero dup events)', async () => {
      const mission = await Mission.create({
        userId: testUser._id,
        objective: 'Test concurrent executeMission single winner CAS',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create({
        missionId: mission._id,
        title: 'Single Task',
        description: 'Completed task awaiting mission completion CAS',
        order: 1,
        status: 'completed',
        agentId: 'analyst',
      });

      // Align both executions at the pre-completion barrier
      let barrierReachedCount = 0;
      let barrierRelease;
      const barrierPromise = new Promise((resolve) => {
        barrierRelease = resolve;
      });

      const executeWithBarrier = () => executeMission(mission._id, {
        forceDeterministic: true,
        skipBrowserHandoff: true,
        __barrierBeforeMissionCompletion: async () => {
          barrierReachedCount++;
          if (barrierReachedCount === 2) {
            barrierRelease();
          } else {
            await barrierPromise;
          }
        },
      });

      const [res1, res2] = await Promise.all([executeWithBarrier(), executeWithBarrier()]);

      // Exactly one must be the winner (failed: false, alreadyRan: undefined),
      // the other must be alreadyRan: true
      const winners = [res1, res2].filter((r) => r.alreadyRan !== true);
      const idempotents = [res1, res2].filter((r) => r.alreadyRan === true);

      assert.strictEqual(winners.length, 1, 'Exactly one execution must win the completion CAS');
      assert.strictEqual(idempotents.length, 1, 'Exactly one execution must report alreadyRan: true');

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'completed', 'Mission must be completed in DB');

      // Exactly one completion event emitted
      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 1, 'Exactly one MISSION_COMPLETED event emitted');
    });

    await runAsyncTest('T13: Terminal State Immutability (repeated execute calls on completed/failed missions yield alreadyRan)', async () => {
      const completedMission = await Mission.create({
        userId: testUser._id,
        objective: 'Completed mission immutability test',
        status: 'completed',
        startedAt: new Date(Date.now() - 10000),
        deadlineAt: new Date(Date.now() + 50000),
      });
      createdMissionIds.push(completedMission._id);

      await MissionTask.create({
        missionId: completedMission._id,
        title: 'Completed Task',
        description: 'Task under completed mission',
        order: 1,
        status: 'completed',
      });

      const failedMission = await Mission.create({
        userId: testUser._id,
        objective: 'Failed mission immutability test',
        status: 'failed',
        startedAt: new Date(Date.now() - 10000),
        deadlineAt: new Date(Date.now() + 50000),
      });
      createdMissionIds.push(failedMission._id);

      await MissionTask.create({
        missionId: failedMission._id,
        title: 'Failed Task',
        description: 'Task under failed mission',
        order: 1,
        status: 'failed',
      });

      // Calling execute on completed mission
      const compResult = await executeMission(completedMission._id);
      assert.strictEqual(compResult.alreadyRan, true, 'Completed mission must report alreadyRan: true');
      assert.strictEqual(compResult.mission.status, 'completed');

      // Calling execute on failed mission
      const failResult = await executeMission(failedMission._id);
      assert.strictEqual(failResult.alreadyRan, true, 'Failed mission must report alreadyRan: true');
      assert.strictEqual(failResult.mission.status, 'failed');

      // Verify no duplicate events were created
      const compEvents = await MissionEvent.find({ missionId: completedMission._id });
      assert.strictEqual(compEvents.length, 0, 'Zero events on idempotent execute of completed mission');

      const failEvents = await MissionEvent.find({ missionId: failedMission._id });
      assert.strictEqual(failEvents.length, 0, 'Zero events on idempotent execute of failed mission');
    });

    console.log('\n====================================================');
    console.log(`  PHASE 2.7 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
    console.log('====================================================\n');

    if (failedTests > 0) {
      process.exitCode = 1;
    }
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

runPhase2_7Suite().catch((err) => {
  console.error('[TEST SUITE FATAL ERROR]:', err);
  process.exit(1);
});
