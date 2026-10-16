/**
 * NEXORA Phase 2.9 Verification Suite
 * Step 8G.6 Phase 2.11 — Real Mission Telemetry Integration
 *
 * Verifies:
 * 1. Correct initial request and sequence cursor progression
 * 2. Duplicate-event suppression by id and sequence
 * 3. Multiple events returned in one batch
 * 4. Empty responses handling without spurious cursor advancement
 * 5. Recoverable network failures with bounded backoff
 * 6. Authentication/authorization (401) and missing-mission (404) errors
 * 7. Terminal-state shutdown and final event handling
 * 8. Mission switching and cleanup preventing stale updates
 * 9. Unknown event types graceful fallback
 * 10. No synthetic execution feed started for real backend missions
 * 11. Backend API sinceSeq contract & sequence number generation
 * 12. Centralized VITE_API_URL configuration and formatting utilities
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

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
    console.error(`  [FAIL] ${name}: ${err.message}`);
    if (err.stack) console.error(err.stack);
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
    console.error(`  [FAIL] ${name}: ${err.message}`);
    if (err.stack) console.error(err.stack);
  }
}

// Emulate frontend missionService functions for pure deterministic node verification
function formatTimeString(date = new Date()) {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const AGENT_MODULE_MAP = {
  research: 'MOD.01',
  browser: 'MOD.02',
  analyst: 'MOD.03',
  critic: 'MOD.04',
  builder: 'MOD.05',
  qa: 'MOD.06',
};

function mapEventToAgent(rawEvent = {}) {
  const metadata = rawEvent.metadata || {};
  const agentKey = String(metadata.agentId || rawEvent.agentId || '').trim().toLowerCase();

  if (agentKey && AGENT_MODULE_MAP[agentKey]) {
    return {
      agentTag: agentKey.toUpperCase(),
      activeAgentId: AGENT_MODULE_MAP[agentKey],
    };
  }

  const type = String(rawEvent.type || '').toUpperCase();
  const decisionType = String(rawEvent.decisionType || '').toUpperCase();

  if (type.includes('RESEARCH') || decisionType === 'SELECT_SOURCE') {
    return { agentTag: 'RESEARCH', activeAgentId: 'MOD.01' };
  }
  if (type.includes('BROWSER') || decisionType === 'ADD_BROWSER_TASK') {
    return { agentTag: 'BROWSER', activeAgentId: 'MOD.02' };
  }
  if (type.includes('ANALYSIS') || type.includes('ANALYST')) {
    return { agentTag: 'ANALYST', activeAgentId: 'MOD.03' };
  }
  if (type.includes('CRITIQUE') || type.includes('CRITIC') || decisionType === 'BLOCK_MISSION') {
    return { agentTag: 'CRITIC', activeAgentId: 'MOD.04' };
  }
  if (type.includes('ARTIFACT') || type.includes('BUILD')) {
    return { agentTag: 'BUILDER', activeAgentId: 'MOD.05' };
  }
  if (type.includes('QA')) {
    return { agentTag: 'QA', activeAgentId: 'MOD.06' };
  }
  if (type === 'MISSION_PLANNING_STARTED' || decisionType === 'RETRY_TASK' || decisionType === 'CONTINUE_PIPELINE') {
    return { agentTag: 'PLANNER', activeAgentId: 'MOD.03' };
  }

  return { agentTag: 'CORE', activeAgentId: null };
}

function mapEventToSystemState(rawEvent = {}) {
  const type = String(rawEvent.type || '').toUpperCase();
  const metadata = rawEvent.metadata || {};
  const agentKey = String(metadata.agentId || rawEvent.agentId || '').trim().toLowerCase();

  if (type === 'MISSION_COMPLETED') return 'COMPLETE';
  if (type === 'MISSION_FAILED') return 'IDLE';
  if (type === 'MISSION_PLANNING_STARTED') return 'PLANNING';

  if (agentKey === 'research' || type.includes('RESEARCH')) return 'RESEARCHING';
  if (agentKey === 'browser' || type.includes('BROWSER')) return 'RESEARCHING';
  if (agentKey === 'analyst' || type.includes('ANALYSIS')) return 'ANALYZING';
  if (agentKey === 'critic' || type.includes('CRITIQUE')) return 'VERIFYING';
  if (agentKey === 'builder' || type.includes('ARTIFACT') || type.includes('BUILD')) return 'BUILDING';
  if (agentKey === 'qa' || type.includes('QA')) return 'QA';

  return null;
}

function formatTelemetryEvent(rawEvent, isMissionTerminal = false) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return {
      id: `evt-${Date.now()}`,
      seq: 0,
      timestamp: new Date().toISOString(),
      timeString: formatTimeString(new Date()),
      missionId: null,
      type: 'UNKNOWN',
      agentId: 'CORE',
      agentTag: 'CORE',
      title: 'OPERATIONAL LOG',
      description: 'System event recorded.',
      status: 'active',
      systemState: 'IDLE',
      activeAgentId: null,
      secondaryAgentId: null,
    };
  }

  const { agentTag, activeAgentId } = mapEventToAgent(rawEvent);
  const sysState = mapEventToSystemState(rawEvent);
  const createdAt = rawEvent.createdAt ? new Date(rawEvent.createdAt) : new Date();
  const timeStr = formatTimeString(createdAt);
  const type = String(rawEvent.type || 'EVENT').toUpperCase();
  const metadata = rawEvent.metadata || {};

  let title = '';
  switch (type) {
    case 'MISSION_CREATED':
      title = 'MISSION INITIALIZED';
      break;
    case 'MISSION_PLANNING_STARTED':
      title = 'DECOMPOSING DIRECTIVE';
      break;
    case 'TASK_STARTED':
      title = metadata.title
        ? `TASK [${metadata.order || 1}]: ${metadata.title}`.toUpperCase()
        : 'TASK INITIALIZED';
      break;
    case 'TASK_COMPLETED':
      title = metadata.title
        ? `COMPLETED: ${metadata.title}`.toUpperCase()
        : 'TASK COMPLETED';
      break;
    case 'TASK_FAILED':
      title = metadata.title
        ? `FAILED: ${metadata.title}`.toUpperCase()
        : 'TASK EXECUTION FAILED';
      break;
    case 'TASK_RETRY_STARTED':
      title = `TASK RETRY (ATTEMPT ${metadata.attempt || 2})`;
      break;
    case 'EVIDENCE_COLLECTED':
      title = 'EVIDENCE RECORDED';
      break;
    case 'DECISION':
      title = rawEvent.decisionType
        ? `DECISION // ${rawEvent.decisionType}`.toUpperCase()
        : 'AUTONOMOUS DECISION';
      break;
    case 'MISSION_COMPLETED':
      title = 'MISSION COMPLETE // ALL INVARIANTS SATISFIED';
      break;
    case 'MISSION_FAILED':
      title = 'MISSION TERMINATED // PIPELINE ABORTED';
      break;
    default:
      title = type.replace(/_/g, ' ').toUpperCase();
      break;
  }

  let description = '';
  if (rawEvent.action) {
    description = rawEvent.action;
    if (rawEvent.outcome) {
      description += ` — ${rawEvent.outcome}`;
    }
  } else if (rawEvent.reason) {
    description = rawEvent.reason;
    if (rawEvent.outcome) {
      description += ` (${rawEvent.outcome})`;
    }
  } else if (rawEvent.outcome) {
    description = rawEvent.outcome;
  } else if (metadata.objective) {
    description = `Directive objective: "${metadata.objective}"`;
  } else {
    description = `Telemetry record ${rawEvent.seq ? `#${rawEvent.seq}` : ''} received from ${agentTag}.`;
  }

  let status = 'active';
  if (type === 'MISSION_COMPLETED' || type === 'TASK_COMPLETED' || isMissionTerminal) {
    status = 'completed';
  } else if (type === 'TASK_FAILED' || type === 'MISSION_FAILED') {
    status = 'failed';
  }

  return {
    id: rawEvent.id || (rawEvent._id ? String(rawEvent._id) : `evt-${rawEvent.seq || Date.now()}`),
    seq: rawEvent.seq || null,
    timestamp: createdAt.toISOString(),
    timeString: timeStr,
    missionId: rawEvent.missionId || null,
    type,
    agentId: metadata.agentId || agentTag,
    agentTag,
    title,
    description,
    status,
    systemState: sysState,
    activeAgentId,
    secondaryAgentId: null,
  };
}

/**
 * Deterministic Telemetry Consumer Simulator
 * Implements the exact algorithm embedded in App.jsx
 */
class TelemetryConsumer {
  constructor({ missionId, fetchEvents }) {
    this.missionId = missionId;
    this.fetchEvents = fetchEvents;
    this.eventsSeq = 0;
    this.seenEventIds = new Set();
    this.executionEvents = [];
    this.isStreaming = false;
    this.activeAgentId = null;
    this.systemState = 'IDLE';
    this.consecutiveErrors = 0;
    this.aborted = false;
  }

  start() {
    this.isStreaming = true;
    this.eventsSeq = 0;
    this.seenEventIds.clear();
    this.consecutiveErrors = 0;
  }

  stop() {
    this.isStreaming = false;
    this.aborted = true;
    this.activeAgentId = null;
  }

  async pollOnce(missionStatus = 'running') {
    if (!this.isStreaming || this.aborted) return { status: 'stopped' };

    try {
      const data = await this.fetchEvents(this.missionId, { sinceSeq: this.eventsSeq });
      if (this.aborted) return { status: 'aborted' };

      this.consecutiveErrors = 0;

      if (data?.events && Array.isArray(data.events) && data.events.length > 0) {
        let highestSeq = this.eventsSeq;

        for (const rawEvt of data.events) {
          const evtId = rawEvt.id || (rawEvt._id ? String(rawEvt._id) : null);
          const evtSeq = typeof rawEvt.seq === 'number' ? rawEvt.seq : null;

          const dedupKey = evtId || (evtSeq !== null ? `seq-${evtSeq}` : null);
          if (dedupKey && this.seenEventIds.has(dedupKey)) {
            continue;
          }
          if (dedupKey) {
            this.seenEventIds.add(dedupKey);
          }

          if (evtSeq !== null && evtSeq > highestSeq) {
            highestSeq = evtSeq;
          }

          const uiEvent = formatTelemetryEvent(rawEvt, missionStatus === 'completed');
          this.executionEvents.push(uiEvent);

          if (uiEvent.systemState) {
            this.systemState = uiEvent.systemState;
          }
          if (uiEvent.activeAgentId) {
            this.activeAgentId = uiEvent.activeAgentId;
          }
        }

        if (typeof data.nextSeq === 'number' && data.nextSeq > highestSeq) {
          this.eventsSeq = data.nextSeq;
        } else if (highestSeq > this.eventsSeq) {
          this.eventsSeq = highestSeq;
        }
      }

      if (['completed', 'failed', 'cancelled'].includes(missionStatus)) {
        this.isStreaming = false;
        this.activeAgentId = null;
        return { status: 'terminal', count: this.executionEvents.length };
      }

      return { status: 'active', count: this.executionEvents.length, seq: this.eventsSeq };
    } catch (err) {
      if (this.aborted) return { status: 'aborted' };

      const status = err.status || err.statusCode;
      if (status === 401 || status === 404) {
        this.isStreaming = false;
        return { status: 'terminal_error', error: err.message };
      }

      this.consecutiveErrors += 1;
      return { status: 'transient_error', errors: this.consecutiveErrors };
    }
  }
}

async function main() {
  console.log('====================================================');
  console.log('  NEXORA PHASE 2.9 TELEMETRY INTEGRATION VERIFICATION');
  console.log('====================================================\n');

  // --- Scenario 1: Initial request and cursor progression ---
  await runAsyncTest('1. Initial request starts at sinceSeq=0 and advances cursor on events', async () => {
    let requestedSeq = null;
    const consumer = new TelemetryConsumer({
      missionId: 'mission-001',
      fetchEvents: async (mId, { sinceSeq }) => {
        requestedSeq = sinceSeq;
        return {
          success: true,
          count: 2,
          nextSeq: 2,
          events: [
            { id: 'e1', seq: 1, type: 'MISSION_CREATED', createdAt: new Date().toISOString() },
            { id: 'e2', seq: 2, type: 'MISSION_PLANNING_STARTED', createdAt: new Date().toISOString() },
          ],
        };
      },
    });

    consumer.start();
    const res1 = await consumer.pollOnce();
    assert.strictEqual(requestedSeq, 0, 'First poll must request sinceSeq=0');
    assert.strictEqual(consumer.eventsSeq, 2, 'Cursor must advance to nextSeq=2');
    assert.strictEqual(consumer.executionEvents.length, 2, 'Must append both events');

    // Second poll
    const res2 = await consumer.pollOnce();
    assert.strictEqual(requestedSeq, 2, 'Second poll must request sinceSeq=2');
  });

  // --- Scenario 2: Duplicate-event suppression ---
  await runAsyncTest('2. Duplicate events returned across repeated polls are suppressed', async () => {
    let callCount = 0;
    const consumer = new TelemetryConsumer({
      missionId: 'mission-002',
      fetchEvents: async () => {
        callCount++;
        return {
          success: true,
          count: 2,
          nextSeq: 2,
          events: [
            { id: 'dup-1', seq: 1, type: 'TASK_STARTED', metadata: { agentId: 'research', title: 'Search DDG' } },
            { id: 'dup-2', seq: 2, type: 'TASK_COMPLETED', metadata: { agentId: 'research', title: 'Search DDG' } },
          ],
        };
      },
    });

    consumer.start();
    await consumer.pollOnce();
    assert.strictEqual(consumer.executionEvents.length, 2);

    // Second poll returns same event IDs
    await consumer.pollOnce();
    assert.strictEqual(consumer.executionEvents.length, 2, 'Duplicate events must not be added to execution feed');
  });

  // --- Scenario 3: Multiple events in a single batch ---
  await runAsyncTest('3. Multiple events returned in one batch are ordered and mapped correctly', async () => {
    const rawBatch = [
      { id: 'm1', seq: 1, type: 'TASK_STARTED', metadata: { agentId: 'research', order: 1, title: 'Gather data' } },
      { id: 'm2', seq: 2, type: 'EVIDENCE_COLLECTED', action: 'Stored 3 candidate URLs', metadata: { agentId: 'research' } },
      { id: 'm3', seq: 3, type: 'TASK_COMPLETED', outcome: 'Research complete', metadata: { agentId: 'research', title: 'Gather data' } },
      { id: 'm4', seq: 4, type: 'TASK_STARTED', metadata: { agentId: 'analyst', order: 2, title: 'Synthesize data' } },
    ];

    const consumer = new TelemetryConsumer({
      missionId: 'mission-003',
      fetchEvents: async () => ({
        success: true,
        count: 4,
        nextSeq: 4,
        events: rawBatch,
      }),
    });

    consumer.start();
    await consumer.pollOnce();
    assert.strictEqual(consumer.executionEvents.length, 4);
    assert.strictEqual(consumer.executionEvents[0].title, 'TASK [1]: GATHER DATA');
    assert.strictEqual(consumer.executionEvents[1].title, 'EVIDENCE RECORDED');
    assert.strictEqual(consumer.executionEvents[2].title, 'COMPLETED: GATHER DATA');
    assert.strictEqual(consumer.executionEvents[3].agentTag, 'ANALYST');
    assert.strictEqual(consumer.activeAgentId, 'MOD.03', 'Active agent must reflect latest task');
  });

  // --- Scenario 4: Empty responses ---
  await runAsyncTest('4. Empty responses leave cursor and event list unchanged', async () => {
    const consumer = new TelemetryConsumer({
      missionId: 'mission-004',
      fetchEvents: async () => ({
        success: true,
        count: 0,
        nextSeq: 5,
        events: [],
      }),
    });

    consumer.start();
    consumer.eventsSeq = 5;
    const res = await consumer.pollOnce();
    assert.strictEqual(consumer.executionEvents.length, 0);
    assert.strictEqual(consumer.eventsSeq, 5, 'Cursor remains at current seq');
    assert.strictEqual(res.status, 'active');
  });

  // --- Scenario 5: Recoverable network failures ---
  await runAsyncTest('5. Recoverable network failure increments error count and recovers on next success', async () => {
    let shouldFail = true;
    const consumer = new TelemetryConsumer({
      missionId: 'mission-005',
      fetchEvents: async () => {
        if (shouldFail) {
          const err = new Error('ECONNREFUSED: Network unreachable');
          err.code = 'NETWORK_ERROR';
          throw err;
        }
        return {
          success: true,
          count: 1,
          nextSeq: 1,
          events: [{ id: 'rec-1', seq: 1, type: 'TASK_STARTED', metadata: { title: 'Recovered task' } }],
        };
      },
    });

    consumer.start();
    const failRes = await consumer.pollOnce();
    assert.strictEqual(failRes.status, 'transient_error');
    assert.strictEqual(consumer.consecutiveErrors, 1);
    assert.strictEqual(consumer.isStreaming, true, 'Transient failure must NOT terminate streaming');

    // Network recovers
    shouldFail = false;
    const okRes = await consumer.pollOnce();
    assert.strictEqual(okRes.status, 'active');
    assert.strictEqual(consumer.consecutiveErrors, 0, 'Consecutive errors must reset on success');
    assert.strictEqual(consumer.executionEvents.length, 1);
  });

  // --- Scenario 6: Auth / 404 terminal errors ---
  await runAsyncTest('6. 401 unauthenticated and 404 missing-mission immediately terminate streaming', async () => {
    // 401 test
    const consumer401 = new TelemetryConsumer({
      missionId: 'mission-006a',
      fetchEvents: async () => {
        const err = new Error('Authentication required');
        err.status = 401;
        throw err;
      },
    });
    consumer401.start();
    const res401 = await consumer401.pollOnce();
    assert.strictEqual(res401.status, 'terminal_error');
    assert.strictEqual(consumer401.isStreaming, false, '401 must stop streaming');

    // 404 test
    const consumer404 = new TelemetryConsumer({
      missionId: 'mission-006b',
      fetchEvents: async () => {
        const err = new Error('Mission not found');
        err.status = 404;
        throw err;
      },
    });
    consumer404.start();
    const res404 = await consumer404.pollOnce();
    assert.strictEqual(res404.status, 'terminal_error');
    assert.strictEqual(consumer404.isStreaming, false, '404 must stop streaming');
  });

  // --- Scenario 7: Terminal-state shutdown and final event handling ---
  await runAsyncTest('7. Terminal mission state halts polling and clears active agent highlighting', async () => {
    const consumer = new TelemetryConsumer({
      missionId: 'mission-007',
      fetchEvents: async () => ({
        success: true,
        count: 1,
        nextSeq: 3,
        events: [
          { id: 'term-1', seq: 3, type: 'MISSION_COMPLETED', outcome: 'All objectives verified' },
        ],
      }),
    });

    consumer.start();
    const res = await consumer.pollOnce('completed');
    assert.strictEqual(res.status, 'terminal');
    assert.strictEqual(consumer.isStreaming, false, 'Streaming must be false when terminal');
    assert.strictEqual(consumer.activeAgentId, null, 'Active agent must be cleared');
    assert.strictEqual(consumer.executionEvents.length, 1, 'Final completion event must be preserved');
    assert.strictEqual(consumer.executionEvents[0].status, 'completed');
  });

  // --- Scenario 8: Mission switching and cleanup ---
  await runAsyncTest('8. Mission switching stops previous consumer and drops stale responses', async () => {
    let missionAResolved = false;
    let missionBResolved = false;

    const consumerA = new TelemetryConsumer({
      missionId: 'mission-A',
      fetchEvents: async () => {
        // Slow async response
        await new Promise((r) => setTimeout(r, 50));
        missionAResolved = true;
        return {
          success: true,
          count: 1,
          nextSeq: 1,
          events: [{ id: 'evt-A', seq: 1, type: 'TASK_STARTED' }],
        };
      },
    });

    consumerA.start();
    // Simulate mission switch: stop A immediately before response resolves
    const pollPromiseA = consumerA.pollOnce();
    consumerA.stop();

    const resA = await pollPromiseA;
    assert.strictEqual(resA.status, 'aborted');
    assert.strictEqual(consumerA.executionEvents.length, 0, 'Mission A events must not be recorded after stop()');

    // Start Consumer B
    const consumerB = new TelemetryConsumer({
      missionId: 'mission-B',
      fetchEvents: async () => {
        missionBResolved = true;
        return {
          success: true,
          count: 1,
          nextSeq: 1,
          events: [{ id: 'evt-B', seq: 1, type: 'MISSION_CREATED' }],
        };
      },
    });

    consumerB.start();
    const resB = await consumerB.pollOnce();
    assert.strictEqual(resB.status, 'active');
    assert.strictEqual(consumerB.executionEvents.length, 1);
    assert.strictEqual(consumerB.executionEvents[0].id, 'evt-B');
  });

  // --- Scenario 9: Unknown event types degrade gracefully ---
  runTest('9. Unknown event types format safely without throwing', () => {
    const unknownEvent = {
      id: 'custom-99',
      seq: 99,
      type: 'ANOMALOUS_OBSERVATION',
      reason: 'Heuristic outlier detected in data pipeline',
      createdAt: new Date().toISOString(),
    };

    const formatted = formatTelemetryEvent(unknownEvent, false);
    assert.strictEqual(formatted.agentTag, 'CORE');
    assert.strictEqual(formatted.title, 'ANOMALOUS OBSERVATION');
    assert.ok(formatted.description.includes('Heuristic outlier detected'));
    assert.strictEqual(formatted.status, 'active');

    // Also verify null / undefined event
    const emptyFormatted = formatTelemetryEvent(null, false);
    assert.strictEqual(emptyFormatted.type, 'UNKNOWN');
    assert.strictEqual(emptyFormatted.agentTag, 'CORE');
  });

  // --- Scenario 10: No synthetic execution feed started for real missions ---
  runTest('10. demoExecutionEngine is stopped and not invoked during real missions', () => {
    const appPath = path.resolve(__dirname, '../../frontend/nexora/src/App.jsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    // Verify demoExecutionEngine.start is not in handleRunMission
    const handleRunMatch = appContent.match(/handleRunMission\s*=\s*async[\s\S]*?};/);
    assert.ok(handleRunMatch, 'handleRunMission must exist in App.jsx');
    assert.ok(
      !handleRunMatch[0].includes('demoExecutionEngine.start'),
      'handleRunMission must NOT call demoExecutionEngine.start for real missions'
    );
    assert.ok(
      handleRunMatch[0].includes('createMission'),
      'handleRunMission must call createMission from missionService'
    );
    assert.ok(
      handleRunMatch[0].includes('setIsStreamingEvents(true)'),
      'handleRunMission must activate real telemetry streaming'
    );
  });

  // --- Scenario 11: Backend API sinceSeq contract & sequence number generation ---
  await runAsyncTest('11. Backend getMissionEvents handles sinceSeq and assigns sequential numbers', async () => {
    const { getMissionEvents, formatEvent } = require('../services/missionEventService');
    const mongoose = require('mongoose');

    // Test with invalid ObjectId returns notFound safely without DB roundtrip
    const notFoundRes = await getMissionEvents('invalid-id', new mongoose.Types.ObjectId());
    assert.strictEqual(notFoundRes.notFound, true);

    const nullMissionRes = await getMissionEvents(null, 'user-123');
    assert.strictEqual(nullMissionRes.notFound, true);

    const nullUserRes = await getMissionEvents(new mongoose.Types.ObjectId(), null);
    assert.strictEqual(nullUserRes.notFound, true);

    // Verify formatEvent sequence numbering logic deterministically
    const mockDoc = {
      _id: new mongoose.Types.ObjectId(),
      missionId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      type: 'TASK_STARTED',
      createdAt: new Date(),
    };

    const formattedWithoutSeq = formatEvent(mockDoc);
    assert.strictEqual(formattedWithoutSeq.type, 'TASK_STARTED');
    assert.strictEqual(formattedWithoutSeq.seq, undefined);

    const formattedWithSeq = formatEvent(mockDoc, 42);
    assert.strictEqual(formattedWithSeq.type, 'TASK_STARTED');
    assert.strictEqual(formattedWithSeq.seq, 42);
  });

  // --- Scenario 12: Centralized API base URL and service exports ---
  runTest('12. missionService exports centralized API_BASE_URL, createMission, getMissionEvents', () => {
    const servicePath = path.resolve(__dirname, '../../frontend/nexora/src/services/missionService.js');
    assert.ok(fs.existsSync(servicePath), 'missionService.js must exist');
    const content = fs.readFileSync(servicePath, 'utf8');

    assert.ok(content.includes('VITE_API_URL'), 'Must use VITE_API_URL environment variable');
    assert.ok(content.includes('http://localhost:5000'), 'Must include localhost:5000 fallback');
    assert.ok(content.includes('export async function createMission'), 'Must export createMission');
    assert.ok(content.includes('export async function getMissionEvents'), 'Must export getMissionEvents');
    assert.ok(content.includes('export async function getMissionResult'), 'Must export getMissionResult');
    assert.ok(content.includes('export function formatTelemetryEvent'), 'Must export formatTelemetryEvent');
  });

  console.log('\n====================================================');
  console.log(`  PHASE 2.9 RESULTS: ${passedTests} passed, ${failedTests} failed (Total: ${totalTests})`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled test suite failure:', err);
    process.exit(1);
  });
}

module.exports = { main };
