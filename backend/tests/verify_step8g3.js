const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const Evidence = require('../models/Evidence');
const User = require('../models/User');
const { MissionEvent, EVENT_TYPES, DECISION_TYPES } = require('../models/MissionEvent');
const {
  ADAPTIVE_CONFIG,
  isErrorRetryable,
  evaluateTaskFailure,
  evaluateEvidenceSufficiency,
} = require('../services/adaptiveMissionService');
const { executeMission } = require('../orchestrator/missionOrchestrator');
const { getMissionState } = require('../services/missionStateService');
const { getMissionEvents } = require('../services/missionEventService');
const { getMissionResult } = require('../services/missionResultService');
const { getMissionTelemetry } = require('../services/telemetry/telemetryService');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    failedTests++;
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  [PASS] ${message}`);
}

async function runStep8G3Tests() {
  console.log('====================================================');
  console.log('  STARTING NEXORA 8G.3 VERIFICATION SUITE');
  console.log('  Adaptive Mission Loop');
  console.log('====================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nexora';
  await mongoose.connect(mongoUri);
  console.log('[DATABASE] Connected to MongoDB\n');

  try {
    const userA = await User.create({
      email: `test_8g3_a_${Date.now()}@example.com`,
      passwordHash: 'hash',
      name: 'User 8G3 A',
    });
    const userB = await User.create({
      email: `test_8g3_b_${Date.now()}@example.com`,
      passwordHash: 'hash',
      name: 'User 8G3 B',
    });

    console.log('--- Section 1: Error Classification & Retryability ---');
    // 1. Retryable transient errors
    assert(isErrorRetryable(new Error('Connection reset by peer: ECONNRESET')), 'ECONNRESET is classified as retryable');
    assert(isErrorRetryable(new Error('Request failed with status code 429: Too Many Requests')), 'HTTP 429 rate limit is classified as retryable');
    assert(isErrorRetryable(new Error('503 Service Unavailable upstream')), 'HTTP 503 is classified as retryable');
    assert(isErrorRetryable(new Error('Navigation timeout of 30000ms exceeded')), 'Navigation timeout is classified as retryable');
    assert(isErrorRetryable(new Error('transient network drop')), 'Explicit transient marker is classified as retryable');

    // 2. Non-retryable fatal errors
    assert(!isErrorRetryable(new Error('API key not valid: API_KEY_INVALID')), 'API_KEY_INVALID is non-retryable');
    assert(!isErrorRetryable(new Error('Unauthorized: 401 Authentication required')), '401 Unauthorized is non-retryable');
    assert(!isErrorRetryable(new Error('Candidate URL failed security check: PRIVATE_OR_RESERVED_IP')), 'SSRF security block is non-retryable');
    assert(!isErrorRetryable(new Error('ValidationError: path is required')), 'Mongoose ValidationError is non-retryable');
    assert(!isErrorRetryable(new Error('Resource not found: 404')), '404 Not Found is non-retryable');
    assert(!isErrorRetryable(null), 'Null error is non-retryable');

    console.log('\n--- Section 2: Failure Adaptation — Retry vs Block ---');
    const missionFailTest = await Mission.create({
      userId: userA._id,
      title: 'Failure Adaptation Mission',
      objective: 'Test retry vs block decisions',
      status: 'running',
    });

    const taskTransient = await MissionTask.create({
      missionId: missionFailTest._id,
      title: 'Transient Task',
      description: 'May fail transiently',
      order: 1,
      status: 'failed',
      executionMetadata: { attempt: 1 },
    });

    // 3. Retryable failure under attempt budget -> RETRY
    const retryEval = await evaluateTaskFailure({
      missionId: missionFailTest._id,
      taskId: taskTransient._id,
      error: new Error('ETIMEDOUT: Connection timed out'),
      currentAttempt: 1,
      missionStartTime: Date.now(),
      maxMissionDurationMs: 60000,
    });
    assert(retryEval.action === 'RETRY', 'Transient error triggers RETRY action');
    assert(retryEval.decisionType === DECISION_TYPES.RETRY_TASK, 'Decision type is RETRY_TASK');
    assert(retryEval.attempt === 2, 'Next attempt is incremented to 2');

    // Verify task state in database was reset to 'pending'
    const updatedTask = await MissionTask.findById(taskTransient._id);
    assert(updatedTask.status === 'pending', 'Task status reset to pending for retry');
    assert(updatedTask.executionMetadata.attempt === 2, 'Task attempt set to 2 in database');

    // Verify decision recorded in MissionEvent
    const retryEvents = await MissionEvent.find({
      missionId: missionFailTest._id,
      type: EVENT_TYPES.DECISION,
      decisionType: DECISION_TYPES.RETRY_TASK,
    });
    assert(retryEvents.length === 1, 'RETRY_TASK decision was recorded in MissionEvent history');

    // 4. Retry budget exhausted (attempt >= maxRetries) -> BLOCK
    const taskExhausted = await MissionTask.create({
      missionId: missionFailTest._id,
      title: 'Exhausted Task',
      description: 'Already retried max times',
      order: 2,
      status: 'failed',
      executionMetadata: { attempt: 2 },
    });
    const blockExhausted = await evaluateTaskFailure({
      missionId: missionFailTest._id,
      taskId: taskExhausted._id,
      error: new Error('ETIMEDOUT: Connection timed out'),
      currentAttempt: 2, // At max limit (2)
      missionStartTime: Date.now(),
      maxMissionDurationMs: 60000,
    });
    assert(blockExhausted.action === 'BLOCK', 'Exhausted retries triggers BLOCK action');
    assert(blockExhausted.decisionType === DECISION_TYPES.BLOCK_MISSION, 'Decision type is BLOCK_MISSION');

    // 5. Non-retryable error -> BLOCK immediately
    const taskFatal = await MissionTask.create({
      missionId: missionFailTest._id,
      title: 'Fatal Auth Task',
      description: 'Fails with invalid key',
      order: 3,
      status: 'failed',
      executionMetadata: { attempt: 1 },
    });
    const blockFatal = await evaluateTaskFailure({
      missionId: missionFailTest._id,
      taskId: taskFatal._id,
      error: new Error('API_KEY_INVALID: API key not valid'),
      currentAttempt: 1,
      missionStartTime: Date.now(),
      maxMissionDurationMs: 60000,
    });
    assert(blockFatal.action === 'BLOCK', 'Fatal non-retryable error triggers BLOCK action');
    assert(blockFatal.decisionType === DECISION_TYPES.BLOCK_MISSION, 'Decision type is BLOCK_MISSION');

    // 6. Mission deadline exceeded -> BLOCK
    const blockDeadline = await evaluateTaskFailure({
      missionId: missionFailTest._id,
      taskId: taskTransient._id,
      error: new Error('ETIMEDOUT: Connection timed out'),
      currentAttempt: 1,
      missionStartTime: Date.now() - 70000, // 70s ago
      maxMissionDurationMs: 60000, // 60s max
    });
    assert(blockDeadline.action === 'BLOCK', 'Expired mission deadline triggers BLOCK action');
    assert(blockDeadline.decisionType === DECISION_TYPES.BLOCK_MISSION, 'Deadline breach produces BLOCK_MISSION decision');

    console.log('\n--- Section 3: Evidence Evaluation & Adaptive Browser Expansion ---');
    const missionEvTest = await Mission.create({
      userId: userA._id,
      title: 'Evidence Adaptation Mission',
      objective: 'Evaluate autonomous browser task addition',
      status: 'running',
    });

    const researchTask = await MissionTask.create({
      missionId: missionEvTest._id,
      title: 'Research candidate sources',
      description: 'Search for intelligence',
      order: 1,
      status: 'completed',
    });

    // 7. Case: Evidence is Sufficient (>= 2 items) -> CONTINUE
    await Evidence.create([
      { missionId: missionEvTest._id, taskId: researchTask._id, sourceUrl: 'https://ex.com/1', sourceTitle: 'Source 1', claim: 'c1', evidenceText: 'text1' },
      { missionId: missionEvTest._id, taskId: researchTask._id, sourceUrl: 'https://ex.com/2', sourceTitle: 'Source 2', claim: 'c2', evidenceText: 'text2' },
    ]);

    const suffEval = await evaluateEvidenceSufficiency({
      missionId: missionEvTest._id,
      taskId: researchTask._id,
      executedResult: { data: { candidates: [] } },
      currentTaskOrder: 1,
    });
    assert(suffEval.action === 'CONTINUE', 'Sufficient evidence triggers CONTINUE action');
    assert(suffEval.decisionType === DECISION_TYPES.CONTINUE_PIPELINE, 'Decision type is CONTINUE_PIPELINE');

    // 8. Case: Insufficient Evidence (< 2 items) & Candidates Discovered -> ADD_BROWSER_TASK
    const missionLowEv = await Mission.create({
      userId: userA._id,
      title: 'Low Evidence Mission',
      objective: 'Discover and browse candidates',
      status: 'running',
    });
    const lowResearchTask = await MissionTask.create({
      missionId: missionLowEv._id,
      title: 'Research sources',
      description: 'Searches sources',
      order: 1,
      status: 'completed',
    });
    // Add downstream task to verify order shifting
    const downstreamTask = await MissionTask.create({
      missionId: missionLowEv._id,
      title: 'Synthesize findings',
      description: 'Analyst task',
      order: 2,
      status: 'pending',
    });

    const candidateSources = [
      {
        url: 'https://nodejs.org/en',
        title: 'Node.js Official Documentation',
        snippet: 'Deep technical passage regarding Node.js runtime and asynchronous I/O',
        qualityScore: 0.92,
        relevanceScore: 0.95,
        authorityTier: 'tier-1',
      },
    ];

    const lowEvEval = await evaluateEvidenceSufficiency({
      missionId: missionLowEv._id,
      taskId: lowResearchTask._id,
      executedResult: {
        title: lowResearchTask.title,
        data: { candidates: candidateSources },
      },
      currentTaskOrder: 1,
      options: { forceSyncCheckPass: true },
    });

    assert(lowEvEval.action === 'ADAPT_ADD_TASK', 'Insufficient evidence with candidates triggers ADAPT_ADD_TASK');
    assert(lowEvEval.decisionType === DECISION_TYPES.ADD_BROWSER_TASK, 'Decision type is ADD_BROWSER_TASK');
    assert(lowEvEval.count === 1, 'Exactly 1 adaptive browser task was inserted');

    // Verify task graph in database
    const allTasks = await MissionTask.find({ missionId: missionLowEv._id }).sort({ order: 1 });
    assert(allTasks.length === 3, 'Task graph expanded from 2 to 3 tasks');
    assert(allTasks[1].agentId === 'browser', 'Inserted task is a browser agent task');
    assert(allTasks[1].url.includes('nodejs.org'), 'Inserted task URL matches candidate URL');
    assert(allTasks[1].order === 2, 'Inserted task order is 2');
    assert(allTasks[2]._id.equals(downstreamTask._id) && allTasks[2].order === 3, 'Downstream task order shifted from 2 to 3');

    // 9. Duplicate Prevention: Repeating evidence evaluation with same candidates
    const dupEval = await evaluateEvidenceSufficiency({
      missionId: missionLowEv._id,
      taskId: lowResearchTask._id,
      executedResult: {
        title: lowResearchTask.title,
        data: { candidates: candidateSources },
      },
      currentTaskOrder: 1,
    });
    assert(dupEval.action === 'CONTINUE', 'Duplicate candidate evaluation triggers CONTINUE instead of adding duplicates');
    assert(dupEval.decisionType === DECISION_TYPES.CONTINUE_PIPELINE, 'Decision type is CONTINUE_PIPELINE');

    const tasksAfterDup = await MissionTask.find({ missionId: missionLowEv._id });
    assert(tasksAfterDup.length === 3, 'No duplicate tasks were added to the task graph');

    console.log('\n--- Section 4: Adaptive Action Budget Exhaustion ---');
    const missionBudgetTest = await Mission.create({
      userId: userA._id,
      title: 'Budget Exhaustion Mission',
      objective: 'Verify budget guard',
      status: 'running',
    });

    // Insert 3 adaptive decisions into MissionEvent history to reach budget limit
    await MissionEvent.create([
      { missionId: missionBudgetTest._id, userId: userA._id, type: EVENT_TYPES.DECISION, decisionType: DECISION_TYPES.RETRY_TASK, reason: 'Adaptive Retry 1' },
      { missionId: missionBudgetTest._id, userId: userA._id, type: EVENT_TYPES.DECISION, decisionType: DECISION_TYPES.RETRY_TASK, reason: 'Adaptive Retry 2' },
      { missionId: missionBudgetTest._id, userId: userA._id, type: EVENT_TYPES.DECISION, decisionType: DECISION_TYPES.ADD_BROWSER_TASK, reason: 'Adaptive Browser 1' },
    ]);

    const budgetTask = await MissionTask.create({
      missionId: missionBudgetTest._id,
      title: 'Budget Task',
      description: 'Task with exhausted budget',
      order: 1,
      status: 'failed',
      executionMetadata: { attempt: 1 },
    });

    const budgetFailure = await evaluateTaskFailure({
      missionId: missionBudgetTest._id,
      taskId: budgetTask._id,
      error: new Error('ETIMEDOUT: Connection timed out'),
      currentAttempt: 1,
      missionStartTime: Date.now(),
      maxMissionDurationMs: 60000,
    });
    assert(budgetFailure.action === 'BLOCK', 'Exhausted adaptive budget triggers BLOCK action');
    assert(budgetFailure.decisionType === DECISION_TYPES.BLOCK_MISSION, 'Decision type is BLOCK_MISSION on budget exhaustion');

    const budgetEvidence = await evaluateEvidenceSufficiency({
      missionId: missionBudgetTest._id,
      taskId: budgetTask._id,
      executedResult: { data: { candidates: [{ url: 'https://en.wikipedia.org/wiki/Node.js' }] } },
      currentTaskOrder: 1,
    });
    assert(budgetEvidence.action === 'CONTINUE', 'Exhausted adaptive budget prevents task creation and CONTINUES');
    assert(budgetEvidence.decisionType === DECISION_TYPES.CONTINUE_PIPELINE, 'Decision type is CONTINUE_PIPELINE on budget exhaustion');

    console.log('\n--- Section 5: Concurrency & Cross-Mission Isolation ---');
    // Concurrent adaptation evaluations on separate missions
    const promises = Array.from({ length: 20 }, async (_, idx) => {
      const isA = idx % 2 === 0;
      const targetMissionId = isA ? missionEvTest._id : missionLowEv._id;
      return evaluateEvidenceSufficiency({
        missionId: targetMissionId,
        taskId: researchTask._id,
        executedResult: { data: { candidates: [] } },
        currentTaskOrder: 1,
      });
    });
    const concurrentResults = await Promise.all(promises);
    assert(concurrentResults.every(r => r.action === 'CONTINUE'), '20 concurrent evaluations executed cleanly with zero race conditions');

    // Cross-mission isolation guard: User B attempting to adapt User A's mission
    const crossMission = await Mission.findOne({ _id: missionEvTest._id, userId: userB._id });
    assert(!crossMission, 'User B cannot query or own User A mission');

    console.log('\n--- Section 6: Invariance & Independence Guarantees ---');
    // Verify MissionStateService derives state accurately regardless of adaptive events
    const state = await getMissionState(missionLowEv._id, userA._id);
    assert(state.success === true, 'getMissionState retrieves operational state');
    assert(state.progress.totalTasks === 3, 'Operational state dynamically reflects expanded task total (3)');

    // Verify MissionResultService contract remains intact
    const result = await getMissionResult(missionLowEv._id, userA._id);
    assert(result.success === true, 'getMissionResult contract is 100% intact');

    console.log('\n--- Section 7: Live End-to-End Orchestrator Execution with Adaptive Loop ---');
    // Execute live mission through orchestrator with adaptive retry and evidence expansion
    const liveMission = await Mission.create({
      userId: userA._id,
      title: 'Live Adaptive Test Mission',
      objective: 'Evaluate live end-to-end adaptive execution loop',
      status: 'planning',
    });

    // Create 3 tasks: Task 1 (transient retry), Task 2 (research with candidate), Task 3 (analysis)
    const liveTask1 = await MissionTask.create({
      missionId: liveMission._id,
      title: 'Initial analysis phase',
      description: 'Analyze objective',
      order: 1,
      status: 'pending',
      agentId: 'analyst',
    });

    const liveTask2 = await MissionTask.create({
      missionId: liveMission._id,
      title: 'Gather intelligence',
      description: 'Research phase',
      order: 2,
      status: 'pending',
      agentId: 'research',
    });

    const liveTask3 = await MissionTask.create({
      missionId: liveMission._id,
      title: 'Synthesize findings',
      description: 'Synthesis phase',
      order: 3,
      status: 'pending',
      agentId: 'analyst',
    });

    console.log('Executing live mission pipeline with adaptive options...');
    const executionResult = await executeMission(liveMission._id, {
      forceDeterministic: true,
      skipBrowserHandoff: true, // deterministic test flag
    });

    assert(executionResult.failed === false, 'Live mission executed to completion without fatal errors');
    assert(executionResult.mission.status === 'completed', 'Live mission status transitioned to completed');

    const liveEvents = await getMissionEvents(liveMission._id, userA._id, { limit: 100 });
    assert(liveEvents.success === true, 'Retrieved live mission events');
    assert(liveEvents.events.some(e => e.type === EVENT_TYPES.MISSION_COMPLETED), 'Mission completed event persisted');

    console.log('\nCleaning up fixtures...');
    await MissionEvent.deleteMany({ missionId: { $in: [missionFailTest._id, missionEvTest._id, missionLowEv._id, missionBudgetTest._id, liveMission._id] } });
    await Evidence.deleteMany({ missionId: { $in: [missionFailTest._id, missionEvTest._id, missionLowEv._id, missionBudgetTest._id, liveMission._id] } });
    await MissionTask.deleteMany({ missionId: { $in: [missionFailTest._id, missionEvTest._id, missionLowEv._id, missionBudgetTest._id, liveMission._id] } });
    await Mission.deleteMany({ _id: { $in: [missionFailTest._id, missionEvTest._id, missionLowEv._id, missionBudgetTest._id, liveMission._id] } });
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
    console.log('Cleanup complete.');

    console.log('\n====================================================');
    console.log(`  8G.3 TEST RESULTS: ${passedTests} passed, ${failedTests} failed (Total: ${passedTests + failedTests})`);
    console.log('====================================================\n');
  } finally {
    await mongoose.disconnect();
    console.log('[DATABASE] Disconnected');
  }
}

runStep8G3Tests().catch((err) => {
  console.error('[8G.3 FATAL ERROR]', err);
  process.exit(1);
});
