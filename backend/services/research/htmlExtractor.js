/**
 * HTML Extraction Utility
 * 
 * Extracts human-readable text and page titles from raw HTML documents.
 * Removes non-content elements (scripts, styles, nav, footer, SVG)
 * and normalizes whitespace for downstream research processing.
 */

/**
 * Decodes HTML entities into plaintext characters.
 * 
 * @param {string} str
 * @returns {string}
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCharCode(parseInt(code, 10));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return '';
      }
    });
}

/**
 * Extracts readable title and plaintext from an HTML string.
 * 
 * @param {string} html
 * @param {object} [options={}]
 * @param {number} [options.maxTextLength=25000] - Truncation limit for raw text
 * @returns {{ title: string, text: string }}
 */
function extractReadableContent(html, options = {}) {
  if (!html || typeof html !== 'string') {
    return { title: '', text: '' };
  }

  const maxTextLength = options.maxTextLength || 25000;

  // 1. Extract Page Title
  let title = '';
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch) {
    title = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim());
  }

  // 2. Strip noise elements: script, style, noscript, svg, nav, header, footer
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ');

  // 3. Convert block endings and line breaks to newlines
  clean = clean.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, '\n');
  clean = clean.replace(/<br\s*[\/]?>/gi, '\n');

  // 4. Strip all remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, ' ');

  // 5. Decode HTML entities
  clean = decodeHtmlEntities(clean);

  // 6. Split into lines, normalize whitespace, and filter empty/sparse noise
  const rawLines = clean.split('\n');
  const validParagraphs = [];

  for (const line of rawLines) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    // Keep lines that have meaningful readable substance (> 15 chars)
    if (trimmed.length > 15) {
      validParagraphs.push(trimmed);
    }
  }

  const fullText = validParagraphs.join('\n\n');
  const truncated = fullText.length > maxTextLength ? fullText.slice(0, maxTextLength) : fullText;

  return {
    title,
    text: truncated,
  };
}

module.exports = {
  extractReadableContent,
  decodeHtmlEntities,
};
