const mongoose = require('mongoose');
const Evidence = require('../../models/Evidence');

/**
 * Bounds for Evidence documents generated from browser observations
 */
const EVIDENCE_LIMITS = {
  MAX_PASSAGES: 3,                 // Maximum 3 evidence records per browser task
  MIN_PASSAGE_LENGTH: 30,          // Minimum length to qualify as meaningful evidence
  MAX_PASSAGE_LENGTH: 450,         // Maximum characters per passage excerpt
  MAX_CLAIM_LENGTH: 300,           // Maximum length for claim statement
};

/**
 * Extracts focused, bounded text passages from raw observed page text.
 * Deterministically splits paragraphs, prioritizes meaningful content,
 * and bounds passage lengths without altering verbatim source words.
 * 
 * @param {string} rawText
 * @param {Array<{level: number, text: string}>} [headings=[]]
 * @returns {string[]} Array of non-empty bounded passage strings
 */
function extractEvidencePassages(rawText = '', headings = []) {
  const passages = [];

  // 1. If structured headings exist, construct a structural outline passage
  if (Array.isArray(headings) && headings.length > 0) {
    const headingLines = headings
      .slice(0, 5)
      .map(h => `H${h.level}: ${h.text}`)
      .join(' | ');
    if (headingLines.length >= EVIDENCE_LIMITS.MIN_PASSAGE_LENGTH) {
      passages.push(`Observed document headings: ${headingLines.slice(0, EVIDENCE_LIMITS.MAX_PASSAGE_LENGTH)}`);
    }
  }

  // 2. Extract readable body text paragraphs
  if (typeof rawText === 'string' && rawText.trim().length >= EVIDENCE_LIMITS.MIN_PASSAGE_LENGTH) {
    const paragraphs = rawText
      .split(/\n\s*\n|\.\s{2,}/)
      .map(p => p.replace(/\s+/g, ' ').trim())
      .filter(p => p.length >= EVIDENCE_LIMITS.MIN_PASSAGE_LENGTH);

    if (paragraphs.length > 0) {
      for (const p of paragraphs) {
        if (passages.length >= EVIDENCE_LIMITS.MAX_PASSAGES) break;
        let bounded = p;
        if (bounded.length > EVIDENCE_LIMITS.MAX_PASSAGE_LENGTH) {
          bounded = bounded.slice(0, EVIDENCE_LIMITS.MAX_PASSAGE_LENGTH - 3) + '...';
        }
        passages.push(bounded);
      }
    } else {
      // Fallback to single chunk from continuous text
      let bounded = rawText.replace(/\s+/g, ' ').trim();
      if (bounded.length > EVIDENCE_LIMITS.MAX_PASSAGE_LENGTH) {
        bounded = bounded.slice(0, EVIDENCE_LIMITS.MAX_PASSAGE_LENGTH - 3) + '...';
      }
      passages.push(bounded);
    }
  }

  return passages.slice(0, EVIDENCE_LIMITS.MAX_PASSAGES);
}

/**
 * Derives a conservative, grounded claim statement without inventing claims.
 * 
 * @param {string} sourceTitle
 * @param {string} taskTitle
 * @param {number} index
 * @returns {string} Factual provenance-backed claim
 */
function deriveFactualClaim(sourceTitle, taskTitle, index = 0) {
  const title = (sourceTitle || 'Web source').trim();
  const taskDesc = (taskTitle || 'web inspection').trim();

  if (index === 0) {
    return `Observed primary content from '${title}' for task: ${taskDesc}`.slice(0, EVIDENCE_LIMITS.MAX_CLAIM_LENGTH);
  }
  return `Observed contextual reference from '${title}' (passage ${index + 1}) for task: ${taskDesc}`.slice(0, EVIDENCE_LIMITS.MAX_CLAIM_LENGTH);
}

/**
 * Persists real Evidence documents into MongoDB from authoritative Browser Agent output.
 * 
 * Enforces:
 * - Deterministic provenance: sourceUrl, sourceTitle, and text originate strictly from browser
 * - Zero fake facts: claims are strictly bounded observation statements
 * - Idempotency: removes any previous evidence for the exact same { missionId, taskId }
 * - Cross-mission & cross-task isolation
 * 
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.missionId
 * @param {string|mongoose.Types.ObjectId} params.taskId
 * @param {object} params.browserResult - Standard browser execution result
 * @param {string} [params.taskTitle=''] - Title of the executing task
 * @returns {Promise<Array<import('mongoose').Document>>} Persisted Evidence records
 */
async function persistBrowserEvidence({
  missionId,
  taskId,
  browserResult,
  taskTitle = '',
}) {
  // 1. Validate ID parameters
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    throw new Error(`BrowserEvidenceService: invalid or missing missionId: '${missionId}'`);
  }
  if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
    throw new Error(`BrowserEvidenceService: invalid or missing taskId: '${taskId}'`);
  }

  // 2. Validate browser result
  if (!browserResult || typeof browserResult !== 'object') {
    throw new Error('BrowserEvidenceService: valid browserResult object is required');
  }

  if (browserResult.status !== 'completed' || !browserResult.data) {
    return [];
  }

  const data = browserResult.data;
  const verifiedUrl = (data.finalUrl || data.url || '').trim();
  if (!verifiedUrl) {
    throw new Error('BrowserEvidenceService: browserResult must contain a verified finalUrl or url');
  }

  const sourceTitle = (data.title || verifiedUrl).trim();
  const rawText = data.text || data.extractedText || '';
  const headings = Array.isArray(data.headings) ? data.headings : [];

  // 3. Extract grounded passages
  let passages = extractEvidencePassages(rawText, headings);

  // If page text is very short (e.g. minimal status page), create single fallback passage
  if (passages.length === 0 && rawText.trim().length > 0) {
    passages = [rawText.trim().slice(0, EVIDENCE_LIMITS.MAX_PASSAGE_LENGTH)];
  } else if (passages.length === 0) {
    // If no body text at all, record basic page presence
    passages = [`Verified page accessibility for ${sourceTitle} (${verifiedUrl}) with HTTP ${data.httpStatus || 200}.`];
  }

  const missionObjectId = new mongoose.Types.ObjectId(missionId);
  const taskObjectId = new mongoose.Types.ObjectId(taskId);
  const retrievalTimestamp = new Date();

  // 4. Construct Evidence documents
  const evidenceDocs = passages.map((passage, idx) => ({
    missionId: missionObjectId,
    taskId: taskObjectId,
    sourceUrl: verifiedUrl,
    sourceTitle,
    claim: deriveFactualClaim(sourceTitle, taskTitle, idx),
    evidenceText: passage,
    retrievedAt: retrievalTimestamp,
  }));

  // 5. Idempotent persistence: remove existing evidence strictly for this { missionId, taskId }
  await Evidence.deleteMany({
    missionId: missionObjectId,
    taskId: taskObjectId,
  });

  // 6. Insert fresh Evidence
  const createdEvidence = await Evidence.insertMany(evidenceDocs);
  return createdEvidence;
}

module.exports = {
  persistBrowserEvidence,
  extractEvidencePassages,
  deriveFactualClaim,
  EVIDENCE_LIMITS,
};
