/**
 * NEXORA 8G.6.2 - PHASE 2.2 VERIFICATION TEST SUITE
 * Durable Mission Deadlines, Bounded Task Execution & Pre-Completion Guards
 *
 * Verifies:
 * - T0: Timeout resolution helper validates boundary conditions
 * - T1: Initial deadline atomically set on queued -> running transition
 * - T2: Running mission deadline immutable on restart/re-execution
 * - T3A: Existing running mission with valid startedAt repairs deadline without granting fresh duration
 * - T3B: Existing running mission with missing startedAt and missing deadline fails safely
 * - T4: Invalid totalTimeoutMs rejected before state mutation
 * - T5: Expired deadline blocks pending task dispatch and marks mission failed
 * - T6: Task timeout dynamically bounded by remaining mission budget
 * - T7: Best-effort pre-completion deadline guard aborts completion if deadline breached before CAS
 * - T8: Adaptive retry blocked when canonical mission.deadlineAt is expired
 * - T9: Concurrent failure CAS preserves single-winner idempotency on deadline breach
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
const { MissionEvent, EVENT_TYPES, DECISION_TYPES } = require('../models/MissionEvent');
const {
  executeMission,
  resolveMissionTimeout,
  DEFAULT_MISSION_TIMEOUT_MS,
  MIN_MISSION_TIMEOUT_MS,
  MAX_MISSION_TIMEOUT_MS,
} = require('../orchestrator/missionOrchestrator');
const { executeMissionTask } = require('../orchestrator/taskExecutor');
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
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runPhase2_2Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.6.2 - PHASE 2.2 VERIFICATION SUITE');
  console.log('  Durable Mission Deadlines & Bounded Execution');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];

  try {
    const testUser = await User.create({
      name: 'Phase 2.2 Test User',
      email: `p2_2_test_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(testUser._id);

    console.log('--- SECTION 1: Deadline Duration Validation ---');

    await runAsyncTest('T0: Timeout resolution helper validates boundary conditions', async () => {
      assert.strictEqual(resolveMissionTimeout(undefined), DEFAULT_MISSION_TIMEOUT_MS);
      assert.strictEqual(resolveMissionTimeout(null), DEFAULT_MISSION_TIMEOUT_MS);
      assert.strictEqual(resolveMissionTimeout(60000), 60000);
      assert.strictEqual(resolveMissionTimeout(MIN_MISSION_TIMEOUT_MS), MIN_MISSION_TIMEOUT_MS);
      assert.strictEqual(resolveMissionTimeout(MAX_MISSION_TIMEOUT_MS), MAX_MISSION_TIMEOUT_MS);

      assert.throws(() => resolveMissionTimeout(0), /Invalid totalTimeoutMs/);
      assert.throws(() => resolveMissionTimeout(-1000), /Invalid totalTimeoutMs/);
      assert.throws(() => resolveMissionTimeout('not-a-number'), /Invalid totalTimeoutMs/);
      assert.throws(() => resolveMissionTimeout(NaN), /Invalid totalTimeoutMs/);
      assert.throws(() => resolveMissionTimeout(Infinity), /Invalid totalTimeoutMs/);
    });

    console.log('\n--- SECTION 2: Atomic Initialization & Immutability ---');

    await runAsyncTest('T1: Initial deadline atomically set on queued -> running transition', async () => {
      const mission = await Mission.create({
        objective: 'Test atomic deadline initialization',
        status: 'queued',
        userId: testUser._id,
        startedAt: null,
        deadlineAt: null,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Simple fast task',
        description: 'Simple task description',
        agentId: 'analyst',
        order: 1,
        status: 'pending',
      });

      const beforeExecution = Date.now();
      const result = await executeMission(mission._id, {
        totalTimeoutMs: 60000,
        taskDelayMs: 10,
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });
      const afterExecution = Date.now();

      assert.strictEqual(result.failed, false, 'Mission must succeed');
      const updatedMission = await Mission.findById(mission._id);

      assert.ok(updatedMission.startedAt instanceof Date, 'startedAt must be populated');
      assert.ok(updatedMission.deadlineAt instanceof Date, 'deadlineAt must be populated');

      const startedMs = updatedMission.startedAt.getTime();
      const deadlineMs = updatedMission.deadlineAt.getTime();

      assert.ok(startedMs >= beforeExecution && startedMs <= afterExecution, 'startedAt within execution window');
      assert.strictEqual(deadlineMs - startedMs, 60000, 'deadlineAt exactly 60000ms after startedAt');
    });

    await runAsyncTest('T2: Running mission deadline immutable on restart/re-execution', async () => {
      const fixedStartedAt = new Date(Date.now() - 10000); // 10s ago
      const fixedDeadlineAt = new Date(Date.now() + 50000); // 50s from now

      const mission = await Mission.create({
        objective: 'Test deadline immutability on running mission',
        status: 'running',
        userId: testUser._id,
        startedAt: fixedStartedAt,
        deadlineAt: fixedDeadlineAt,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task on restarted mission',
        description: 'Restarted task description',
        agentId: 'analyst',
        order: 1,
        status: 'pending',
      });

      // Attempt to execute with totalTimeoutMs = 300000 (5 minutes)
      const result = await executeMission(mission._id, {
        totalTimeoutMs: 300000,
        taskDelayMs: 10,
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });
      assert.strictEqual(result.failed, false);

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(
        missionInDb.deadlineAt.getTime(),
        fixedDeadlineAt.getTime(),
        'Original deadlineAt must NOT be overwritten or extended'
      );
      assert.strictEqual(
        missionInDb.startedAt.getTime(),
        fixedStartedAt.getTime(),
        'Original startedAt must NOT be overwritten'
      );
    });

    await runAsyncTest('T3A: Existing running mission with missing deadline fails safely without reconstruction', async () => {
      const originalStartedAt = new Date(Date.now() - 30000); // Started 30s ago
      const mission = await Mission.create({
        objective: 'Test fail-safe handling of missing deadlineAt on running mission',
        status: 'running',
        userId: testUser._id,
        startedAt: originalStartedAt,
        deadlineAt: null, // Missing deadline!
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task for fail-safe test',
        description: 'Fail-safe task description',
        agentId: 'analyst',
        order: 1,
        status: 'pending',
      });

      await assert.rejects(
        async () => {
          await executeMission(mission._id, {
            totalTimeoutMs: 20000,
            forceDeterministic: true,
            skipBrowserHandoff: true,
          });
        },
        /cannot establish safe deadline/
      );

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed', 'Mission must be transitioned to failed');
    });

    await runAsyncTest('T3B: Existing running mission with missing startedAt and deadline fails safely', async () => {
      const mission = await Mission.create({
        objective: 'Corrupted running mission with no timestamps',
        status: 'running',
        userId: testUser._id,
        startedAt: null,
        deadlineAt: null,
      });
      createdMissionIds.push(mission._id);

      // Unset createdAt so neither startedAt nor createdAt can establish a deadline
      await Mission.collection.updateOne({ _id: mission._id }, { $unset: { createdAt: '' } });

      await assert.rejects(
        async () => {
          await executeMission(mission._id, { totalTimeoutMs: 60000 });
        },
        /cannot establish safe deadline/
      );

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed', 'Mission must be transitioned to failed state');
    });

    console.log('\n--- SECTION 3: Input Validation & Pre-Dispatch Guard ---');

    await runAsyncTest('T4: Invalid totalTimeoutMs rejected before state mutation', async () => {
      const mission = await Mission.create({
        objective: 'Test invalid totalTimeoutMs rejection',
        status: 'queued',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      await assert.rejects(
        async () => {
          await executeMission(mission._id, { totalTimeoutMs: -5000 });
        },
        /Invalid totalTimeoutMs/
      );

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'queued', 'Mission status must remain queued');
      assert.strictEqual(missionInDb.startedAt, null, 'startedAt must remain null');
      assert.strictEqual(missionInDb.deadlineAt, null, 'deadlineAt must remain null');
    });

    await runAsyncTest('T5: Expired deadline blocks pending task dispatch and marks mission failed', async () => {
      const pastDeadline = new Date(Date.now() - 1000); // 1s in past
      const mission = await Mission.create({
        objective: 'Test dispatch blocking on expired deadline',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 60000),
        deadlineAt: pastDeadline,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task that must never run',
        description: 'Unrunnable task description',
        agentId: 'analyst',
        order: 1,
        status: 'pending',
      });

      const result = await executeMission(mission._id, {
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });
      assert.strictEqual(result.failed, true);
      assert.ok(result.error.includes('deadline exceeded'));

      // Verify task was never dispatched
      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'pending', 'Task must remain pending and un-dispatched');

      // Verify mission in DB is failed
      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed');

      // Verify canonical failure event was emitted
      const failEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_FAILED,
      });
      assert.strictEqual(failEvents.length, 1);
      assert.ok(failEvents[0].reason.includes('deadline exceeded'));
    });

    console.log('\n--- SECTION 4: Bounded Task Execution & Pre-Completion Guard ---');

    await runAsyncTest('T6: Task timeout dynamically bounded by remaining mission budget', async () => {
      const mission = await Mission.create({
        objective: 'Test dynamic task timeout bounding',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 10000),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Slow task facing tight mission deadline',
        description: 'Tight budget task description',
        agentId: 'analyst',
        order: 1,
        status: 'pending',
      });

      // Set deadline 1500ms from now immediately before calling executeMission
      const tightDeadline = new Date(Date.now() + 1500);
      await Mission.updateOne({ _id: mission._id }, { $set: { deadlineAt: tightDeadline } });

      const startTime = Date.now();
      const result = await executeMission(mission._id, {
        taskTimeoutMs: 120000,
        taskDelayMs: 2500, // task work delay exceeds the 1500ms budget
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });
      const elapsed = Date.now() - startTime;

      assert.strictEqual(result.failed, true);
      assert.ok(elapsed < 4000, `Execution must abort within tight timeout (~1500ms), took ${elapsed}ms`);

      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'failed');
      assert.ok(taskInDb.error.includes('timed out'));
    });

    await runAsyncTest('T7: Pre-completion deadline guard aborts completion if deadline breached before CAS', async () => {
      const mission = await Mission.create({
        objective: 'Test pre-completion deadline guard',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task completing after deadline breach',
        description: 'Barrier task description',
        agentId: 'analyst',
        order: 1,
        status: 'pending',
      });

      // Set deadline 250ms in the future immediately before executing task
      const testDeadlineAt = new Date(Date.now() + 250);
      await Mission.updateOne({ _id: mission._id }, { $set: { deadlineAt: testDeadlineAt } });

      // Work finishes in 10ms (well within 250ms), but barrier sleeps 300ms to push past deadline before CAS
      await assert.rejects(
        async () => {
          await executeMissionTask(task._id, {
            missionDeadlineAt: testDeadlineAt,
            taskDelayMs: 10,
            forceDeterministic: true,
            skipBrowserHandoff: true,
            __barrierBeforeCompletion: async () => {
              await new Promise((resolve) => setTimeout(resolve, 300));
            },
          });
        },
        (err) => {
          assert.strictEqual(err.code, 'TASK_TIMEOUT');
          assert.ok(err.message.includes('deadline') || err.message.includes('timed out'), `Expected timeout/deadline error, got: ${err.message}`);
          return true;
        }
      );

      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'failed', 'Task must NOT be marked completed');
      assert.ok(taskInDb.error.includes('deadline') || taskInDb.error.includes('timed out'), `Expected timeout/deadline error in DB, got: ${taskInDb.error}`);

      // Confirm zero completion events
      const completionEvents = await MissionEvent.find({
        taskId: task._id,
        type: EVENT_TYPES.TASK_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 0, 'Zero TASK_COMPLETED events on deadline breach');
    });

    console.log('\n--- SECTION 5: Adaptive Retry & Concurrency Idempotency ---');

    await runAsyncTest('T8: Adaptive retry blocked when canonical mission.deadlineAt is expired', async () => {
      const expiredDeadline = new Date(Date.now() - 5000);
      const mission = await Mission.create({
        objective: 'Test adaptive retry blocked on deadline expiry',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 60000),
        deadlineAt: expiredDeadline,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task with retryable error but expired deadline',
        description: 'Expired deadline task description',
        agentId: 'analyst',
        order: 1,
        status: 'failed',
        executionMetadata: {
          generation: 1,
          attempt: 1,
          claimedBy: 'worker_old',
        },
      });

      // Transient retryable error (ECONNRESET) on attempt 1 (normally retryable)
      const transientError = new Error('read ECONNRESET');
      transientError.code = 'ECONNRESET';

      const decision = await evaluateTaskFailure({
        missionId: mission._id,
        taskId: task._id,
        error: transientError,
        currentAttempt: 1,
        missionStartTime: Date.now() - 60000,
        maxMissionDurationMs: 300000,
      });

      assert.strictEqual(decision.action, 'BLOCK', 'Must BLOCK on expired deadline');
      assert.strictEqual(decision.decisionType, DECISION_TYPES.BLOCK_MISSION);
      assert.ok(decision.reason.includes('deadline exceeded'));

      // Confirm task was NOT re-queued
      const taskInDb = await MissionTask.findById(task._id);
      assert.strictEqual(taskInDb.status, 'failed', 'Task must remain failed');

      // Confirm BLOCK_MISSION decision event recorded
      const blockEvents = await MissionEvent.find({
        missionId: mission._id,
        decisionType: DECISION_TYPES.BLOCK_MISSION,
      });
      assert.strictEqual(blockEvents.length, 1);
    });

    await runAsyncTest('T9: Concurrent failure CAS preserves single-winner idempotency on deadline breach', async () => {
      const expiredDeadline = new Date(Date.now() - 500);
      const mission = await Mission.create({
        objective: 'Test concurrent failure CAS on deadline breach',
        status: 'running',
        userId: testUser._id,
        startedAt: new Date(Date.now() - 60000),
        deadlineAt: expiredDeadline,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task during concurrent deadline expiry',
        description: 'Concurrent task description',
        agentId: 'analyst',
        order: 1,
        status: 'pending',
      });

      // Barrier setup to ensure both workers hit the failure CAS together
      let barrierWaiters = 0;
      let barrierRelease = null;
      const barrierPromise = new Promise((resolve) => {
        barrierRelease = resolve;
      });

      async function testBarrier() {
        barrierWaiters++;
        if (barrierWaiters === 2) {
          barrierRelease();
        } else {
          await barrierPromise;
        }
      }

      const [res1, res2] = await Promise.all([
        executeMission(mission._id, {
          __barrierBeforeFailureCas: testBarrier,
          forceDeterministic: true,
          skipBrowserHandoff: true,
        }),
        executeMission(mission._id, {
          __barrierBeforeFailureCas: testBarrier,
          forceDeterministic: true,
          skipBrowserHandoff: true,
        }),
      ]);

      // Exactly one winner and one loser
      const winner = res1.alreadyRan ? res2 : res1;
      const loser = res1.alreadyRan ? res1 : res2;

      assert.strictEqual(winner.failed, true);
      assert.ok(!winner.alreadyRan, 'Winner must not have alreadyRan flag');
      assert.strictEqual(loser.failed, true);
      assert.strictEqual(loser.alreadyRan, true, 'Losing caller must cleanly yield with alreadyRan: true');

      // Canonical failure event must be emitted exactly once
      const failEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_FAILED,
      });
      assert.strictEqual(failEvents.length, 1, 'Exactly 1 MISSION_FAILED event emitted');

      const missionInDb = await Mission.findById(mission._id);
      assert.strictEqual(missionInDb.status, 'failed');
    });

    console.log('\n====================================================');
    console.log(`  NEXORA 8G.6.2 - PHASE 2.2 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (0 FAILED)`);
    console.log('====================================================\n');
  } finally {
    // Cleanup test artifacts
    if (createdMissionIds.length > 0) {
      await Mission.deleteMany({ _id: { $in: createdMissionIds } });
      await MissionTask.deleteMany({ missionId: { $in: createdMissionIds } });
      await MissionEvent.deleteMany({ missionId: { $in: createdMissionIds } });
      const MissionTelemetry = require('../models/MissionTelemetry');
      await MissionTelemetry.deleteMany({ missionId: { $in: createdMissionIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
  }
}

runPhase2_2Suite().catch((err) => {
  console.error('[FATAL PHASE 2.2 SUITE FAILURE]', err);
  process.exit(1);
});
