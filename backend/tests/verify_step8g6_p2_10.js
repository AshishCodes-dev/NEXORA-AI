/**
 * NEXORA 8G.6.7 - PHASE 2.8 VERIFICATION SUITE
 * Mission API & End-to-End Reliability
 *
 * Verifies:
 * SECTION 1: Authentication & Authorization Security Across All Routes
 * - T1: Unauthenticated Requests to All 12 Mission Endpoints Return 401
 * - T2: Cross-Tenant Isolation & Anti-Enumeration (404 on Foreign Read & Mutate, Zero Mutation)
 * - T3: Tenant List Isolation (GET /api/missions Scoped Exclusively to req.user.id)
 *
 * SECTION 2: Input Validation, Schema Bounds & Anti-Tampering
 * - T4: Objective Input Validation on POST /api/missions (Missing, Non-String, Empty, Bounds)
 * - T5: Malformed ObjectId Safety Across All Parameterized Routes (Clean 404, No 500)
 * - T6: Identity & Status Anti-Tampering on Creation (Ignores Injected userId and status)
 *
 * SECTION 3: End-to-End Mission Creation & Execution Lifecycles
 * - T7: Happy Path End-to-End Creation & Async Execution (POST /api/missions)
 * - T8: Synchronous Execution via HTTP (POST /api/missions/:id/execute?sync=true)
 * - T9: Asynchronous Execution via HTTP (POST /api/missions/:id/execute returns 202)
 *
 * SECTION 4: Cancellation, Concurrency & Idempotency
 * - T10: In-Flight Mission Cancellation via HTTP (POST /api/missions/:id/cancel)
 * - T11: Cancellation Idempotency (Repeated Cancel on Terminal Returns 200, Zero Dup Events)
 * - T12: Execution Terminal Guard (Execute Completed -> 200; Execute Failed -> 400)
 * - T13: Concurrent Execute Requests (Single-Winner CAS, Zero Task Duplication)
 *
 * SECTION 5: Sub-Resource Contracts & Error Sanitization
 * - T14: Complete Sub-Resource Contracts Verification (/state, /result, /telemetry, /metrics, /events, /graph)
 * - T15: Error Response Sanitization (No Internal Stack Traces Leaked)
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

function generateAuthToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role },
    getJwtSecret(),
    { expiresIn: '1h' }
  );
}

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

async function runPhase2_8Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.6.7 - PHASE 2.8 VERIFICATION SUITE');
  console.log('  Mission API & End-to-End Reliability');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];
  let httpServer = null;
  let baseUrl = '';

  try {
    // Start temporary HTTP server on ephemeral port
    httpServer = await new Promise((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    const port = httpServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Create test users
    const ownerUser = await User.create({
      name: 'Phase 2.8 Owner',
      email: `owner_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(ownerUser._id);
    const ownerToken = generateAuthToken(ownerUser);

    const foreignUser = await User.create({
      name: 'Phase 2.8 Foreign User',
      email: `foreign_${Date.now()}@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(foreignUser._id);
    const foreignToken = generateAuthToken(foreignUser);

    // =============================================================
    // SECTION 1: AUTHENTICATION & AUTHORIZATION SECURITY
    // =============================================================
    console.log('--- SECTION 1: Authentication & Authorization Security Across All Routes ---');

    await runAsyncTest('T1: Unauthenticated Requests to All 12 Mission Endpoints Return 401', async () => {
      const dummyId = new mongoose.Types.ObjectId().toString();
      const endpoints = [
        { method: 'POST', path: '/api/missions', body: { objective: 'Test unauth' } },
        { method: 'GET', path: '/api/missions' },
        { method: 'GET', path: `/api/missions/${dummyId}` },
        { method: 'POST', path: `/api/missions/${dummyId}/cancel`, body: {} },
        { method: 'POST', path: `/api/missions/${dummyId}/execute` },
        { method: 'GET', path: `/api/missions/${dummyId}/result` },
        { method: 'GET', path: `/api/missions/${dummyId}/telemetry` },
        { method: 'GET', path: `/api/missions/${dummyId}/metrics` },
        { method: 'GET', path: `/api/missions/${dummyId}/state` },
        { method: 'GET', path: `/api/missions/${dummyId}/events` },
        { method: 'GET', path: `/api/missions/${dummyId}/memory` },
        { method: 'GET', path: `/api/missions/${dummyId}/graph` },
      ];

      for (const ep of endpoints) {
        const opts = { method: ep.method };
        if (ep.body) {
          opts.headers = { 'Content-Type': 'application/json' };
          opts.body = JSON.stringify(ep.body);
        }
        const res = await fetch(`${baseUrl}${ep.path}`, opts);
        assert.strictEqual(
          res.status,
          401,
          `Expected 401 for unauthenticated ${ep.method} ${ep.path}, got ${res.status}`
        );
        const json = await res.json();
        assert.strictEqual(json.success, false);
        assert.strictEqual(json.message, 'Authentication required');
      }

      // Also verify invalid JWT cookie returns 401
      const badCookieRes = await fetch(`${baseUrl}/api/missions`, {
        headers: { Cookie: `${COOKIE_NAME}=invalid.jwt.token` },
      });
      assert.strictEqual(badCookieRes.status, 401, 'Invalid token must return 401');
    });

    await runAsyncTest('T2: Cross-Tenant Isolation & Anti-Enumeration (404 on Foreign Read & Mutate, Zero Mutation)', async () => {
      const ownerMission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Private owner mission for cross-tenant testing',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(ownerMission._id);

      await MissionTask.create({
        missionId: ownerMission._id,
        order: 1,
        title: 'Private Owner Task',
        description: 'Sensitive work',
        status: 'pending',
        agentId: 'analyst',
      });

      const foreignHeaders = { Cookie: `${COOKIE_NAME}=${foreignToken}` };

      // Read endpoints attempted by Foreign User -> must return 404 (anti-enumeration)
      const readPaths = [
        `/api/missions/${ownerMission._id}`,
        `/api/missions/${ownerMission._id}/result`,
        `/api/missions/${ownerMission._id}/telemetry`,
        `/api/missions/${ownerMission._id}/metrics`,
        `/api/missions/${ownerMission._id}/state`,
        `/api/missions/${ownerMission._id}/events`,
        `/api/missions/${ownerMission._id}/memory`,
        `/api/missions/${ownerMission._id}/graph`,
      ];

      for (const p of readPaths) {
        const res = await fetch(`${baseUrl}${p}`, { headers: foreignHeaders });
        assert.strictEqual(
          res.status,
          404,
          `Foreign user accessing ${p} must return 404, received ${res.status}`
        );
        const json = await res.json();
        assert.strictEqual(json.success, false);
        assert.strictEqual(json.error, 'Mission not found');
      }

      // Mutate endpoints attempted by Foreign User -> must return 404 and cause ZERO mutation
      const cancelRes = await fetch(`${baseUrl}/api/missions/${ownerMission._id}/cancel`, {
        method: 'POST',
        headers: foreignHeaders,
      });
      assert.strictEqual(cancelRes.status, 404, 'Foreign cancel attempt must return 404');

      const executeRes = await fetch(`${baseUrl}/api/missions/${ownerMission._id}/execute`, {
        method: 'POST',
        headers: foreignHeaders,
      });
      assert.strictEqual(executeRes.status, 404, 'Foreign execute attempt must return 404');

      // Verify ZERO mutation occurred on ownerMission
      const freshMission = await Mission.findById(ownerMission._id);
      assert.strictEqual(freshMission.status, 'running', 'Owner mission status must remain untouched');
    });

    await runAsyncTest('T3: Tenant List Isolation (GET /api/missions Scoped Exclusively to req.user.id)', async () => {
      // Create distinct missions for Owner and Foreign
      const mOwner = await Mission.create({
        userId: ownerUser._id,
        objective: 'Owner distinct list mission',
        status: 'planning',
      });
      createdMissionIds.push(mOwner._id);

      const mForeign = await Mission.create({
        userId: foreignUser._id,
        objective: 'Foreign distinct list mission',
        status: 'planning',
      });
      createdMissionIds.push(mForeign._id);

      // Owner requests list
      const ownerListRes = await fetch(`${baseUrl}/api/missions?userId=${foreignUser._id}`, {
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(ownerListRes.status, 200);
      const ownerList = await ownerListRes.json();
      assert.strictEqual(ownerList.success, true);
      const ownerMissionIds = ownerList.missions.map((m) => m.id);
      assert.ok(ownerMissionIds.includes(mOwner._id.toString()), 'Owner must see their mission');
      assert.ok(!ownerMissionIds.includes(mForeign._id.toString()), 'Owner must NOT see foreign mission');

      // Foreign requests list
      const foreignListRes = await fetch(`${baseUrl}/api/missions`, {
        headers: { Cookie: `${COOKIE_NAME}=${foreignToken}` },
      });
      assert.strictEqual(foreignListRes.status, 200);
      const foreignList = await foreignListRes.json();
      assert.strictEqual(foreignList.success, true);
      const foreignMissionIds = foreignList.missions.map((m) => m.id);
      assert.ok(foreignMissionIds.includes(mForeign._id.toString()), 'Foreign must see their mission');
      assert.ok(!foreignMissionIds.includes(mOwner._id.toString()), 'Foreign must NOT see owner mission');
    });

    // =============================================================
    // SECTION 2: INPUT VALIDATION, SCHEMA BOUNDS & ANTI-TAMPERING
    // =============================================================
    console.log('\n--- SECTION 2: Input Validation, Schema Bounds & Anti-Tampering ---');

    await runAsyncTest('T4: Objective Input Validation on POST /api/missions (Missing, Non-String, Empty, Bounds)', async () => {
      const ownerHeaders = {
        Cookie: `${COOKIE_NAME}=${ownerToken}`,
        'Content-Type': 'application/json',
      };

      // 1. Missing objective
      const rMissing = await fetch(`${baseUrl}/api/missions`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({}),
      });
      assert.strictEqual(rMissing.status, 400);
      const jMissing = await rMissing.json();
      assert.strictEqual(jMissing.success, false);
      assert.ok(jMissing.error.includes('required and must be a string'));

      // 2. Non-string objective (number)
      const rNum = await fetch(`${baseUrl}/api/missions`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ objective: 12345 }),
      });
      assert.strictEqual(rNum.status, 400);

      // 3. Empty string objective
      const rEmpty = await fetch(`${baseUrl}/api/missions`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ objective: '   ' }),
      });
      assert.strictEqual(rEmpty.status, 400);
      const jEmpty = await rEmpty.json();
      assert.ok(jEmpty.error.includes('cannot be empty'));

      // 4. Too short (< 3 chars)
      const rShort = await fetch(`${baseUrl}/api/missions`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ objective: 'ab' }),
      });
      assert.strictEqual(rShort.status, 400);
      const jShort = await rShort.json();
      assert.ok(jShort.error.includes('at least 3 characters'));

      // 5. Too long (> 2000 chars)
      const hugeStr = 'A'.repeat(2001);
      const rLong = await fetch(`${baseUrl}/api/missions`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ objective: hugeStr }),
      });
      assert.strictEqual(rLong.status, 400);
      const jLong = await rLong.json();
      assert.ok(jLong.error.includes('exceeds maximum allowed length'));
    });

    await runAsyncTest('T5: Malformed ObjectId Safety Across All Parameterized Routes (Clean 404, No 500)', async () => {
      const ownerHeaders = { Cookie: `${COOKIE_NAME}=${ownerToken}` };
      const invalidIds = ['invalid-id', '123', 'undefined', 'null', '6490c659-2bf2-47dc'];

      for (const badId of invalidIds) {
        const endpoints = [
          { method: 'GET', path: `/api/missions/${badId}` },
          { method: 'POST', path: `/api/missions/${badId}/cancel` },
          { method: 'POST', path: `/api/missions/${badId}/execute` },
          { method: 'GET', path: `/api/missions/${badId}/result` },
          { method: 'GET', path: `/api/missions/${badId}/telemetry` },
          { method: 'GET', path: `/api/missions/${badId}/metrics` },
          { method: 'GET', path: `/api/missions/${badId}/state` },
          { method: 'GET', path: `/api/missions/${badId}/events` },
          { method: 'GET', path: `/api/missions/${badId}/memory` },
          { method: 'GET', path: `/api/missions/${badId}/graph` },
        ];

        for (const ep of endpoints) {
          const res = await fetch(`${baseUrl}${ep.path}`, {
            method: ep.method,
            headers: ownerHeaders,
          });
          assert.strictEqual(
            res.status,
            404,
            `Expected 404 for malformed ID '${badId}' on ${ep.method} ${ep.path}, got ${res.status}`
          );
          const json = await res.json();
          assert.strictEqual(json.success, false);
          assert.strictEqual(json.error, 'Mission not found');
        }
      }
    });

    await runAsyncTest('T6: Identity & Status Anti-Tampering on Creation (Ignores Injected userId and status)', async () => {
      const ownerHeaders = {
        Cookie: `${COOKIE_NAME}=${ownerToken}`,
        'Content-Type': 'application/json',
      };

      const res = await fetch(`${baseUrl}/api/missions`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          objective: 'Test anti-tampering parameters on mission create',
          userId: foreignUser._id.toString(),
          status: 'completed',
        }),
      });

      assert.strictEqual(res.status, 201);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      createdMissionIds.push(json.mission.id);

      // Verify mission was created with owner's ID and initial status 'planning'
      assert.strictEqual(json.mission.userId, ownerUser._id.toString(), 'userId must equal req.user.id');
      assert.strictEqual(json.mission.status, 'planning', 'status must initially be planning');

      // Verify persisted MongoDB state matches
      const persisted = await Mission.findById(json.mission.id);
      assert.strictEqual(persisted.userId.toString(), ownerUser._id.toString());
    });

    // =============================================================
    // SECTION 3: END-TO-END CREATION & EXECUTION LIFECYCLES
    // =============================================================
    console.log('\n--- SECTION 3: End-to-End Mission Creation & Execution Lifecycles ---');

    await runAsyncTest('T7: Happy Path End-to-End Creation & Async Execution (POST /api/missions)', async () => {
      const ownerHeaders = {
        Cookie: `${COOKIE_NAME}=${ownerToken}`,
        'Content-Type': 'application/json',
      };

      const createRes = await fetch(`${baseUrl}/api/missions`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          objective: 'Research state machine transitions in distributed workflows',
        }),
      });

      assert.strictEqual(createRes.status, 201, 'POST /api/missions must return 201');
      const createBody = await createRes.json();
      assert.strictEqual(createBody.success, true);
      assert.ok(createBody.mission.id);
      assert.strictEqual(createBody.mission.status, 'planning');
      assert.ok(Array.isArray(createBody.tasks));
      assert.ok(createBody.tasks.length > 0, 'Initial execution plan tasks must be returned');

      const missionId = createBody.mission.id;
      createdMissionIds.push(missionId);

      // Wait for background asynchronous execution to be dispatched (planning -> running or completed)
      let isDispatched = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const current = await Mission.findById(missionId);
        if (current && (current.status === 'running' || current.status === 'completed')) {
          isDispatched = true;
          break;
        }
      }
      assert.strictEqual(isDispatched, true, 'Background async execution must be dispatched (status running/completed)');

      // Verify lifecycle events recorded for the created mission
      const eventsRes = await fetch(`${baseUrl}/api/missions/${missionId}/events`, {
        headers: ownerHeaders,
      });
      assert.strictEqual(eventsRes.status, 200);
      const eventsBody = await eventsRes.json();
      assert.strictEqual(eventsBody.success, true);
      const types = eventsBody.events.map((e) => e.type);
      assert.ok(types.includes('MISSION_CREATED'), 'MISSION_CREATED event must be recorded');
      assert.ok(types.includes('MISSION_PLANNING_STARTED'), 'MISSION_PLANNING_STARTED event must be recorded');
    });

    await runAsyncTest('T8: Synchronous Execution via HTTP (POST /api/missions/:id/execute?sync=true)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Evaluate synchronous mission execution HTTP pipeline',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 3);

      const syncRes = await fetch(`${baseUrl}/api/missions/${mission._id}/execute?sync=true`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });

      assert.strictEqual(syncRes.status, 200, 'Sync execution should return 200');
      const syncBody = await syncRes.json();
      assert.strictEqual(syncBody.success, true);
      assert.strictEqual(syncBody.message, 'Mission execution completed');
      assert.strictEqual(syncBody.status, 'completed');
      assert.strictEqual(syncBody.mission.status, 'completed');

      // Verify DB state
      const dbMission = await Mission.findById(mission._id);
      assert.strictEqual(dbMission.status, 'completed');
      const dbTasks = await MissionTask.find({ missionId: mission._id });
      assert.strictEqual(dbTasks.filter((t) => t.status === 'completed').length, 3);
    });

    await runAsyncTest('T9: Asynchronous Execution via HTTP (POST /api/missions/:id/execute returns 202)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Evaluate asynchronous dispatch HTTP endpoint',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 2);

      const asyncRes = await fetch(`${baseUrl}/api/missions/${mission._id}/execute`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });

      assert.strictEqual(asyncRes.status, 202, 'Async execution dispatch must return 202');
      const asyncBody = await asyncRes.json();
      assert.strictEqual(asyncBody.success, true);
      assert.strictEqual(asyncBody.message, 'Mission execution dispatched');
      assert.strictEqual(asyncBody.status, 'running');

      // Await background execution completion
      let completed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const current = await Mission.findById(mission._id);
        if (current?.status === 'completed') {
          completed = true;
          break;
        }
      }
      assert.strictEqual(completed, true, 'Async execution should complete in background');
    });

    // =============================================================
    // SECTION 4: CANCELLATION, CONCURRENCY & IDEMPOTENCY
    // =============================================================
    console.log('\n--- SECTION 4: Cancellation, Concurrency & Idempotency ---');

    await runAsyncTest('T10: In-Flight Mission Cancellation via HTTP (POST /api/missions/:id/cancel)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Test in-flight cancellation via HTTP',
        status: 'running',
        deadlineAt: new Date(Date.now() + 60000),
      });
      createdMissionIds.push(mission._id);

      await MissionTask.create([
        {
          missionId: mission._id,
          order: 1,
          title: 'Running Task',
          description: 'Executing',
          status: 'running',
          agentId: 'analyst',
        },
        {
          missionId: mission._id,
          order: 2,
          title: 'Pending Task',
          description: 'Queued',
          status: 'pending',
          agentId: 'analyst',
        },
      ]);

      const cancelRes = await fetch(`${baseUrl}/api/missions/${mission._id}/cancel`, {
        method: 'POST',
        headers: {
          Cookie: `${COOKIE_NAME}=${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'User requested abort during audit' }),
      });

      assert.strictEqual(cancelRes.status, 200);
      const cancelBody = await cancelRes.json();
      assert.strictEqual(cancelBody.success, true);
      assert.strictEqual(cancelBody.cancelled, true);
      assert.strictEqual(cancelBody.mission.status, 'failed');

      // Verify remaining pending task was reconciled to failed
      const pendingTask = await MissionTask.findOne({ missionId: mission._id, order: 2 });
      assert.strictEqual(pendingTask.status, 'failed');
      assert.ok(pendingTask.error.includes('User requested abort during audit'));
    });

    await runAsyncTest('T11: Cancellation Idempotency (Repeated Cancel on Terminal Returns 200, Zero Dup Events)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Test repeated cancellation idempotency',
        status: 'failed',
      });
      createdMissionIds.push(mission._id);

      const initialEventCount = await MissionEvent.countDocuments({ missionId: mission._id });

      // First repeat cancel
      const res1 = await fetch(`${baseUrl}/api/missions/${mission._id}/cancel`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(res1.status, 200);
      const body1 = await res1.json();
      assert.strictEqual(body1.success, true);
      assert.strictEqual(body1.cancelled, false);
      assert.strictEqual(body1.message, 'Mission is already terminal');

      // Second repeat cancel
      const res2 = await fetch(`${baseUrl}/api/missions/${mission._id}/cancel`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.cancelled, false);

      // Verify zero duplicate terminal events emitted
      const finalEventCount = await MissionEvent.countDocuments({ missionId: mission._id });
      assert.strictEqual(finalEventCount, initialEventCount, 'No duplicate events should be recorded');
    });

    await runAsyncTest('T12: Execution Terminal Guard (Execute Completed -> 200; Execute Failed -> 400)', async () => {
      // 1. Completed mission
      const completedMission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Test completed execution guard',
        status: 'completed',
      });
      createdMissionIds.push(completedMission._id);

      const cRes = await fetch(`${baseUrl}/api/missions/${completedMission._id}/execute`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(cRes.status, 200);
      const cBody = await cRes.json();
      assert.strictEqual(cBody.success, true);
      assert.strictEqual(cBody.message, 'Mission already completed');
      assert.strictEqual(cBody.status, 'completed');

      // 2. Failed mission
      const failedMission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Test failed execution guard',
        status: 'failed',
      });
      createdMissionIds.push(failedMission._id);

      const fRes = await fetch(`${baseUrl}/api/missions/${failedMission._id}/execute`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(fRes.status, 400);
      const fBody = await fRes.json();
      assert.strictEqual(fBody.success, false);
      assert.ok(fBody.error.includes('Cannot execute a failed mission'));
      assert.strictEqual(fBody.status, 'failed');
    });

    await runAsyncTest('T13: Concurrent Execute Requests (Single-Winner CAS, Zero Task Duplication)', async () => {
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Concurrent HTTP execute race test',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 3);

      // Launch 2 concurrent async execute calls via HTTP simultaneously
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/missions/${mission._id}/execute`, {
          method: 'POST',
          headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
        }),
        fetch(`${baseUrl}/api/missions/${mission._id}/execute`, {
          method: 'POST',
          headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
        }),
      ]);

      assert.strictEqual(res1.status, 202);
      assert.strictEqual(res2.status, 202);

      // Wait for execution to conclude
      let completed = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const current = await Mission.findById(mission._id);
        if (current?.status === 'completed') {
          completed = true;
          break;
        }
      }
      assert.strictEqual(completed, true, 'Mission should reach completed state cleanly');

      // Verify every task was executed exactly once (attempt = 1)
      const tasks = await MissionTask.find({ missionId: mission._id }).sort({ order: 1 });
      for (const t of tasks) {
        assert.strictEqual(t.status, 'completed');
        const attempt = t.executionMetadata?.attempt || 1;
        assert.strictEqual(attempt, 1, `Task order ${t.order} should have exactly 1 attempt`);
      }
    });

    // =============================================================
    // SECTION 5: SUB-RESOURCE CONTRACTS & ERROR SANITIZATION
    // =============================================================
    console.log('\n--- SECTION 5: Sub-Resource Contracts & Error Sanitization ---');

    await runAsyncTest('T14: Complete Sub-Resource Contracts Verification (/state, /result, /telemetry, /metrics, /events, /graph)', async () => {
      // Create and synchronously complete a full mission
      const mission = await Mission.create({
        userId: ownerUser._id,
        objective: 'Comprehensive sub-resource verification mission',
        status: 'planning',
      });
      createdMissionIds.push(mission._id);

      await createDeterministicTasks(mission._id, 4);

      // Execute synchronously
      const execRes = await fetch(`${baseUrl}/api/missions/${mission._id}/execute?sync=true`, {
        method: 'POST',
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(execRes.status, 200);

      const ownerHeaders = { Cookie: `${COOKIE_NAME}=${ownerToken}` };

      // 1. GET /api/missions/:id/state
      const stateRes = await fetch(`${baseUrl}/api/missions/${mission._id}/state`, { headers: ownerHeaders });
      assert.strictEqual(stateRes.status, 200);
      const stateBody = await stateRes.json();
      assert.strictEqual(stateBody.success, true);
      assert.strictEqual(stateBody.missionId, mission._id.toString());
      assert.strictEqual(stateBody.stage, 'completed');
      assert.strictEqual(stateBody.state, 'completed');
      assert.strictEqual(stateBody.progress.percentage, 100);
      assert.strictEqual(stateBody.activeTask, null);

      // 2. GET /api/missions/:id/result
      const resultRes = await fetch(`${baseUrl}/api/missions/${mission._id}/result`, { headers: ownerHeaders });
      assert.strictEqual(resultRes.status, 200);
      const resultBody = await resultRes.json();
      assert.strictEqual(resultBody.success, true);
      assert.ok(resultBody.mission);
      assert.strictEqual(resultBody.mission.id, mission._id.toString());
      assert.ok(Array.isArray(resultBody.tasks));
      assert.strictEqual(resultBody.tasks.length, 4);

      // 3. GET /api/missions/:id/telemetry
      const teleRes = await fetch(`${baseUrl}/api/missions/${mission._id}/telemetry`, { headers: ownerHeaders });
      assert.strictEqual(teleRes.status, 200);
      const teleBody = await teleRes.json();
      assert.strictEqual(teleBody.success, true);
      assert.ok(teleBody.telemetry);
      assert.strictEqual(teleBody.telemetry.missionId, mission._id.toString());
      assert.strictEqual(teleBody.telemetry.status, 'completed');

      // 4. GET /api/missions/:id/metrics
      const metricRes = await fetch(`${baseUrl}/api/missions/${mission._id}/metrics`, { headers: ownerHeaders });
      assert.strictEqual(metricRes.status, 200);
      const metricBody = await metricRes.json();
      assert.strictEqual(metricBody.success, true);
      assert.ok(metricBody.metrics);

      // 5. GET /api/missions/:id/events
      const eventRes = await fetch(`${baseUrl}/api/missions/${mission._id}/events`, { headers: ownerHeaders });
      assert.strictEqual(eventRes.status, 200);
      const eventBody = await eventRes.json();
      assert.strictEqual(eventBody.success, true);
      assert.ok(Array.isArray(eventBody.events));
      assert.ok(eventBody.events.length > 0);

      // 6. GET /api/missions/:id/memory
      const memRes = await fetch(`${baseUrl}/api/missions/${mission._id}/memory`, { headers: ownerHeaders });
      assert.strictEqual(memRes.status, 200);
      const memBody = await memRes.json();
      assert.strictEqual(memBody.success, true);
      assert.ok(Array.isArray(memBody.memories));

      // 7. GET /api/missions/:id/graph
      const graphRes = await fetch(`${baseUrl}/api/missions/${mission._id}/graph`, { headers: ownerHeaders });
      const graphBody = await graphRes.json();
      assert.strictEqual(graphBody.success, true);
      assert.ok(Array.isArray(graphBody.nodes));
      assert.ok(Array.isArray(graphBody.edges));
      assert.ok(graphBody.summary);
    });

    await runAsyncTest('T15: Error Response Sanitization (No Internal Stack Traces Leaked)', async () => {
      // 1. Non-existent route (global and authenticated sub-route)
      const badGlobalRoute = await fetch(`${baseUrl}/api/unknown/sub/path`);
      assert.strictEqual(badGlobalRoute.status, 404);
      const badGlobalJson = await badGlobalRoute.json();
      assert.strictEqual(badGlobalJson.success, false);
      assert.strictEqual(badGlobalJson.code, 'ROUTE_NOT_FOUND');
      assert.strictEqual(badGlobalJson.stack, undefined, 'Production/test 404 must not expose stack traces');

      const badSubRoute = await fetch(`${baseUrl}/api/missions/unknown/sub/path`, {
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(badSubRoute.status, 404);
      const badSubJson = await badSubRoute.json();
      assert.strictEqual(badSubJson.success, false);
      assert.strictEqual(badSubJson.code, 'ROUTE_NOT_FOUND');
      assert.strictEqual(badSubJson.stack, undefined);

      // 2. Mission detail endpoint response format
      const detailRes = await fetch(`${baseUrl}/api/missions/${new mongoose.Types.ObjectId()}`, {
        headers: { Cookie: `${COOKIE_NAME}=${ownerToken}` },
      });
      assert.strictEqual(detailRes.status, 404);
      const detailJson = await detailRes.json();
      assert.strictEqual(detailJson.success, false);
      assert.strictEqual(detailJson.error, 'Mission not found');
      assert.strictEqual(detailJson.stack, undefined, '404 error must not leak stack');
    });

    console.log('\n====================================================');
    console.log(`  PHASE 2.8 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED`);
    console.log('====================================================\n');
  } finally {
    // Teardown: close server
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    // Teardown: abort active workers for created missions
    try {
      const { abortMissionWorkers } = require('../orchestrator/taskExecutor');
      for (const mId of createdMissionIds) {
        await abortMissionWorkers(mId, { timeoutMs: 500 }).catch(() => {});
      }
    } catch {}

    // Teardown: clean up test documents
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

runPhase2_8Suite().catch((err) => {
  console.error('[SUITE FATAL ERROR]', err);
  process.exit(1);
});
