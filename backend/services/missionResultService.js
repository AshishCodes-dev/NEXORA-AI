const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const Artifact = require('../models/Artifact');
const Evidence = require('../models/Evidence');
const Analysis = require('../models/Analysis');
const Critique = require('../models/Critique');
const QAReport = require('../models/QAReport');
const { getMissionMetrics } = require('./telemetry/telemetryService');

/**
 * Bounds and pagination limits to prevent unbounded response growth
 */
const LIMITS = {
  MAX_EVIDENCE_RETURNED: 100,
  MAX_ANALYSIS_RETURNED: 20,
  MAX_CRITIQUE_RETURNED: 20,
  MAX_EVIDENCE_TEXT_LENGTH: 4000,
  MAX_SECTION_CONTENT_LENGTH: 10000,
  MAX_SUMMARY_LENGTH: 5000,
  MAX_FINDINGS_PER_ANALYSIS: 30,
  MAX_REVIEWS_PER_CRITIQUE: 30,
  MAX_CHECKS_PER_QA: 30,
  MAX_WARNINGS_RETURNED: 30,
  MAX_RECOMMENDATIONS_RETURNED: 30,
};

/**
 * Deterministically bounds string length to prevent megabyte response bloat
 */
function truncateText(str, maxLength) {
  if (typeof str !== 'string') return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '... [truncated]';
}

/**
 * Sensitive key pattern to prevent accidental credential or internal leakage
 */
const SENSITIVE_KEY_REGEX = /^(password|hash|token|secret|jwt|apikey|cookie|sessionid|authorization)$/i;

/**
 * Recursively strips sensitive fields and Mongo metadata
 */
function sanitizeRecord(item, depth = 0) {
  if (depth > 6 || !item || typeof item !== 'object') return item;
  if (Array.isArray(item)) {
    return item.map(el => sanitizeRecord(el, depth + 1));
  }
  const clean = {};
  for (const [key, value] of Object.entries(item)) {
    if (SENSITIVE_KEY_REGEX.test(key) || key === '__v') continue;
    clean[key] = (value && typeof value === 'object') ? sanitizeRecord(value, depth + 1) : value;
  }
  return clean;
}

/**
 * Maps a persisted Mission document to clean API shape
 */
function mapMission(doc) {
  if (!doc) return null;
  return sanitizeRecord({
    id: doc._id.toString(),
    objective: truncateText(doc.objective, 2000),
    status: doc.status,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
  });
}

/**
 * Maps MissionTask documents to clean API shape
 */
function mapTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.slice(0, 100).map(t => sanitizeRecord({
    id: t._id.toString(),
    title: truncateText(t.title || '', 300),
    description: truncateText(t.description || '', 1000),
    order: t.order || 1,
    status: t.status || 'pending',
    agentId: t.agentId || null,
    error: t.error ? truncateText(t.error, 1000) : null,
    createdAt: t.createdAt ? t.createdAt.toISOString() : null,
    updatedAt: t.updatedAt ? t.updatedAt.toISOString() : null,
  }));
}

/**
 * Maps an Artifact document to clean API shape
 */
function mapArtifact(doc) {
  if (!doc) return null;
  return sanitizeRecord({
    id: doc._id.toString(),
    taskId: doc.taskId ? doc.taskId.toString() : null,
    artifactType: doc.artifactType,
    title: truncateText(doc.title, 500),
    executiveSummary: truncateText(doc.executiveSummary, LIMITS.MAX_SUMMARY_LENGTH),
    sections: (doc.sections || []).slice(0, 20).map(sec => ({
      heading: truncateText(sec.heading, 300),
      content: truncateText(sec.content, LIMITS.MAX_SECTION_CONTENT_LENGTH),
      evidenceIds: (sec.evidenceIds || []).map(id => id.toString()),
    })),
    keyFindings: (doc.keyFindings || []).slice(0, 30).map(kf => ({
      statement: truncateText(kf.statement, 1000),
      evidenceIds: (kf.evidenceIds || []).map(id => id.toString()),
      confidence: kf.confidence,
      groundingStatus: kf.groundingStatus || 'supported',
      sourceUrls: (kf.sourceUrls || []).slice(0, 10).map(u => truncateText(u, 500)),
    })),
    limitations: (doc.limitations || []).slice(0, LIMITS.MAX_WARNINGS_RETURNED).map(l => truncateText(l, 500)),
    unresolvedQuestions: (doc.unresolvedQuestions || []).slice(0, 30).map(q => truncateText(q, 500)),
    sourceReferences: (doc.sourceReferences || []).slice(0, 50).map(ref => ({
      evidenceId: ref.evidenceId ? ref.evidenceId.toString() : null,
      sourceTitle: truncateText(ref.sourceTitle, 300),
      sourceUrl: truncateText(ref.sourceUrl, 500),
    })),
    grounding: doc.grounding ? {
      evidenceIds: (doc.grounding.evidenceIds || []).map(id => id.toString()),
      sourceUrls: (doc.grounding.sourceUrls || []).slice(0, 20).map(u => truncateText(u, 500)),
      supportedClaimCount: typeof doc.grounding.supportedClaimCount === 'number' ? doc.grounding.supportedClaimCount : 0,
      partiallySupportedClaimCount: typeof doc.grounding.partiallySupportedClaimCount === 'number' ? doc.grounding.partiallySupportedClaimCount : 0,
      unsupportedClaimCount: typeof doc.grounding.unsupportedClaimCount === 'number' ? doc.grounding.unsupportedClaimCount : 0,
      coverageScore: typeof doc.grounding.coverageScore === 'number' ? doc.grounding.coverageScore : 0,
      warnings: (doc.grounding.warnings || []).slice(0, LIMITS.MAX_WARNINGS_RETURNED).map(w => truncateText(w, 500)),
    } : null,
    buildMethod: doc.buildMethod,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  });
}

/**
 * Maps Evidence documents to clean API shape
 */
function mapEvidence(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.slice(0, LIMITS.MAX_EVIDENCE_RETURNED).map(e => sanitizeRecord({
    id: e._id.toString(),
    taskId: e.taskId ? e.taskId.toString() : null,
    sourceTitle: truncateText(e.sourceTitle || '', 300),
    sourceUrl: truncateText(e.sourceUrl || '', 500),
    claim: truncateText(e.claim || '', 1000),
    evidenceText: truncateText(e.evidenceText || '', LIMITS.MAX_EVIDENCE_TEXT_LENGTH),
    retrievedAt: e.retrievedAt ? e.retrievedAt.toISOString() : null,
  }));
}

/**
 * Maps Analysis documents to clean API shape
 */
function mapAnalysis(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.slice(0, LIMITS.MAX_ANALYSIS_RETURNED).map(a => sanitizeRecord({
    id: a._id.toString(),
    taskId: a.taskId ? a.taskId.toString() : null,
    evidenceCount: a.evidenceCount || 0,
    findings: (a.findings || []).slice(0, LIMITS.MAX_FINDINGS_PER_ANALYSIS).map(f => ({
      statement: truncateText(f.statement, 1000),
      supportingEvidenceIds: (f.supportingEvidenceIds || []).map(id => id.toString()),
      confidence: f.confidence,
    })),
    gaps: (a.gaps || []).slice(0, 30).map(g => truncateText(g, 500)),
    contradictions: (a.contradictions || []).slice(0, 30).map(c => ({
      description: truncateText(c.description, 1000),
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
  return docs.slice(0, LIMITS.MAX_CRITIQUE_RETURNED).map(c => sanitizeRecord({
    id: c._id.toString(),
    taskId: c.taskId ? c.taskId.toString() : null,
    overallVerdict: c.overallVerdict,
    summary: truncateText(c.summary, LIMITS.MAX_SUMMARY_LENGTH),
    findingReviews: (c.findingReviews || []).slice(0, LIMITS.MAX_REVIEWS_PER_CRITIQUE).map(fr => ({
      statement: truncateText(fr.statement, 1000),
      verdict: fr.verdict,
      evidenceIds: (fr.evidenceIds || []).map(id => id.toString()),
      issues: (fr.issues || []).slice(0, 20).map(i => truncateText(i, 500)),
      confidence: fr.confidence,
    })),
    unsupportedFindings: (c.unsupportedFindings || []).slice(0, 30).map(uf => ({
      findingIndex: uf.findingIndex,
      statement: truncateText(uf.statement, 1000),
      reason: truncateText(uf.reason, 1000),
    })),
    contradictions: (c.contradictions || []).slice(0, 30).map(con => ({
      description: truncateText(con.description, 1000),
      evidenceIds: (con.evidenceIds || []).map(id => id.toString()),
    })),
    evidenceGaps: (c.evidenceGaps || []).slice(0, 30).map(g => truncateText(g, 500)),
    citationIntegrity: c.citationIntegrity ? {
      valid: Boolean(c.citationIntegrity.valid),
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
  return sanitizeRecord({
    id: doc._id.toString(),
    taskId: doc.taskId ? doc.taskId.toString() : null,
    overallVerdict: doc.overallVerdict,
    summary: truncateText(doc.summary, LIMITS.MAX_SUMMARY_LENGTH),
    checks: (doc.checks || []).slice(0, LIMITS.MAX_CHECKS_PER_QA).map(ck => ({
      checkType: ck.checkType,
      status: ck.status,
      message: truncateText(ck.message, 500),
      evidenceIds: (ck.evidenceIds || []).map(id => id.toString()),
      details: truncateText(ck.details || '', 2000),
    })),
    invalidEvidenceIds: (doc.invalidEvidenceIds || []).map(id => id.toString()),
    unsupportedFindings: (doc.unsupportedFindings || []).slice(0, 30).map(uf => ({
      statement: truncateText(uf.statement, 1000),
      reason: truncateText(uf.reason, 1000),
      evidenceIds: (uf.evidenceIds || []).map(id => id.toString()),
    })),
    critiqueViolations: (doc.critiqueViolations || []).slice(0, 30).map(cv => ({
      description: truncateText(cv.description, 1000),
      relatedEvidenceIds: (cv.relatedEvidenceIds || []).map(id => id.toString()),
    })),
    missingRequirements: (doc.missingRequirements || []).slice(0, 30).map(r => truncateText(r, 500)),
    warnings: (doc.warnings || []).slice(0, LIMITS.MAX_WARNINGS_RETURNED).map(w => truncateText(w, 500)),
    qaMethod: doc.qaMethod,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  });
}

/**
 * Authoritative Readiness Evaluation Gate
 * 
 * Evaluates the mission execution lifecycle, task states, artifact integrity,
 * QA verdict, grounding compliance, and cross-mission boundaries to determine
 * the authoritative public verification status:
 * 
 * - 'pending'
 * - 'verified'
 * - 'needs_revision'
 * - 'failed'
 * 
 * @param {object} params
 * @param {object} params.mission - Persisted Mission document
 * @param {Array<object>} [params.tasks] - Persisted MissionTask documents
 * @param {object} [params.artifact] - Persisted Artifact document
 * @param {object} [params.qaReport] - Persisted QAReport document
 * @param {Array<object>} [params.evidence] - Persisted Evidence documents
 * @param {Array<object>} [params.analysis] - Persisted Analysis documents
 * @param {Array<object>} [params.critique] - Persisted Critique documents
 * @param {boolean} [params.foreignArtifactDetected] - Flag indicating foreign artifact
 * @param {boolean} [params.foreignQADetected] - Flag indicating foreign QA
 * @param {boolean} [params.foreignEvidenceDetected] - Flag indicating foreign evidence cited
 * @returns {{ ready: boolean, verification: 'pending'|'verified'|'needs_revision'|'failed', qaVerdict: string|null, reasons: string[] }}
 */
function evaluateMissionReadiness({
  mission,
  tasks = null,
  artifact = null,
  qaReport = null,
  evidence = [],
  analysis = [],
  critique = [],
  foreignArtifactDetected = false,
  foreignQADetected = false,
  foreignEvidenceDetected = false,
} = {}) {
  const reasons = [];

  // 1. Mission Existence
  if (!mission || !mission._id) {
    return {
      ready: false,
      verification: 'pending',
      qaVerdict: null,
      reasons: ['Mission not found or not initialized'],
    };
  }

  const missionIdStr = mission._id.toString();

  // 2. Mission Failure State
  if (mission.status === 'failed') {
    reasons.push("Mission status is 'failed'");
    return {
      ready: false,
      verification: 'failed',
      qaVerdict: qaReport?.overallVerdict || null,
      reasons,
    };
  }

  // 3. Task Failure State
  if (Array.isArray(tasks) && tasks.length > 0) {
    const failedTask = tasks.find(t => t.status === 'failed');
    if (failedTask) {
      reasons.push(`Task order ${failedTask.order} ("${failedTask.title || 'unnamed'}") failed: ${failedTask.error || 'task failure'}`);
      return {
        ready: false,
        verification: 'failed',
        qaVerdict: qaReport?.overallVerdict || null,
        reasons,
      };
    }
  }

  // 4. Cross-Mission Integrity Violations
  if (foreignArtifactDetected) {
    reasons.push('Foreign artifact detected: artifact does not belong to this mission');
    return {
      ready: false,
      verification: 'failed',
      qaVerdict: qaReport?.overallVerdict || null,
      reasons,
    };
  }
  if (artifact && artifact.missionId && artifact.missionId.toString() !== missionIdStr) {
    reasons.push('Cross-mission contamination: artifact missionId mismatch');
    return {
      ready: false,
      verification: 'failed',
      qaVerdict: qaReport?.overallVerdict || null,
      reasons,
    };
  }

  if (foreignQADetected) {
    reasons.push('Foreign QA report detected: QA does not belong to this mission');
    return {
      ready: false,
      verification: 'failed',
      qaVerdict: null,
      reasons,
    };
  }
  if (qaReport && qaReport.missionId && qaReport.missionId.toString() !== missionIdStr) {
    reasons.push('Cross-mission contamination: QA report missionId mismatch');
    return {
      ready: false,
      verification: 'failed',
      qaVerdict: null,
      reasons,
    };
  }

  if (foreignEvidenceDetected) {
    reasons.push('Cross-mission contamination: artifact references evidence belonging to a foreign mission');
    return {
      ready: false,
      verification: 'failed',
      qaVerdict: qaReport?.overallVerdict || null,
      reasons,
    };
  }

  if (Array.isArray(evidence)) {
    const foreignEv = evidence.find(e => e.missionId && e.missionId.toString() !== missionIdStr);
    if (foreignEv) {
      reasons.push('Cross-mission contamination: evidence record from foreign mission detected');
      return {
        ready: false,
        verification: 'failed',
        qaVerdict: qaReport?.overallVerdict || null,
        reasons,
      };
    }
  }

  if (Array.isArray(analysis)) {
    const foreignAn = analysis.find(a => a.missionId && a.missionId.toString() !== missionIdStr);
    if (foreignAn) {
      reasons.push('Cross-mission contamination: analysis record from foreign mission detected');
      return {
        ready: false,
        verification: 'failed',
        qaVerdict: qaReport?.overallVerdict || null,
        reasons,
      };
    }
  }

  if (Array.isArray(critique)) {
    const foreignCr = critique.find(c => c.missionId && c.missionId.toString() !== missionIdStr);
    if (foreignCr) {
      reasons.push('Cross-mission contamination: critique record from foreign mission detected');
      return {
        ready: false,
        verification: 'failed',
        qaVerdict: qaReport?.overallVerdict || null,
        reasons,
      };
    }
  }

  // 5. Incomplete / Running Pipeline
  const isMissionActive = ['planning', 'queued', 'running'].includes(mission.status);
  if (isMissionActive) {
    reasons.push(`Mission is currently in '${mission.status}' state`);
    return {
      ready: false,
      verification: 'pending',
      qaVerdict: qaReport?.overallVerdict || null,
      reasons,
    };
  }

  if (Array.isArray(tasks) && tasks.length > 0) {
    const activeTask = tasks.find(t => ['pending', 'queued', 'running'].includes(t.status));
    if (activeTask) {
      reasons.push(`Task order ${activeTask.order} ("${activeTask.title || 'unnamed'}") is still in '${activeTask.status}' state`);
      return {
        ready: false,
        verification: 'pending',
        qaVerdict: qaReport?.overallVerdict || null,
        reasons,
      };
    }
  }

  // 6. Missing Artifact Deliverable
  if (!artifact) {
    reasons.push('Artifact deliverable has not been generated');
    return {
      ready: false,
      verification: 'pending',
      qaVerdict: qaReport?.overallVerdict || null,
      reasons,
    };
  }

  // 7. Missing QA Report
  if (!qaReport) {
    reasons.push('QA verification report is not yet available');
    return {
      ready: false,
      verification: 'pending',
      qaVerdict: null,
      reasons,
    };
  }

  const qaVerdict = qaReport.overallVerdict || null;

  // 8. QA Verdict === 'fail'
  if (qaVerdict === 'fail') {
    reasons.push(`QA verification failed: ${qaReport.summary || 'Quality checks failed'}`);
    return {
      ready: false,
      verification: 'failed',
      qaVerdict,
      reasons,
    };
  }

  // 9. Grounding QA Checks Audit
  const checks = Array.isArray(qaReport.checks) ? qaReport.checks : [];

  const isolationCheck = checks.find(c => c.checkType === 'grounding_mission_isolation');
  if (isolationCheck && isolationCheck.status === 'fail') {
    reasons.push(`Critical QA check failed: ${isolationCheck.message || 'Mission isolation violated'}`);
    return {
      ready: false,
      verification: 'failed',
      qaVerdict,
      reasons,
    };
  }

  const existsCheck = checks.find(c => c.checkType === 'grounding_evidence_exists');
  if (existsCheck && existsCheck.status === 'fail') {
    reasons.push(`Critical QA check failed: ${existsCheck.message || 'Evidence does not exist'}`);
    return {
      ready: false,
      verification: 'failed',
      qaVerdict,
      reasons,
    };
  }

  const failedGroundingCheck = checks.find(
    c => c.status === 'fail' && [
      'grounding_source_match',
      'grounding_reference_integrity',
      'grounding_metadata_valid'
    ].includes(c.checkType)
  );
  if (failedGroundingCheck) {
    reasons.push(`Grounding check failed: [${failedGroundingCheck.checkType}] ${failedGroundingCheck.message}`);
    return {
      ready: true,
      verification: 'needs_revision',
      qaVerdict: 'needs_revision',
      reasons,
    };
  }

  // 10. QA Verdict === 'needs_revision'
  if (qaVerdict === 'needs_revision') {
    reasons.push(`QA requested revision: ${qaReport.summary || 'Review required'}`);
    return {
      ready: true,
      verification: 'needs_revision',
      qaVerdict,
      reasons,
    };
  }

  // 11. Artifact Grounding Metadata Integrity
  if (artifact.grounding) {
    const g = artifact.grounding;
    if (typeof g.coverageScore === 'number' && (g.coverageScore < 0 || g.coverageScore > 1)) {
      reasons.push('Artifact grounding coverageScore is out of bounds [0.0, 1.0]');
      return {
        ready: true,
        verification: 'needs_revision',
        qaVerdict: 'needs_revision',
        reasons,
      };
    }
    if (typeof g.unsupportedClaimCount === 'number' && g.unsupportedClaimCount > 0) {
      reasons.push(`Artifact contains ${g.unsupportedClaimCount} unsupported claims`);
      return {
        ready: true,
        verification: 'needs_revision',
        qaVerdict: 'needs_revision',
        reasons,
      };
    }
  }

  // Check key findings for explicit unsupported status
  if (Array.isArray(artifact.keyFindings)) {
    const unsupportedFinding = artifact.keyFindings.find(kf => kf.groundingStatus === 'unsupported');
    if (unsupportedFinding) {
      reasons.push(`Artifact contains unsupported finding: "${unsupportedFinding.statement}"`);
      return {
        ready: true,
        verification: 'needs_revision',
        qaVerdict: 'needs_revision',
        reasons,
      };
    }
  }

  // 12. All Conditions Passed -> 'verified'
  if (mission.status === 'completed' && qaVerdict === 'pass') {
    reasons.push('All tasks completed, artifact grounded, and QA verification passed');
    return {
      ready: true,
      verification: 'verified',
      qaVerdict: 'pass',
      reasons,
    };
  }

  // Fallback safe state
  reasons.push('Pipeline conditions not fully satisfied for verification');
  return {
    ready: false,
    verification: 'pending',
    qaVerdict,
    reasons,
  };
}

/**
 * Computes deterministic resultStatus and verification readiness
 * 
 * Preserves 100% backward compatibility for legacy callers while delegating
 * to evaluateMissionReadiness.
 * 
 * @param {object} mission - Persisted Mission document
 * @param {object} [artifactDoc] - Persisted Artifact document
 * @param {object} [qaReport] - Persisted QAReport document
 * @param {object} [options={}] - Extended evaluation context
 * @returns {{ ready: boolean, verification: string, qaVerdict: string|null, reasons?: string[] }}
 */
function computeResultStatus(mission, artifactDoc, qaReport, options = {}) {
  return evaluateMissionReadiness({
    mission,
    artifact: artifactDoc,
    qaReport,
    tasks: options.tasks !== undefined ? options.tasks : null,
    evidence: options.evidence || [],
    analysis: options.analysis || [],
    critique: options.critique || [],
    foreignArtifactDetected: options.foreignArtifactDetected || false,
    foreignQADetected: options.foreignQADetected || false,
    foreignEvidenceDetected: options.foreignEvidenceDetected || false,
  });
}

/**
 * Retrieves the complete final result for a mission owned by the authenticated user.
 * 
 * Read-only gate with strict cross-mission isolation and anti-enumeration.
 * 
 * @param {string} missionId - Mission identifier
 * @param {string} userId - Authenticated user identifier (req.user.id)
 * @returns {Promise<{ notFound?: boolean, success?: boolean, mission?: object, tasks?: Array, resultStatus?: object, status?: string, artifact?: object, evidence?: Array, analysis?: Array, critique?: Array, qa?: object }>}
 */
async function getMissionResult(missionId, userId) {
  // 1. Validate ObjectId formats (prevents format-based enumeration)
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    return { notFound: true };
  }
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { notFound: true };
  }

  const missionObjectId = new mongoose.Types.ObjectId(missionId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 2. Load Mission strictly enforcing authenticated user ownership (read-only)
  const mission = await Mission.findOne({
    _id: missionObjectId,
    userId: userObjectId,
  }).lean();

  if (!mission) {
    return { notFound: true };
  }

  // 3. Load MissionTasks belonging to the mission, ordered by execution order ASC (read-only)
  const tasks = await MissionTask.find({ missionId: missionObjectId })
    .sort({ order: 1 })
    .lean();

  // 4. Locate output/Builder task and QA task from persisted task pipeline
  const builderTask = tasks.find(t => t.agentId === 'builder' || t.order === 4) || null;
  const qaTask = tasks.find(t => t.agentId === 'qa' || t.order === 5) || null;

  // 5. Load Artifact (prefer Builder task scope, fallback to mission scope)
  let artifactDoc = null;
  let foreignArtifactDetected = false;
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

  // Verify artifact ownership if artifact exists
  if (artifactDoc && artifactDoc.missionId && artifactDoc.missionId.toString() !== missionObjectId.toString()) {
    foreignArtifactDetected = true;
    artifactDoc = null; // Do not expose foreign artifact
  }

  // 6. Load QAReport (prefer QA task scope, fallback to mission scope)
  let qaReportDoc = null;
  let foreignQADetected = false;
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

  // Verify QA report ownership if QA report exists
  if (qaReportDoc && qaReportDoc.missionId && qaReportDoc.missionId.toString() !== missionObjectId.toString()) {
    foreignQADetected = true;
    qaReportDoc = null; // Do not expose foreign QA report
  }

  // 7. Load Evidence records strictly for this mission (sorted deterministically)
  const evidenceDocs = await Evidence.find({ missionId: missionObjectId })
    .sort({ createdAt: 1 })
    .limit(LIMITS.MAX_EVIDENCE_RETURNED)
    .lean();

  // 8. Cross-mission evidence check on artifact citations
  let foreignEvidenceDetected = false;
  if (artifactDoc) {
    const missionEvIdSet = new Set(evidenceDocs.map(e => e._id.toString()));
    const citedIds = new Set();
    if (artifactDoc.grounding && Array.isArray(artifactDoc.grounding.evidenceIds)) {
      artifactDoc.grounding.evidenceIds.forEach(id => citedIds.add(id.toString()));
    }
    if (Array.isArray(artifactDoc.keyFindings)) {
      artifactDoc.keyFindings.forEach(kf => {
        if (Array.isArray(kf.evidenceIds)) {
          kf.evidenceIds.forEach(id => citedIds.add(id.toString()));
        }
      });
    }

    const citedOutsideMission = Array.from(citedIds).filter(id => !missionEvIdSet.has(id));
    if (citedOutsideMission.length > 0) {
      const validObjectIds = citedOutsideMission
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));

      if (validObjectIds.length > 0) {
        const foreignEvidence = await Evidence.findOne({
          _id: { $in: validObjectIds },
          missionId: { $ne: missionObjectId },
        }).select('_id missionId').lean();

        if (foreignEvidence) {
          foreignEvidenceDetected = true;
        }
      }
    }
  }

  // 9. Load Analysis documents strictly for this mission
  const analysisDocs = await Analysis.find({ missionId: missionObjectId })
    .sort({ createdAt: 1 })
    .limit(LIMITS.MAX_ANALYSIS_RETURNED)
    .lean();

  // 10. Load Critique documents strictly for this mission
  const critiqueDocs = await Critique.find({ missionId: missionObjectId })
    .sort({ createdAt: 1 })
    .limit(LIMITS.MAX_CRITIQUE_RETURNED)
    .lean();

  // 11. Compute deterministic result status via Authoritative Readiness Gate
  const resultStatus = evaluateMissionReadiness({
    mission,
    tasks,
    artifact: artifactDoc,
    qaReport: qaReportDoc,
    evidence: evidenceDocs,
    analysis: analysisDocs,
    critique: critiqueDocs,
    foreignArtifactDetected,
    foreignQADetected,
    foreignEvidenceDetected,
  });

  // 12. Load deterministic mission metrics (read-only)
  const metrics = await getMissionMetrics(missionObjectId);

  // 13. Assemble structured, secure, bounded response contract (read-only)
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
    metrics: metrics || null,
  };
}

module.exports = {
  getMissionResult,
  evaluateMissionReadiness,
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
