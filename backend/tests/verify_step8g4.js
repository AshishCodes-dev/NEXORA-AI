/**
 * verify_step8g4.js
 * NEXORA 8G.4 — Mission Memory Foundation Verification Suite
 *
 * Verifies:
 *  1. Model validation, bounds, and schema integrity
 *  2. Sanitization & credential redaction
 *  3. Multi-tenant isolation & cross-user protection
 *  4. Evidence provenance & dangling reference rejection
 *  5. 50-record quota bounding & safe eviction under concurrency
 *  6. Task attempt provenance & stale attempt supersession
 *  7. Fatal task failure memory invalidation
 *  8. Relevance scoring & deterministic query ranking
 *  9. Advisory context assembly & prompt-injection safety
 *  10. Architectural invariance (memory cannot alter /state or /result)
 *  11. Live pipeline execution & route endpoint verification
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const Evidence = require('../models/Evidence');
const {
  MissionMemory,
  MEMORY_CONFIG,
  MEMORY_TYPES,
  MEMORY_STATUSES,
  sanitizeMemoryString,
  sanitizeMemoryMetadata,
} = require('../models/MissionMemory');
const {
  recordMemory,
  queryMemories,
  pruneMissionMemories,
  supersedePriorTaskAttempts,
  invalidateTaskMemories,
  assembleTaskContext,
  getMissionMemories,
} = require('../services/missionMemoryService');
const { getMissionState } = require('../services/missionStateService');
const { getMissionResult } = require('../services/missionResultService');
const { createMissionExecutionPlan, executeMission } = require('../orchestrator/missionOrchestrator');

let passed = 0;
let failed = 0;
const results = [];

function assert(label, condition, detail = '') {
  if (condition) {
    passed++;
    results.push(`  [PASS] ${label}`);
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    const msg = `  [FAIL] ${label}${detail ? ' — ' + detail : ''}`;
    results.push(msg);
    console.log(msg);
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
  } catch (err) {
    assert(name, false, err.message);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('  STARTING NEXORA 8G.4 VERIFICATION SUITE');
  console.log('  Mission Memory Foundation');
  console.log('='.repeat(60));

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1/nexora');
  console.log('\n[DATABASE] Connected to MongoDB');

  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();

  try {
    // -------------------------------------------------------------
    // SECTION 1: MODEL VALIDATION, BOUNDS & SANITIZATION
    // -------------------------------------------------------------
    console.log('\n--- Section 1: Model Validation, Bounds & Sanitization ---');

    await runAsyncTest('1. Sanitization redacts Bearer tokens and API keys', async () => {
      const dirty = 'Here is the key AIzaSyABC1234567890 and Bearer eyJhbGciOiJIUzI1NiJ9.test and pass password=secret';
      const clean = sanitizeMemoryString(dirty, 300);
      assert('Bearer token redacted', !clean.includes('eyJhbGciOiJIUzI1NiJ9'));
      assert('API key redacted', !clean.includes('AIzaSyABC1234567890'));
      assert('Password redacted', !clean.includes('secret'));
    });

    await runAsyncTest('2. Content bounds enforced by string sanitizer', async () => {
      const huge = 'A'.repeat(2000);
      const bounded = sanitizeMemoryString(huge, MEMORY_CONFIG.MAX_CONTENT_LENGTH);
      assert('Truncated to max content length', bounded.length <= MEMORY_CONFIG.MAX_CONTENT_LENGTH);
      assert('Contains truncation indicator', bounded.includes('[truncated]'));
    });

    await runAsyncTest('3. Metadata sanitizer enforces allowlist and prototype safety', async () => {
      const meta = {
        safeField: 'valid string',
        numField: 42,
        boolField: true,
        secretField: 'should-be-omitted',
        passwordField: 'should-be-omitted',
        __proto__: { polluted: true },
      };
      const cleanMeta = sanitizeMemoryMetadata(meta);
      assert('Safe fields kept', cleanMeta.safeField === 'valid string' && cleanMeta.numField === 42 && cleanMeta.boolField === true);
      assert('Sensitive fields omitted', cleanMeta.secretField === undefined && cleanMeta.passwordField === undefined);
      assert('Prototype not polluted', ({}).polluted === undefined);
      assert('__proto__ is not an own property', !Object.prototype.hasOwnProperty.call(cleanMeta, '__proto__'));
    });

    await runAsyncTest('3b. Benign keys survive sanitizeMemoryMetadata', async () => {
      const benignMeta = {
        keyA: 'valueA',
        keyboard: 'mechanical',
        author: 'NEXORA Auditor',
        authMethod: 'oauth2',
        tokenCount: 1500,
        statusKey: 'active',
      };
      const clean = sanitizeMemoryMetadata(benignMeta);
      assert('keyA survived', clean.keyA === 'valueA');
      assert('keyboard survived', clean.keyboard === 'mechanical');
      assert('author survived', clean.author === 'NEXORA Auditor');
      assert('authMethod survived', clean.authMethod === 'oauth2');
      assert('tokenCount survived', clean.tokenCount === 1500);
      assert('statusKey survived', clean.statusKey === 'active');
    });

    await runAsyncTest('3c. Sensitive key variants and case variations blocked', async () => {
      const sensitiveMeta = {
        password: 'p1',
        PASSWORD: 'p2',
        apiKey: 'k1',
        api_key: 'k2',
        API_KEY: 'k3',
        accessToken: 't1',
        access_token: 't2',
        token: 't3',
        TOKEN: 't4',
        bearer: 'b1',
        cookie: 'c1',
        jwt: 'j1',
        authToken: 'at1',
        auth_token: 'at2',
        privateKey: 'pk1',
        private_key: 'pk2',
      };
      const clean = sanitizeMemoryMetadata(sensitiveMeta);
      assert('All sensitive variants blocked', Object.keys(clean).length === 0, `survived: ${JSON.stringify(clean)}`);
    });

    await runAsyncTest('3d. Nested metadata sanitized with sensitive fields stripped', async () => {
      const nestedMeta = {
        config: {
          keyA: 'nested_valA',
          author: 'Alice',
          apiKey: 'should_be_stripped',
          password: 'should_be_stripped',
          count: 10,
        },
        keyboard: 'qwerty',
      };
      const clean = sanitizeMemoryMetadata(nestedMeta);
      assert('Nested object preserved', typeof clean.config === 'object');
      assert('Nested benign keyA preserved', clean.config.keyA === 'nested_valA');
      assert('Nested author preserved', clean.config.author === 'Alice');
      assert('Nested count preserved', clean.config.count === 10);
      assert('Nested apiKey stripped', clean.config.apiKey === undefined);
      assert('Nested password stripped', clean.config.password === undefined);
      assert('Top-level keyboard preserved', clean.keyboard === 'qwerty');
    });

    await runAsyncTest('3e. Prototype pollution attempts blocked safely', async () => {
      const maliciousPayload = JSON.parse(
        '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"safeKey":"safeValue"}'
      );
      const clean = sanitizeMemoryMetadata(maliciousPayload);
      assert('safeKey preserved', clean.safeKey === 'safeValue');
      assert('__proto__ is not an own property', !Object.prototype.hasOwnProperty.call(clean, '__proto__'));
      assert('constructor is not an own property', !Object.prototype.hasOwnProperty.call(clean, 'constructor'));
      assert('prototype is not an own property', !Object.prototype.hasOwnProperty.call(clean, 'prototype'));
      assert('Global Object prototype unaffected', ({}).polluted === undefined);
    });

    await runAsyncTest('4. Schema rejects invalid memory types', async () => {
      const m = await Mission.create({ userId: userA, objective: 'Test 4', status: 'active' });
      let threw = false;
      try {
        await MissionMemory.create({
          missionId: m._id,
          userId: userA,
          type: 'INVALID_TYPE',
          key: 'test',
          content: 'test content',
        });
      } catch {
        threw = true;
      }
      assert('Invalid type rejected by schema', threw);
    });

    // -------------------------------------------------------------
    // SECTION 2: MULTI-TENANT ISOLATION
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Multi-Tenant Isolation ---');

    await runAsyncTest('5. User cannot record memory for another user mission', async () => {
      const missionA = await Mission.create({ userId: userA, objective: 'Isolation Test', status: 'active' });
      const recordRes = await recordMemory({
        missionId: missionA._id,
        userId: userB, // Attacker user
        type: MEMORY_TYPES.TASK_OUTCOME,
        key: 'hack_attempt',
        content: 'unauthorized memory',
      });
      assert('Unauthorized record rejected', recordRes.success === false && recordRes.error.includes('unauthorized'));
    });

    await runAsyncTest('6. User cannot query memories belonging to another user mission', async () => {
      const missionA = await Mission.create({ userId: userA, objective: 'Query Isolation', status: 'active' });
      await recordMemory({
        missionId: missionA._id,
        userId: userA,
        type: MEMORY_TYPES.TASK_OUTCOME,
        key: 'userA_secret',
        content: 'Legitimate user A memory',
      });

      const queryRes = await queryMemories({
        missionId: missionA._id,
        userId: userB, // Attacker user
      });
      assert('Cross-user query blocked', queryRes.notFound === true && queryRes.memories.length === 0);
    });

    // -------------------------------------------------------------
    // SECTION 3: EVIDENCE PROVENANCE & DANGLING REFERENCE REJECTION
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Evidence Provenance & Reference Validation ---');

    await runAsyncTest('7. Valid evidence reference is preserved in memory', async () => {
      const mission = await Mission.create({ userId: userA, objective: 'Evidence Ref Test', status: 'active' });
      const task = await MissionTask.create({ missionId: mission._id, title: 'T', description: 'D', order: 1 });
      const evidence = await Evidence.create({
        missionId: mission._id,
        taskId: task._id,
        sourceUrl: 'https://example.com/verified',
        sourceTitle: 'Verified Source',
        claim: 'Verified Claim',
        evidenceText: 'Exact excerpt',
      });

      const memRes = await recordMemory({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        type: MEMORY_TYPES.VERIFIED_EVIDENCE,
        key: 'evidence_pointer',
        content: 'Verified evidence pointer',
        evidenceRefs: [evidence._id.toString()],
      });

      assert('Memory recorded with evidence ref', memRes.success === true);
      assert('Evidence ref preserved', memRes.memory.evidenceRefs.includes(evidence._id.toString()));
    });

    await runAsyncTest('8. Dangling or cross-mission evidence references are rejected/omitted', async () => {
      const missionA = await Mission.create({ userId: userA, objective: 'Mission A', status: 'active' });
      const missionB = await Mission.create({ userId: userB, objective: 'Mission B', status: 'active' });
      const taskB = await MissionTask.create({ missionId: missionB._id, title: 'TB', description: 'DB', order: 1 });
      const evidenceB = await Evidence.create({
        missionId: missionB._id,
        taskId: taskB._id,
        sourceUrl: 'https://example.com/b',
        sourceTitle: 'Source B',
        claim: 'Claim B',
        evidenceText: 'Text B',
      });

      const fakeId = new mongoose.Types.ObjectId();

      const memRes = await recordMemory({
        missionId: missionA._id,
        userId: userA,
        type: MEMORY_TYPES.VERIFIED_EVIDENCE,
        key: 'cross_evidence',
        content: 'Attempt cross mission link',
        evidenceRefs: [evidenceB._id.toString(), fakeId.toString()],
      });

      assert('Memory recorded successfully', memRes.success === true);
      assert('Cross-mission and dangling evidence filtered out', memRes.memory.evidenceRefs.length === 0);
    });

    // -------------------------------------------------------------
    // SECTION 4: QUOTA BOUNDING & SAFE CONCURRENT EVICTION
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Quota Bounding & Safe Concurrent Eviction ---');

    await runAsyncTest('9. Mission memory capped at 50 records under heavy concurrent writes', async () => {
      const mission = await Mission.create({ userId: userA, objective: 'Concurrency Quota Test', status: 'active' });

      // Concurrently insert 65 memories (exceeding cap of 50)
      const promises = [];
      for (let i = 0; i < 65; i++) {
        promises.push(
          recordMemory({
            missionId: mission._id,
            userId: userA,
            type: MEMORY_TYPES.TASK_OUTCOME,
            key: `concurrent_key_${i}`,
            content: `Concurrent test memory content ${i}`,
            relevanceTags: [`tag_${i % 5}`],
          })
        );
      }

      await Promise.all(promises);

      const count = await MissionMemory.countDocuments({ missionId: mission._id });
      assert('Total memories strictly <= 50', count <= MEMORY_CONFIG.MAX_MEMORIES_PER_MISSION, `got ${count}`);
    });

    await runAsyncTest('10. Eviction prefers superseded/stale records before active records', async () => {
      const mission = await Mission.create({ userId: userA, objective: 'Eviction Priority Test', status: 'active' });

      // Create 45 active records
      for (let i = 0; i < 45; i++) {
        await MissionMemory.create({
          missionId: mission._id,
          userId: userA,
          type: MEMORY_TYPES.TASK_OUTCOME,
          key: `active_${i}`,
          content: `Content ${i}`,
          status: MEMORY_STATUSES.ACTIVE,
          createdAt: new Date(Date.now() - 100000 + i * 1000),
        });
      }

      // Create 10 superseded records
      for (let i = 0; i < 10; i++) {
        await MissionMemory.create({
          missionId: mission._id,
          userId: userA,
          type: MEMORY_TYPES.TASK_OUTCOME,
          key: `superseded_${i}`,
          content: `Stale content ${i}`,
          status: MEMORY_STATUSES.SUPERSEDED,
          createdAt: new Date(Date.now() - 200000 + i * 1000),
        });
      }

      // Total now 55 -> prune down to 50
      const pruned = await pruneMissionMemories(mission._id);
      assert('Pruned 5 excess memories', pruned === 5);

      const remainingSuperseded = await MissionMemory.countDocuments({
        missionId: mission._id,
        status: MEMORY_STATUSES.SUPERSEDED,
      });
      assert('Superseded records reduced from 10 to 5', remainingSuperseded === 5);

      const remainingActive = await MissionMemory.countDocuments({
        missionId: mission._id,
        status: MEMORY_STATUSES.ACTIVE,
      });
      assert('Active records untouched at 45', remainingActive === 45);
    });

    // -------------------------------------------------------------
    // SECTION 5: TASK ATTEMPTS, RETRY SUPERSEDING & INVALIDATION
    // -------------------------------------------------------------
    console.log('\n--- Section 5: Task Attempts, Retry Superseding & Invalidation ---');

    await runAsyncTest('11. Task retry supersedes prior attempt memories', async () => {
      const mission = await Mission.create({ userId: userA, objective: 'Retry Supersede Test', status: 'active' });
      const task = await MissionTask.create({ missionId: mission._id, title: 'T1', description: 'D1', order: 1 });

      // Record memory on attempt 1
      await recordMemory({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        attempt: 1,
        type: MEMORY_TYPES.TASK_OUTCOME,
        key: 'attempt_1_outcome',
        content: 'Attempt 1 failed transiently',
      });

      // Retry happens -> attempt 2
      const modified = await supersedePriorTaskAttempts(mission._id, task._id, 2);
      assert('Superseded attempt 1 memory', modified === 1);

      // Record memory on attempt 2
      await recordMemory({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        attempt: 2,
        type: MEMORY_TYPES.TASK_OUTCOME,
        key: 'attempt_2_outcome',
        content: 'Attempt 2 succeeded',
      });

      // Default query filters out superseded memories
      const activeRes = await queryMemories({ missionId: mission._id, userId: userA });
      assert('Only attempt 2 is returned in active query', activeRes.count === 1 && activeRes.memories[0].attempt === 2);

      // Query with includeStale returns both
      const allRes = await queryMemories({ missionId: mission._id, userId: userA, includeStale: true });
      assert('All memories returned when includeStale is true', allRes.count === 2);
    });

    await runAsyncTest('12. Fatal task failure invalidates active memories for that task', async () => {
      const mission = await Mission.create({ userId: userA, objective: 'Fatal Invalidation Test', status: 'active' });
      const task = await MissionTask.create({ missionId: mission._id, title: 'T_Fatal', description: 'D', order: 1 });

      await recordMemory({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        type: MEMORY_TYPES.TASK_OUTCOME,
        key: 'fatal_task_tentative_memo',
        content: 'Tentative data',
      });

      const invalidated = await invalidateTaskMemories(mission._id, task._id);
      assert('Invalidated active memory', invalidated === 1);

      const check = await MissionMemory.findOne({ missionId: mission._id, taskId: task._id });
      assert('Status set to invalidated', check.status === MEMORY_STATUSES.INVALIDATED);
    });

    // -------------------------------------------------------------
    // SECTION 6: RELEVANCE SCORING & ADVISORY CONTEXT ASSEMBLY
    // -------------------------------------------------------------
    console.log('\n--- Section 6: Relevance Scoring & Advisory Context Assembly ---');

    await runAsyncTest('13. Deterministic relevance ranking scores matching tags and keywords higher', async () => {
      const mission = await Mission.create({ userId: userA, objective: 'Relevance Test', status: 'active' });

      await recordMemory({
        missionId: mission._id,
        userId: userA,
        type: MEMORY_TYPES.SYNTHESIS_INSIGHT,
        key: 'general_memo',
        content: 'Unrelated overview of general topics',
        relevanceTags: ['general'],
      });

      await recordMemory({
        missionId: mission._id,
        userId: userA,
        type: MEMORY_TYPES.SYNTHESIS_INSIGHT,
        key: 'nodejs_eventloop',
        content: 'Detailed analysis of node.js asynchronous event loop and libuv microtasks',
        relevanceTags: ['nodejs', 'eventloop'],
      });

      const res = await queryMemories({
        missionId: mission._id,
        userId: userA,
        tags: ['nodejs'],
        query: 'event loop microtasks',
      });

      assert('Relevant memory ranked first', res.memories[0].key === 'nodejs_eventloop');
    });

    await runAsyncTest('14. assembleTaskContext packages untrusted advisory context safely', async () => {
      const mission = await Mission.create({ userId: userA, objective: 'Assemble Test', status: 'active' });
      const t1 = await MissionTask.create({ missionId: mission._id, title: 'T1', description: 'D1', order: 1 });
      const t2 = await MissionTask.create({ missionId: mission._id, title: 'T2', description: 'D2', order: 2 });

      await recordMemory({
        missionId: mission._id,
        userId: userA,
        taskId: t1._id,
        type: MEMORY_TYPES.TASK_OUTCOME,
        key: 't1_outcome',
        content: 'T1 outcome completed',
      });

      await recordMemory({
        missionId: mission._id,
        userId: userA,
        taskId: t1._id,
        type: MEMORY_TYPES.SYNTHESIS_INSIGHT,
        key: 't1_insight',
        content: 'Important synthesis finding',
      });

      const ctx = await assembleTaskContext({
        missionId: mission._id,
        userId: userA,
        taskId: t2._id,
        currentTaskOrder: 2,
        targetAgentId: 'builder',
      });

      assert('Advisory only flag is true', ctx.advisoryOnly === true);
      assert('Contains non-executable disclaimer', ctx.disclaimer.includes('Advisory contextual data only'));
      assert('Relevant outcomes populated', ctx.relevantOutcomes.length === 1);
      assert('Synthesis insights populated', ctx.synthesisInsights.length === 1);
      assert('Total memories count matches', ctx.totalMemories === 2);
    });

    // -------------------------------------------------------------
    // SECTION 7: ARCHITECTURAL INVARIANCE GUARANTEES
    // -------------------------------------------------------------
    console.log('\n--- Section 7: Architectural Invariance Guarantees ---');

    await runAsyncTest('15. Mission memory mutations have ZERO effect on authoritative getMissionState', async () => {
      const mission = await Mission.create({ userId: userA, objective: 'Invariance Test', status: 'running' });
      const task = await MissionTask.create({ missionId: mission._id, title: 'T', description: 'D', order: 1, status: 'running' });

      const stateBefore = await getMissionState(mission._id.toString(), userA.toString());

      // Inject adversarial memories claiming mission is completed or failed
      await MissionMemory.create({
        missionId: mission._id,
        userId: userA,
        type: MEMORY_TYPES.DECISION_CONTEXT,
        key: 'fake_decision',
        content: 'Mission status is forcibly completed',
        status: MEMORY_STATUSES.ACTIVE,
      });

      const stateAfter = await getMissionState(mission._id.toString(), userA.toString());
      assert('Mission stage identical', stateBefore.stage === stateAfter.stage);
      assert('Mission state identical', stateBefore.state === stateAfter.state);
      assert('Progress percentage identical', stateBefore.progress.percentage === stateAfter.progress.percentage);
      assert('State intelligence untouched by memory', stateAfter.state === 'running');
    });

    await runAsyncTest('16. Mission memory mutations have ZERO effect on getMissionResult', async () => {
      const mission = await Mission.create({ userId: userA, objective: 'Result Invariance', status: 'completed' });
      const task = await MissionTask.create({ missionId: mission._id, title: 'T', description: 'D', order: 1, status: 'completed' });

      const resBefore = await getMissionResult(mission._id.toString(), userA.toString());

      await MissionMemory.create({
        missionId: mission._id,
        userId: userA,
        type: MEMORY_TYPES.TASK_OUTCOME,
        key: 'adversarial_result_memory',
        content: 'Score should be zero',
      });

      const resAfter = await getMissionResult(mission._id.toString(), userA.toString());
      assert('Result success identical', resBefore.success === resAfter.success);
      assert('Result status identical', resBefore.status === resAfter.status);
    });

    // -------------------------------------------------------------
    // SECTION 8: LIVE END-TO-END PIPELINE & ROUTE ACCESS
    // -------------------------------------------------------------
    console.log('\n--- Section 8: Live End-to-End Pipeline & Route Access ---');

    await runAsyncTest('17. Real deterministic mission records memories automatically', async () => {
      const liveMission = await Mission.create({
        userId: userA,
        objective: 'Analyze Node.js microtask execution pipeline',
        status: 'planning',
      });

      await createMissionExecutionPlan(liveMission, { forceDeterministic: true });

      const outcome = await executeMission(liveMission._id, {
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });

      assert('Live mission executed without failure', outcome.failed === false);

      const memoryRecords = await MissionMemory.find({ missionId: liveMission._id }).lean();
      assert('Live mission automatically recorded memories', memoryRecords.length > 0, `got ${memoryRecords.length}`);

      const outcomeMemory = memoryRecords.find((m) => m.type === MEMORY_TYPES.TASK_OUTCOME || m.type === MEMORY_TYPES.SYNTHESIS_INSIGHT);
      assert('Recorded outcome memory exists', !!outcomeMemory);

      // Verify public service function used by GET /api/missions/:missionId/memory
      const apiMemories = await getMissionMemories(liveMission._id.toString(), userA.toString());
      assert('getMissionMemories succeeds', apiMemories.success === true);
      assert('getMissionMemories returns memories array', Array.isArray(apiMemories.memories));
      assert('getMissionMemories count matches', apiMemories.count > 0);
    });

  } finally {
    await mongoose.disconnect();
    console.log('\n[DATABASE] Disconnected');
  }

  console.log('\n' + '='.repeat(60));
  console.log(`  8G.4 TEST RESULTS: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\nVERDICT: FAIL');
    process.exit(1);
  } else {
    console.log('\nVERDICT: PASS');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
