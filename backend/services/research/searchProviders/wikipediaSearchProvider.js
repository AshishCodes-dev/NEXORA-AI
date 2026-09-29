const BaseSearchProvider = require('./baseSearchProvider');

/**
 * Wikipedia OpenSearch / Full-Text Search Provider
 * 
 * Free, zero-API-key official search provider using Wikimedia's public API.
 * Uses OpenSearch first; falls back to full-text search if query is specific.
 */
class WikipediaSearchProvider extends BaseSearchProvider {
  constructor() {
    super('wikipedia');
  }

  async search(query, options = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const limit = options.limit || 5;
    const timeoutMs = options.timeoutMs || 8000;
    const cleanQuery = query.trim();

    // 1. Try OpenSearch
    let results = await this._openSearch(cleanQuery, limit, timeoutMs);
    if (results.length > 0) {
      return results;
    }

    // 2. Fallback to full-text search
    results = await this._fullTextSearch(cleanQuery, limit, timeoutMs);
    return results;
  }

  async _openSearch(query, limit, timeoutMs) {
    const encoded = encodeURIComponent(query);
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encoded}&limit=${limit}&namespace=0&format=json`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'NexoraResearchBot/1.0 (https://github.com/AshishCodes-dev/NEXORA-AI)',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) return [];

      const data = await res.json();
      if (!Array.isArray(data) || data.length < 4) return [];

      const titles = data[1] || [];
      const snippets = data[2] || [];
      const urls = data[3] || [];

      const results = [];
      for (let i = 0; i < titles.length && results.length < limit; i++) {
        const url = urls[i];
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          results.push({
            title: titles[i] || 'Wikipedia Article',
            url,
            snippet: snippets[i] || '',
            source: 'wikipedia',
          });
        }
      }
      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async _fullTextSearch(query, limit, timeoutMs) {
    const encoded = encodeURIComponent(query);
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&srlimit=${limit}&format=json`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'NexoraResearchBot/1.0 (https://github.com/AshishCodes-dev/NEXORA-AI)',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) return [];

      const data = await res.json();
      const searchItems = data?.query?.search || [];

      const results = [];
      for (const item of searchItems) {
        if (results.length >= limit) break;
        const title = item.title;
        if (!title) continue;

        const cleanSnippet = (item.snippet || '').replace(/<[^>]+>/g, '').trim();
        const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;

        results.push({
          title,
          url: articleUrl,
          snippet: cleanSnippet,
          source: 'wikipedia',
        });
      }
      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = WikipediaSearchProvider;
