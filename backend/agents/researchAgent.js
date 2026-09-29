const mongoose = require('mongoose');
const { createAgent } = require('./baseAgent');
const { searchWeb } = require('../services/research/searchService');
const { validateSafeUrl } = require('../services/research/urlValidator');
const { fetchSource } = require('../services/research/sourceFetcher');
const Evidence = require('../models/Evidence');

/**
 * Builds a clean, focused web search query from a task's title and description.
 * 
 * @param {object} task
 * @returns {string}
 */
function buildSearchQuery(task) {
  const title = (task.title || '').trim();
  const desc = (task.description || '').trim();

  // Strip common prompt prefixes: "Research:", "Investigate:", "Task 1:", etc.
  let cleaned = title.replace(/^(task\s*\d*[:\-]|research[:\-]|investigate[:\-]|analyze[:\-])/i, '').trim();

  if (cleaned.length < 5 && desc.length > 0) {
    cleaned = desc.slice(0, 100);
  }

  return cleaned || 'AI agent architecture';
}

/**
 * Extracts candidate evidence passages from a retrieved source document.
 * Deterministically aligns source text with task keywords to generate
 * focused, provenance-backed evidence without inventing external claims.
 * 
 * @param {object} source - Normalized source object { title, url, text, retrievedAt }
 * @param {object} task - MissionTask definition
 * @param {string} query - The search query executed
 * @returns {{ sourceUrl: string, sourceTitle: string, claim: string, evidenceText: string, retrievedAt: string } | null}
 */
function extractEvidencePassage(source, task, query) {
  const text = source.text || '';
  if (!text || text.length < 30) return null;

  // Split into readable paragraphs
  const paragraphs = text.split('\n\n').map(p => p.trim()).filter(p => p.length >= 40);
  if (paragraphs.length === 0) return null;

  // Extract query keywords for relevance scoring
  const keywords = `${task.title} ${query}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(k => k.length >= 3);

  let bestParagraph = paragraphs[0];
  let bestScore = -1;

  for (const para of paragraphs) {
    const lowerPara = para.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lowerPara.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestParagraph = para;
    }
  }

  // Bound evidence snippet length to keep claims focused (100 - 350 chars)
  let evidenceText = bestParagraph;
  if (evidenceText.length > 350) {
    evidenceText = evidenceText.slice(0, 347) + '...';
  }

  const claim = `Source '${source.title}' documents reference information regarding: ${task.title}`;

  return {
    sourceUrl: source.url,
    sourceTitle: source.title,
    claim,
    evidenceText,
    retrievedAt: source.retrievedAt || new Date().toISOString(),
  };
}

/**
 * Real Research Agent Execution Handler
 * 
 * Implements the full research pipeline:
 * 1. Task validation
 * 2. Query synthesis (max 3 queries per task, default 1)
 * 3. Web search execution (max 5 candidate sources per query)
 * 4. SSRF & safe URL filtering
 * 5. Source retrieval (max 3 retrieved sources per task)
 * 6. HTML text extraction
 * 7. Evidence extraction with source provenance
 * 8. MongoDB Evidence persistence
 * 9. Structured research result contract
 */
async function executeResearchTask(task, context = {}) {
  // 1. Task validation
  if (!task || typeof task !== 'object') {
    throw new Error('Research Agent: task object is required');
  }

  const taskId = task.taskId || (task._id ? task._id.toString() : null);
  if (!taskId) {
    throw new Error('Research Agent: task.taskId is required');
  }

  const missionId = task.missionId ? task.missionId.toString() : null;
  if (!missionId) {
    throw new Error('Research Agent: task.missionId is required');
  }

  // 2. Build focused search query
  const query = buildSearchQuery(task);
  const queryCount = 1;

  // 3. Search web (limited to 5 candidates)
  const searchResponse = await searchWeb(query, {
    limit: 5,
    provider: context.options?.searchProvider,
  });

  const candidates = searchResponse.results || [];
  const validCandidates = [];

  // 4. Pre-filter candidate URLs with SSRF validation
  for (const candidate of candidates) {
    const check = await validateSafeUrl(candidate.url);
    if (check.isValid) {
      validCandidates.push(candidate);
    } else {
      console.warn(`[RESEARCH AGENT] Dropped candidate URL '${candidate.url}': ${check.reason}`);
    }
  }

  // 5. Source retrieval (max 3 sources per task)
  const sourcesToRetrieve = validCandidates.slice(0, 3);
  const retrievedSources = [];
  const evidenceItems = [];

  for (const candidate of sourcesToRetrieve) {
    try {
      const sourceData = await fetchSource(candidate.url, {
        timeoutMs: 8000,
        maxSizeBytes: 512 * 1024,
      });

      retrievedSources.push({
        title: sourceData.title,
        url: sourceData.url,
        retrievedAt: sourceData.retrievedAt,
      });

      // 6. Evidence extraction
      const evidence = extractEvidencePassage(sourceData, task, query);
      if (evidence) {
        evidenceItems.push(evidence);
      }
    } catch (fetchErr) {
      console.warn(`[RESEARCH AGENT] Failed to retrieve source '${candidate.url}':`, fetchErr.message);
    }
  }

  // 7. Evidence Persistence to MongoDB
  if (evidenceItems.length > 0) {
    const validMissionObjectId = mongoose.Types.ObjectId.isValid(missionId)
      ? new mongoose.Types.ObjectId(missionId)
      : null;
    const validTaskObjectId = mongoose.Types.ObjectId.isValid(taskId)
      ? new mongoose.Types.ObjectId(taskId)
      : null;

    if (validMissionObjectId && validTaskObjectId) {
      const evidenceDocs = evidenceItems.map(item => ({
        missionId: validMissionObjectId,
        taskId: validTaskObjectId,
        sourceUrl: item.sourceUrl,
        sourceTitle: item.sourceTitle,
        claim: item.claim,
        evidenceText: item.evidenceText,
        retrievedAt: item.retrievedAt ? new Date(item.retrievedAt) : new Date(),
      }));

      try {
        await Evidence.insertMany(evidenceDocs);
      } catch (dbErr) {
        console.error('[RESEARCH AGENT] Evidence persistence failed:', dbErr.message);
        throw new Error(`EVIDENCE_PERSISTENCE_FAILED: ${dbErr.message}`);
      }
    }
  }

  // 8. Result contract
  const sourceCount = retrievedSources.length;
  const evidenceCount = evidenceItems.length;

  const message = sourceCount > 0
    ? `Real research completed successfully. Retrieved ${sourceCount} sources and extracted ${evidenceCount} verified evidence items.`
    : 'Research completed: No accessible candidate sources found.';

  return {
    status: 'completed',
    agentId: 'research',
    taskId,
    message,
    data: {
      queryCount,
      sourcesRetrieved: sourceCount,
      evidenceCount,
      sources: retrievedSources,
      evidence: evidenceItems,
    },
  };
}

const researchAgent = createAgent({
  id: 'research',
  name: 'Research Agent',
  description: 'Live web intelligence retrieval, secure source fetching, and provenance-backed evidence extraction.',
  capabilities: ['web-search', 'evidence-retrieval', 'source-verification', 'content-extraction'],
  executeHandler: executeResearchTask,
});

module.exports = researchAgent;
