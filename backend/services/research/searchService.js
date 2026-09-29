const DuckDuckGoSearchProvider = require('./searchProviders/duckduckgoSearchProvider');
const WikipediaSearchProvider = require('./searchProviders/wikipediaSearchProvider');
const TavilySearchProvider = require('./searchProviders/tavilySearchProvider');

// Provider instances
const ddgProvider = new DuckDuckGoSearchProvider();
const wikiProvider = new WikipediaSearchProvider();
const tavilyProvider = new TavilySearchProvider();

/**
 * Searches the web using the configured or best available search provider.
 * Normalizes results, removes duplicates, validates URL syntax, and enforces result limits.
 * 
 * @param {string} query - The search query
 * @param {object} [options={}]
 * @param {number} [options.limit=5] - Maximum number of normalized results
 * @param {string} [options.provider] - Explicit provider override ('duckduckgo', 'wikipedia', 'tavily')
 * @returns {Promise<{ results: Array<{ title: string, url: string, snippet: string, source: string }> }>}
 */
async function searchWeb(query, options = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return { results: [] };
  }

  const limit = Math.min(Math.max(options.limit || 5, 1), 10);
  const cleanQuery = query.trim().slice(0, 200);

  let rawResults = [];
  let primaryError = null;

  // Determine provider strategy
  const explicitProvider = options.provider;

  if (explicitProvider === 'tavily' && tavilyProvider.isAvailable()) {
    rawResults = await tavilyProvider.search(cleanQuery, { limit });
  } else if (explicitProvider === 'wikipedia') {
    rawResults = await wikiProvider.search(cleanQuery, { limit });
  } else if (explicitProvider === 'duckduckgo') {
    rawResults = await ddgProvider.search(cleanQuery, { limit });
  } else {
    // Default zero-cost strategy:
    // 1. If Tavily API key is explicitly configured, use it
    if (tavilyProvider.isAvailable()) {
      try {
        rawResults = await tavilyProvider.search(cleanQuery, { limit });
      } catch (err) {
        primaryError = err;
      }
    }

    // 2. Try DuckDuckGo
    if (rawResults.length === 0) {
      try {
        rawResults = await ddgProvider.search(cleanQuery, { limit });
      } catch (ddgErr) {
        primaryError = ddgErr;
      }
    }

    // 3. Fallback to Wikipedia if primary returned no results or failed
    if (rawResults.length === 0) {
      try {
        rawResults = await wikiProvider.search(cleanQuery, { limit });
      } catch (wikiErr) {
        // If all providers fail, log and return empty rather than fabricating
        console.warn(`[SEARCH SERVICE] All providers failed for query '${cleanQuery}':`, wikiErr.message);
      }
    }
  }

  // Normalize, deduplicate, and validate results
  const seenUrls = new Set();
  const normalizedResults = [];

  for (const item of rawResults) {
    if (!item || typeof item !== 'object') continue;

    const rawUrl = item.url;
    if (!rawUrl || typeof rawUrl !== 'string') continue;

    // Validate URL syntax
    let canonicalUrl;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      canonicalUrl = parsed.href;
    } catch {
      continue;
    }

    if (seenUrls.has(canonicalUrl)) continue;
    seenUrls.add(canonicalUrl);

    normalizedResults.push({
      title: (item.title || 'Untitled Source').trim(),
      url: canonicalUrl,
      snippet: (item.snippet || '').trim(),
      source: item.source || 'web',
    });

    if (normalizedResults.length >= limit) {
      break;
    }
  }

  return {
    results: normalizedResults,
  };
}

module.exports = {
  searchWeb,
  ddgProvider,
  wikiProvider,
  tavilyProvider,
};
