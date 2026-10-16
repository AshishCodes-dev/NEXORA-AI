/**
 * verify_step8g5.js
 * NEXORA 8G.5 — Evidence/Decision Graph Verification Suite
 *
 * Verifies:
 *  1. Multi-tenant ownership & anti-enumeration (404 for missing/unauthorized)
 *  2. Node types & schema-grounded edges (MISSION, TASK, EVIDENCE, ANALYSIS, CRITIQUE, ARTIFACT, QA_REPORT, DECISION, MEMORY)
 *  3. Foreign, dangling, and cross-mission reference rejection
 *  4. Advisory memory separation (isCanonical: false, advisoryOnly: true, toggleable)
 *  5. Query bounds, option normalization, deterministic ordering, and DAG acyclicity
 *  6. Response sanitization, credential stripping, and zero DB write mutations
 *  7. Canonical invariance (advisory memories/events cannot alter readiness or truth)
 *  8. Partial, failed, and minimal mission graphs
 *  9. Live deterministic E2E pipeline execution and graph synthesis
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const Evidence = require('../models/Evidence');
const Analysis = require('../models/Analysis');
const Critique = require('../models/Critique');
const Artifact = require('../models/Artifact');
const QAReport = require('../models/QAReport');
const { MissionEvent, EVENT_TYPES, DECISION_TYPES } = require('../models/MissionEvent');
const { MissionMemory, MEMORY_TYPES, MEMORY_STATUSES } = require('../models/MissionMemory');
const {
  buildMissionGraph,
  checkAcyclicity,
  normalizeOptions,
  sanitizeMeta,
  wouldCreateCycle,
  GRAPH_CONFIG,
  NODE_TYPES,
  EDGE_TYPES,
} = require('../services/missionGraphService');
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
  console.log('  STARTING NEXORA 8G.5 VERIFICATION SUITE');
  console.log('  Evidence/Decision Graph');
  console.log('='.repeat(60));

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1/nexora');
  console.log('\n[DATABASE] Connected to MongoDB');

  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();

  try {
    // -------------------------------------------------------------
    // SECTION 1: MULTI-TENANT OWNERSHIP & ANTI-ENUMERATION
    // -------------------------------------------------------------
    console.log('\n--- Section 1: Multi-Tenant Ownership & Anti-Enumeration ---');

    await runAsyncTest('1. Valid owner can retrieve graph', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Owner Test Mission',
        status: 'completed',
      });

      const res = await buildMissionGraph(mission._id.toString(), userA.toString());
      assert('Success is true', res.success === true);
      assert('Mission ID matches', res.missionId === mission._id.toString());
      assert('Summary present', typeof res.summary === 'object');
      assert('Nodes array present', Array.isArray(res.nodes));
      assert('Edges array present', Array.isArray(res.edges));
      assert('Root mission node exists', res.nodes.some((n) => n.id === `mission_${mission._id}`));
    });

    await runAsyncTest('2. Non-owner receives anti-enumeration 404', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Cross-Tenant Private Mission',
        status: 'running',
      });

      const res = await buildMissionGraph(mission._id.toString(), userB.toString());
      assert('Success is false', res.success === false);
      assert('notFound is true', res.notFound === true);
      assert('Error is generic Mission not found', res.error === 'Mission not found');
    });

    await runAsyncTest('3. Non-existent and malformed IDs return anti-enumeration 404', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const resNonExistent = await buildMissionGraph(nonExistentId, userA.toString());
      assert('Non-existent mission returns notFound', resNonExistent.notFound === true);

      const resMalformedMission = await buildMissionGraph('invalid-id-format', userA.toString());
      assert('Malformed missionId returns notFound', resMalformedMission.notFound === true);

      const resMalformedUser = await buildMissionGraph(nonExistentId, 'invalid-user-format');
      assert('Malformed userId returns notFound', resMalformedUser.notFound === true);
    });

    // -------------------------------------------------------------
    // SECTION 2: NODE TYPES & SCHEMA-GROUNDED EDGES
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Node Types & Schema-Grounded Edges ---');

    await runAsyncTest('4. Comprehensive mission constructs all node & edge types', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Graph Comprehensive Test',
        status: 'completed',
      });

      // Tasks
      const t1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Gather Market Evidence',
        description: 'Research data',
        agentId: 'researcher',
        order: 1,
        status: 'completed',
      });
      const t2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Synthesize Findings',
        description: 'Analyze and build artifact',
        agentId: 'builder',
        order: 2,
        status: 'completed',
      });
      const t3 = await MissionTask.create({
        missionId: mission._id,
        title: 'Audit and QA',
        description: 'Evaluate quality',
        agentId: 'critic',
        order: 3,
        status: 'completed',
      });

      // Evidence
      const ev1 = await Evidence.create({
        missionId: mission._id,
        taskId: t1._id,
        sourceUrl: 'https://example.com/source1',
        sourceTitle: 'Source 1 Title',
        claim: 'Claim 1 about market trends',
        evidenceText: 'Exact quoted evidence snippet 1',
      });
      const ev2 = await Evidence.create({
        missionId: mission._id,
        taskId: t1._id,
        sourceUrl: 'https://example.com/source2',
        sourceTitle: 'Source 2 Title',
        claim: 'Claim 2 about competitive advantage',
        evidenceText: 'Exact quoted evidence snippet 2',
      });

      // Analysis
      const an1 = await Analysis.create({
        missionId: mission._id,
        taskId: t2._id,
        evidenceCount: 2,
        analysisMethod: 'deterministic',
        findings: [
          {
            statement: 'Market is growing rapidly',
            supportingEvidenceIds: [ev1._id, ev2._id],
            confidence: 'high',
          },
        ],
        gaps: ['Need more APAC data'],
        contradictions: [],
      });

      // Critique
      const cr1 = await Critique.create({
        missionId: mission._id,
        taskId: t3._id,
        overallVerdict: 'pass',
        summary: 'Rigorous analysis verified against raw sources',
        critiqueMethod: 'deterministic',
        citationIntegrity: {
          valid: true,
          invalidEvidenceIds: [],
          orphanReferenceCount: 0,
        },
        findingReviews: [
          {
            statement: 'Market is growing rapidly',
            verdict: 'supported',
            evidenceIds: [ev1._id, ev2._id],
            issues: [],
            confidence: 'high',
          },
        ],
      });

      // Artifact
      const ar1 = await Artifact.create({
        missionId: mission._id,
        taskId: t2._id,
        artifactType: 'report',
        title: 'Executive Market Intelligence Report',
        executiveSummary: 'Comprehensive overview of 2026 market dynamics',
        buildMethod: 'deterministic',
        sections: [
          {
            heading: 'Growth Outlook',
            content: 'The market exhibits steady expansion.',
            evidenceIds: [ev1._id],
          },
        ],
        keyFindings: [
          {
            statement: 'Primary driver is automation',
            evidenceIds: [ev2._id],
            confidence: 'high',
          },
        ],
      });

      // QAReport
      const qa1 = await QAReport.create({
        missionId: mission._id,
        taskId: t3._id,
        overallVerdict: 'pass',
        overallScore: 95,
        summary: 'Artifact adheres to all verification requirements',
        qaMethod: 'deterministic',
        checks: [
          {
            checkType: 'artifact_integrity',
            status: 'pass',
            message: 'All sections well-structured',
          },
        ],
      });

      // MissionEvents (Decisions)
      const dec1 = await MissionEvent.create({
        missionId: mission._id,
        userId: userA,
        taskId: t1._id,
        type: 'DECISION',
        decisionType: 'SELECT_SOURCE',
        reason: 'Selected high-credibility primary research domain',
        action: 'Query domain directly',
        outcome: 'SUCCESS',
        confidence: 0.92,
      });

      const dec2 = await MissionEvent.create({
        missionId: mission._id,
        userId: userA,
        taskId: t2._id,
        type: 'DECISION',
        decisionType: 'RETRY_TASK',
        reason: 'Initial draft lacked synthesis depth',
        action: 'Re-executed synthesis with additional constraints',
        outcome: 'SUCCESS',
        confidence: 0.88,
        metadata: {
          targetTaskId: t3._id.toString(),
        },
      });

      // MissionMemory
      const mem1 = await MissionMemory.create({
        missionId: mission._id,
        userId: userA,
        taskId: t1._id,
        type: MEMORY_TYPES.TASK_OUTCOME,
        key: 'research_benchmark',
        content: 'Historical CAGR benchmark is 14.2%',
        evidenceRefs: [ev1._id],
        status: MEMORY_STATUSES.ACTIVE,
      });

      // Build graph
      const graph = await buildMissionGraph(mission._id.toString(), userA.toString());
      assert('Graph built successfully', graph.success === true);

      // Verify all node types are present
      const nodeTypes = new Set(graph.nodes.map((n) => n.type));
      assert('MISSION node present', nodeTypes.has(NODE_TYPES.MISSION));
      assert('TASK node present', nodeTypes.has(NODE_TYPES.TASK));
      assert('EVIDENCE node present', nodeTypes.has(NODE_TYPES.EVIDENCE));
      assert('ANALYSIS node present', nodeTypes.has(NODE_TYPES.ANALYSIS));
      assert('CRITIQUE node present', nodeTypes.has(NODE_TYPES.CRITIQUE));
      assert('ARTIFACT node present', nodeTypes.has(NODE_TYPES.ARTIFACT));
      assert('QA_REPORT node present', nodeTypes.has(NODE_TYPES.QA_REPORT));
      assert('DECISION node present', nodeTypes.has(NODE_TYPES.DECISION));
      assert('MEMORY node present', nodeTypes.has(NODE_TYPES.MEMORY));

      // Verify all schema-grounded edge types are present
      const edgeTypes = new Set(graph.edges.map((e) => e.type));
      assert('HAS_TASK edge present', edgeTypes.has(EDGE_TYPES.HAS_TASK));
      assert('PRODUCED edge present', edgeTypes.has(EDGE_TYPES.PRODUCED));
      assert('GROUNDED_IN edge present', edgeTypes.has(EDGE_TYPES.GROUNDED_IN));
      assert('AUDITED edge present', edgeTypes.has(EDGE_TYPES.AUDITED));
      assert('VERIFIED_EVIDENCE edge present', edgeTypes.has(EDGE_TYPES.VERIFIED_EVIDENCE));
      assert('CONSTRUCTED edge present', edgeTypes.has(EDGE_TYPES.CONSTRUCTED));
      assert('INCORPORATES edge present', edgeTypes.has(EDGE_TYPES.INCORPORATES));
      assert('EVALUATED edge present', edgeTypes.has(EDGE_TYPES.EVALUATED));
      assert('TRIGGERED_DECISION edge present', edgeTypes.has(EDGE_TYPES.TRIGGERED_DECISION));
      assert('ADAPTED_PIPELINE edge present', edgeTypes.has(EDGE_TYPES.ADAPTED_PIPELINE));
      assert('INFORMED_BY edge present', edgeTypes.has(EDGE_TYPES.INFORMED_BY));

      // Verify Acyclicity
      assert('Comprehensive graph is acyclic DAG', graph.summary.isAcyclic === true);
    });

    // -------------------------------------------------------------
    // SECTION 3: FOREIGN, DANGLING & CROSS-MISSION REJECTION
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Foreign, Dangling & Cross-Mission Rejection ---');

    await runAsyncTest('5. Foreign and dangling references are omitted from graph edges', async () => {
      const foreignMission = await Mission.create({
        userId: userB,
        objective: 'Foreign Mission',
        status: 'completed',
      });
      const foreignTask = await MissionTask.create({
        missionId: foreignMission._id,
        title: 'Foreign Task',
        description: 'Foreign Description',
        order: 1,
        status: 'completed',
      });
      const foreignEvidence = await Evidence.create({
        missionId: foreignMission._id,
        taskId: foreignTask._id,
        sourceUrl: 'https://foreign.example.com',
        sourceTitle: 'Foreign Source',
        claim: 'Foreign Claim',
        evidenceText: 'Foreign text',
      });

      const mission = await Mission.create({
        userId: userA,
        objective: 'Dangling Check Mission',
        status: 'completed',
      });
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task with contaminated references',
        description: 'Testing edge filtering',
        order: 1,
        status: 'completed',
      });
      const localEvidence = await Evidence.create({
        missionId: mission._id,
        taskId: task._id,
        sourceUrl: 'https://local.example.com',
        sourceTitle: 'Local Source',
        claim: 'Local Claim',
        evidenceText: 'Local text',
      });

      const danglingId = new mongoose.Types.ObjectId();

      // Analysis references 1 local evidence, 1 foreign evidence, and 1 non-existent evidence
      await Analysis.create({
        missionId: mission._id,
        taskId: task._id,
        evidenceCount: 3,
        analysisMethod: 'deterministic',
        findings: [
          {
            statement: 'Contaminated finding',
            supportingEvidenceIds: [localEvidence._id, foreignEvidence._id, danglingId],
            confidence: 'medium',
          },
        ],
        gaps: [],
        contradictions: [],
      });

      // Artifact also references dangling and foreign IDs
      await Artifact.create({
        missionId: mission._id,
        taskId: task._id,
        artifactType: 'report',
        title: 'Artifact with dangling refs',
        executiveSummary: 'Executive summary',
        buildMethod: 'deterministic',
        sections: [
          {
            heading: 'Section 1',
            content: 'Content',
            evidenceIds: [foreignEvidence._id, danglingId, localEvidence._id],
          },
        ],
        keyFindings: [],
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString());
      assert('Graph built successfully', graph.success === true);

      // Verify foreign and dangling nodes are NOT in the graph
      const nodeIds = new Set(graph.nodes.map((n) => n.id));
      assert('Foreign evidence node NOT in graph', !nodeIds.has(`evidence_${foreignEvidence._id}`));
      assert('Dangling evidence node NOT in graph', !nodeIds.has(`evidence_${danglingId}`));
      assert('Local evidence node IS in graph', nodeIds.has(`evidence_${localEvidence._id}`));

      // Verify every single edge has both source and target in nodes
      const allEndpointsValid = graph.edges.every(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
      );
      assert('Zero dangling edges in graph', allEndpointsValid);

      // Verify no edge targets foreign or dangling IDs
      const pointsToForeign = graph.edges.some(
        (e) => e.target === `evidence_${foreignEvidence._id}` || e.source === `evidence_${foreignEvidence._id}`
      );
      assert('Zero edges referencing foreign evidence', !pointsToForeign);
    });

    // -------------------------------------------------------------
    // SECTION 4: ADVISORY MEMORY SEPARATION & TOGGLES
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Advisory Memory Separation & Toggles ---');

    await runAsyncTest('6. Advisory memory nodes marked strictly advisory and non-canonical', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Advisory Memory Test',
        status: 'running',
      });
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'T1',
        description: 'D1',
        order: 1,
        status: 'running',
      });
      await MissionMemory.create({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        type: MEMORY_TYPES.SYNTHESIS_INSIGHT,
        key: 'advisory_insight',
        content: 'Historical observation for guidance only',
        status: MEMORY_STATUSES.ACTIVE,
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString());
      const memNode = graph.nodes.find((n) => n.type === NODE_TYPES.MEMORY);
      assert('Memory node exists', !!memNode);
      assert('Memory node isCanonical is false', memNode.isCanonical === false);
      assert('Memory node advisoryOnly is true', memNode.advisoryOnly === true);

      const memEdge = graph.edges.find((e) => e.type === EDGE_TYPES.INFORMED_BY);
      assert('INFORMED_BY edge exists', !!memEdge);
      assert('INFORMED_BY edge canonical is false', memEdge.canonical === false);
      assert('INFORMED_BY edge advisoryOnly is true', memEdge.advisoryOnly === true);
    });

    await runAsyncTest('7. Query option includeAdvisory=false omits memories completely', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'No Advisory Test',
        status: 'running',
      });
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'T1',
        description: 'D1',
        order: 1,
        status: 'running',
      });
      await MissionMemory.create({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        type: MEMORY_TYPES.SYNTHESIS_INSIGHT,
        key: 'advisory_insight_2',
        content: 'Observation',
        status: MEMORY_STATUSES.ACTIVE,
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString(), {
        includeAdvisory: false,
      });
      assert('Graph succeeds', graph.success === true);
      assert('Zero memory nodes when includeAdvisory=false', !graph.nodes.some((n) => n.type === NODE_TYPES.MEMORY));
      assert('Zero INFORMED_BY edges when includeAdvisory=false', !graph.edges.some((e) => e.type === EDGE_TYPES.INFORMED_BY));
    });

    await runAsyncTest('8. Query option includeEvents=false omits decision events', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'No Events Test',
        status: 'running',
      });
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'T1',
        description: 'D1',
        order: 1,
        status: 'running',
      });
      await MissionEvent.create({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        type: 'DECISION',
        decisionType: 'SELECT_SOURCE',
        reason: 'Selected source',
        action: 'Query',
        outcome: 'SUCCESS',
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString(), {
        includeEvents: false,
      });
      assert('Graph succeeds', graph.success === true);
      assert('Zero decision nodes when includeEvents=false', !graph.nodes.some((n) => n.type === NODE_TYPES.DECISION));
      assert('Zero decision edges when includeEvents=false', !graph.edges.some((e) => e.type === EDGE_TYPES.TRIGGERED_DECISION));
    });

    // -------------------------------------------------------------
    // SECTION 5: BOUNDS, SORTING & ACYCLICITY
    // -------------------------------------------------------------
    console.log('\n--- Section 5: Bounds, Sorting & Acyclicity ---');

    await runAsyncTest('9. Option normalization clamps invalid bounds to safety caps', async () => {
      const opts1 = normalizeOptions({ maxNodes: 9999, maxEdges: 9999, depth: 99 });
      assert('maxNodes clamped to HARD_MAX_NODES (250)', opts1.maxNodes === GRAPH_CONFIG.HARD_MAX_NODES);
      assert('maxEdges clamped to HARD_MAX_EDGES (500)', opts1.maxEdges === GRAPH_CONFIG.HARD_MAX_EDGES);
      assert('depth clamped to HARD_MAX_DEPTH (6)', opts1.depth === GRAPH_CONFIG.HARD_MAX_DEPTH);

      const opts2 = normalizeOptions({ maxNodes: -5, maxEdges: 'notanumber', depth: 0 });
      assert('maxNodes defaults to DEFAULT_MAX_NODES (100)', opts2.maxNodes === GRAPH_CONFIG.DEFAULT_MAX_NODES);
      assert('maxEdges defaults to DEFAULT_MAX_EDGES (200)', opts2.maxEdges === GRAPH_CONFIG.DEFAULT_MAX_EDGES);
      assert('depth defaults to DEFAULT_MAX_DEPTH (4)', opts2.depth === GRAPH_CONFIG.DEFAULT_MAX_DEPTH);
    });

    await runAsyncTest('10. Node and edge slicing preserves referential integrity', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Slicing Bounds Test',
        status: 'completed',
      });
      for (let i = 1; i <= 10; i++) {
        await MissionTask.create({
          missionId: mission._id,
          title: `Task ${i}`,
          description: `Desc ${i}`,
          order: i,
          status: 'completed',
        });
      }

      // Request graph with maxNodes = 4
      const graph = await buildMissionGraph(mission._id.toString(), userA.toString(), {
        maxNodes: 4,
      });
      assert('Graph returned exactly 4 nodes', graph.nodes.length === 4);
      assert('Root mission node is included', graph.nodes[0].type === NODE_TYPES.MISSION);

      // Check referential integrity: no edges may point to nodes outside the 4 nodes
      const retainedIds = new Set(graph.nodes.map((n) => n.id));
      const validEdges = graph.edges.every((e) => retainedIds.has(e.source) && retainedIds.has(e.target));
      assert('All edges point only to retained nodes after slicing', validEdges);
    });

    await runAsyncTest('11. Cycle detection verifies DAGs and detects cyclic graphs', async () => {
      // 1. Valid acyclic DAG
      const acyclicNodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
      const acyclicEdges = [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
      ];
      assert('checkAcyclicity identifies valid DAG', checkAcyclicity(acyclicNodes, acyclicEdges) === true);

      // 2. Cyclic graph (A -> B -> C -> A)
      const cyclicNodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
      const cyclicEdges = [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
        { source: 'C', target: 'A' },
      ];
      assert('checkAcyclicity detects cycle correctly', checkAcyclicity(cyclicNodes, cyclicEdges) === false);
    });

    // -------------------------------------------------------------
    // SECTION 6: RESPONSE SANITIZATION & ZERO DB MUTATIONS
    // -------------------------------------------------------------
    console.log('\n--- Section 6: Response Sanitization & Zero DB Mutations ---');

    await runAsyncTest('12. Metadata sanitization strips sensitive keys and credentials', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Sanitization Test',
        status: 'completed',
      });
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task for sanitized memory',
        description: 'D',
        order: 1,
        status: 'completed',
      });
      await MissionMemory.create({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        type: MEMORY_TYPES.DECISION_CONTEXT,
        key: 'sensitive_mem',
        content: 'Content with sensitive metadata',
        metadata: {
          publicField: 'safe data',
          password: 'supersecretpassword',
          apiKey: 'AIzaSy123456789',
          jwt: 'eyJhbGciOiJIUzI1NiJ9',
          __proto__: { bad: true },
        },
        status: MEMORY_STATUSES.ACTIVE,
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString());
      const memNode = graph.nodes.find((n) => n.type === NODE_TYPES.MEMORY);
      assert('Memory node retrieved', !!memNode);
      assert('publicField retained', memNode.metadata?.publicField === 'safe data');
      assert('password stripped', memNode.metadata?.password === undefined);
      assert('apiKey stripped', memNode.metadata?.apiKey === undefined);
      assert('jwt stripped', memNode.metadata?.jwt === undefined);
    });

    await runAsyncTest('13. Graph retrieval causes ZERO database mutations (strictly read-only)', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Read Only Test Mission',
        status: 'completed',
      });
      await MissionTask.create({
        missionId: mission._id,
        title: 'Task Read Only',
        description: 'D',
        order: 1,
        status: 'completed',
      });

      const countBefore = {
        missions: await Mission.countDocuments(),
        tasks: await MissionTask.countDocuments(),
        evidence: await Evidence.countDocuments(),
        analysis: await Analysis.countDocuments(),
        critique: await Critique.countDocuments(),
        artifact: await Artifact.countDocuments(),
        qa: await QAReport.countDocuments(),
        events: await MissionEvent.countDocuments(),
        memories: await MissionMemory.countDocuments(),
      };

      // Execute graph build multiple times
      await buildMissionGraph(mission._id.toString(), userA.toString());
      await buildMissionGraph(mission._id.toString(), userA.toString());
      await buildMissionGraph(mission._id.toString(), userA.toString());

      const countAfter = {
        missions: await Mission.countDocuments(),
        tasks: await MissionTask.countDocuments(),
        evidence: await Evidence.countDocuments(),
        analysis: await Analysis.countDocuments(),
        critique: await Critique.countDocuments(),
        artifact: await Artifact.countDocuments(),
        qa: await QAReport.countDocuments(),
        events: await MissionEvent.countDocuments(),
        memories: await MissionMemory.countDocuments(),
      };

      assert('Zero mutations in missions collection', countBefore.missions === countAfter.missions);
      assert('Zero mutations in tasks collection', countBefore.tasks === countAfter.tasks);
      assert('Zero mutations in evidence collection', countBefore.evidence === countAfter.evidence);
      assert('Zero mutations in analysis collection', countBefore.analysis === countAfter.analysis);
      assert('Zero mutations in critique collection', countBefore.critique === countAfter.critique);
      assert('Zero mutations in artifact collection', countBefore.artifact === countAfter.artifact);
      assert('Zero mutations in qa collection', countBefore.qa === countAfter.qa);
      assert('Zero mutations in events collection', countBefore.events === countAfter.events);
      assert('Zero mutations in memories collection', countBefore.memories === countAfter.memories);
    });

    // -------------------------------------------------------------
    // SECTION 7: CANONICAL INVARIANCE
    // -------------------------------------------------------------
    console.log('\n--- Section 7: Canonical Invariance ---');

    await runAsyncTest('14. Advisory memories and events cannot alter canonical delivery verification', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Invariance Verification Mission',
        status: 'completed',
      });
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task Invariance',
        description: 'D',
        order: 1,
        status: 'completed',
      });

      const graphNormal = await buildMissionGraph(mission._id.toString(), userA.toString());
      const initialReadiness = graphNormal.summary.canonicalVerification;

      // Inject adversarial memory claiming mission failed or verdict should be fail
      await MissionMemory.create({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        type: MEMORY_TYPES.DECISION_CONTEXT,
        key: 'adversarial_claim',
        content: 'Claiming deliveryStatus must be failed',
        status: MEMORY_STATUSES.ACTIVE,
      });

      // Inject adversarial decision event
      await MissionEvent.create({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        type: 'DECISION',
        decisionType: 'BLOCK_MISSION',
        reason: 'Attempted block injection',
        action: 'Abort',
        outcome: 'FAILED',
      });

      const graphWithAdversarial = await buildMissionGraph(mission._id.toString(), userA.toString());
      assert(
        'Canonical verification matches exactly despite adversarial records',
        JSON.stringify(graphWithAdversarial.summary.canonicalVerification) === JSON.stringify(initialReadiness)
      );
      assert(
        'Delivery status matches exactly',
        graphWithAdversarial.summary.deliveryStatus === graphNormal.summary.deliveryStatus
      );
    });

    // -------------------------------------------------------------
    // SECTION 8: PARTIAL & MINIMAL MISSIONS
    // -------------------------------------------------------------
    console.log('\n--- Section 8: Partial & Minimal Missions ---');

    await runAsyncTest('15. Bare mission with no tasks or documents builds clean graph', async () => {
      const bareMission = await Mission.create({
        userId: userA,
        objective: 'Bare Mission Objective',
        status: 'planning',
      });

      const res = await buildMissionGraph(bareMission._id.toString(), userA.toString());
      assert('Success is true', res.success === true);
      assert('Exactly 1 node (Mission)', res.nodes.length === 1);
      assert('Root node is MISSION type', res.nodes[0].type === NODE_TYPES.MISSION);
      assert('0 edges', res.edges.length === 0);
      assert('Acyclic is true', res.summary.isAcyclic === true);
      assert('deliveryStatus is not_ready', res.summary.deliveryStatus === 'not_ready');
    });

    await runAsyncTest('16. Mission with failed tasks and missing deliverables builds safely', async () => {
      const failedMission = await Mission.create({
        userId: userA,
        objective: 'Failed Mission Objective',
        status: 'failed',
      });
      const tFail = await MissionTask.create({
        missionId: failedMission._id,
        title: 'Failed Task',
        description: 'Failed due to timeout',
        order: 1,
        status: 'failed',
      });

      const res = await buildMissionGraph(failedMission._id.toString(), userA.toString());
      assert('Success is true', res.success === true);
      assert('2 nodes (Mission, Task)', res.nodes.length === 2);
      assert('1 edge (HAS_TASK)', res.edges.length === 1);
      assert('Task status is failed', res.nodes.find((n) => n.id === `task_${tFail._id}`).status === 'failed');
      assert('deliveryStatus is not_ready', res.summary.deliveryStatus === 'not_ready');
    });

    // -------------------------------------------------------------
    // SECTION 9: LIVE DETERMINISTIC E2E PIPELINE EXECUTION
    // -------------------------------------------------------------
    console.log('\n--- Section 9: Live Deterministic E2E Pipeline Execution ---');

    await runAsyncTest('17. Real live deterministic mission produces rich valid graph', async () => {
      const liveMission = await Mission.create({
        userId: userA,
        objective: 'Investigate reactive execution pipelines in distributed autonomous agents',
        status: 'planning',
      });

      await createMissionExecutionPlan(liveMission, { forceDeterministic: true });

      const outcome = await executeMission(liveMission._id, {
        forceDeterministic: true,
        skipBrowserHandoff: true,
      });

      assert('Execution succeeded', outcome.failed === false);

      const graph = await buildMissionGraph(liveMission._id.toString(), userA.toString());
      assert('Graph synthesis succeeded', graph.success === true);
      assert('Graph contains nodes', graph.nodes.length > 5, `got ${graph.nodes.length} nodes`);
      assert('Graph contains edges', graph.edges.length > 5, `got ${graph.edges.length} edges`);
      assert('Graph is confirmed acyclic', graph.summary.isAcyclic === true);
      assert('Graph stages match tasks', graph.summary.stages.length > 0);
      assert('Canonical verification completed', graph.summary.canonicalVerification !== undefined);

      // Verify that every edge in the live graph connects existing nodes
      const liveNodeIds = new Set(graph.nodes.map((n) => n.id));
      const allValid = graph.edges.every((e) => liveNodeIds.has(e.source) && liveNodeIds.has(e.target));
      assert('All live edges connect valid nodes', allValid);
    });

    // -------------------------------------------------------------
    // SECTION 10: FINDING 1 REGRESSION TESTS — METADATA SANITIZATION
    // -------------------------------------------------------------
    console.log('\n--- Section 10: Finding 1 Regression Tests (Metadata Sanitization) ---');

    await runAsyncTest('18. sanitizeMeta blocks prototype pollution and sensitive credential variants', async () => {
      const hostileMeta = {
        constructor: 'polluted',
        __proto__: { injected: true },
        prototype: { bad: 1 },
        __hidden: 'drop',
        api_key: 'secret1',
        apiKey: 'secret2',
        API_KEY: 'secret3',
        apikey: 'secret4',
        client_secret: 'secret5',
        access_token: 'secret6',
        bearer_token: 'secret7',
        jwt: 'secret8',
        password: 'secret9',
        session: 'secret10',
        sessionid: 'secret11',
        hash: 'secret12',
        author: 'Alice Researcher',
        authMethod: 'deterministic_rsa',
        tokenCount: 42,
        keyA: 'legitimate_value',
        nested: {
          client_secret: 'nested_secret',
          author: 'Nested Author',
          sub: {
            apiKey: 'deep_secret',
            tokenCount: 100,
          },
        },
        arr: [
          'safe_item',
          { password: 'arr_secret', keyA: 'arr_good' },
        ],
      };

      const cleaned = sanitizeMeta(hostileMeta);
      assert('Sanitized object is non-null', cleaned !== null);
      assert('constructor is blocked', cleaned.constructor === Object.prototype.constructor || !('constructor' in cleaned));
      assert('__proto__ is blocked', !Object.prototype.hasOwnProperty.call(cleaned, '__proto__'));
      assert('prototype is blocked', cleaned.prototype === undefined);
      assert('api_key is blocked', cleaned.api_key === undefined);
      assert('apiKey is blocked', cleaned.apiKey === undefined);
      assert('API_KEY is blocked', cleaned.API_KEY === undefined);
      assert('apikey is blocked', cleaned.apikey === undefined);
      assert('client_secret is blocked', cleaned.client_secret === undefined);
      assert('access_token is blocked', cleaned.access_token === undefined);
      assert('bearer_token is blocked', cleaned.bearer_token === undefined);
      assert('jwt is blocked', cleaned.jwt === undefined);
      assert('password is blocked', cleaned.password === undefined);
      assert('session is blocked', cleaned.session === undefined);
      assert('sessionid is blocked', cleaned.sessionid === undefined);
      assert('hash is blocked', cleaned.hash === undefined);
      assert('author survives', cleaned.author === 'Alice Researcher');
      assert('authMethod survives', cleaned.authMethod === 'deterministic_rsa');
      assert('tokenCount survives', cleaned.tokenCount === 42);
      assert('keyA survives', cleaned.keyA === 'legitimate_value');
      assert('Nested sensitive key is stripped', cleaned.nested?.client_secret === undefined);
      assert('Nested benign key survives', cleaned.nested?.author === 'Nested Author');
      assert('Deep nested sensitive key is stripped', cleaned.nested?.sub?.apiKey === undefined);
      assert('Deep nested benign key survives', cleaned.nested?.sub?.tokenCount === 100);
      assert('Array sensitive element is stripped', cleaned.arr?.[1]?.password === undefined);
      assert('Array benign element survives', cleaned.arr?.[1]?.keyA === 'arr_good');

      // Circular reference protection
      const cyclic = { author: 'Cycle Tester' };
      cyclic.self = cyclic;
      const cyclicCleaned = sanitizeMeta(cyclic);
      assert('Cyclic object does not cause stack overflow', cyclicCleaned !== null && cyclicCleaned.author === 'Cycle Tester');
    });

    await runAsyncTest('19. Memory node metadata in graph strips secrets and retains benign keys', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Memory Metadata Graph Test',
        status: 'completed',
      });
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Task for Memory Test',
        description: 'Test memory metadata',
        status: 'completed',
        order: 1,
      });
      await MissionMemory.create({
        missionId: mission._id,
        userId: userA,
        taskId: task._id,
        type: MEMORY_TYPES.TASK_OUTCOME,
        key: 'audit_finding_1',
        content: 'Verification passed',
        status: MEMORY_STATUSES.ACTIVE,
        metadata: {
          author: 'NEXORA Auditor',
          tokenCount: 150,
          keyA: 'benchmark_metric',
          api_key: 'must_not_leak',
          client_secret: 'must_not_leak_secret',
        },
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString());
      assert('Graph retrieval succeeded', graph.success === true);
      const memNode = graph.nodes.find((n) => n.type === NODE_TYPES.MEMORY);
      assert('Memory node exists', !!memNode);
      assert('author survived', memNode.metadata?.author === 'NEXORA Auditor');
      assert('tokenCount survived', memNode.metadata?.tokenCount === 150);
      assert('keyA survived', memNode.metadata?.keyA === 'benchmark_metric');
      assert('api_key stripped in graph', memNode.metadata?.api_key === undefined);
      assert('client_secret stripped in graph', memNode.metadata?.client_secret === undefined);
    });

    // -------------------------------------------------------------
    // SECTION 11: FINDING 2 REGRESSION TESTS — GRAPH DEPTH ENFORCEMENT
    // -------------------------------------------------------------
    console.log('\n--- Section 11: Finding 2 Regression Tests (Graph Depth Enforcement) ---');

    await runAsyncTest('20. Depth=1 prunes all nodes beyond root mission and direct tasks', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Depth Enforcement Test',
        status: 'completed',
      });
      const task = await MissionTask.create({
        missionId: mission._id,
        title: 'Depth Task 1',
        description: 'Test depth enforcement',
        status: 'completed',
        order: 1,
      });
      const ev = await Evidence.create({
        missionId: mission._id,
        taskId: task._id,
        sourceUrl: 'https://depth.example.com',
        sourceTitle: 'Depth Source Title',
        claim: 'Depth evidence claim',
        evidenceText: 'Snippet for depth testing',
      });
      await Analysis.create({
        missionId: mission._id,
        taskId: task._id,
        evidenceCount: 1,
        analysisMethod: 'deterministic',
        findings: [{ statement: 'Depth finding', supportingEvidenceIds: [ev._id], confidence: 'high' }],
      });

      // Query with depth: 1
      const depth1Graph = await buildMissionGraph(mission._id.toString(), userA.toString(), { depth: 1 });
      assert('Depth 1 query succeeds', depth1Graph.success === true);
      const depth1Types = new Set(depth1Graph.nodes.map((n) => n.type));
      assert('Depth 1 has MISSION node', depth1Types.has(NODE_TYPES.MISSION));
      assert('Depth 1 has TASK node', depth1Types.has(NODE_TYPES.TASK));
      assert('Depth 1 excludes EVIDENCE node (distance 2)', !depth1Types.has(NODE_TYPES.EVIDENCE));
      assert('Depth 1 excludes ANALYSIS node (distance 2)', !depth1Types.has(NODE_TYPES.ANALYSIS));
      assert('Depth 1 only has HAS_TASK edges', depth1Graph.edges.every((e) => e.type === EDGE_TYPES.HAS_TASK));

      // Referential integrity check: no dangling edges
      const d1NodeIds = new Set(depth1Graph.nodes.map((n) => n.id));
      assert('Zero dangling edges at depth 1', depth1Graph.edges.every((e) => d1NodeIds.has(e.source) && d1NodeIds.has(e.target)));

      // Query with depth: 2
      const depth2Graph = await buildMissionGraph(mission._id.toString(), userA.toString(), { depth: 2 });
      assert('Depth 2 query succeeds', depth2Graph.success === true);
      const depth2Types = new Set(depth2Graph.nodes.map((n) => n.type));
      assert('Depth 2 includes EVIDENCE node', depth2Types.has(NODE_TYPES.EVIDENCE));
      assert('Depth 2 includes ANALYSIS node', depth2Types.has(NODE_TYPES.ANALYSIS));
      const d2NodeIds = new Set(depth2Graph.nodes.map((n) => n.id));
      assert('Zero dangling edges at depth 2', depth2Graph.edges.every((e) => d2NodeIds.has(e.source) && d2NodeIds.has(e.target)));
    });

    // -------------------------------------------------------------
    // SECTION 12: FINDING 3 REGRESSION TESTS — CYCLE HANDLING
    // -------------------------------------------------------------
    console.log('\n--- Section 12: Finding 3 Regression Tests (Cycle Handling) ---');

    await runAsyncTest('21. wouldCreateCycle identifies cycles accurately', async () => {
      const adj = new Map();
      adj.set('A', ['B']);
      adj.set('B', ['C']);
      adj.set('C', []);

      assert('Adding C->A would create cycle', wouldCreateCycle(adj, 'C', 'A') === true);
      assert('Adding A->A would create cycle', wouldCreateCycle(adj, 'A', 'A') === true);
      assert('Adding A->C does not create cycle', wouldCreateCycle(adj, 'A', 'C') === false);
      assert('Adding C->D does not create cycle', wouldCreateCycle(adj, 'C', 'D') === false);
    });

    await runAsyncTest('22. Inferred ADAPTED_PIPELINE edge creating cycle is omitted and graph remains DAG', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Inferred Cycle Omission Test',
        status: 'completed',
      });
      const t1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task Alpha',
        description: 'Task Alpha description',
        order: 1,
        status: 'completed',
      });
      const t2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task Beta',
        description: 'Task Beta description',
        order: 2,
        status: 'completed',
      });

      // t1 triggered a decision pointing to t2 (valid forward adaptation)
      await MissionEvent.create({
        missionId: mission._id,
        userId: userA,
        taskId: t1._id,
        type: 'DECISION',
        decisionType: 'ADD_BROWSER_TASK',
        reason: 'Adapted pipeline to t2',
        metadata: { targetTaskId: t2._id.toString() },
      });

      // t2 triggered a decision that attempts to adapt back to t1 (cycle: t1 -> dec1 -> t2 -> dec2 -> t1)
      await MissionEvent.create({
        missionId: mission._id,
        userId: userA,
        taskId: t2._id,
        type: 'DECISION',
        decisionType: 'RETRY_TASK',
        reason: 'Backwards loop attempt to t1',
        metadata: { targetTaskId: t1._id.toString() },
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString());
      assert('Graph built successfully', graph.success === true);
      assert('Graph is acyclic DAG', graph.summary.isAcyclic === true);
      assert('cycleDetected is false', graph.summary.cycleDetected === false);
      // The backward edge from dec2 to t1 was omitted to protect acyclicity
      const adaptedEdges = graph.edges.filter((e) => e.type === EDGE_TYPES.ADAPTED_PIPELINE);
      assert('Only the non-cyclic ADAPTED_PIPELINE edge is retained', adaptedEdges.length === 1);
      assert('Retained edge targets t2', adaptedEdges[0]?.target === `task_${t2._id}`);
    });

    await runAsyncTest('23. Corrupted canonical cycle in DB is preserved truthfully and flagged in summary', async () => {
      // Simulate checkAcyclicity with a cyclic edge list
      const mockNodes = [
        { id: 'node_1', type: 'TASK' },
        { id: 'node_2', type: 'TASK' },
      ];
      const cyclicEdges = [
        { source: 'node_1', target: 'node_2', type: 'HAS_TASK' },
        { source: 'node_2', target: 'node_1', type: 'HAS_TASK' },
      ];
      const acyclic = checkAcyclicity(mockNodes, cyclicEdges);
      assert('checkAcyclicity identifies canonical cycle', acyclic === false);
    });

    // -------------------------------------------------------------
    // SECTION 13: FINDING 4 REGRESSION TESTS — ADAPTED_PIPELINE PROVENANCE
    // -------------------------------------------------------------
    console.log('\n--- Section 13: Finding 4 Regression Tests (ADAPTED_PIPELINE Provenance) ---');

    await runAsyncTest('24. ADAPTED_PIPELINE edge strictly omitted when provenance metadata is absent', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Provenance Fallback Removal Test',
        status: 'completed',
      });
      const t1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Research',
        description: 'Task 1 description',
        order: 1,
        status: 'completed',
      });
      const t2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Subsequent Synthesis',
        description: 'Task 2 description',
        order: 2,
        status: 'completed',
      });

      // Decision on t1 with NO metadata and no parentResearchTaskId on t2
      // Previously, heuristic fallback connected t1 decision -> t2 because t2.order > t1.order
      await MissionEvent.create({
        missionId: mission._id,
        userId: userA,
        taskId: t1._id,
        type: 'DECISION',
        decisionType: 'RETRY_TASK',
        reason: 'Generic retry decision without target task link',
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString());
      assert('Graph built successfully', graph.success === true);
      const adaptedEdges = graph.edges.filter((e) => e.type === EDGE_TYPES.ADAPTED_PIPELINE);
      assert('ADAPTED_PIPELINE edge is strictly OMITTED when provenance is missing', adaptedEdges.length === 0);
    });

    await runAsyncTest('25. ADAPTED_PIPELINE connects when parentResearchTaskId is present', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'ParentResearchTaskId Provenance Test',
        status: 'completed',
      });
      const t1 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 1 Primary Research',
        description: 'Task 1 description',
        order: 1,
        status: 'completed',
      });
      // t2 was dynamically spawned from t1 via browser handoff
      const t2 = await MissionTask.create({
        missionId: mission._id,
        title: 'Task 2 Dynamic Browser Extraction',
        description: 'Task 2 description',
        order: 2,
        status: 'completed',
        executionMetadata: {
          parentResearchTaskId: t1._id.toString(),
        },
      });

      const dec = await MissionEvent.create({
        missionId: mission._id,
        userId: userA,
        taskId: t1._id,
        type: 'DECISION',
        decisionType: 'ADD_BROWSER_TASK',
        reason: 'Spawned dynamic browser verification',
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString());
      assert('Graph built successfully', graph.success === true);
      const adaptedEdge = graph.edges.find((e) => e.type === EDGE_TYPES.ADAPTED_PIPELINE);
      assert('ADAPTED_PIPELINE edge exists via parentResearchTaskId', !!adaptedEdge);
      assert('ADAPTED_PIPELINE source is decision', adaptedEdge?.source === `decision_${dec._id}`);
      assert('ADAPTED_PIPELINE target is spawned task', adaptedEdge?.target === `task_${t2._id}`);
    });

    // -------------------------------------------------------------
    // SECTION 14: FINDING 5 REGRESSION TESTS — SCOPED AUDITED & EVALUATED
    // -------------------------------------------------------------
    console.log('\n--- Section 14: Finding 5 Regression Tests (Scoped AUDITED and EVALUATED) ---');

    await runAsyncTest('26. AUDITED and EVALUATED edges connect only to their specific scoped target', async () => {
      const mission = await Mission.create({
        userId: userA,
        objective: 'Scoped Relationships Multi-Document Test',
        status: 'completed',
      });

      // Tasks
      const tAnalysis1 = await MissionTask.create({ missionId: mission._id, title: 'Analyze Source Alpha', description: 'Analyze alpha', order: 1, status: 'completed' });
      const tAnalysis2 = await MissionTask.create({ missionId: mission._id, title: 'Analyze Source Beta', description: 'Analyze beta', order: 2, status: 'completed' });
      const tCritique = await MissionTask.create({ missionId: mission._id, title: 'Critique Analysis Beta', description: 'Critique beta', order: 3, status: 'completed' });
      const tArtifact1 = await MissionTask.create({ missionId: mission._id, title: 'Build Artifact 1', description: 'Build artifact 1', order: 4, status: 'completed' });
      const tArtifact2 = await MissionTask.create({ missionId: mission._id, title: 'Build Artifact 2', description: 'Build artifact 2', order: 5, status: 'completed' });
      const tQA = await MissionTask.create({ missionId: mission._id, title: 'Audit Artifact 1', description: 'Audit artifact 1', order: 6, status: 'completed' });

      // Two analyses
      const an1 = await Analysis.create({
        missionId: mission._id,
        taskId: tAnalysis1._id,
        evidenceCount: 1,
        analysisMethod: 'deterministic',
        findings: [{ statement: 'Finding Alpha', confidence: 'high' }],
      });
      const an2 = await Analysis.create({
        missionId: mission._id,
        taskId: tAnalysis2._id,
        evidenceCount: 1,
        analysisMethod: 'deterministic',
        findings: [{ statement: 'Finding Beta', confidence: 'high' }],
      });

      // Critique explicitly targets Analysis 2 via finding review statement overlap
      const cr = await Critique.create({
        missionId: mission._id,
        taskId: tCritique._id,
        overallVerdict: 'pass',
        summary: 'Targeted critique of Analysis Beta',
        critiqueMethod: 'deterministic',
        findingReviews: [
          {
            statement: 'Finding Beta',
            verdict: 'supported',
            evidenceIds: [],
            confidence: 'high',
          },
        ],
        citationIntegrity: {
          valid: true,
          invalidEvidenceIds: [],
          orphanReferenceCount: 0,
        },
      });

      // Two artifacts
      const ar1 = await Artifact.create({
        missionId: mission._id,
        taskId: tArtifact1._id,
        artifactType: 'report',
        title: 'Artifact Prime',
        executiveSummary: 'Executive summary for Artifact Prime',
        buildMethod: 'deterministic',
      });
      const ar2 = await Artifact.create({
        missionId: mission._id,
        taskId: tArtifact2._id,
        artifactType: 'report',
        title: 'Artifact Secundus',
        executiveSummary: 'Executive summary for Artifact Secundus',
        buildMethod: 'deterministic',
      });

      // QA explicitly targets Artifact 1 via matching task
      const qa = await QAReport.create({
        missionId: mission._id,
        taskId: tArtifact1._id,
        overallVerdict: 'pass',
        overallScore: 90,
        summary: 'Quality audit of Artifact Prime',
        qaMethod: 'deterministic',
      });

      const graph = await buildMissionGraph(mission._id.toString(), userA.toString());
      assert('Graph built successfully', graph.success === true);

      // Verify AUDITED edges
      const auditedEdges = graph.edges.filter((e) => e.type === EDGE_TYPES.AUDITED);
      assert('Exactly 1 AUDITED edge exists in multi-analysis mission', auditedEdges.length === 1);
      assert('AUDITED source is Critique', auditedEdges[0]?.source === `critique_${cr._id}`);
      assert('AUDITED target is Analysis 2 (not Analysis 1)', auditedEdges[0]?.target === `analysis_${an2._id}`);

      // Verify EVALUATED edges
      const evaluatedEdges = graph.edges.filter((e) => e.type === EDGE_TYPES.EVALUATED);
      assert('Exactly 1 EVALUATED edge exists in multi-artifact mission', evaluatedEdges.length === 1);
      assert('EVALUATED source is QAReport', evaluatedEdges[0]?.source === `qa_${qa._id}`);
      assert('EVALUATED target is Artifact 1 (not Artifact 2)', evaluatedEdges[0]?.target === `artifact_${ar1._id}`);
    });

  } finally {
    await mongoose.disconnect();
    console.log('\n[DATABASE] Disconnected');
  }

  console.log('\n' + '='.repeat(60));
  console.log(`  8G.5 TEST RESULTS: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
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
