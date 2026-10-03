/**
 * Source Selection Service - NEXORA Step 8E.2
 * 
 * Provides deterministic, mission-aware candidate source evaluation, ranking,
 * and selection for the Research -> Browser handoff pipeline.
 * 
 * Integrates directly with the 8E.1 Source Intelligence Service without duplicating
 * scoring logic, making network calls, or invoking LLMs.
 * 
 * NOTE: Quality scores and rankings represent deterministic source-selection heuristics
 * and authority signals; they do NOT claim to represent factual truth probabilities.
 */

const { analyzeSource } = require('./sourceIntelligenceService');
const { normalizeCanonicalUrl } = require('../research/browserHandoffService');

const SELECTION_LIMITS = {
  DEFAULT_MAX_TARGETS: 3,
  ABSOLUTE_MAX_TARGETS: 3,
  MIN_TARGETS: 1,
};

const AUTHORITY_TIER_RANK = {
  high: 4,
  medium: 3,
  low: 2,
  unknown: 1,
};

/**
 * Deterministically compares two evaluated candidates for sorting.
 * 
 * Order:
 * 1. qualityScore descending
 * 2. relevanceScore descending
 * 3. authorityTier descending (high > medium > low > unknown)
 * 4. officialDomain true before false
 * 5. canonicalUrl lexicographic ascending (final deterministic tie-breaker)
 * 
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareCandidates(a, b) {
  // 1. qualityScore descending
  if (b.qualityScore !== a.qualityScore) {
    return b.qualityScore - a.qualityScore;
  }

  // 2. relevanceScore descending
  if (b.relevanceScore !== a.relevanceScore) {
    return b.relevanceScore - a.relevanceScore;
  }

  // 3. authorityTier descending
  const authA = AUTHORITY_TIER_RANK[a.authorityTier] || 1;
  const authB = AUTHORITY_TIER_RANK[b.authorityTier] || 1;
  if (authB !== authA) {
    return authB - authA;
  }

  // 4. officialDomain true before false
  if (a.officialDomain !== b.officialDomain) {
    return a.officialDomain ? -1 : 1;
  }

  // 5. Canonical URL lexicographic ascending
  const urlA = a.canonicalUrl || a.url || '';
  const urlB = b.canonicalUrl || b.url || '';
  return urlA.localeCompare(urlB);
}

/**
 * Generates an explainable, human-readable selection reason from candidate signals.
 * 
 * @param {object} cand
 * @returns {string}
 */
function generateSelectionReason(cand) {
  const parts = [];

  if (cand.officialDomain) {
    parts.push('official domain');
  }

  if (cand.relevanceScore >= 0.70) {
    parts.push('strong relevance');
  } else if (cand.relevanceScore >= 0.35) {
    parts.push('moderate relevance');
  } else {
    parts.push('low relevance');
  }

  if (cand.authorityTier === 'high') {
    parts.push('high authority');
  } else if (cand.authorityTier === 'medium') {
    parts.push('medium authority');
  } else if (cand.authorityTier === 'low') {
    parts.push('low authority');
  }

  if (parts.length === 0) {
    return 'general reference source';
  }

  return parts.join(' + ');
}

/**
 * Evaluates, ranks, and selects discovered Research candidate sources.
 * 
 * @param {object} params
 * @param {Array<object>} params.candidates - Discovered web candidate sources
 * @param {string} [params.missionObjective=''] - User mission objective
 * @param {string} [params.taskTitle=''] - Current research task title
 * @param {string} [params.taskDescription=''] - Task description
 * @param {object} [params.input={}] - Task input parameters
 * @param {number} [params.maxResults=3] - Maximum targets to select (capped strictly at 3)
 * @param {Set<string>|Array<string>} [params.existingUrls] - Existing URLs to exclude
 * @returns {{
 *   selected: Array<object>,
 *   rejected: Array<object>,
 *   ranked: Array<object>,
 *   selectionMetadata: object
 * }}
 */
function selectSources({
  candidates = [],
  missionObjective = '',
  taskTitle = '',
  taskDescription = '',
  input = {},
  maxResults = SELECTION_LIMITS.DEFAULT_MAX_TARGETS,
  existingUrls,
} = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      selected: [],
      rejected: [],
      ranked: [],
      selectionMetadata: {
        totalEvaluated: 0,
        selectedCount: 0,
        rejectedCount: 0,
        maxResultsClamped: Math.min(Math.max(Number(maxResults) || SELECTION_LIMITS.DEFAULT_MAX_TARGETS, SELECTION_LIMITS.MIN_TARGETS), SELECTION_LIMITS.ABSOLUTE_MAX_TARGETS),
      },
    };
  }

  // 1. Clamp maxResults strictly to [1, 3]
  const clampedMax = Math.min(
    Math.max(Number(maxResults) || SELECTION_LIMITS.DEFAULT_MAX_TARGETS, SELECTION_LIMITS.MIN_TARGETS),
    SELECTION_LIMITS.ABSOLUTE_MAX_TARGETS
  );

  // 2. Build set of existing URLs to avoid duplication
  const existingSet = new Set();
  if (existingUrls) {
    const list = Array.isArray(existingUrls) ? existingUrls : Array.from(existingUrls);
    for (const u of list) {
      const norm = normalizeCanonicalUrl(u);
      if (norm) existingSet.add(norm);
    }
  }

  // 3. Deduplicate and evaluate candidates via Source Intelligence
  const seenCanonical = new Set();
  const evaluated = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    if (!cand || typeof cand !== 'object') continue;

    const rawUrl = cand.url;
    if (!rawUrl || typeof rawUrl !== 'string') continue;

    const canonicalUrl = normalizeCanonicalUrl(rawUrl);
    if (!canonicalUrl) continue;

    // Deduplicate against already existing mission URLs and within current candidate batch
    if (existingSet.has(canonicalUrl) || seenCanonical.has(canonicalUrl)) {
      continue;
    }
    seenCanonical.add(canonicalUrl);

    // Call 8E.1 canonical Source Intelligence Service
    const intelligence = analyzeSource({
      url: canonicalUrl,
      title: cand.title || '',
      snippet: cand.snippet || '',
      missionObjective,
      taskTitle,
      publishedAt: cand.publishedAt,
      retrievedAt: cand.retrievedAt,
    });

    evaluated.push({
      ...cand,
      url: canonicalUrl,
      canonicalUrl,
      title: (cand.title || 'Discovered Web Source').trim(),
      snippet: (cand.snippet || '').trim(),
      sourceType: intelligence.sourceType,
      authorityTier: intelligence.authorityTier,
      officialDomain: intelligence.officialDomain,
      relevanceScore: intelligence.relevanceScore,
      freshnessScore: intelligence.freshnessScore,
      freshnessLabel: intelligence.freshnessLabel,
      qualityScore: intelligence.qualityScore,
      signals: intelligence.signals,
      originalIndex: i,
    });
  }

  // 4. Deterministic multi-attribute ranking
  evaluated.sort(compareCandidates);

  // 5. Partition into selected and rejected sets
  const selected = [];
  const rejected = [];

  for (let rank = 0; rank < evaluated.length; rank++) {
    const cand = evaluated[rank];
    const rankNumber = rank + 1;

    if (selected.length < clampedMax) {
      selected.push({
        ...cand,
        rank: rankNumber,
        selectionStatus: 'selected',
        selectionReason: generateSelectionReason(cand),
      });
    } else {
      rejected.push({
        ...cand,
        rank: rankNumber,
        selectionStatus: 'rejected',
        rejectionReason: 'ranked-below-cap',
      });
    }
  }

  return {
    selected,
    rejected,
    ranked: evaluated,
    selectionMetadata: {
      totalEvaluated: evaluated.length,
      selectedCount: selected.length,
      rejectedCount: rejected.length,
      maxResultsClamped: clampedMax,
      topQualityScore: selected[0]?.qualityScore ?? null,
      topRelevanceScore: selected[0]?.relevanceScore ?? null,
    },
  };
}

module.exports = {
  SELECTION_LIMITS,
  AUTHORITY_TIER_RANK,
  compareCandidates,
  generateSelectionReason,
  selectSources,
};
