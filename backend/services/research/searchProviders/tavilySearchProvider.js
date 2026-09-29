const BaseSearchProvider = require('./baseSearchProvider');

/**
 * Tavily AI Search Provider
 * 
 * Free-tier (1,000 requests/mo) AI search API.
 * Activated if TAVILY_API_KEY is defined in process.env.
 */
class TavilySearchProvider extends BaseSearchProvider {
  constructor(apiKey) {
    super('tavily');
    this.apiKey = apiKey || process.env.TAVILY_API_KEY || '';
  }

  isAvailable() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async search(query, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Tavily API key is not configured');
    }

    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const limit = options.limit || 5;
    const timeoutMs = options.timeoutMs || 8000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: query.trim(),
          search_depth: 'basic',
          max_results: limit,
          include_answer: false,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Tavily search timed out after ${timeoutMs}ms`);
      }
      throw new Error(`Tavily search network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`Tavily search returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const results = [];

    if (Array.isArray(data.results)) {
      for (const item of data.results) {
        if (results.length >= limit) break;
        if (item.url && (item.url.startsWith('http://') || item.url.startsWith('https://'))) {
          results.push({
            title: item.title || 'Untitled Result',
            url: item.url,
            snippet: item.content || '',
            source: 'tavily',
          });
        }
      }
    }

    return results;
  }
}

module.exports = TavilySearchProvider;
