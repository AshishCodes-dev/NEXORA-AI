const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const Artifact = require('../models/Artifact');
const Evidence = require('../models/Evidence');
const Analysis = require('../models/Analysis');
const Critique = require('../models/Critique');
const QAReport = require('../models/QAReport');

/**
 * Bounds and pagination limits to prevent unbounded response growth
 */
const LIMITS = {
  MAX_EVIDENCE_RETURNED: 100,
  MAX_ANALYSIS_RETURNED: 20,
  MAX_CRITIQUE_RETURNED: 20,
};

/**
 * Maps a persisted Mission document to clean API shape
 */
function mapMission(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    objective: doc.objective,
    status: doc.status,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
  };
}

/**
 * Maps MissionTask documents to clean API shape
 */
function mapTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map(t => ({
    id: t._id.toString(),
    title: t.title || '',
    description: t.description || '',
    order: t.order || 1,
    status: t.status || 'pending',
    agentId: t.agentId || null,
    error: t.error || null,
    createdAt: t.createdAt ? t.createdAt.toISOString() : null,
    updatedAt: t.updatedAt ? t.updatedAt.toISOString() : null,
  }));
}

/**
 * Maps an Artifact document to clean API shape
 */
function mapArtifact(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    taskId: doc.taskId ? doc.taskId.toString() : null,
    artifactType: doc.artifactType,
    title: doc.title,
    executiveSummary: doc.executiveSummary,
    sections: (doc.sections || []).map(sec => ({
      heading: sec.heading,
      content: sec.content,
      evidenceIds: (sec.evidenceIds || []).map(id => id.toString()),
    })),
    keyFindings: (doc.keyFindings || []).map(kf => ({
      statement: kf.statement,
      evidenceIds: (kf.evidenceIds || []).map(id => id.toString()),
      confidence: kf.confidence,
    })),
    limitations: doc.limitations || [],
    unresolvedQuestions: doc.unresolvedQuestions || [],
    sourceReferences: (doc.sourceReferences || []).map(ref => ({
      evidenceId: ref.evidenceId ? ref.evidenceId.toString() : null,
      sourceTitle: ref.sourceTitle,
      sourceUrl: ref.sourceUrl,
    })),
    buildMethod: doc.buildMethod,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

/**
 * Maps Evidence documents to clean API shape
 */
function mapEvidence(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(e => ({
    id: e._id.toString(),
    taskId: e.taskId ? e.taskId.toString() : null,
    sourceTitle: e.sourceTitle || '',
    sourceUrl: e.sourceUrl || '',
    claim: e.claim || '',
    evidenceText: e.evidenceText || '',
    retrievedAt: e.retrievedAt ? e.retrievedAt.toISOString() : null,
  }));
}

/**
 * Maps Analysis documents to clean API shape
 */
function mapAnalysis(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(a => ({
    id: a._id.toString(),
    taskId: a.taskId ? a.taskId.toString() : null,
    evidenceCount: a.evidenceCount || 0,
    findings: (a.findings || []).map(f => ({
      statement: f.statement,
      supportingEvidenceIds: (f.supportingEvidenceIds || []).map(id => id.toString()),
      confidence: f.confidence,
    })),
    gaps: a.gaps || [],
    contradictions: (a.contradictions || []).map(c => ({
      description: c.description,
      evidenceIds: (c.evidenceIds || []).map(id => id.toString()),
    })),
    analysisMethod: a.analysisMethod,
    createdAt: a.createdAt ? a.createdAt.toISOString() : null,
    updatedAt: a.updatedAt ? a.updatedAt.toISOString() : null,
  }));
}

/**
 * Maps Critique documents to clean API shape
 */
function mapCritique(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(c => ({
    id: c._id.toString(),
    taskId: c.taskId ? c.taskId.toString() : null,
    overallVerdict: c.overallVerdict,
    summary: c.summary,
    findingReviews: (c.findingReviews || []).map(fr => ({
      statement: fr.statement,
      verdict: fr.verdict,
      evidenceIds: (fr.evidenceIds || []).map(id => id.toString()),
      issues: fr.issues || [],
      confidence: fr.confidence,
    })),
    unsupportedFindings: (c.unsupportedFindings || []).map(uf => ({
      findingIndex: uf.findingIndex,
      statement: uf.statement,
      reason: uf.reason,
    })),
    contradictions: (c.contradictions || []).map(con => ({
      description: con.description,
      evidenceIds: (con.evidenceIds || []).map(id => id.toString()),
    })),
    evidenceGaps: c.evidenceGaps || [],
    citationIntegrity: c.citationIntegrity ? {
      valid: c.citationIntegrity.valid,
      invalidEvidenceIds: (c.citationIntegrity.invalidEvidenceIds || []).map(id => id.toString()),
      orphanReferenceCount: c.citationIntegrity.orphanReferenceCount || 0,
    } : null,
    critiqueMethod: c.critiqueMethod,
    createdAt: c.createdAt ? c.createdAt.toISOString() : null,
    updatedAt: c.updatedAt ? c.updatedAt.toISOString() : null,
  }));
}

/**
 * Maps a QAReport document to clean API shape
 */
function mapQA(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    taskId: doc.taskId ? doc.taskId.toString() : null,
    overallVerdict: doc.overallVerdict,
    summary: doc.summary,
    checks: (doc.checks || []).map(ck => ({
      checkType: ck.checkType,
      status: ck.status,
      message: ck.message,
      evidenceIds: (ck.evidenceIds || []).map(id => id.toString()),
      details: ck.details || '',
    })),
    invalidEvidenceIds: (doc.invalidEvidenceIds || []).map(id => id.toString()),
    unsupportedFindings: (doc.unsupportedFindings || []).map(uf => ({
      statement: uf.statement,
      reason: uf.reason,
      evidenceIds: (uf.evidenceIds || []).map(id => id.toString()),
    })),
    critiqueViolations: (doc.critiqueViolations || []).map(cv => ({
      description: cv.description,
      relatedEvidenceIds: (cv.relatedEvidenceIds || []).map(id => id.toString()),
    })),
    missingRequirements: doc.missingRequirements || [],
    warnings: doc.warnings || [],
    qaMethod: doc.qaMethod,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

/**
 * Computes deterministic resultStatus and verification readiness
 * 
 * Allowed verification values: "pending" | "verified" | "needs_revision" | "failed"
 */
function computeResultStatus(mission, artifactDoc, qaReport) {
  const isMissionCompleted = mission.status === 'completed';
  const isMissionFailed = mission.status === 'failed';
  const hasArtifact = Boolean(artifactDoc);
  const hasQA = Boolean(qaReport);
  const qaVerdict = qaReport?.overallVerdict || null;

  let verification = 'pending';

  if (isMissionFailed && (!hasQA || qaVerdict === 'fail')) {
    verification = 'failed';
  } else if (!hasArtifact || !hasQA) {
    verification = 'pending';
  } else if (qaVerdict === 'pass') {
    verification = 'verified';
  } else if (qaVerdict === 'needs_revision') {
    verification = 'needs_revision';
  } else if (qaVerdict === 'fail') {
    verification = 'failed';
  }

  const ready = isMissionCompleted && hasArtifact && hasQA;

  return {
    ready,
    verification,
    qaVerdict,
  };
}

/**
 * Retrieves the complete final result for a mission owned by the authenticated user.
 * 
 * @param {string} missionId - Mission identifier
 * @param {string} userId - Authenticated user identifier (req.user.id)
 * @returns {Promise<{ notFound?: boolean, success?: boolean, mission?: object, tasks?: Array, resultStatus?: object, status?: string, artifact?: object, evidence?: Array, analysis?: Array, critique?: Array, qa?: object }>}
 */
async function getMissionResult(missionId, userId) {
  // 1. Validate ObjectId formats
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    return { notFound: true };
  }
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { notFound: true };
  }

  const missionObjectId = new mongoose.Types.ObjectId(missionId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 2. Load Mission strictly enforcing authenticated user ownership
  const mission = await Mission.findOne({
    _id: missionObjectId,
    userId: userObjectId,
  }).lean();

  if (!mission) {
    return { notFound: true };
  }

  // 3. Load MissionTasks belonging to the mission, ordered by execution order ASC
  const tasks = await MissionTask.find({ missionId: missionObjectId })
    .sort({ order: 1 })
    .lean();

  // 4. Locate output/Builder task and QA task from persisted task pipeline
  const builderTask = tasks.find(t => t.agentId === 'builder' || t.order === 4) || null;
  const qaTask = tasks.find(t => t.agentId === 'qa' || t.order === 5) || null;

  // 5. Load Artifact (prefer Builder task scope, fallback to mission scope)
  let artifactDoc = null;
  if (builderTask) {
    artifactDoc = await Artifact.findOne({
      missionId: missionObjectId,
      taskId: builderTask._id,
    }).lean();
  }
  if (!artifactDoc) {
    artifactDoc = await Artifact.findOne({
      missionId: missionObjectId,
    })
      .sort({ createdAt: -1 })
      .lean();
  }

  // 6. Load QAReport (prefer QA task scope, fallback to mission scope)
  let qaReportDoc = null;
  if (qaTask) {
    qaReportDoc = await QAReport.findOne({
      missionId: missionObjectId,
      taskId: qaTask._id,
    }).lean();
  }
  if (!qaReportDoc) {
    qaReportDoc = await QAReport.findOne({
      missionId: missionObjectId,
    })
      .sort({ createdAt: -1 })
      .lean();
  }

  // 7. Load Evidence records strictly for this mission (sorted deterministically)
  const evidenceDocs = await Evidence.find({ missionId: missionObjectId })
    .sort({ createdAt: 1 })
    .limit(LIMITS.MAX_EVIDENCE_RETURNED)
    .lean();

  // 8. Load Analysis documents strictly for this mission
  const analysisDocs = await Analysis.find({ missionId: missionObjectId })
    .sort({ createdAt: 1 })
    .limit(LIMITS.MAX_ANALYSIS_RETURNED)
    .lean();

  // 9. Load Critique documents strictly for this mission
  const critiqueDocs = await Critique.find({ missionId: missionObjectId })
    .sort({ createdAt: 1 })
    .limit(LIMITS.MAX_CRITIQUE_RETURNED)
    .lean();

  // 10. Compute deterministic result status
  const resultStatus = computeResultStatus(mission, artifactDoc, qaReportDoc);

  // 11. Assemble structured, secure response contract
  return {
    success: true,
    mission: mapMission(mission),
    tasks: mapTasks(tasks),
    status: resultStatus.verification,
    resultStatus,
    artifact: mapArtifact(artifactDoc),
    evidence: mapEvidence(evidenceDocs),
    analysis: mapAnalysis(analysisDocs),
    critique: mapCritique(critiqueDocs),
    qa: mapQA(qaReportDoc),
  };
}

module.exports = {
  getMissionResult,
  computeResultStatus,
  mapMission,
  mapTasks,
  mapArtifact,
  mapEvidence,
  mapAnalysis,
  mapCritique,
  mapQA,
  LIMITS,
};
