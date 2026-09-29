/**
 * Base Search Provider Contract
 * 
 * Standard interface for all search provider implementations.
 */

class BaseSearchProvider {
  constructor(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('Search provider name must be a non-empty string');
    }
    this.name = name;
  }

  /**
   * Executes a search query.
   * 
   * @param {string} query - The search query
   * @param {object} [options={}] - Search options (e.g. limit)
   * @returns {Promise<Array<{ title: string, url: string, snippet: string, source: string }>>}
   */
  async search(query, options = {}) {
    throw new Error(`Method search() must be implemented by provider [${this.name}]`);
  }
}

module.exports = BaseSearchProvider;
