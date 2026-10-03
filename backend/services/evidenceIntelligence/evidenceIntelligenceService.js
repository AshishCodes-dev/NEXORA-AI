/**
 * Evidence Intelligence Service - NEXORA Step 8E.3
 * 
 * Provides deterministic, explainable evidence quality evaluation, relevance scoring,
 * metadata completeness auditing, ranking, and mission-scoped coverage analysis
 * without calling external LLMs, embeddings, or network endpoints.
 * 
 * IMPORTANT ARCHITECTURAL & AUDIT PRINCIPLE:
 * evidenceQualityScore is a heuristic ranking and audit signal for source selection
 * and evidence coverage. It does NOT represent:
 * - factual truth probability
 * - objective reality verification
 * - source credibility guarantee
 */

const {
  extractCleanHostname,
  analyzeSource,
  calculateRelevance,
  tokenize,
} = require('../sourceIntelligence/sourceIntelligenceService');

/**
 * Weights for composite Evidence Quality Score heuristic:
 * - 45% source quality (authority, official domain, ecosystem tier)
 * - 40% evidence relevance (keyword/token correspondence with mission & task)
 * - 15% evidence completeness (metadata presence & structural bounds)
 */
const EVIDENCE_QUALITY_WEIGHTS = {
  SOURCE_QUALITY: 0.45,
  EVIDENCE_RELEVANCE: 0.40,
  EVIDENCE_COMPLETENESS: 0.15,
};

/**
 * Audit warning thresholds
 */
const AUDIT_THRESHOLDS = {
  MIN_RELEVANCE_WARN: 0.35,
  MIN_COMPLETENESS_WARN: 0.75,
  MIN_QUALITY_WARN: 0.40,
  MIN_COVERAGE_WARN: 0.40,
  SINGLE_SOURCE_CONCENTRATION_RATIO: 0.80,
  LOW_DIVERSITY_THRESHOLD: 0.45,
  MIN_EVIDENCE_FOR_DIVERSITY_CHECK: 3,
};

/**
 * Evaluates the structural completeness of an Evidence record.
 * Checks presence and minimum length of required fields.
 * 
 * NOTE: Evaluates metadata completeness only. Does NOT assess factual correctness.
 * 
 * @param {object} evidence - Evidence item
 * @returns {number} Score bounded between 0.0 and 1.0
 */
function calculateEvidenceCompleteness(evidence = {}) {
  if (!evidence || typeof evidence !== 'object') {
    return 0.0;
  }

  let points = 0;
  const totalComponents = 4;
  const pointValue = 1.0 / totalComponents; // 0.25 per component

  // 1. sourceUrl: non-empty string starting with http:// or https://
  const url = typeof evidence.sourceUrl === 'string' ? evidence.sourceUrl.trim() : '';
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    points += pointValue;
  }

  // 2. sourceTitle: non-empty string with meaningful length (>= 3 chars)
  const title = typeof evidence.sourceTitle === 'string' ? evidence.sourceTitle.trim() : '';
  if (title.length >= 3) {
    points += pointValue;
  }

  // 3. claim: non-empty string with meaningful length (>= 10 chars)
  const claim = typeof evidence.claim === 'string' ? evidence.claim.trim() : '';
  if (claim.length >= 10) {
    points += pointValue;
  }

  // 4. evidenceText: non-empty string with meaningful excerpt length (>= 30 chars)
  const text = typeof evidence.evidenceText === 'string' ? evidence.evidenceText.trim() : '';
  if (text.length >= 30) {
    points += pointValue;
  }

  const score = Math.min(1.0, Math.max(0.0, points));
  return Number(score.toFixed(3));
}

/**
 * Calculates deterministic evidence relevance using the canonical 8E.1 tokenizer and scoring logic.
 * Evaluates claim, evidenceText, and sourceTitle against missionObjective and taskTitle.
 * 
 * @param {object} evidence - Evidence item
 * @param {object} context - Mission context { missionObjective, taskTitle }
 * @returns {number} Score bounded between 0.0 and 1.0
 */
function calculateEvidenceRelevance(evidence = {}, context = {}) {
  const missionObjective = context.missionObjective || '';
  const taskTitle = context.taskTitle || '';

  const title = (evidence.sourceTitle || '').trim();
  const claim = (evidence.claim || '').trim();
  const text = (evidence.evidenceText || '').trim();
  const url = (evidence.sourceUrl || '').trim();
  const hostname = extractCleanHostname(url);

  const snippet = `${claim} ${text}`.trim();

  return calculateRelevance({
    missionObjective,
    taskTitle,
    title,
    snippet,
    url,
    hostname,
  });
}

/**
 * Computes composite Evidence Quality Score using the documented deterministic heuristic:
 * evidenceQualityScore = 0.45 * sourceQualityScore + 0.40 * evidenceRelevanceScore + 0.15 * evidenceCompletenessScore
 * 
 * @param {object} params
 * @param {number} params.sourceQualityScore
 * @param {number} params.evidenceRelevanceScore
 * @param {number} params.evidenceCompletenessScore
 * @returns {number} Score bounded between 0.0 and 1.0
 */
function calculateEvidenceQuality({
  sourceQualityScore = 0.5,
  evidenceRelevanceScore = 0.5,
  evidenceCompletenessScore = 1.0,
} = {}) {
  const sq = Math.min(1.0, Math.max(0.0, Number(sourceQualityScore) || 0));
  const er = Math.min(1.0, Math.max(0.0, Number(evidenceRelevanceScore) || 0));
  const ec = Math.min(1.0, Math.max(0.0, Number(evidenceCompletenessScore) || 0));

  const composite = (
    EVIDENCE_QUALITY_WEIGHTS.SOURCE_QUALITY * sq +
    EVIDENCE_QUALITY_WEIGHTS.EVIDENCE_RELEVANCE * er +
    EVIDENCE_QUALITY_WEIGHTS.EVIDENCE_COMPLETENESS * ec
  );

  const bounded = Math.min(1.0, Math.max(0.0, composite));
  return Number(bounded.toFixed(3));
}

/**
 * Analyzes a single Evidence item deterministically.
 * Reuses 8E.1 source intelligence when available or reconstructs it via analyzeSource.
 * 
 * @param {object} evidence - Evidence item document or plain object
 * @param {object} [context={}] - { missionObjective, taskTitle, taskExecutionMetadata }
 * @returns {object} Annotated evidence analysis object
 */
function analyzeEvidenceItem(evidence, context = {}) {
  if (!evidence || typeof evidence !== 'object') {
    throw new Error('analyzeEvidenceItem requires an evidence object');
  }

  const rawId = evidence._id || evidence.id;
  const evidenceId = rawId ? rawId.toString() : null;
  const sourceUrl = (evidence.sourceUrl || '').trim();
  const sourceTitle = (evidence.sourceTitle || '').trim();
  const claim = (evidence.claim || '').trim();
  const evidenceText = (evidence.evidenceText || '').trim();
  const retrievedAt = evidence.retrievedAt || null;

  // 1. Resolve Source Intelligence (prefer existing task metadata if passed, else analyzeSource)
  let sourceIntelligence = null;
  const taskMeta = context.taskExecutionMetadata || {};
  if (taskMeta.sourceIntelligence && typeof taskMeta.sourceIntelligence === 'object') {
    sourceIntelligence = taskMeta.sourceIntelligence;
  } else if (evidence.sourceIntelligence && typeof evidence.sourceIntelligence === 'object') {
    sourceIntelligence = evidence.sourceIntelligence;
  } else {
    sourceIntelligence = analyzeSource({
      url: sourceUrl,
      title: sourceTitle,
      snippet: evidenceText.slice(0, 300),
      missionObjective: context.missionObjective || '',
      taskTitle: context.taskTitle || '',
      retrievedAt,
    });
  }

  const sourceQualityScore = Math.min(1.0, Math.max(0.0, Number(sourceIntelligence.qualityScore) || 0.5));

  // 2. Calculate Evidence Relevance
  const evidenceRelevanceScore = calculateEvidenceRelevance(evidence, context);

  // 3. Calculate Metadata Completeness
  const evidenceCompletenessScore = calculateEvidenceCompleteness(evidence);

  // 4. Calculate Composite Evidence Quality Score
  const evidenceQualityScore = calculateEvidenceQuality({
    sourceQualityScore,
    evidenceRelevanceScore,
    evidenceCompletenessScore,
  });

  return {
    evidenceId,
    taskId: evidence.taskId ? evidence.taskId.toString() : null,
    sourceUrl,
    sourceTitle,
    claim,
    evidenceText,
    retrievedAt,
    sourceQualityScore,
    evidenceRelevanceScore,
    evidenceCompletenessScore,
    evidenceQualityScore,
    sourceIntelligence: {
      sourceType: sourceIntelligence.sourceType,
      authorityTier: sourceIntelligence.authorityTier,
      officialDomain: sourceIntelligence.officialDomain,
      relevanceScore: sourceIntelligence.relevanceScore,
      freshnessScore: sourceIntelligence.freshnessScore,
      freshnessLabel: sourceIntelligence.freshnessLabel,
      qualityScore: sourceIntelligence.qualityScore,
      signals: sourceIntelligence.signals,
    },
  };
}

/**
 * Deterministic multi-tier comparator for ranking analyzed evidence items.
 * 
 * Order:
 * 1. evidenceQualityScore descending
 * 2. evidenceRelevanceScore descending
 * 3. sourceQualityScore descending
 * 4. authorityTier descending (high > medium > low > unknown)
 * 5. officialDomain (true > false)
 * 6. sourceUrl lexicographical ascending
 * 7. evidenceId lexicographical ascending
 * 
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareEvidence(a, b) {
  // Tier 1: evidenceQualityScore (delta >= 0.001)
  const diffQuality = (b.evidenceQualityScore || 0) - (a.evidenceQualityScore || 0);
  if (Math.abs(diffQuality) >= 0.001) {
    return diffQuality;
  }

  // Tier 2: evidenceRelevanceScore (delta >= 0.001)
  const diffRel = (b.evidenceRelevanceScore || 0) - (a.evidenceRelevanceScore || 0);
  if (Math.abs(diffRel) >= 0.001) {
    return diffRel;
  }

  // Tier 3: sourceQualityScore (delta >= 0.001)
  const diffSrc = (b.sourceQualityScore || 0) - (a.sourceQualityScore || 0);
  if (Math.abs(diffSrc) >= 0.001) {
    return diffSrc;
  }

  // Tier 4: authorityTier descending
  const tierWeights = { high: 4, medium: 3, low: 2, unknown: 1 };
  const aTier = tierWeights[a.sourceIntelligence?.authorityTier] || 1;
  const bTier = tierWeights[b.sourceIntelligence?.authorityTier] || 1;
  if (aTier !== bTier) {
    return bTier - aTier;
  }

  // Tier 5: officialDomain (true before false)
  const aOfficial = a.sourceIntelligence?.officialDomain ? 1 : 0;
  const bOfficial = b.sourceIntelligence?.officialDomain ? 1 : 0;
  if (aOfficial !== bOfficial) {
    return bOfficial - aOfficial;
  }

  // Tier 6: canonical sourceUrl lexicographic ascending
  const urlComp = (a.sourceUrl || '').localeCompare(b.sourceUrl || '');
  if (urlComp !== 0) {
    return urlComp;
  }

  // Tier 7: evidenceId lexicographic ascending for deterministic stability
  return String(a.evidenceId || '').localeCompare(String(b.evidenceId || ''));
}

/**
 * Ranks analyzed evidence items deterministically without dropping or deleting any records.
 * 
 * @param {Array<object>} analyzedItems
 * @returns {Array<object>} Ranked evidence items with assigned 1-based ranks
 */
function rankEvidence(analyzedItems = []) {
  if (!Array.isArray(analyzedItems) || analyzedItems.length === 0) {
    return [];
  }

  // Clone to avoid mutating input array
  const sorted = [...analyzedItems].sort(compareEvidence);

  return sorted.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

/**
 * Calculates mission-scoped token coverage across the evidence collection.
 * 
 * @param {Array<object>} evidenceItems
 * @param {string} missionObjective
 * @param {string} taskTitle
 * @returns {number} Score bounded between 0.0 and 1.0
 */
function calculateMissionCoverage(evidenceItems = [], missionObjective = '', taskTitle = '') {
  const queryTokens = tokenize(`${missionObjective} ${taskTitle}`);
  if (queryTokens.length === 0) {
    return evidenceItems.length > 0 ? 0.80 : 0.0;
  }

  if (!Array.isArray(evidenceItems) || evidenceItems.length === 0) {
    return 0.0;
  }

  // Aggregate all words across all evidence records
  const allDocTokens = new Set();
  for (const item of evidenceItems) {
    const textCorpus = `${item.sourceTitle || ''} ${item.claim || ''} ${item.evidenceText || ''}`;
    const tokens = tokenize(textCorpus);
    for (const t of tokens) {
      allDocTokens.add(t);
    }
  }

  const allTokensArr = Array.from(allDocTokens);
  let matchedTokens = 0;

  for (const qToken of queryTokens) {
    if (allDocTokens.has(qToken) || allTokensArr.some(t => t.length >= 4 && qToken.length >= 4 && (t.startsWith(qToken) || qToken.startsWith(t)))) {
      matchedTokens++;
    }
  }

  const coverageRatio = matchedTokens / queryTokens.length;
  const bounded = Math.min(1.0, Math.max(0.0, coverageRatio));
  return Number(bounded.toFixed(2));
}

/**
 * Calculates source diversity and host concentration metrics across evidence records.
 * Uses clean hostname identity without external public-suffix dependencies.
 * 
 * @param {Array<object>} evidenceItems
 * @returns {{ uniqueSourceCount: number, sourceDiversityScore: number, hostCounts: Record<string, number>, dominantHostRatio: number }}
 */
function calculateSourceDiversity(evidenceItems = []) {
  if (!Array.isArray(evidenceItems) || evidenceItems.length === 0) {
    return {
      uniqueSourceCount: 0,
      sourceDiversityScore: 0.0,
      hostCounts: {},
      dominantHostRatio: 0.0,
    };
  }

  const total = evidenceItems.length;
  const hostCounts = {};

  for (const item of evidenceItems) {
    const host = extractCleanHostname(item.sourceUrl) || 'unknown';
    hostCounts[host] = (hostCounts[host] || 0) + 1;
  }

  const uniqueSourceCount = Object.keys(hostCounts).length;
  let maxHostCount = 0;
  for (const host of Object.keys(hostCounts)) {
    if (hostCounts[host] > maxHostCount) {
      maxHostCount = hostCounts[host];
    }
  }

  const dominantHostRatio = total > 0 ? Number((maxHostCount / total).toFixed(2)) : 0.0;

  // Bounded diversity score: ratio of unique sources relative to expected spread (up to 3)
  // For 1 item: 1.0. For multiple items from 1 source: lower score.
  let rawDiversity = 1.0;
  if (total > 1) {
    rawDiversity = uniqueSourceCount / Math.min(total, 3);
  }
  const sourceDiversityScore = Number(Math.min(1.0, Math.max(0.0, rawDiversity)).toFixed(2));

  return {
    uniqueSourceCount,
    sourceDiversityScore,
    hostCounts,
    dominantHostRatio,
  };
}

/**
 * Builds deterministic audit warnings based on conservative quality and coverage thresholds.
 * Does NOT generate sensational or absolute truth claims.
 * 
 * @param {object} params
 * @param {Array<object>} params.rankedEvidence
 * @param {number} params.averageQuality
 * @param {number} params.averageRelevance
 * @param {number} params.missionCoverageScore
 * @param {number} params.sourceDiversityScore
 * @param {number} params.dominantHostRatio
 * @param {number} params.uniqueSourceCount
 * @returns {string[]} List of standardized warning codes
 */
function buildEvidenceWarnings({
  rankedEvidence = [],
  averageQuality = 1.0,
  averageRelevance = 1.0,
  missionCoverageScore = 1.0,
  sourceDiversityScore = 1.0,
  dominantHostRatio = 0.0,
  uniqueSourceCount = 1,
} = {}) {
  const warnings = [];
  const count = rankedEvidence.length;
  if (count === 0) {
    return ['insufficient_evidence'];
  }

  // 1. Single source dependency warning (conservative: count >= 3 and dominant host >= 80% or uniqueSourceCount === 1)
  if (count >= AUDIT_THRESHOLDS.MIN_EVIDENCE_FOR_DIVERSITY_CHECK && (uniqueSourceCount === 1 || dominantHostRatio >= AUDIT_THRESHOLDS.SINGLE_SOURCE_CONCENTRATION_RATIO)) {
    warnings.push('single_source_dependency');
  } else if (count >= AUDIT_THRESHOLDS.MIN_EVIDENCE_FOR_DIVERSITY_CHECK && sourceDiversityScore < AUDIT_THRESHOLDS.LOW_DIVERSITY_THRESHOLD) {
    // 2. Low source diversity warning
    warnings.push('low_source_diversity');
  }

  // 3. Limited mission coverage warning
  if (missionCoverageScore < AUDIT_THRESHOLDS.MIN_COVERAGE_WARN) {
    warnings.push('limited_mission_coverage');
  }

  // 4. Low relevance evidence warning
  const hasLowRelevanceItem = rankedEvidence.some(e => e.evidenceRelevanceScore < 0.20);
  if (averageRelevance < AUDIT_THRESHOLDS.MIN_RELEVANCE_WARN || hasLowRelevanceItem) {
    warnings.push('low_relevance_evidence');
  }

  // 5. Incomplete evidence warning
  const hasIncompleteItem = rankedEvidence.some(e => e.evidenceCompletenessScore < AUDIT_THRESHOLDS.MIN_COMPLETENESS_WARN);
  if (hasIncompleteItem) {
    warnings.push('incomplete_evidence');
  }

  // 6. Low evidence quality warning
  if (averageQuality < AUDIT_THRESHOLDS.MIN_QUALITY_WARN) {
    warnings.push('low_evidence_quality');
  }

  return warnings;
}

/**
 * Builds aggregate mission-scoped Evidence Coverage and audit metadata.
 * 
 * @param {Array<object>} rankedEvidence - Ranked evidence items
 * @param {object} [context={}] - { missionObjective, taskTitle }
 * @returns {object} Coverage and audit metadata object
 */
function buildEvidenceCoverage(rankedEvidence = [], context = {}) {
  const count = rankedEvidence.length;
  if (count === 0) {
    return {
      evidenceCount: 0,
      uniqueSourceCount: 0,
      sourceDiversityScore: 0.0,
      averageEvidenceQualityScore: 0.0,
      averageEvidenceRelevanceScore: 0.0,
      missionCoverageScore: 0.0,
      strongestEvidenceId: null,
      weakestEvidenceId: null,
      rankedEvidenceIds: [],
      warnings: ['insufficient_evidence'],
    };
  }

  // Sum scores for averages
  let sumQuality = 0;
  let sumRelevance = 0;
  for (const item of rankedEvidence) {
    sumQuality += item.evidenceQualityScore || 0;
    sumRelevance += item.evidenceRelevanceScore || 0;
  }

  const averageEvidenceQualityScore = Number((sumQuality / count).toFixed(3));
  const averageEvidenceRelevanceScore = Number((sumRelevance / count).toFixed(3));

  // Diversity metrics
  const diversity = calculateSourceDiversity(rankedEvidence);

  // Mission coverage
  const missionCoverageScore = calculateMissionCoverage(
    rankedEvidence,
    context.missionObjective || '',
    context.taskTitle || ''
  );

  // Strongest & weakest evidence IDs
  const strongestEvidenceId = rankedEvidence[0]?.evidenceId || null;
  const weakestEvidenceId = rankedEvidence[count - 1]?.evidenceId || null;
  const rankedEvidenceIds = rankedEvidence.map(e => e.evidenceId).filter(Boolean);

  // Audit warnings
  const warnings = buildEvidenceWarnings({
    rankedEvidence,
    averageQuality: averageEvidenceQualityScore,
    averageRelevance: averageEvidenceRelevanceScore,
    missionCoverageScore,
    sourceDiversityScore: diversity.sourceDiversityScore,
    dominantHostRatio: diversity.dominantHostRatio,
    uniqueSourceCount: diversity.uniqueSourceCount,
  });

  return {
    evidenceCount: count,
    uniqueSourceCount: diversity.uniqueSourceCount,
    sourceDiversityScore: diversity.sourceDiversityScore,
    averageEvidenceQualityScore,
    averageEvidenceRelevanceScore,
    missionCoverageScore,
    strongestEvidenceId,
    weakestEvidenceId,
    rankedEvidenceIds,
    warnings,
  };
}

/**
 * Top-level orchestration function: evaluates, scores, ranks, and analyzes coverage
 * for a collection of Evidence documents.
 * 
 * Pure, deterministic, side-effect free in-memory calculation.
 * 
 * @param {Array<object>} rawEvidenceList - Array of Evidence records from MongoDB
 * @param {object} [context={}] - Context metadata { missionObjective, taskTitle, tasksMap }
 * @returns {{ rankedEvidence: Array<object>, coverage: object, warnings: string[], intelligenceMap: Map<string, object> }}
 */
function evaluateMissionEvidence(rawEvidenceList = [], context = {}) {
  if (!Array.isArray(rawEvidenceList) || rawEvidenceList.length === 0) {
    const emptyCoverage = buildEvidenceCoverage([], context);
    return {
      rankedEvidence: [],
      coverage: emptyCoverage,
      warnings: emptyCoverage.warnings,
      intelligenceMap: new Map(),
    };
  }

  // 1. Analyze each evidence item
  const analyzedItems = [];
  const intelligenceMap = new Map();

  for (const rawDoc of rawEvidenceList) {
    const docObj = (typeof rawDoc.toObject === 'function') ? rawDoc.toObject() : rawDoc;

    // Check if task execution metadata exists for this evidence's taskId
    let taskExecutionMetadata = null;
    if (context.tasksMap && docObj.taskId) {
      const taskIdStr = docObj.taskId.toString();
      const parentTask = context.tasksMap.get(taskIdStr);
      if (parentTask?.executionMetadata) {
        taskExecutionMetadata = parentTask.executionMetadata;
      }
    }

    const analyzed = analyzeEvidenceItem(docObj, {
      missionObjective: context.missionObjective,
      taskTitle: context.taskTitle,
      taskExecutionMetadata,
    });

    analyzedItems.push(analyzed);
    if (analyzed.evidenceId) {
      intelligenceMap.set(analyzed.evidenceId, analyzed);
    }
  }

  // 2. Rank evidence items
  const rankedEvidence = rankEvidence(analyzedItems);

  // 3. Build mission coverage and audit warnings
  const coverage = buildEvidenceCoverage(rankedEvidence, context);

  return {
    rankedEvidence,
    coverage,
    warnings: coverage.warnings,
    intelligenceMap,
  };
}

module.exports = {
  EVIDENCE_QUALITY_WEIGHTS,
  AUDIT_THRESHOLDS,
  calculateEvidenceCompleteness,
  calculateEvidenceRelevance,
  calculateEvidenceQuality,
  analyzeEvidenceItem,
  compareEvidence,
  rankEvidence,
  calculateMissionCoverage,
  calculateSourceDiversity,
  buildEvidenceWarnings,
  buildEvidenceCoverage,
  evaluateMissionEvidence,
};
