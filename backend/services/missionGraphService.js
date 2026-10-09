const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const Evidence = require('../models/Evidence');
const Analysis = require('../models/Analysis');
const Critique = require('../models/Critique');
const Artifact = require('../models/Artifact');
const QAReport = require('../models/QAReport');
const { MissionEvent } = require('../models/MissionEvent');
const { MissionMemory, MEMORY_STATUSES, isSensitiveMetadataKey } = require('../models/MissionMemory');
const { evaluateMissionReadiness } = require('./missionResultService');

/**
 * Bounds & Safety Configuration for Graph Assembly
 */
const GRAPH_CONFIG = {
  DEFAULT_MAX_NODES: 100,
  HARD_MAX_NODES: 250,
  DEFAULT_MAX_EDGES: 200,
  HARD_MAX_EDGES: 500,
  DEFAULT_MAX_DEPTH: 4,
  HARD_MAX_DEPTH: 6,
  MAX_LABEL_LENGTH: 300,
  MAX_TEXT_LENGTH: 500,
  MAX_REASON_LENGTH: 500,
};

/**
 * Supported Graph Node Types
 */
const NODE_TYPES = {
  MISSION: 'MISSION',
  TASK: 'TASK',
  EVIDENCE: 'EVIDENCE',
  ANALYSIS: 'ANALYSIS',
  CRITIQUE: 'CRITIQUE',
  ARTIFACT: 'ARTIFACT',
  QA_REPORT: 'QA_REPORT',
  DECISION: 'DECISION',
  MEMORY: 'MEMORY',
};

/**
 * Supported Graph Edge Types
 */
const EDGE_TYPES = {
  HAS_TASK: 'HAS_TASK',
  PRODUCED: 'PRODUCED',
  GROUNDED_IN: 'GROUNDED_IN',
  AUDITED: 'AUDITED',
  VERIFIED_EVIDENCE: 'VERIFIED_EVIDENCE',
  CONSTRUCTED: 'CONSTRUCTED',
  INCORPORATES: 'INCORPORATES',
  EVALUATED: 'EVALUATED',
  TRIGGERED_DECISION: 'TRIGGERED_DECISION',
  ADAPTED_PIPELINE: 'ADAPTED_PIPELINE',
  INFORMED_BY: 'INFORMED_BY',
};

/**
 * Deterministically bounds string length to prevent megabyte response bloat
 */
function truncateText(str, maxLength) {
  if (typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength) + '... [truncated]';
}

/**
 * Sanitizes object metadata recursively, removing sensitive keys, credential variants,
 * and prototype pollution properties.
 *
 * @param {any} meta
 * @param {number} [depth=0]
 * @param {WeakSet} [seen=new WeakSet()]
 * @returns {any}
 */
function sanitizeMeta(meta, depth = 0, seen = new WeakSet()) {
  if (!meta || typeof meta !== 'object' || depth > 3) return null;
  if (seen.has(meta)) return null;
  seen.add(meta);

  if (Array.isArray(meta)) {
    const cleanArr = [];
    for (const item of meta) {
      if (typeof item === 'string') {
        cleanArr.push(truncateText(item, 200));
      } else if (typeof item === 'number' || typeof item === 'boolean' || item === null) {
        cleanArr.push(item);
      } else if (typeof item === 'object' && item !== null && depth < 3) {
        const nested = sanitizeMeta(item, depth + 1, seen);
        if (nested !== null) cleanArr.push(nested);
      }
    }
    return cleanArr.length > 0 ? cleanArr : null;
  }

  const clean = {};
  for (const [key, value] of Object.entries(meta)) {
    if (isSensitiveMetadataKey(key) || key.startsWith('__')) continue;
    if (typeof value === 'string') {
      clean[key] = truncateText(value, 200);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      clean[key] = value;
    } else if (typeof value === 'object' && value !== null && depth < 3) {
      const nested = sanitizeMeta(value, depth + 1, seen);
      if (nested !== null && (Array.isArray(nested) ? nested.length > 0 : Object.keys(nested).length > 0)) {
        clean[key] = nested;
      }
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/**
 * Safely parses and bounds query options
 */
function normalizeOptions(options = {}) {
  const includeAdvisory =
    options.includeAdvisory === undefined ||
    options.includeAdvisory === true ||
    options.includeAdvisory === 'true';

  const includeEvents =
    options.includeEvents === undefined ||
    options.includeEvents === true ||
    options.includeEvents === 'true';

  let maxNodes = parseInt(options.maxNodes, 10);
  if (isNaN(maxNodes) || maxNodes < 1) {
    maxNodes = GRAPH_CONFIG.DEFAULT_MAX_NODES;
  }
  maxNodes = Math.min(maxNodes, GRAPH_CONFIG.HARD_MAX_NODES);

  let maxEdges = parseInt(options.maxEdges, 10);
  if (isNaN(maxEdges) || maxEdges < 1) {
    maxEdges = GRAPH_CONFIG.DEFAULT_MAX_EDGES;
  }
  maxEdges = Math.min(maxEdges, GRAPH_CONFIG.HARD_MAX_EDGES);

  let depth = parseInt(options.depth, 10);
  if (isNaN(depth) || depth < 1) {
    depth = GRAPH_CONFIG.DEFAULT_MAX_DEPTH;
  }
  depth = Math.min(depth, GRAPH_CONFIG.HARD_MAX_DEPTH);

  return {
    includeAdvisory,
    includeEvents,
    maxNodes,
    maxEdges,
    depth,
  };
}

/**
 * Verifies acyclicity (DAG) using Kahn's algorithm or DFS cycle detection
 *
 * @param {Array<object>} nodes
 * @param {Array<object>} edges
 * @returns {boolean} True if the directed graph contains no cycles
 */
function checkAcyclicity(nodes, edges) {
  const inDegree = new Map();
  const adj = new Map();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of edges) {
    if (adj.has(edge.source) && inDegree.has(edge.target)) {
      adj.get(edge.source).push(edge.target);
      inDegree.set(edge.target, inDegree.get(edge.target) + 1);
    }
  }

  const queue = [];
  for (const [nodeId, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(nodeId);
    }
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const curr = queue.shift();
    visitedCount++;

    const neighbors = adj.get(curr) || [];
    for (const neighbor of neighbors) {
      const newDeg = inDegree.get(neighbor) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  return visitedCount === nodes.length;
}

/**
 * Checks whether adding a directed edge from source to target would create a cycle.
 * Traverses reachable nodes from target to see if source is reachable.
 *
 * @param {Map<string, Array<string>>} adj - Current adjacency list
 * @param {string} source
 * @param {string} target
 * @returns {boolean} True if source is already reachable from target
 */
function wouldCreateCycle(adj, source, target) {
  if (source === target) return true;
  const visited = new Set();
  const queue = [target];
  visited.add(target);

  while (queue.length > 0) {
    const curr = queue.shift();
    if (curr === source) return true;
    const neighbors = adj.get(curr) || [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Builds the mission-scoped, explainable Evidence/Decision graph at read-time.
 * Read-only synthesis from indexed collections with zero database writes.
 *
 * @param {string|mongoose.Types.ObjectId} missionId
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {object} [options={}]
 * @returns {Promise<{ success: boolean, missionId?: string, summary?: object, nodes?: Array, edges?: Array, notFound?: boolean, error?: string }>}
 */
async function buildMissionGraph(missionId, userId, options = {}) {
  try {
    // 1. Validation & Multi-Tenant Authorization
    if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
      return { success: false, notFound: true, error: 'Mission not found' };
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return { success: false, notFound: true, error: 'Mission not found' };
    }

    const mId = new mongoose.Types.ObjectId(missionId);
    const uId = new mongoose.Types.ObjectId(userId);

    // Verify mission ownership (Anti-enumeration: 404 for missing or cross-tenant)
    const mission = await Mission.findOne({ _id: mId, userId: uId }).lean();
    if (!mission) {
      return { success: false, notFound: true, error: 'Mission not found' };
    }

    const config = normalizeOptions(options);

    // 2. Parallel Bounded Read Queries (strictly mission-scoped & projected)
    const [
      tasks,
      evidenceList,
      analysisList,
      critiqueList,
      artifactList,
      qaReportList,
      decisionEvents,
      memories,
    ] = await Promise.all([
      MissionTask.find({ missionId: mId })
        .sort({ order: 1, _id: 1 })
        .limit(100)
        .select('_id title description status order agentId url executionMetadata createdAt')
        .lean(),

      Evidence.find({ missionId: mId })
        .sort({ createdAt: 1, _id: 1 })
        .limit(100)
        .select('_id taskId sourceUrl sourceTitle claim evidenceText retrievedAt createdAt')
        .lean(),

      Analysis.find({ missionId: mId })
        .sort({ createdAt: 1, _id: 1 })
        .limit(20)
        .select('_id taskId findings gaps contradictions createdAt')
        .lean(),

      Critique.find({ missionId: mId })
        .sort({ createdAt: 1, _id: 1 })
        .limit(20)
        .select('_id taskId analysisId overallVerdict summary findingReviews createdAt')
        .lean(),

      Artifact.find({ missionId: mId })
        .sort({ createdAt: 1, _id: 1 })
        .limit(10)
        .select('_id taskId artifactType title executiveSummary sections keyFindings createdAt')
        .lean(),

      QAReport.find({ missionId: mId })
        .sort({ createdAt: 1, _id: 1 })
        .limit(10)
        .select('_id taskId artifactId overallVerdict overallScore summary checks createdAt')
        .lean(),

      config.includeEvents
        ? MissionEvent.find({ missionId: mId, type: 'DECISION' })
            .sort({ createdAt: 1, _id: 1 })
            .limit(100)
            .select('_id taskId decisionType reason action outcome confidence metadata createdAt')
            .lean()
        : Promise.resolve([]),

      config.includeAdvisory
        ? MissionMemory.find({ missionId: mId, status: { $in: [MEMORY_STATUSES.ACTIVE, MEMORY_STATUSES.SUPERSEDED] } })
            .sort({ createdAt: 1, _id: 1 })
            .limit(50)
            .select('_id taskId attempt type key content evidenceRefs status metadata createdAt')
            .lean()
        : Promise.resolve([]),
    ]);

    // 3. Construct In-Memory Node Set
    const nodesById = new Map();
    const rawEdges = [];

    // Root Mission Node
    const rootMissionId = `mission_${mission._id.toString()}`;
    nodesById.set(rootMissionId, {
      id: rootMissionId,
      type: NODE_TYPES.MISSION,
      entityId: mission._id.toString(),
      label: truncateText(mission.objective, GRAPH_CONFIG.MAX_LABEL_LENGTH),
      status: mission.status,
      isCanonical: true,
      advisoryOnly: false,
      createdAt: mission.createdAt ? mission.createdAt.toISOString() : new Date().toISOString(),
    });

    // Task Nodes
    for (const task of tasks) {
      const taskIdStr = `task_${task._id.toString()}`;
      nodesById.set(taskIdStr, {
        id: taskIdStr,
        type: NODE_TYPES.TASK,
        entityId: task._id.toString(),
        label: truncateText(task.title, GRAPH_CONFIG.MAX_LABEL_LENGTH),
        status: task.status,
        agentId: task.agentId || 'unknown',
        order: task.order,
        isCanonical: true,
        advisoryOnly: false,
        metadata: {
          attempt: task.executionMetadata?.attempt || 1,
          isAdaptiveRetry: Boolean(task.executionMetadata?.isAdaptiveRetry),
        },
        createdAt: task.createdAt ? task.createdAt.toISOString() : null,
      });

      // Edge: Mission -> Task
      rawEdges.push({
        source: rootMissionId,
        target: taskIdStr,
        type: EDGE_TYPES.HAS_TASK,
        canonical: true,
        advisoryOnly: false,
      });
    }

    // Evidence Nodes & Task -> Evidence (PRODUCED)
    for (const ev of evidenceList) {
      const evIdStr = `evidence_${ev._id.toString()}`;
      nodesById.set(evIdStr, {
        id: evIdStr,
        type: NODE_TYPES.EVIDENCE,
        entityId: ev._id.toString(),
        label: truncateText(ev.sourceTitle || ev.claim, GRAPH_CONFIG.MAX_LABEL_LENGTH),
        sourceUrl: ev.sourceUrl,
        claim: truncateText(ev.claim, GRAPH_CONFIG.MAX_TEXT_LENGTH),
        isCanonical: true,
        advisoryOnly: false,
        createdAt: ev.createdAt ? ev.createdAt.toISOString() : null,
      });

      if (ev.taskId) {
        const taskIdStr = `task_${ev.taskId.toString()}`;
        if (nodesById.has(taskIdStr)) {
          rawEdges.push({
            source: taskIdStr,
            target: evIdStr,
            type: EDGE_TYPES.PRODUCED,
            canonical: true,
            advisoryOnly: false,
          });
        }
      }
    }

    // Analysis Nodes & Analysis -> Evidence (GROUNDED_IN)
    for (const an of analysisList) {
      const anIdStr = `analysis_${an._id.toString()}`;
      const findingsCount = Array.isArray(an.findings) ? an.findings.length : 0;
      const gapsCount = Array.isArray(an.gaps) ? an.gaps.length : 0;
      const contradictionsCount = Array.isArray(an.contradictions) ? an.contradictions.length : 0;

      nodesById.set(anIdStr, {
        id: anIdStr,
        type: NODE_TYPES.ANALYSIS,
        entityId: an._id.toString(),
        label: `Evidence Analysis (${findingsCount} findings)`,
        findingsCount,
        gapsCount,
        contradictionsCount,
        isCanonical: true,
        advisoryOnly: false,
        createdAt: an.createdAt ? an.createdAt.toISOString() : null,
      });

      // Task -> Analysis (PRODUCED)
      if (an.taskId) {
        const taskIdStr = `task_${an.taskId.toString()}`;
        if (nodesById.has(taskIdStr)) {
          rawEdges.push({
            source: taskIdStr,
            target: anIdStr,
            type: EDGE_TYPES.PRODUCED,
            canonical: true,
            advisoryOnly: false,
          });
        }
      }

      // Analysis -> Evidence (GROUNDED_IN)
      if (Array.isArray(an.findings)) {
        for (const finding of an.findings) {
          if (Array.isArray(finding.supportingEvidenceIds)) {
            for (const refId of finding.supportingEvidenceIds) {
              const evIdStr = `evidence_${refId.toString()}`;
              if (nodesById.has(evIdStr)) {
                rawEdges.push({
                  source: anIdStr,
                  target: evIdStr,
                  type: EDGE_TYPES.GROUNDED_IN,
                  canonical: true,
                  advisoryOnly: false,
                });
              }
            }
          }
        }
      }
    }

    // Critique Nodes & Critique -> Analysis (AUDITED), Critique -> Evidence (VERIFIED_EVIDENCE)
    for (const cr of critiqueList) {
      const crIdStr = `critique_${cr._id.toString()}`;
      const reviewsCount = Array.isArray(cr.findingReviews) ? cr.findingReviews.length : 0;

      nodesById.set(crIdStr, {
        id: crIdStr,
        type: NODE_TYPES.CRITIQUE,
        entityId: cr._id.toString(),
        label: `Critic Audit (${cr.overallVerdict})`,
        overallVerdict: cr.overallVerdict,
        summary: truncateText(cr.summary, GRAPH_CONFIG.MAX_TEXT_LENGTH),
        reviewsCount,
        isCanonical: true,
        advisoryOnly: false,
        createdAt: cr.createdAt ? cr.createdAt.toISOString() : null,
      });

      // Task -> Critique (PRODUCED)
      if (cr.taskId) {
        const taskIdStr = `task_${cr.taskId.toString()}`;
        if (nodesById.has(taskIdStr)) {
          rawEdges.push({
            source: taskIdStr,
            target: crIdStr,
            type: EDGE_TYPES.PRODUCED,
            canonical: true,
            advisoryOnly: false,
          });
        }
      }

      // Critique -> Analysis (AUDITED)
      // Connects Critique to the verified Analysis it audited
      let auditedAnalysis = null;
      if (cr.analysisId) {
        auditedAnalysis = analysisList.find((an) => an._id.toString() === cr.analysisId.toString());
      } else if (cr.taskId) {
        auditedAnalysis = analysisList.find((an) => an.taskId?.toString() === cr.taskId.toString());
      }
      if (!auditedAnalysis && Array.isArray(cr.findingReviews) && cr.findingReviews.length > 0) {
        const reviewStatements = new Set(cr.findingReviews.map((r) => r.statement?.trim().toLowerCase()).filter(Boolean));
        auditedAnalysis = analysisList.find((an) =>
          Array.isArray(an.findings) && an.findings.some((f) => reviewStatements.has(f.statement?.trim().toLowerCase()))
        );
      }
      if (!auditedAnalysis && analysisList.length === 1) {
        auditedAnalysis = analysisList[0];
      }

      if (auditedAnalysis) {
        const anIdStr = `analysis_${auditedAnalysis._id.toString()}`;
        if (nodesById.has(anIdStr)) {
          rawEdges.push({
            source: crIdStr,
            target: anIdStr,
            type: EDGE_TYPES.AUDITED,
            canonical: true,
            advisoryOnly: false,
          });
        }
      }

      // Critique -> Evidence (VERIFIED_EVIDENCE)
      if (Array.isArray(cr.findingReviews)) {
        for (const rev of cr.findingReviews) {
          if (Array.isArray(rev.evidenceIds)) {
            for (const refId of rev.evidenceIds) {
              const evIdStr = `evidence_${refId.toString()}`;
              if (nodesById.has(evIdStr)) {
                rawEdges.push({
                  source: crIdStr,
                  target: evIdStr,
                  type: EDGE_TYPES.VERIFIED_EVIDENCE,
                  canonical: true,
                  advisoryOnly: false,
                });
              }
            }
          }
        }
      }
    }

    // Artifact Nodes & Builder Task -> Artifact (CONSTRUCTED), Artifact -> Evidence (INCORPORATES)
    for (const ar of artifactList) {
      const arIdStr = `artifact_${ar._id.toString()}`;
      nodesById.set(arIdStr, {
        id: arIdStr,
        type: NODE_TYPES.ARTIFACT,
        entityId: ar._id.toString(),
        label: truncateText(ar.title, GRAPH_CONFIG.MAX_LABEL_LENGTH),
        artifactType: ar.artifactType,
        isCanonical: true,
        advisoryOnly: false,
        createdAt: ar.createdAt ? ar.createdAt.toISOString() : null,
      });

      // Task -> Artifact (CONSTRUCTED)
      if (ar.taskId) {
        const taskIdStr = `task_${ar.taskId.toString()}`;
        if (nodesById.has(taskIdStr)) {
          rawEdges.push({
            source: taskIdStr,
            target: arIdStr,
            type: EDGE_TYPES.CONSTRUCTED,
            canonical: true,
            advisoryOnly: false,
          });
        }
      }

      // Artifact -> Evidence (INCORPORATES)
      if (Array.isArray(ar.sections)) {
        for (const sec of ar.sections) {
          if (Array.isArray(sec.evidenceIds)) {
            for (const refId of sec.evidenceIds) {
              const evIdStr = `evidence_${refId.toString()}`;
              if (nodesById.has(evIdStr)) {
                rawEdges.push({
                  source: arIdStr,
                  target: evIdStr,
                  type: EDGE_TYPES.INCORPORATES,
                  canonical: true,
                  advisoryOnly: false,
                });
              }
            }
          }
        }
      }
      if (Array.isArray(ar.keyFindings)) {
        for (const kf of ar.keyFindings) {
          if (Array.isArray(kf.evidenceIds)) {
            for (const refId of kf.evidenceIds) {
              const evIdStr = `evidence_${refId.toString()}`;
              if (nodesById.has(evIdStr)) {
                rawEdges.push({
                  source: arIdStr,
                  target: evIdStr,
                  type: EDGE_TYPES.INCORPORATES,
                  canonical: true,
                  advisoryOnly: false,
                });
              }
            }
          }
        }
      }
    }

    // QAReport Nodes & QAReport -> Artifact (EVALUATED)
    for (const qa of qaReportList) {
      const qaIdStr = `qa_${qa._id.toString()}`;
      nodesById.set(qaIdStr, {
        id: qaIdStr,
        type: NODE_TYPES.QA_REPORT,
        entityId: qa._id.toString(),
        label: `QA Audit (${qa.overallVerdict}, score: ${qa.overallScore ?? 'N/A'})`,
        overallVerdict: qa.overallVerdict,
        overallScore: qa.overallScore,
        summary: truncateText(qa.summary, GRAPH_CONFIG.MAX_TEXT_LENGTH),
        isCanonical: true,
        advisoryOnly: false,
        createdAt: qa.createdAt ? qa.createdAt.toISOString() : null,
      });

      // Task -> QAReport (PRODUCED)
      if (qa.taskId) {
        const taskIdStr = `task_${qa.taskId.toString()}`;
        if (nodesById.has(taskIdStr)) {
          rawEdges.push({
            source: taskIdStr,
            target: qaIdStr,
            type: EDGE_TYPES.PRODUCED,
            canonical: true,
            advisoryOnly: false,
          });
        }
      }

      // QAReport -> Artifact (EVALUATED)
      // Connects QAReport to the deliverable Artifact it evaluated
      let evaluatedArtifact = null;
      if (qa.artifactId) {
        evaluatedArtifact = artifactList.find((ar) => ar._id.toString() === qa.artifactId.toString());
      } else if (qa.taskId) {
        evaluatedArtifact = artifactList.find((ar) => ar.taskId?.toString() === qa.taskId.toString());
      }
      if (!evaluatedArtifact && artifactList.length === 1) {
        evaluatedArtifact = artifactList[0];
      }

      if (evaluatedArtifact) {
        const arIdStr = `artifact_${evaluatedArtifact._id.toString()}`;
        if (nodesById.has(arIdStr)) {
          rawEdges.push({
            source: qaIdStr,
            target: arIdStr,
            type: EDGE_TYPES.EVALUATED,
            canonical: true,
            advisoryOnly: false,
          });
        }
      }
    }

    // Decision Event Nodes (TRIGGERED_DECISION, ADAPTED_PIPELINE)
    for (const dec of decisionEvents) {
      const decIdStr = `decision_${dec._id.toString()}`;
      nodesById.set(decIdStr, {
        id: decIdStr,
        type: NODE_TYPES.DECISION,
        entityId: dec._id.toString(),
        label: `Decision: ${dec.decisionType}`,
        decisionType: dec.decisionType,
        reason: truncateText(dec.reason, GRAPH_CONFIG.MAX_REASON_LENGTH),
        action: truncateText(dec.action, GRAPH_CONFIG.MAX_TEXT_LENGTH),
        outcome: dec.outcome || null,
        confidence: typeof dec.confidence === 'number' ? dec.confidence : null,
        isCanonical: true,
        advisoryOnly: false,
        createdAt: dec.createdAt ? dec.createdAt.toISOString() : null,
      });

      if (dec.taskId) {
        const taskIdStr = `task_${dec.taskId.toString()}`;
        if (nodesById.has(taskIdStr)) {
          rawEdges.push({
            source: taskIdStr,
            target: decIdStr,
            type: EDGE_TYPES.TRIGGERED_DECISION,
            canonical: true,
            advisoryOnly: false,
          });
        }
      }

      // Decision -> Task (ADAPTED_PIPELINE)
      // Connects decision to downstream, adaptively retried, or created tasks
      const candidateTargetIds = [];
      if (dec.metadata?.targetTaskId) candidateTargetIds.push(dec.metadata.targetTaskId);
      if (dec.metadata?.createdTaskId) candidateTargetIds.push(dec.metadata.createdTaskId);
      if (dec.metadata?.retriedTaskId) candidateTargetIds.push(dec.metadata.retriedTaskId);
      if (Array.isArray(dec.metadata?.createdTaskIds)) {
        candidateTargetIds.push(...dec.metadata.createdTaskIds);
      }

      // Strictly connect to tasks explicitly referencing this decision's trigger task via parentResearchTaskId
      if (candidateTargetIds.length === 0 && dec.taskId) {
        const decTaskIdStr = dec.taskId.toString();
        const matchingTasks = tasks.filter(
          (t) => t._id.toString() !== decTaskIdStr &&
                 t.executionMetadata?.parentResearchTaskId === decTaskIdStr
        );
        for (const mt of matchingTasks) {
          candidateTargetIds.push(mt._id);
        }
      }

      for (const tgtId of candidateTargetIds) {
        if (!tgtId) continue;
        const tgtIdStr = `task_${tgtId.toString()}`;
        // Prevent direct cycle with triggering task
        if (nodesById.has(tgtIdStr) && (!dec.taskId || tgtId.toString() !== dec.taskId.toString())) {
          rawEdges.push({
            source: decIdStr,
            target: tgtIdStr,
            type: EDGE_TYPES.ADAPTED_PIPELINE,
            canonical: true,
            advisoryOnly: false,
          });
        }
      }
    }

    // Advisory Memory Nodes (INFORMED_BY)
    if (config.includeAdvisory) {
      for (const mem of memories) {
        const memIdStr = `memory_${mem._id.toString()}`;
        nodesById.set(memIdStr, {
          id: memIdStr,
          type: NODE_TYPES.MEMORY,
          entityId: mem._id.toString(),
          label: truncateText(mem.key, GRAPH_CONFIG.MAX_LABEL_LENGTH),
          memoryType: mem.type,
          status: mem.status,
          attempt: mem.attempt,
          isCanonical: false,
          advisoryOnly: true,
          metadata: sanitizeMeta(mem.metadata),
          createdAt: mem.createdAt ? mem.createdAt.toISOString() : null,
        });

        if (mem.taskId) {
          const taskIdStr = `task_${mem.taskId.toString()}`;
          if (nodesById.has(taskIdStr)) {
            rawEdges.push({
              source: taskIdStr,
              target: memIdStr,
              type: EDGE_TYPES.INFORMED_BY,
              canonical: false,
              advisoryOnly: true,
            });
          }
        }

        // Memory -> Evidence (references)
        if (Array.isArray(mem.evidenceRefs)) {
          for (const refId of mem.evidenceRefs) {
            const evIdStr = `evidence_${refId.toString()}`;
            if (nodesById.has(evIdStr)) {
              rawEdges.push({
                source: memIdStr,
                target: evIdStr,
                type: EDGE_TYPES.GROUNDED_IN,
                canonical: false,
                advisoryOnly: true,
              });
            }
          }
        }
      }
    }

    // 4. Edge Validation, Deduplication & Inferred/Advisory Cycle Prevention
    const validEdges = [];
    const seenEdges = new Set();
    const cycleAdj = new Map();
    for (const nodeId of nodesById.keys()) {
      cycleAdj.set(nodeId, []);
    }

    const canonicalRawEdges = [];
    const inferredOrAdvisoryRawEdges = [];

    for (const e of rawEdges) {
      if (!nodesById.has(e.source) || !nodesById.has(e.target)) {
        continue;
      }
      const isInferredOrAdvisory =
        e.advisoryOnly === true ||
        e.type === EDGE_TYPES.ADAPTED_PIPELINE ||
        e.type === EDGE_TYPES.INFORMED_BY;

      if (isInferredOrAdvisory) {
        inferredOrAdvisoryRawEdges.push(e);
      } else {
        canonicalRawEdges.push(e);
      }
    }

    let edgeIndex = 0;

    // A. Add canonical edges first (preserves physical/canonical truth)
    for (const e of canonicalRawEdges) {
      const edgeKey = `${e.source}->${e.target}:${e.type}`;
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);

      cycleAdj.get(e.source).push(e.target);
      validEdges.push({
        id: `edge_${++edgeIndex}`,
        source: e.source,
        target: e.target,
        type: e.type,
        canonical: e.canonical,
        advisoryOnly: e.advisoryOnly,
      });
    }

    // B. Add inferred and advisory edges ONLY if they do not introduce a cycle
    for (const e of inferredOrAdvisoryRawEdges) {
      const edgeKey = `${e.source}->${e.target}:${e.type}`;
      if (seenEdges.has(edgeKey)) continue;

      if (wouldCreateCycle(cycleAdj, e.source, e.target)) {
        // Deterministically omit inferred/advisory edge that would introduce a cycle
        continue;
      }

      seenEdges.add(edgeKey);
      cycleAdj.get(e.source).push(e.target);
      validEdges.push({
        id: `edge_${++edgeIndex}`,
        source: e.source,
        target: e.target,
        type: e.type,
        canonical: e.canonical,
        advisoryOnly: e.advisoryOnly,
      });
    }

    // 5. BFS Hop-Distance Traversal from Root Mission (distance 0)
    const distMap = new Map();
    if (nodesById.has(rootMissionId)) {
      distMap.set(rootMissionId, 0);
      const queue = [rootMissionId];

      const bfsAdj = new Map();
      for (const e of validEdges) {
        if (!bfsAdj.has(e.source)) bfsAdj.set(e.source, []);
        bfsAdj.get(e.source).push(e.target);
      }

      while (queue.length > 0) {
        const curr = queue.shift();
        const currDist = distMap.get(curr);
        const neighbors = bfsAdj.get(curr) || [];
        for (const nxt of neighbors) {
          if (!distMap.has(nxt)) {
            distMap.set(nxt, currDist + 1);
            queue.push(nxt);
          }
        }
      }
    }

    // Retain nodes within config.depth hops from root mission
    let depthFilteredNodes = Array.from(nodesById.values()).filter(
      (n) => distMap.has(n.id) && distMap.get(n.id) <= config.depth
    );

    // Deterministic node sort order: Mission -> Task (by order) -> Evidence -> Analysis -> Critique -> Artifact -> QA -> Decision -> Memory
    const typeOrder = {
      [NODE_TYPES.MISSION]: 1,
      [NODE_TYPES.TASK]: 2,
      [NODE_TYPES.EVIDENCE]: 3,
      [NODE_TYPES.ANALYSIS]: 4,
      [NODE_TYPES.CRITIQUE]: 5,
      [NODE_TYPES.ARTIFACT]: 6,
      [NODE_TYPES.QA_REPORT]: 7,
      [NODE_TYPES.DECISION]: 8,
      [NODE_TYPES.MEMORY]: 9,
    };

    depthFilteredNodes.sort((a, b) => {
      const typeDiff = (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
      if (typeDiff !== 0) return typeDiff;
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      return a.id.localeCompare(b.id);
    });

    if (depthFilteredNodes.length > config.maxNodes) {
      depthFilteredNodes = depthFilteredNodes.slice(0, config.maxNodes);
    }

    // Re-filter edges to preserve referential integrity (no edges pointing to sliced or depth-pruned nodes)
    const retainedNodeIds = new Set(depthFilteredNodes.map((n) => n.id));
    let filteredEdges = validEdges.filter(
      (e) => retainedNodeIds.has(e.source) && retainedNodeIds.has(e.target)
    );

    // Sort edges deterministically
    filteredEdges.sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      if (a.target !== b.target) return a.target.localeCompare(b.target);
      return a.type.localeCompare(b.type);
    });

    if (filteredEdges.length > config.maxEdges) {
      filteredEdges = filteredEdges.slice(0, config.maxEdges);
    }

    // 6. Acyclicity Verification (DAG Check)
    const isAcyclic = checkAcyclicity(depthFilteredNodes, filteredEdges);

    // 7. Authoritative Delivery Readiness Evaluation (Canonical only, Memory ignored)
    const readiness = evaluateMissionReadiness({
      mission,
      tasks,
      artifact: artifactList[0] || null,
      qaReport: qaReportList[0] || null,
      evidence: evidenceList,
      analysis: analysisList,
      critique: critiqueList,
    });

    return {
      success: true,
      missionId: mission._id.toString(),
      summary: {
        nodeCount: depthFilteredNodes.length,
        edgeCount: filteredEdges.length,
        stages: [...new Set(tasks.map((t) => t.agentId || 'research'))],
        canonicalVerification: readiness.verification,
        deliveryStatus: !isAcyclic ? 'not_ready' : (readiness.ready ? 'ready' : 'not_ready'),
        qaVerdict: qaReportList[0]?.overallVerdict || null,
        isAcyclic,
        cycleDetected: !isAcyclic,
      },
      nodes: depthFilteredNodes,
      edges: filteredEdges,
    };
  } catch (err) {
    console.error(`[MISSION GRAPH SERVICE] Error building graph for mission ${missionId}:`, err.message);
    return {
      success: false,
      error: 'Failed to build mission graph',
    };
  }
}

module.exports = {
  GRAPH_CONFIG,
  NODE_TYPES,
  EDGE_TYPES,
  buildMissionGraph,
  checkAcyclicity,
  normalizeOptions,
  sanitizeMeta,
  wouldCreateCycle,
};
