/**
 * NEXORA 8G.6.1 VERIFICATION TEST SUITE
 * Atomic Task Claiming & In-Flight Concurrency Guard
 *
 * Verifies:
 * - Section 1: Single Atomic Claim & Generation Allocation (Null & Populated Metadata)
 * - Section 2: Concurrent Claim Exclusivity, Typed Conflict & Error Discrimination
 * - Section 3: In-Flight Concurrency Guard (Prevention of Out-of-Order Dispatch)
 * - Section 4: Concurrency Collision in Orchestrator Yields Cleanly Without Mission Failure
 * - Section 5: End-to-End Sequential Pipeline Execution & Generation Accounting
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
const { executeMissionTask, TaskClaimConflictError } = require('../orchestrator/taskExecutor');
const { createMissionExecutionPlan, executeMission } = require('../orchestrator/missionOrchestrator');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

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

async function run8G6Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.6.1 VERIFICATION SUITE');
  console.log('  Atomic Task Claiming & In-Flight Concurrency Guard');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];

  try {
    const testUser = await User.create({
      name: 'Claim Test User',
      email: `claim_test_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(testUser._id);

    // -------------------------------------------------------------
    // SECTION 1: ATOMIC TASK CLAIMING & GENERATION ALLOCATION
    // -------------------------------------------------------------
    console.log('--- Section 1: Atomic Claim & Generation Allocation ---');

    await runAsyncTest('1. Atomic claim transitions pending to running and sets generation 1 on null metadata', async () => {
      const mission = await Mission.create({
        objective: 'Test atomic claim on null metadata',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task with null metadata',
        description: 'Should safely allocate generation',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
        executionMetadata: null, // explicitly null
      });

      const claimed = await executeMissionTask(task._id, {
        workerId: 'worker_unit_1',
        taskDelayMs: 0,
      });

      assert.strictEqual(claimed.status, 'completed');
      const inDb = await MissionTask.findById(task._id);
      assert.strictEqual(inDb.executionMetadata.claimedBy, 'worker_unit_1');
      assert.strictEqual(inDb.executionMetadata.generation, 1);
      assert.ok(inDb.executionMetadata.claimedAt);
    });

    await runAsyncTest('2. Atomic claim preserves existing metadata fields while incrementing generation', async () => {
      const mission = await Mission.create({
        objective: 'Test metadata preservation',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task with existing metadata',
        description: 'Preserve missionObjective',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
        executionMetadata: {
          missionObjective: 'Custom mission objective text',
          customParam: 42,
        },
      });

      const claimed = await executeMissionTask(task._id, {
        workerId: 'worker_unit_2',
        taskDelayMs: 0,
      });

      assert.strictEqual(claimed.status, 'completed');
      const inDb = await MissionTask.findById(task._id);
      assert.strictEqual(inDb.executionMetadata.missionObjective, 'Custom mission objective text');
      assert.strictEqual(inDb.executionMetadata.customParam, 42);
      assert.strictEqual(inDb.executionMetadata.claimedBy, 'worker_unit_2');
      assert.strictEqual(inDb.executionMetadata.generation, 1);
    });

    // -------------------------------------------------------------
    // SECTION 2: CONCURRENT CLAIM EXCLUSIVITY & TYPED CONFLICTS
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Concurrent Claim Exclusivity & Typed Conflicts ---');

    await runAsyncTest('3. Two concurrent claims on one pending task yield exactly 1 success and 1 TaskClaimConflictError', async () => {
      const mission = await Mission.create({
        objective: 'Test concurrent claim race',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Contested task',
        description: 'Two workers race to claim',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
        executionMetadata: null,
      });

      let successCount = 0;
      let conflictCount = 0;
      let conflictError = null;

      const p1 = executeMissionTask(task._id, { workerId: 'worker_alpha', taskDelayMs: 50 });
      const p2 = executeMissionTask(task._id, { workerId: 'worker_beta', taskDelayMs: 50 });

      const results = await Promise.allSettled([p1, p2]);

      for (const res of results) {
        if (res.status === 'fulfilled') {
          successCount++;
        } else {
          conflictCount++;
          conflictError = res.reason;
        }
      }

      assert.strictEqual(successCount, 1, 'Exactly one worker must successfully claim and execute');
      assert.strictEqual(conflictCount, 1, 'Exactly one worker must experience a claim conflict');
      assert.ok(conflictError instanceof TaskClaimConflictError, 'Losing worker error must be instance of TaskClaimConflictError');
      assert.strictEqual(conflictError.code, 'TASK_CLAIM_CONFLICT', 'Error code must be TASK_CLAIM_CONFLICT');
      assert.strictEqual(conflictError.taskId, task._id.toString());
      assert.ok(['running', 'completed'].includes(conflictError.currentStatus), 'Conflict status must indicate running or completed');

      // Database integrity verification
      const finalTask = await MissionTask.findById(task._id);
      assert.strictEqual(finalTask.status, 'completed', 'Winning worker completes the task');
      assert.strictEqual(finalTask.executionMetadata.generation, 1, 'Generation must be exactly 1 after race');
      assert.ok(['worker_alpha', 'worker_beta'].includes(finalTask.executionMetadata.claimedBy));
    });

    await runAsyncTest('4. Calling executeMissionTask on completed task throws TaskClaimConflictError with status completed', async () => {
      const mission = await Mission.create({
        objective: 'Test claim on completed task',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Already completed task',
        description: 'Should not allow re-claim',
        status: 'completed',
        order: 1,
        agentId: 'analyst',
      });

      let thrownErr = null;
      try {
        await executeMissionTask(task._id, { workerId: 'worker_late' });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(thrownErr instanceof TaskClaimConflictError);
      assert.strictEqual(thrownErr.code, 'TASK_CLAIM_CONFLICT');
      assert.strictEqual(thrownErr.currentStatus, 'completed');
    });

    await runAsyncTest('5. Calling executeMissionTask on failed task throws TaskClaimConflictError with status failed', async () => {
      const mission = await Mission.create({
        objective: 'Test claim on failed task',
        status: 'running',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Already failed task',
        description: 'Should not allow direct claim',
        status: 'failed',
        order: 1,
        agentId: 'analyst',
      });

      let thrownErr = null;
      try {
        await executeMissionTask(task._id, { workerId: 'worker_late' });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(thrownErr instanceof TaskClaimConflictError);
      assert.strictEqual(thrownErr.code, 'TASK_CLAIM_CONFLICT');
      assert.strictEqual(thrownErr.currentStatus, 'failed');
    });

    await runAsyncTest('6. Calling executeMissionTask with non-existent ID throws TASK_NOT_FOUND (not conflict)', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      let thrownErr = null;
      try {
        await executeMissionTask(fakeId, { workerId: 'worker_fake' });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(!(thrownErr instanceof TaskClaimConflictError));
      assert.strictEqual(thrownErr.code, 'TASK_NOT_FOUND');
    });

    await runAsyncTest('7. Calling executeMissionTask with malformed ID throws INVALID_TASK_ID', async () => {
      let thrownErr = null;
      try {
        await executeMissionTask('not-an-id');
      } catch (err) {
        thrownErr = err;
      }

      assert.strictEqual(thrownErr.code, 'INVALID_TASK_ID');
    });

    // -------------------------------------------------------------
    // SECTION 3: IN-FLIGHT CONCURRENCY GUARD & OUT-OF-ORDER PREVENTION
    // -------------------------------------------------------------
    console.log('\n--- Section 3: In-Flight Concurrency Guard ---');

    await runAsyncTest('8. In-flight running task prevents second orchestrator from dispatching downstream pending task', async () => {
      const mission = await Mission.create({
        objective: 'Test in-flight concurrency protection',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Active',
        description: 'Currently running',
        status: 'running', // in-flight!
        order: 1,
        agentId: 'analyst',
        executionMetadata: { generation: 1, claimedBy: 'worker_primary' },
      });

      const task2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Pending',
        description: 'Must NOT be executed while Task 1 is running',
        status: 'pending',
        order: 2,
        agentId: 'research',
        executionMetadata: null,
      });

      // Second worker enters executeMission while Task 1 is running
      const result = await executeMission(mission._id, { taskDelayMs: 0 });

      assert.strictEqual(result.alreadyActive, true, 'Orchestrator must yield with alreadyActive flag');
      assert.strictEqual(result.activeTaskId.toString(), task1._id.toString());

      // Task 2 must remain pending and untouched
      const task2Db = await MissionTask.findById(task2._id);
      assert.strictEqual(task2Db.status, 'pending', 'Downstream task must remain pending');
      assert.strictEqual(task2Db.executionMetadata, null, 'Downstream task must not be claimed');

      // Mission must still be running
      const missionDb = await Mission.findById(mission._id);
      assert.strictEqual(missionDb.status, 'running', 'Mission must remain in running state');
    });

    await runAsyncTest('9. In-flight queued task prevents second orchestrator from dispatching downstream pending task', async () => {
      const mission = await Mission.create({
        objective: 'Test in-flight queued protection',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Queued',
        description: 'Currently queued',
        status: 'queued', // in-flight queued!
        order: 1,
        agentId: 'analyst',
      });

      const task2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Pending',
        description: 'Must NOT be executed while Task 1 is queued',
        status: 'pending',
        order: 2,
        agentId: 'research',
      });

      const result = await executeMission(mission._id, { taskDelayMs: 0 });

      assert.strictEqual(result.alreadyActive, true);
      assert.strictEqual(result.activeTaskId.toString(), task1._id.toString());

      const task2Db = await MissionTask.findById(task2._id);
      assert.strictEqual(task2Db.status, 'pending');
    });

    // -------------------------------------------------------------
    // SECTION 4: CONFLICT HANDLING IN ORCHESTRATOR YIELDS CLEANLY
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Conflict Handling Yields Cleanly Without Mission Failure ---');

    await runAsyncTest('10. Claim conflict in executeMission yields cleanly without failing mission or emitting BLOCK_MISSION', async () => {
      const mission = await Mission.create({
        objective: 'Test conflict yield without failure',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Raced task',
        description: 'Simulate concurrent claim during executeMission',
        status: 'pending',
        order: 1,
        agentId: 'analyst',
      });

      // Hook: right before executeMissionTask claims it, simulate another worker claiming it
      // We can test this by running executeMission with an injected delay or pre-empting the claim
      const originalFindOneAndUpdate = MissionTask.findOneAndUpdate.bind(MissionTask);

      // Pre-empt: worker B steals the task right after orchestrator finds nextTask
      let intercepted = false;
      MissionTask.findOneAndUpdate = async function(filter, update, opts) {
        if (filter._id && filter.status === 'pending' && !intercepted) {
          intercepted = true;
          // Worker B claims it first!
          await originalFindOneAndUpdate(
            { _id: filter._id, status: 'pending' },
            { $set: { status: 'running', executionMetadata: { claimedBy: 'worker_stealer', generation: 1 } } }
          );
        }
        return originalFindOneAndUpdate(filter, update, opts);
      };

      try {
        const result = await executeMission(mission._id, { taskDelayMs: 0 });

        assert.strictEqual(result.claimConflict, true, 'Orchestrator must return claimConflict: true');
        assert.strictEqual(result.conflictTaskId.toString(), task._id.toString());

        // Verify Mission was NOT marked failed!
        const missionDb = await Mission.findById(mission._id);
        assert.strictEqual(missionDb.status, 'running', 'Mission must NOT be marked failed');

        // Verify no BLOCK_MISSION decision was recorded!
        const blockDecisions = await MissionEvent.find({
          missionId: mission._id,
          decisionType: DECISION_TYPES.BLOCK_MISSION,
        });
        assert.strictEqual(blockDecisions.length, 0, 'Zero BLOCK_MISSION decisions must be emitted on claim conflict');

        // Verify no MISSION_FAILED event was recorded!
        const failEvents = await MissionEvent.find({
          missionId: mission._id,
          type: EVENT_TYPES.MISSION_FAILED,
        });
        assert.strictEqual(failEvents.length, 0, 'Zero MISSION_FAILED events must be emitted on claim conflict');
      } finally {
        MissionTask.findOneAndUpdate = originalFindOneAndUpdate;
      }
    });

    // -------------------------------------------------------------
    // SECTION 5: END-TO-END PIPELINE EXECUTION & GENERATION ACCOUNTING
    // -------------------------------------------------------------
    console.log('\n--- Section 5: End-to-End Execution & Generation Accounting ---');

    await runAsyncTest('11. Full sequential mission execution completes all tasks with generation 1 for each', async () => {
      const mission = await Mission.create({
        objective: 'Analyze Node.js asynchronous architecture and produce brief report',
        status: 'planning',
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const plan = await createMissionExecutionPlan(mission, { forceDeterministic: true });
      assert.ok(plan.tasks.length >= 4, 'Plan must contain tasks');

      const execResult = await executeMission(mission._id, {
        taskDelayMs: 10,
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });

      assert.strictEqual(execResult.failed, false, 'Mission must complete successfully');
      assert.strictEqual(execResult.mission.status, 'completed', 'Mission status must be completed');

      // Verify each task has status completed and generation === 1
      const tasksInDb = await MissionTask.find({ missionId: mission._id }).sort({ order: 1 });
      for (const t of tasksInDb) {
        assert.strictEqual(t.status, 'completed', `Task order ${t.order} must be completed`);
        assert.strictEqual(t.executionMetadata.generation, 1, `Task order ${t.order} generation must be 1`);
        assert.ok(t.executionMetadata.claimedBy, `Task order ${t.order} must have claimedBy`);
      }
    });

    // -------------------------------------------------------------
    // SECTION 6: AUDIT REMEDIATION REGRESSIONS (FINDINGS 1 & 2)
    // -------------------------------------------------------------
    console.log('\n--- Section 6: Audit Remediation Regressions (Findings 1 & 2) ---');

    await runAsyncTest('12. Finding 1: Running mission with failed Task 1 halts and never dispatches downstream pending Task 2', async () => {
      const mission = await Mission.create({
        objective: 'Test prerequisite failure isolation',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      const task1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Fatal Failure',
        description: 'Previously failed with non-retryable error',
        order: 1,
        status: 'failed',
        agentId: 'analyst',
        executionMetadata: { attempt: 2, lastError: 'Fatal connection termination' },
      });

      const task2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Downstream Pending',
        description: 'Must NEVER be dispatched when Task 1 is failed',
        order: 2,
        status: 'pending',
        agentId: 'research',
        executionMetadata: null,
      });

      const result = await executeMission(mission._id, { taskDelayMs: 0 });

      assert.strictEqual(result.failed, true, 'Execution result must indicate failure');
      assert.ok(result.error && result.error.includes('Prerequisite task order 1'), 'Error must identify prerequisite failure');

      // Verify Task 2 was NOT dispatched
      const task2Db = await MissionTask.findById(task2._id);
      assert.strictEqual(task2Db.status, 'pending', 'Downstream task must remain pending');
      assert.strictEqual(task2Db.executionMetadata, null, 'Downstream task must not be claimed or modified');

      // Verify Mission transitioned to failed
      const missionDb = await Mission.findById(mission._id);
      assert.strictEqual(missionDb.status, 'failed', 'Mission must transition to failed state');
    });

    await runAsyncTest('13. Finding 2: Concurrent callers completing a running mission emit exactly ONE terminal MISSION_COMPLETED event', async () => {
      const mission = await Mission.create({
        objective: 'Test idempotent terminal mission completion',
        status: 'running',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
        userId: testUser._id,
      });
      createdMissionIds.push(mission._id);

      // Create all tasks in completed status
      await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Completed',
        description: 'Done',
        order: 1,
        status: 'completed',
        agentId: 'analyst',
        executionMetadata: { generation: 1 },
      });
      await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Completed',
        description: 'Done',
        order: 2,
        status: 'completed',
        agentId: 'research',
        executionMetadata: { generation: 1 },
      });

      // Two concurrent callers enter executeMission simultaneously
      const [res1, res2] = await Promise.all([
        executeMission(mission._id, { taskDelayMs: 0 }),
        executeMission(mission._id, { taskDelayMs: 0 }),
      ]);

      // Exactly one caller wins the atomic running -> completed transition
      const winners = [res1, res2].filter(r => r.alreadyRan !== true);
      const followers = [res1, res2].filter(r => r.alreadyRan === true);

      assert.strictEqual(winners.length, 1, 'Exactly one caller must win the terminal transition');
      assert.strictEqual(followers.length, 1, 'Exactly one caller must receive alreadyRan: true');

      // In database, mission is completed
      const missionDb = await Mission.findById(mission._id);
      assert.strictEqual(missionDb.status, 'completed', 'Mission status must be completed');

      // Exactly ONE MISSION_COMPLETED event recorded
      const completionEvents = await MissionEvent.find({
        missionId: mission._id,
        type: EVENT_TYPES.MISSION_COMPLETED,
      });
      assert.strictEqual(completionEvents.length, 1, 'Exactly one MISSION_COMPLETED event must be recorded in database');
    });

    console.log('\n====================================================');
    console.log(`  NEXORA 8G.6.1 AUDIT COMPLETE: ${passedTests}/${totalTests} PASSED (0 FAILED)`);
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

run8G6Suite().catch((err) => {
  console.error('[FATAL 8G.6.1 SUITE FAILURE]', err);
  process.exit(1);
});
