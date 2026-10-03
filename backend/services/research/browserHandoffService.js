const mongoose = require('mongoose');
const MissionTask = require('../../models/MissionTask');
const { checkUrlSynchronous, validateBrowserUrl } = require('../browser/browserPolicy');
const { validateSafeUrl } = require('./urlValidator');

/**
 * Service bounds and constraints
 */
const HANDOFF_LIMITS = {
  DEFAULT_MAX_TARGETS: 3,
  ABSOLUTE_MAX_TARGETS: 3,
  MIN_TARGETS: 1,
  MAX_TITLE_LENGTH: 80,
  MAX_SNIPPET_LENGTH: 300,
};

/**
 * Normalizes a URL into canonical representation for deterministic comparison and deduplication.
 * - Enforces http / https protocol
 * - Lowercases scheme and host
 * - Removes default ports (:80, :443)
 * - Strips fragment/hash (#...)
 * - Normalizes path (strips trailing slash unless root /)
 * - Strips marketing/tracking query parameters (utm_*, ref, etc.)
 * - Sorts remaining functional query parameters deterministically
 * 
 * @param {string} rawUrl
 * @returns {string|null} Canonical URL or null if invalid
 */
function normalizeCanonicalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // Only http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  // Lowercase protocol and host
  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return null;

  // Port normalization: omit default ports
  let port = parsed.port;
  if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
    port = '';
  }
  const host = port ? `${hostname}:${port}` : hostname;

  // Path normalization: normalize trailing slash
  let pathname = parsed.pathname || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Query parameter normalization: strip tracking params, sort remaining keys
  const trackingKeys = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'ref',
    'source',
    'fbclid',
    'gclid',
    'msclkid',
  ]);

  const searchParams = new URLSearchParams();
  const sortedKeys = Array.from(parsed.searchParams.keys()).sort();

  for (const key of sortedKeys) {
    if (!trackingKeys.has(key.toLowerCase())) {
      const values = parsed.searchParams.getAll(key);
      for (const val of values) {
        searchParams.append(key, val);
      }
    }
  }

  const queryString = searchParams.toString();
  const finalSearch = queryString ? `?${queryString}` : '';

  // Fragments are always stripped
  return `${protocol}//${host}${pathname}${finalSearch}`;
}

/**
 * Validates, filters, deduplicates, and bounds discovered candidate sources.
 * Reuses existing strict SSRF and browser policy security validation.
 * 
 * @param {Array<object>} candidates - Raw candidates from searchWeb
 * @param {object} [options={}]
 * @param {number} [options.maxTargets=3] - Maximum targets to select (max 3)
 * @param {Set<string>|Array<string>} [options.existingUrls] - URLs already visited or assigned
 * @param {string|mongoose.Types.ObjectId} [options.missionId] - Mission context ID
 * @param {string|mongoose.Types.ObjectId} [options.researchTaskId] - Originating research task ID
 * @returns {Promise<Array<{ title: string, url: string, snippet: string, source: string, candidateIndex: number }>>}
 */
async function validateAndSelectCandidates(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const maxTargets = Math.min(
    Math.max(Number(options.maxTargets) || HANDOFF_LIMITS.DEFAULT_MAX_TARGETS, HANDOFF_LIMITS.MIN_TARGETS),
    HANDOFF_LIMITS.ABSOLUTE_MAX_TARGETS
  );

  // Normalize existing URLs set for deduplication
  const existingSet = new Set();
  if (options.existingUrls) {
    const list = Array.isArray(options.existingUrls)
      ? options.existingUrls
      : Array.from(options.existingUrls);
    for (const u of list) {
      const norm = normalizeCanonicalUrl(u);
      if (norm) existingSet.add(norm);
    }
  }

  const validPool = [];
  const batchSeen = new Set();

  for (let idx = 0; idx < candidates.length; idx++) {
    const cand = candidates[idx];
    if (!cand || typeof cand !== 'object') continue;

    const rawUrl = cand.url;
    if (!rawUrl || typeof rawUrl !== 'string') continue;

    // 1. Canonical normalization
    const canonicalUrl = normalizeCanonicalUrl(rawUrl);
    if (!canonicalUrl) {
      continue;
    }

    // 2. Deduplication against batch and existing mission tasks
    if (batchSeen.has(canonicalUrl) || existingSet.has(canonicalUrl)) {
      continue;
    }

    // 3. Fast synchronous protocol and hostname policy check
    const syncCheck = checkUrlSynchronous(canonicalUrl);
    if (!syncCheck.isAllowed) {
      console.warn(`[BROWSER HANDOFF] Candidate URL '${canonicalUrl}' failed sync policy: ${syncCheck.reason}`);
      continue;
    }

    // 4. Asynchronous SSRF, DNS resolution, and private IP validation
    try {
      const policyCheck = await validateBrowserUrl(canonicalUrl);
      if (!policyCheck.isValid) {
        console.warn(`[BROWSER HANDOFF] Candidate URL '${canonicalUrl}' failed security check: ${policyCheck.reason}`);
        continue;
      }
    } catch (valErr) {
      console.warn(`[BROWSER HANDOFF] Error validating candidate URL '${canonicalUrl}':`, valErr.message);
      continue;
    }

    // 5. Accepted candidate into verified pool
    batchSeen.add(canonicalUrl);
    validPool.push({
      title: (cand.title || 'Discovered Web Source').trim(),
      url: canonicalUrl,
      snippet: (cand.snippet || '').trim().slice(0, HANDOFF_LIMITS.MAX_SNIPPET_LENGTH),
      source: cand.source || cand.discoveredVia || 'web-search',
      candidateIndex: idx,
      publishedAt: cand.publishedAt,
      retrievedAt: cand.retrievedAt,
    });
  }

  if (validPool.length === 0) {
    return [];
  }

  // 6. Intelligent Source Selection (deterministic evaluation & ranking)
  if (options.missionObjective || options.taskTitle || options.rankSources) {
    const { selectSources } = require('../sourceIntelligence/sourceSelectionService');
    const selectionResult = selectSources({
      candidates: validPool,
      missionObjective: options.missionObjective || '',
      taskTitle: options.taskTitle || '',
      taskDescription: options.taskDescription || '',
      input: options.input || {},
      maxResults: maxTargets,
      existingUrls: options.existingUrls,
    });

    return selectionResult.selected;
  }

  // Preserve original validation encounter order bounded by maxTargets
  return validPool.slice(0, maxTargets);
}

/**
 * Creates dynamic Browser MissionTasks from validated Research candidate sources.
 * Shifts downstream pending tasks forward and persists new browser tasks atomically.
 * 
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.missionId
 * @param {string|mongoose.Types.ObjectId} params.researchTaskId
 * @param {Array<object>} params.candidates - Candidate sources discovered by Research
 * @param {number} params.currentTaskOrder - Order number of the completing research task
 * @param {object} [params.options={}]
 * @returns {Promise<{ tasksCreated: Array<import('mongoose').Document>, count: number }>}
 */
async function createBrowserTasksFromResearch({
  missionId,
  researchTaskId,
  candidates,
  currentTaskOrder,
  options = {},
}) {
  // 1. Validate missionId
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    throw new Error('Valid missionId is required for dynamic browser task creation');
  }

  const missionObjectId = new mongoose.Types.ObjectId(missionId);
  const researchTaskObjectId = researchTaskId && mongoose.Types.ObjectId.isValid(researchTaskId)
    ? new mongoose.Types.ObjectId(researchTaskId)
    : null;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { tasksCreated: [], count: 0 };
  }

  // 2. Query existing tasks for this mission to collect already assigned URLs and avoid duplication
  const existingTasks = await MissionTask.find({ missionId: missionObjectId }).lean();
  const existingUrls = new Set();
  for (const t of existingTasks) {
    if (t.url) {
      const norm = normalizeCanonicalUrl(t.url);
      if (norm) existingUrls.add(norm);
    }
  }

  // 2b. Context resolution for missionObjective and taskTitle
  let missionObjective = options.missionObjective;
  let taskTitle = options.taskTitle;
  if (!missionObjective) {
    const Mission = require('../../models/Mission');
    const m = await Mission.findById(missionObjectId).lean();
    if (m?.objective) missionObjective = m.objective;
  }
  if (!taskTitle && researchTaskObjectId) {
    const rt = await MissionTask.findById(researchTaskObjectId).lean();
    if (rt?.title) taskTitle = rt.title;
  }

  // 3. Validate, deduplicate, rank, and select up to max 3 candidate targets
  const selectedCandidates = await validateAndSelectCandidates(candidates, {
    maxTargets: options.maxTargets || HANDOFF_LIMITS.DEFAULT_MAX_TARGETS,
    existingUrls,
    missionId: missionObjectId,
    researchTaskId: researchTaskObjectId,
    missionObjective,
    taskTitle,
    taskDescription: options.taskDescription,
    input: options.input,
    rankSources: true,
  });

  if (selectedCandidates.length === 0) {
    return { tasksCreated: [], count: 0 };
  }

  const insertCount = selectedCandidates.length;
  const startOrder = (typeof currentTaskOrder === 'number' && currentTaskOrder >= 1)
    ? currentTaskOrder
    : 2;

  // 4. Shift downstream pending tasks forward by insertCount to preserve strict sequential order
  await MissionTask.updateMany(
    {
      missionId: missionObjectId,
      status: 'pending',
      order: { $gt: startOrder },
    },
    {
      $inc: { order: insertCount },
    }
  );

  // 5. Construct new dynamic Browser MissionTasks with provenance and source intelligence metadata
  const newTasksData = selectedCandidates.map((cand, idx) => {
    const rawTitle = cand.title || cand.url;
    const cleanTitle = rawTitle.slice(0, HANDOFF_LIMITS.MAX_TITLE_LENGTH);

    return {
      missionId: missionObjectId,
      title: `Inspect discovered source: ${cleanTitle}`,
      description: `Navigate to ${cand.url} and extract verified page content, structure, and evidence.`,
      status: 'pending',
      order: startOrder + 1 + idx,
      agentId: 'browser',
      url: cand.url,
      executionMetadata: {
        sourceType: 'research-discovery',
        parentResearchTaskId: researchTaskObjectId ? researchTaskObjectId.toString() : null,
        candidateTitle: cand.title,
        candidateSnippet: cand.snippet,
        discoveredVia: cand.source || cand.discoveredVia || 'web-search',
        sourceIntelligence: {
          sourceType: cand.sourceType,
          authorityTier: cand.authorityTier,
          officialDomain: cand.officialDomain,
          relevanceScore: cand.relevanceScore,
          freshnessScore: cand.freshnessScore,
          freshnessLabel: cand.freshnessLabel,
          qualityScore: cand.qualityScore,
          signals: cand.signals,
        },
        sourceSelection: {
          rank: cand.rank || (idx + 1),
          qualityScore: cand.qualityScore,
          relevanceScore: cand.relevanceScore,
          authorityTier: cand.authorityTier,
          officialDomain: cand.officialDomain,
          selectionReason: cand.selectionReason,
        },
      },
    };
  });

  // 6. Persist new dynamic browser tasks
  const createdTasks = await MissionTask.insertMany(newTasksData);

  return {
    tasksCreated: createdTasks,
    count: createdTasks.length,
  };
}

module.exports = {
  HANDOFF_LIMITS,
  normalizeCanonicalUrl,
  validateAndSelectCandidates,
  createBrowserTasksFromResearch,
};
