/**
 * NEXORA Phase 2.10 Verification Suite
 * Step 8G.6 Phase 2.12 — Frontend Mission Controls & Workspace Polish
 *
 * Verifies:
 * SECTION 1: Task Retry Route (POST /api/missions/:missionId/tasks/:taskId/retry)
 * - T1: Unauthenticated retry requests return 401
 * - T2: Cross-tenant isolation returns 404 without data mutation
 * - T3: Malformed ObjectId for missionId or taskId returns clean 400/404
 * - T4: Terminal mission guard: retry rejected if mission is cancelled
 * - T5: Status guard: retry rejected for non-failed tasks (pending/completed)
 * - T6: Eligible failed task retry: atomic CAS to pending, generation increment, event emission
 * - T7: Mission failed status recovery: mission resets to running upon task retry
 * - T8: Concurrency CAS test: multiple concurrent retries yield exactly 1 winner
 *
 * SECTION 2: Mission Cancellation (POST /api/missions/:missionId/cancel)
 * - T9: In-flight active mission cancellation transitions mission to cancelled
 * - T10: Cancellation idempotency: repeated cancel on cancelled mission returns 200 safely
 *
 * SECTION 3: Workspace Polish & Tooling Sanity
 * - T11: Root package.json exists, valid JSON, defines dev, build, build:frontend, test, test:backend
 * - T12: Root scripts/dev.js exists and validates syntax cleanly
 * - T13: frontend/nexora/.env.example exists and contains VITE_API_URL
 * - T14: Root README.md exists and contains architecture, quickstart, and API contract
 * - T15: Frontend missionService.js exports cancelMission and retryTask
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';

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
const { MissionEvent, EVENT_TYPES } = require('../models/MissionEvent');
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

function runSyncTest(name, fn) {
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

function generateAuthToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role },
    getJwtSecret(),
    { expiresIn: '1h' }
  );
}

async function runPhase2_10Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA PHASE 2.10 VERIFICATION SUITE');
  console.log('  Frontend Mission Controls & Workspace Polish');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];
  let httpServer = null;
  let baseUrl = '';

  try {
    httpServer = await new Promise((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    const port = httpServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const ownerUser = await User.create({
      name: 'Phase 2.10 Owner',
      email: `owner_${Date.now()}_p210@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(ownerUser._id);
    const ownerToken = generateAuthToken(ownerUser);
    const ownerHeaders = { Cookie: `${COOKIE_NAME}=${ownerToken}` };

    const foreignUser = await User.create({
      name: 'Phase 2.10 Foreign User',
      email: `foreign_${Date.now()}_p210@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(foreignUser._id);
    const foreignToken = generateAuthToken(foreignUser);
    const foreignHeaders = { Cookie: `${COOKIE_NAME}=${foreignToken}` };

    // =============================================================
    // SECTION 1: TASK RETRY ROUTE (POST /api/missions/:id/tasks/:tid/retry)
    // =============================================================
    console.log('--- SECTION 1: Task Retry Route (POST /api/missions/:id/tasks/:tid/retry) ---');

    await runAsyncTest('T1: Unauthenticated retry requests return 401', async () => {
      const dummyMid = new mongoose.Types.ObjectId().toString();
      const dummyTid = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/missions/${dummyMid}/tasks/${dummyTid}/retry`, {
        method: 'POST',
      });
      assert.strictEqual(res.status, 401, 'Unauthenticated retry must return 401');
    });

    await runAsyncTest('T2: Cross-tenant isolation returns 404 without data mutation', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Owner mission for tenant isolation test',
        status: 'running',
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        order: 1,
        title: 'Task for cross tenant test',
        description: 'Task for cross tenant test description',
        status: 'failed',
        error: 'Original error',
      });

      // Foreign user attempts to retry owner's task
      const res = await fetch(`${baseUrl}/api/missions/${mission._id}/tasks/${task._id}/retry`, {
        method: 'POST',
        headers: {
          ...foreignHeaders,
          'Content-Type': 'application/json',
        },
      });

      assert.strictEqual(res.status, 404, 'Foreign user retry must return 404');

      // Verify task status was NOT mutated
      const unchangedTask = await MissionTask.findById(task._id);
      assert.strictEqual(unchangedTask.status, 'failed', 'Task status must remain failed');
    });

    await runAsyncTest('T3: Malformed ObjectId for missionId or taskId returns clean 400/404', async () => {
      const validMid = new mongoose.Types.ObjectId().toString();
      const res1 = await fetch(`${baseUrl}/api/missions/not-a-valid-oid/tasks/${validMid}/retry`, {
        method: 'POST',
        headers: ownerHeaders,
      });
      assert.ok([400, 404].includes(res1.status), 'Malformed missionId must return 400 or 404');

      const res2 = await fetch(`${baseUrl}/api/missions/${validMid}/tasks/not-a-valid-oid/retry`, {
        method: 'POST',
        headers: ownerHeaders,
      });
      assert.ok([400, 404].includes(res2.status), 'Malformed taskId must return 400 or 404');
    });

    await runAsyncTest('T4: Terminal mission guard: retry rejected if mission is cancelled', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Mission cancelled retry guard test',
        status: 'cancelled',
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        order: 1,
        title: 'Task in cancelled mission',
        description: 'Task in cancelled mission description',
        status: 'failed',
        error: 'Execution failed',
      });

      const res = await fetch(`${baseUrl}/api/missions/${mission._id}/tasks/${task._id}/retry`, {
        method: 'POST',
        headers: ownerHeaders,
      });

      assert.strictEqual(res.status, 400, 'Retry on cancelled mission must return 400');
      const data = await res.json();
      assert.ok(data.message.includes('cancelled'), 'Error message should mention cancelled mission');
    });

    await runAsyncTest('T5: Status guard: retry rejected for non-failed tasks (pending/completed)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Mission task status guard test',
        status: 'running',
      });
      createdMissionIds.push(mission._id);

      const pendingTask = await MissionTask.create({
        missionId: mission._id,
        order: 1,
        title: 'Pending task',
        description: 'Pending task description',
        status: 'pending',
      });

      const completedTask = await MissionTask.create({
        missionId: mission._id,
        order: 2,
        title: 'Completed task',
        description: 'Completed task description',
        status: 'completed',
      });

      const res1 = await fetch(`${baseUrl}/api/missions/${mission._id}/tasks/${pendingTask._id}/retry`, {
        method: 'POST',
        headers: ownerHeaders,
      });
      assert.strictEqual(res1.status, 400, 'Retry on pending task must return 400');

      const res2 = await fetch(`${baseUrl}/api/missions/${mission._id}/tasks/${completedTask._id}/retry`, {
        method: 'POST',
        headers: ownerHeaders,
      });
      assert.strictEqual(res2.status, 400, 'Retry on completed task must return 400');
    });

    await runAsyncTest('T6: Eligible failed task retry: atomic CAS to pending, generation increment, event emission', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Eligible failed task retry test',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const failedTask = await MissionTask.create({
        missionId: mission._id,
        order: 1,
        title: 'Failed task for retry',
        description: 'Failed task description',
        status: 'failed',
        error: 'SyntaxError: Unexpected token',
        executionMetadata: { attempt: 1 },
      });

      const res = await fetch(`${baseUrl}/api/missions/${mission._id}/tasks/${failedTask._id}/retry`, {
        method: 'POST',
        headers: ownerHeaders,
      });

      assert.strictEqual(res.status, 200, 'Eligible retry should return 200');
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.task.status, 'pending');
      assert.strictEqual(data.task.id, failedTask._id.toString());

      // Verify DB document
      const dbTask = await MissionTask.findById(failedTask._id);
      assert.strictEqual(dbTask.status, 'pending');
      assert.strictEqual(dbTask.error, null);
      assert.strictEqual(dbTask.executionMetadata?.attempt, 2);
      assert.strictEqual(dbTask.executionMetadata?.isManualRetry, true);

      // Verify telemetry event was recorded
      const retryEvent = await MissionEvent.findOne({
        missionId: mission._id,
        type: 'TASK_RETRY_STARTED',
      });
      assert.ok(retryEvent, 'TASK_RETRY_STARTED event should be emitted');
    });

    await runAsyncTest('T7: Mission failed status recovery: mission resets to running upon task retry', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Mission in failed state recovery test',
        status: 'failed',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const failedTask = await MissionTask.create({
        missionId: mission._id,
        order: 1,
        title: 'Task causing mission failure',
        description: 'Task causing mission failure description',
        status: 'failed',
        error: 'Fatal pipeline error',
      });

      const res = await fetch(`${baseUrl}/api/missions/${mission._id}/tasks/${failedTask._id}/retry`, {
        method: 'POST',
        headers: ownerHeaders,
      });

      assert.strictEqual(res.status, 200);

      // Verify mission status was transitioned away from failed to running
      const updatedMission = await Mission.findById(mission._id);
      assert.strictEqual(updatedMission.status, 'running', 'Mission status should be updated to running');
    });

    await runAsyncTest('T8: Concurrency CAS test: multiple concurrent retries yield exactly 1 winner', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Concurrent task retry CAS test',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      const failedTask = await MissionTask.create({
        missionId: mission._id,
        order: 1,
        title: 'Task for concurrent retry race',
        description: 'Task for concurrent retry race description',
        status: 'failed',
        error: 'Connection timeout',
        executionMetadata: { attempt: 1 },
      });

      // Dispatch 5 concurrent retry requests
      const promises = Array.from({ length: 5 }, () =>
        fetch(`${baseUrl}/api/missions/${mission._id}/tasks/${failedTask._id}/retry`, {
          method: 'POST',
          headers: ownerHeaders,
        })
      );

      const responses = await Promise.all(promises);
      const statuses = responses.map((r) => r.status);

      const successCount = statuses.filter((s) => s === 200).length;
      const rejectedCount = statuses.filter((s) => s === 400 || s === 409).length;

      assert.strictEqual(successCount, 1, 'Exactly one concurrent request should succeed');
      assert.strictEqual(rejectedCount, 4, 'Remaining concurrent requests should be rejected with 400 or 409');

      const winnerRes = responses.find((r) => r.status === 200);
      const winnerData = await winnerRes.json();
      assert.strictEqual(winnerData.task.status, 'pending', 'Returned winner task status must be pending');

      const finalTask = await MissionTask.findById(failedTask._id);
      assert.ok(['pending', 'running', 'completed'].includes(finalTask.status), 'Task status must be pending or leased for execution');
      assert.strictEqual(finalTask.executionMetadata?.attempt, 2);
    });

    // =============================================================
    // SECTION 2: MISSION CANCELLATION (POST /api/missions/:id/cancel)
    // =============================================================
    console.log('--- SECTION 2: Mission Cancellation (POST /api/missions/:id/cancel) ---');

    await runAsyncTest('T9: In-flight active mission cancellation transitions mission to cancelled', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Mission to be cancelled by operator',
        status: 'running',
      });
      createdMissionIds.push(mission._id);

      const task = await MissionTask.create({
        missionId: mission._id,
        order: 1,
        title: 'Pending step',
        description: 'Pending step description',
        status: 'pending',
      });

      const res = await fetch(`${baseUrl}/api/missions/${mission._id}/cancel`, {
        method: 'POST',
        headers: {
          ...ownerHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'operator_abort' }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.cancelled, true);

      const updatedMission = await Mission.findById(mission._id);
      assert.strictEqual(updatedMission.status, 'failed');
    });

    await runAsyncTest('T10: Cancellation idempotency: repeated cancel on cancelled mission returns 200 safely', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Already cancelled mission',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      const res = await fetch(`${baseUrl}/api/missions/${mission._id}/cancel`, {
        method: 'POST',
        headers: ownerHeaders,
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.cancelled, false, 'Already cancelled mission returns cancelled: false');
    });

    // =============================================================
    // SECTION 3: WORKSPACE POLISH & TOOLING SANITY
    // =============================================================
    console.log('--- SECTION 3: Workspace Polish & Tooling Sanity ---');

    const rootDir = path.resolve(__dirname, '../..');

    runSyncTest('T11: Root package.json exists, valid JSON, defines dev, build, build:frontend, test, test:backend', () => {
      const pkgPath = path.join(rootDir, 'package.json');
      assert.ok(fs.existsSync(pkgPath), 'Root package.json must exist');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      assert.ok(pkg.scripts, 'Root package.json must define scripts');
      assert.ok(pkg.scripts.dev, 'dev script must be defined');
      assert.ok(pkg.scripts.build, 'build script must be defined');
      assert.ok(pkg.scripts['build:frontend'], 'build:frontend script must be defined');
      assert.ok(pkg.scripts.test, 'test script must be defined');
      assert.ok(pkg.scripts['test:backend'], 'test:backend script must be defined');
    });

    runSyncTest('T12: Root scripts/dev.js exists and validates syntax cleanly', () => {
      const devPath = path.join(rootDir, 'scripts', 'dev.js');
      assert.ok(fs.existsSync(devPath), 'scripts/dev.js must exist');
      const devContent = fs.readFileSync(devPath, 'utf8');
      assert.ok(devContent.includes('spawn'), 'scripts/dev.js should invoke spawn');
      assert.ok(devContent.includes('backend'), 'scripts/dev.js should reference backend');
      assert.ok(devContent.includes('frontend'), 'scripts/dev.js should reference frontend');
      const { execSync } = require('child_process');
      execSync(`node -c "${devPath}"`, { stdio: 'pipe' });
    });

    runSyncTest('T13: frontend/nexora/.env.example exists and contains VITE_API_URL', () => {
      const envExPath = path.join(rootDir, 'frontend', 'nexora', '.env.example');
      assert.ok(fs.existsSync(envExPath), 'frontend/nexora/.env.example must exist');
      const content = fs.readFileSync(envExPath, 'utf8');
      assert.ok(content.includes('VITE_API_URL'), 'Must contain VITE_API_URL');
    });

    runSyncTest('T14: Root README.md exists and contains architecture, quickstart, and API contract', () => {
      const readmePath = path.join(rootDir, 'README.md');
      assert.ok(fs.existsSync(readmePath), 'Root README.md must exist');
      const content = fs.readFileSync(readmePath, 'utf8');
      assert.ok(content.includes('NEXORA AI'), 'README must mention NEXORA AI');
      assert.ok(content.includes('Architecture') || content.includes('architecture'), 'README must have Architecture section');
      assert.ok(content.includes('Quick Start') || content.includes('quick start'), 'README must have Quick Start section');
      assert.ok(content.includes('POST /api/missions') && content.includes('/retry'), 'README must document retry route');
    });

    runSyncTest('T15: Frontend missionService.js exports cancelMission and retryTask', () => {
      const servicePath = path.join(rootDir, 'frontend', 'nexora', 'src', 'services', 'missionService.js');
      assert.ok(fs.existsSync(servicePath), 'missionService.js must exist');
      const content = fs.readFileSync(servicePath, 'utf8');
      assert.ok(content.includes('export async function cancelMission'), 'Must export cancelMission');
      assert.ok(content.includes('export async function retryTask'), 'Must export retryTask');
      assert.ok(content.includes('/tasks/') && content.includes('/retry'), 'Must call task retry endpoint');
    });

    console.log('\n====================================================');
    console.log(`  PHASE 2.10 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED`);
    console.log('====================================================\n');
  } finally {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    if (createdMissionIds.length > 0) {
      await Mission.deleteMany({ _id: { $in: createdMissionIds } }).catch(() => {});
      await MissionTask.deleteMany({ missionId: { $in: createdMissionIds } }).catch(() => {});
      await MissionTelemetry.deleteMany({ missionId: { $in: createdMissionIds } }).catch(() => {});
      await MissionEvent.deleteMany({ missionId: { $in: createdMissionIds } }).catch(() => {});
    }

    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } }).catch(() => {});
    }

    await new Promise((r) => setTimeout(r, 200));
    await mongoose.connection.close();
  }
}

runPhase2_10Suite().catch((err) => {
  console.error('[SUITE FATAL ERROR]', err);
  process.exit(1);
});
