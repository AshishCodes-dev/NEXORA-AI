const BaseSearchProvider = require('./baseSearchProvider');
const { decodeHtmlEntities } = require('../htmlExtractor');

/**
 * DuckDuckGo HTML Search Provider
 * 
 * Free, zero-API-key web search provider that parses real web search results
 * from DuckDuckGo's HTML search interface.
 */
class DuckDuckGoSearchProvider extends BaseSearchProvider {
  constructor() {
    super('duckduckgo');
  }

  async search(query, options = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const limit = options.limit || 5;
    const timeoutMs = options.timeoutMs || 8000;

    const encodedQuery = encodeURIComponent(query.trim());
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`DuckDuckGo search timed out after ${timeoutMs}ms`);
      }
      throw new Error(`DuckDuckGo search network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`DuckDuckGo search returned HTTP ${res.status}`);
    }

    const html = await res.text();
    const results = [];

    // Split into result blocks
    const resultBlocks = html.split(/<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>/i).slice(1);

    for (const block of resultBlocks) {
      if (results.length >= limit) break;

      const titleMatch = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      const snippetMatch = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);

      if (titleMatch) {
        let rawUrl = titleMatch[1];
        let title = decodeHtmlEntities(titleMatch[2].replace(/<[^>]+>/g, '').trim());
        let snippet = '';

        if (snippetMatch) {
          snippet = decodeHtmlEntities(snippetMatch[1].replace(/<[^>]+>/g, '').trim());
        }

        // Decode DDG redirect URL (uddg parameter)
        if (rawUrl.includes('uddg=')) {
          try {
            const parsed = new URL(rawUrl, 'https://duckduckgo.com');
            const realTarget = parsed.searchParams.get('uddg');
            if (realTarget) rawUrl = decodeURIComponent(realTarget);
          } catch {
            // Keep rawUrl if parse fails
          }
        }

        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
          results.push({
            title: title || 'Untitled Page',
            url: rawUrl,
            snippet: snippet || '',
            source: 'duckduckgo',
          });
        }
      }
    }

    return results;
  }
}

module.exports = DuckDuckGoSearchProvider;
