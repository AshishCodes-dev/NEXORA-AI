/**
 * Source Intelligence Service - NEXORA Step 8E.1
 * 
 * Provides deterministic, explainable source-selection signals and authority tiers
 * for discovered and fetched web sources without calling external LLMs, embeddings,
 * or network endpoints.
 * 
 * NOTE: Source intelligence scores represent source-selection quality and authority
 * heuristics only; they do NOT claim to prove objective factual truth.
 */

// Common English stopwords for relevance tokenization
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did',
  'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off',
  'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out',
  'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that',
  'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves', 'using',
  'please', 'gather', 'collect', 'provide', 'prepare', 'research', 'analyze',
  'study', 'investigate', 'explore', 'find', 'verified', 'official', 'public',
  'documentation', 'docs', 'detail', 'comprehensive', 'information', 'overview'
]);

/**
 * Registry of canonical software/tech ecosystems and their authoritative domains.
 * Used for deterministic context-aware official domain resolution.
 */
const CANONICAL_ECOSYSTEM_DOMAINS = [
  { keywords: ['node', 'nodejs', 'node.js', 'libuv', 'npm'], domains: ['nodejs.org', 'npmjs.com', 'openjsf.org'] },
  { keywords: ['mongo', 'mongodb', 'mongosh', 'bson', 'wiredtiger'], domains: ['mongodb.com'] },
  { keywords: ['react', 'reactjs', 'react.js'], domains: ['react.dev', 'reactjs.org'] },
  { keywords: ['vue', 'vuejs', 'vue.js'], domains: ['vuejs.org'] },
  { keywords: ['angular'], domains: ['angular.dev', 'angular.io'] },
  { keywords: ['docker', 'containerd'], domains: ['docker.com'] },
  { keywords: ['kubernetes', 'k8s'], domains: ['kubernetes.io'] },
  { keywords: ['python', 'cpython', 'pypi'], domains: ['python.org', 'pypi.org'] },
  { keywords: ['golang', 'go lang'], domains: ['go.dev', 'golang.org'] },
  { keywords: ['rust', 'rustlang', 'cargo'], domains: ['rust-lang.org', 'crates.io'] },
  { keywords: ['postgres', 'postgresql'], domains: ['postgresql.org'] },
  { keywords: ['redis'], domains: ['redis.io'] },
  { keywords: ['linux'], domains: ['kernel.org', 'linuxfoundation.org'] },
  { keywords: ['typescript'], domains: ['typescriptlang.org'] },
  { keywords: ['javascript', 'ecmascript'], domains: ['tc39.es', 'ecma-international.org', 'developer.mozilla.org'] },
  { keywords: ['w3c', 'html', 'css'], domains: ['w3.org'] },
  { keywords: ['ietf', 'tcp', 'udp', 'http', 'tls', 'dns'], domains: ['ietf.org', 'rfc-editor.org'] },
  { keywords: ['apache'], domains: ['apache.org'] },
];

/**
 * Known top-level standards and specifications bodies
 */
const STANDARDS_DOMAINS = [
  'ietf.org',
  'w3.org',
  'iso.org',
  'rfc-editor.org',
  'tc39.es',
  'ecma-international.org',
  'oasis-open.org',
  'openjsf.org',
  'khronos.org',
  'unicode.org',
  'ansi.org',
  'itu.int'
];

/**
 * Known encyclopedia and reference sources
 */
const ENCYCLOPEDIA_DOMAINS = [
  'wikipedia.org',
  'wikimedia.org',
  'britannica.com',
  'scholarpedia.org',
  'plato.stanford.edu',
  'encyclopedia.com'
];

/**
 * Known developer documentation and reference platforms
 */
const DOCUMENTATION_DOMAINS = [
  'developer.mozilla.org',
  'devdocs.io',
  'readthedocs.io',
  'readthedocs.org',
  'gitbook.io',
  'learn.microsoft.com',
  'pkg.go.dev',
  'docs.rs',
  'crates.io',
  'npmjs.com',
  'pypi.org'
];

/**
 * Known developer and discussion community platforms
 */
const COMMUNITY_DOMAINS = [
  'github.com',
  'gitlab.com',
  'stackoverflow.com',
  'stackexchange.com',
  'reddit.com',
  'dev.to',
  'medium.com',
  'hackernews.com',
  'news.ycombinator.com',
  'discord.com',
  'quora.com'
];

/**
 * Known reputable major journalistic news platforms
 */
const NEWS_DOMAINS = [
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'bloomberg.com',
  'wsj.com',
  'nytimes.com',
  'ft.com',
  'theguardian.com',
  'techcrunch.com',
  'wired.com',
  'arstechnica.com'
];

/**
 * Safely extracts a clean lowercased hostname from a URL string or naked domain.
 * 
 * @param {string} rawUrlOrHost
 * @returns {string} Clean hostname (e.g. "nodejs.org") or empty string
 */
function extractCleanHostname(rawUrlOrHost) {
  if (!rawUrlOrHost || typeof rawUrlOrHost !== 'string') return '';
  const trimmed = rawUrlOrHost.trim().toLowerCase();
  try {
    if (trimmed.includes('://')) {
      const u = new URL(trimmed);
      return u.hostname.toLowerCase();
    }
    const u = new URL(`https://${trimmed}`);
    return u.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Performs safe, exact domain or subdomain matching.
 * Strictly prevents lookalike domain spoofing (e.g. evilnodejs.org will NOT match nodejs.org).
 * 
 * @param {string} hostname - The candidate hostname
 * @param {string} targetDomain - The authorized root or specific domain
 * @returns {boolean}
 */
function matchesDomain(hostname, targetDomain) {
  if (!hostname || !targetDomain) return false;
  const h = hostname.toLowerCase();
  const d = targetDomain.toLowerCase();
  return h === d || h.endsWith('.' + d);
}

/**
 * Determines whether a given hostname is an authoritative official domain for the
 * given task/mission context.
 * 
 * @param {string} hostname
 * @param {object} [context={}]
 * @param {string} [context.missionObjective='']
 * @param {string} [context.taskTitle='']
 * @returns {boolean}
 */
function isOfficialDomain(hostname, context = {}) {
  const cleanHost = extractCleanHostname(hostname);
  if (!cleanHost) return false;

  const missionText = `${context.missionObjective || ''} ${context.taskTitle || ''}`.toLowerCase();

  // 1. Contextual matching against canonical ecosystem domains
  if (missionText.trim()) {
    for (const entry of CANONICAL_ECOSYSTEM_DOMAINS) {
      const matchesKeyword = entry.keywords.some(kw => {
        // Safe word-boundary or substring keyword presence
        const regex = new RegExp(`(^|[^a-z0-9])${kw.replace('.', '\\.')}([^a-z0-9]|$)`, 'i');
        return regex.test(missionText);
      });

      if (matchesKeyword) {
        const matchesAnyDomain = entry.domains.some(d => matchesDomain(cleanHost, d));
        if (matchesAnyDomain) {
          return true;
        }
      }
    }
  }

  // 2. Standalone primary official domain verification (when cleanHost itself is canonical)
  for (const entry of CANONICAL_ECOSYSTEM_DOMAINS) {
    if (entry.domains.some(d => matchesDomain(cleanHost, d))) {
      // If no conflicting context was provided or if context is generic, grant official status
      if (!missionText.trim()) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Classifies a source based on its hostname, path structure, and context.
 * 
 * Supported categories:
 * - official
 * - government
 * - academic
 * - standards
 * - documentation
 * - encyclopedia
 * - news
 * - community
 * - commercial
 * - unknown
 * 
 * @param {string} rawUrlOrHost
 * @param {string} [url='']
 * @param {object} [context={}]
 * @returns {string} Classified source category
 */
function classifySource(rawUrlOrHost, url = '', context = {}) {
  const cleanHost = extractCleanHostname(rawUrlOrHost || url);
  if (!cleanHost) return 'unknown';

  // 1. Government (Strict TLD & domain pattern)
  if (
    cleanHost.endsWith('.gov') ||
    cleanHost.endsWith('.mil') ||
    /\.gov\.[a-z]{2}$/.test(cleanHost) ||
    /\.mil\.[a-z]{2}$/.test(cleanHost) ||
    matchesDomain(cleanHost, 'who.int') ||
    matchesDomain(cleanHost, 'un.org')
  ) {
    return 'government';
  }

  // 2. Academic (Strict TLD & academic indexers)
  if (
    cleanHost.endsWith('.edu') ||
    /\.ac\.[a-z]{2}$/.test(cleanHost) ||
    /\.edu\.[a-z]{2}$/.test(cleanHost) ||
    matchesDomain(cleanHost, 'arxiv.org') ||
    matchesDomain(cleanHost, 'biorxiv.org') ||
    matchesDomain(cleanHost, 'jstor.org') ||
    matchesDomain(cleanHost, 'springer.com') ||
    matchesDomain(cleanHost, 'ieee.org') ||
    matchesDomain(cleanHost, 'acm.org') ||
    matchesDomain(cleanHost, 'ncbi.nlm.nih.gov')
  ) {
    return 'academic';
  }

  // 3. Standards Bodies
  if (STANDARDS_DOMAINS.some(d => matchesDomain(cleanHost, d))) {
    return 'standards';
  }

  // 4. Encyclopedia
  if (ENCYCLOPEDIA_DOMAINS.some(d => matchesDomain(cleanHost, d))) {
    return 'encyclopedia';
  }

  // 5. Documentation
  // Either explicit documentation platform or docs subdomain/path
  const isDocSubdomain = cleanHost.startsWith('docs.') || cleanHost.startsWith('doc.') || cleanHost.startsWith('documentation.');
  const isDocPath = typeof url === 'string' && (url.includes('/docs/') || url.includes('/documentation/') || url.includes('/manual/'));
  if (DOCUMENTATION_DOMAINS.some(d => matchesDomain(cleanHost, d)) || isDocSubdomain || isDocPath) {
    return 'documentation';
  }

  // 6. Official Domain Check
  if (isOfficialDomain(cleanHost, context)) {
    return 'official';
  }

  // 7. News & Journalistic Publications
  if (NEWS_DOMAINS.some(d => matchesDomain(cleanHost, d))) {
    return 'news';
  }

  // 8. Community Platforms
  if (COMMUNITY_DOMAINS.some(d => matchesDomain(cleanHost, d))) {
    return 'community';
  }

  // 9. Commercial
  if (
    cleanHost.endsWith('.com') ||
    cleanHost.endsWith('.io') ||
    cleanHost.endsWith('.ai') ||
    cleanHost.endsWith('.co') ||
    cleanHost.endsWith('.net') ||
    cleanHost.endsWith('.biz')
  ) {
    return 'commercial';
  }

  return 'unknown';
}

/**
 * Determines the authority tier of a source based on classification and official-domain signal.
 * 
 * Tiers: 'high', 'medium', 'low', 'unknown'
 * 
 * @param {string} sourceType
 * @param {boolean} isOfficial
 * @returns {'high'|'medium'|'low'|'unknown'}
 */
function calculateAuthorityTier(sourceType, isOfficial) {
  if (isOfficial) {
    return 'high';
  }

  switch (sourceType) {
    case 'official':
    case 'government':
    case 'standards':
    case 'academic':
      return 'high';

    case 'documentation':
    case 'encyclopedia':
    case 'news':
      return 'medium';

    case 'community':
    case 'commercial':
      return 'low';

    case 'unknown':
    default:
      return 'unknown';
  }
}

/**
 * Tokenizes text for deterministic relevance calculation.
 * Preserves compound tech identifiers (e.g. "node.js" -> "nodejs", "node", "js").
 * 
 * @param {string} text
 * @returns {Array<string>} Unique normalized tokens
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase();

  // Expand tech identifiers (e.g. "node.js" -> "node.js nodejs node js")
  const techPreserved = lower.replace(/\b([a-z0-9]+)\.([a-z0-9]+)\b/g, '$1.$2 $1$2 $1 $2');

  const rawTokens = techPreserved
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));

  return Array.from(new Set(rawTokens));
}

/**
 * Calculates a transparent, bounded relevance score (0.0 to 1.0)
 * based on deterministic keyword overlap between mission context and source metadata.
 * 
 * @param {object} params
 * @param {string} [params.missionObjective='']
 * @param {string} [params.taskTitle='']
 * @param {string} [params.title='']
 * @param {string} [params.snippet='']
 * @param {string} [params.url='']
 * @param {string} [params.hostname='']
 * @returns {number} Bounded score 0.0 to 1.0
 */
function calculateRelevance({
  missionObjective = '',
  taskTitle = '',
  title = '',
  snippet = '',
  url = '',
  hostname = '',
} = {}) {
  const queryTokens = tokenize(`${missionObjective} ${taskTitle}`);
  if (queryTokens.length === 0) {
    // If no context was provided, return a neutral fallback
    return 0.5;
  }

  const titleTokensArr = tokenize(title);
  const bodyTokensArr = tokenize(`${snippet} ${hostname} ${url}`);
  const titleTokens = new Set(titleTokensArr);
  const bodyTokens = new Set(bodyTokensArr);

  let queryMatchesInTitle = 0;
  let queryMatchesInBody = 0;

  for (const token of queryTokens) {
    const inTitle = titleTokens.has(token) || titleTokensArr.some(t => t.length >= 4 && token.length >= 4 && (t.startsWith(token) || token.startsWith(t)));
    const inBody = bodyTokens.has(token) || bodyTokensArr.some(t => t.length >= 4 && token.length >= 4 && (t.startsWith(token) || token.startsWith(t)));

    if (inTitle) {
      queryMatchesInTitle++;
    } else if (inBody) {
      queryMatchesInBody++;
    }
  }

  const totalMatches = queryMatchesInTitle + queryMatchesInBody;
  const coverageRatio = queryTokens.length > 0 ? Math.min(1.0, totalMatches / queryTokens.length) : 1;
  const titleRatio = queryTokens.length > 0 ? Math.min(1.0, queryMatchesInTitle / queryTokens.length) : 1;

  const rawScore = (0.70 * coverageRatio) + (0.30 * titleRatio);
  const boundedScore = Math.min(1.0, Math.max(0.0, rawScore));

  return Number(boundedScore.toFixed(2));
}

/**
 * Calculates a freshness score and descriptive label from metadata timestamps.
 * If publication date is missing, returns 'unknown' and never invents a date.
 * 
 * @param {object} params
 * @param {Date|string|number} [params.retrievedAt]
 * @param {Date|string|number} [params.publishedAt]
 * @returns {{ freshnessScore: number, freshnessLabel: 'fresh'|'recent'|'stale'|'unknown' }}
 */
function calculateFreshness({ retrievedAt, publishedAt } = {}) {
  if (!publishedAt) {
    return {
      freshnessScore: 0.50,
      freshnessLabel: 'unknown',
    };
  }

  const pubDate = new Date(publishedAt);
  if (isNaN(pubDate.getTime())) {
    return {
      freshnessScore: 0.50,
      freshnessLabel: 'unknown',
    };
  }

  const refDate = retrievedAt ? new Date(retrievedAt) : new Date();
  const validRefDate = isNaN(refDate.getTime()) ? new Date() : refDate;

  // Calculate age in days
  const ageMs = Math.max(0, validRefDate.getTime() - pubDate.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Thresholds:
  // Fresh: < 180 days (~6 months) -> Score: 1.00 - 0.85
  // Recent: 180 - 730 days (~2 years) -> Score: 0.70
  // Stale: > 730 days -> Score: 0.35
  if (ageDays <= 180) {
    return {
      freshnessScore: 1.00,
      freshnessLabel: 'fresh',
    };
  } else if (ageDays <= 730) {
    return {
      freshnessScore: 0.70,
      freshnessLabel: 'recent',
    };
  } else {
    return {
      freshnessScore: 0.35,
      freshnessLabel: 'stale',
    };
  }
}

/**
 * Computes a composite deterministic quality score combining authority,
 * official status, relevance, and freshness.
 * 
 * @param {object} params
 * @param {'high'|'medium'|'low'|'unknown'} params.authorityTier
 * @param {boolean} params.officialDomain
 * @param {number} params.relevanceScore
 * @param {number} params.freshnessScore
 * @param {'fresh'|'recent'|'stale'|'unknown'} params.freshnessLabel
 * @returns {number} Bounded score 0.0 to 1.0
 */
function calculateSourceQuality({
  authorityTier,
  officialDomain,
  relevanceScore,
  freshnessScore,
  freshnessLabel,
}) {
  const authorityWeights = {
    high: 1.00,
    medium: 0.75,
    low: 0.45,
    unknown: 0.20,
  };

  const numAuthority = authorityWeights[authorityTier] ?? 0.20;
  const numOfficial = officialDomain ? 1.00 : 0.00;
  const numRelevance = Math.min(1.0, Math.max(0.0, Number(relevanceScore) || 0.0));
  const numFreshness = Math.min(1.0, Math.max(0.0, Number(freshnessScore) || 0.5));

  let score;
  if (freshnessLabel === 'unknown') {
    // When publication date is unknown, reallocate weight across authority & relevance
    // Authority: 40%, Official: 20%, Relevance: 40%
    score = (0.40 * numAuthority) + (0.20 * numOfficial) + (0.40 * numRelevance);
  } else {
    // Authority: 35%, Official: 20%, Relevance: 35%, Freshness: 10%
    score = (0.35 * numAuthority) + (0.20 * numOfficial) + (0.35 * numRelevance) + (0.10 * numFreshness);
  }

  return Number(Math.min(1.0, Math.max(0.0, score)).toFixed(2));
}

/**
 * Main canonical entry point for the Source Intelligence Service.
 * Evaluates candidate or fetched source metadata deterministically.
 * 
 * @param {object} params
 * @param {string} params.url
 * @param {string} [params.title='']
 * @param {string} [params.snippet='']
 * @param {string} [params.missionObjective='']
 * @param {string} [params.taskTitle='']
 * @param {Date|string|number} [params.publishedAt]
 * @param {Date|string|number} [params.retrievedAt]
 * @returns {object} Structured source intelligence result
 */
function analyzeSource({
  url = '',
  title = '',
  snippet = '',
  missionObjective = '',
  taskTitle = '',
  publishedAt,
  retrievedAt,
} = {}) {
  const hostname = extractCleanHostname(url);
  const context = { missionObjective, taskTitle };

  // 1. Classification & Official Domain
  const officialDomain = isOfficialDomain(hostname, context);
  const sourceType = classifySource(hostname, url, context);
  const authorityTier = calculateAuthorityTier(sourceType, officialDomain);

  // 2. Relevance Signal
  const relevanceScore = calculateRelevance({
    missionObjective,
    taskTitle,
    title,
    snippet,
    url,
    hostname,
  });

  // 3. Freshness Signal
  const { freshnessScore, freshnessLabel } = calculateFreshness({
    retrievedAt,
    publishedAt,
  });

  // 4. Composite Quality Score
  const qualityScore = calculateSourceQuality({
    authorityTier,
    officialDomain,
    relevanceScore,
    freshnessScore,
    freshnessLabel,
  });

  // 5. Explainability mapping
  const relevanceLabel = relevanceScore >= 0.70 ? 'strong' : (relevanceScore >= 0.35 ? 'moderate' : 'low');

  return {
    sourceType,
    authorityTier,
    officialDomain,
    relevanceScore,
    freshnessScore,
    freshnessLabel,
    qualityScore,
    signals: {
      officialDomain,
      authorityTier,
      relevance: relevanceLabel,
      freshness: freshnessLabel,
    },
  };
}

module.exports = {
  extractCleanHostname,
  matchesDomain,
  isOfficialDomain,
  classifySource,
  calculateAuthorityTier,
  tokenize,
  calculateRelevance,
  calculateFreshness,
  calculateSourceQuality,
  analyzeSource,
};
