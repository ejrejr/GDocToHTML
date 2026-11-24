/**
 * Pure HTML formatting, escaping, sanitization, and warning helpers.
 * Loaded into the shared Apps Script V8 global scope, and conditionally
 * exported for local Node.js unit testing.
 */

const MONOSPACE_FONT_REGEX =
  /mono|courier|consolas|inconsolata|fira code|source code|jetbrains|menlo|monaco|cascadia/i;

const SAFE_URL_REGEX = /^(https?:\/\/|mailto:|#|\/)/i;

/**
 * Escapes HTML text content characters.
 * @param {string} str
 * @return {string}
 */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes HTML attribute values.
 * @param {string} str
 * @return {string}
 */
function escapeAttr(str) {
  return escapeHtml(str)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates and trims a link URL, blocking unsafe protocols (e.g. javascript:).
 * @param {string | null | undefined} url
 * @return {string | null}
 */
function sanitizeUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!SAFE_URL_REGEX.test(trimmed)) return null;
  return trimmed;
}

/**
 * Normalizes Google Docs soft line breaks (\v) and CR/CRLF into \n.
 * @param {string} str
 * @return {string}
 */
function normalizeSoftBreaks(str) {
  return String(str == null ? '' : str)
    .replace(/\r\n/g, '\n')
    .replace(/[\r\u000b]/g, '\n');
}

/**
 * Escapes HTML and converts soft line breaks into <br> elements.
 * @param {string} str
 * @return {string}
 */
function formatTextWithBreaks(str) {
  return escapeHtml(normalizeSoftBreaks(str)).replace(/\n/g, '<br>');
}

/**
 * Detects whether a Google Docs font family name represents a monospace font.
 * @param {string | null | undefined} fontFamily
 * @return {boolean}
 */
function isMonospaceFont(fontFamily) {
  return Boolean(fontFamily && MONOSPACE_FONT_REGEX.test(fontFamily));
}

/**
 * Normalizes Google Docs typographic auto-substitutions inside code so pasted
 * snippets remain syntactically valid (curly quotes, em/en dashes, ellipsis, NBSP).
 * @param {string} str
 * @return {string}
 */
function normalizeCodeText(str) {
  return String(str == null ? '' : str)
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2014/g, '--')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ');
}

/**
 * Formats a single inline text run into clean, style-free semantic HTML.
 * @param {string} raw
 * @param {{ bold?: boolean, italic?: boolean, strikethrough?: boolean, linkUrl?: string | null, isMono?: boolean }} attrs
 * @return {string}
 */
function formatHtmlRun(raw, attrs) {
  const normalized = normalizeSoftBreaks(raw);
  if (!normalized) return '';

  // Preserve whitespace and standalone soft line breaks without wrapping empty tags around them.
  if (!normalized.trim()) {
    return formatTextWithBreaks(normalized);
  }

  const isMono = Boolean(attrs && attrs.isMono);
  const textToFormat = isMono ? normalizeCodeText(normalized) : normalized;
  let out = formatTextWithBreaks(textToFormat);

  if (isMono) {
    out = '<code>' + out + '</code>';
  } else if (attrs) {
    if (attrs.italic) out = '<em>' + out + '</em>';
    if (attrs.bold) out = '<strong>' + out + '</strong>';
  }

  if (attrs && attrs.strikethrough) {
    out = '<s>' + out + '</s>';
  }

  if (attrs && attrs.linkUrl) {
    const safeUrl = sanitizeUrl(attrs.linkUrl);
    if (safeUrl) {
      out = '<a href="' + escapeAttr(safeUrl) + '">' + out + '</a>';
    }
  }

  return out;
}

/**
 * Builds an inline placeholder string for an omitted inline image.
 * @param {string | null | undefined} altText
 * @return {string}
 */
function formatImagePlaceholder(altText) {
  const cleanAlt = String(altText == null ? '' : altText).replace(/\s+/g, ' ').trim();
  return cleanAlt ? '[IMAGE: ' + cleanAlt + ']' : '[IMAGE]';
}

/**
 * Builds a placeholder string for an omitted non-code table.
 * @param {number} rows
 * @param {number} cols
 * @return {string}
 */
function formatTablePlaceholder(rows, cols) {
  if (rows > 0 && cols > 0) {
    return '[TABLE: ' + rows + '\u00d7' + cols + ']';
  }
  return '[TABLE]';
}

/**
 * Formats Medium compatibility warnings for display in the sidebar.
 * @param {{ images: number, tables: number, nestedListsFlattened: number }} warnings
 * @return {string[]}
 */
function formatWarnings(warnings) {
  const out = [];
  if (warnings.images > 0) {
    out.push(
      warnings.images +
        ' inline image(s) replaced with [IMAGE] placeholder \u2014 upload them directly in Medium.'
    );
  }
  if (warnings.tables > 0) {
    out.push(
      warnings.tables +
        ' table(s) replaced with [TABLE] placeholder \u2014 Medium strips HTML tables (use a GitHub Gist or screenshot).'
    );
  }
  if (warnings.nestedListsFlattened > 0) {
    out.push(
      warnings.nestedListsFlattened +
        ' nested list item(s) detected \u2014 Medium flattens lists to one level.'
    );
  }
  return out;
}

/**
 * Converts a tab or document title into a safe lowercase filename slug.
 * @param {string | null | undefined} name
 * @return {string}
 */
function slugifyFilename(name) {
  return (
    String(name == null ? '' : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'article'
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MONOSPACE_FONT_REGEX,
    escapeHtml,
    escapeAttr,
    sanitizeUrl,
    normalizeSoftBreaks,
    normalizeCodeText,
    formatTextWithBreaks,
    isMonospaceFont,
    formatHtmlRun,
    formatImagePlaceholder,
    formatTablePlaceholder,
    formatWarnings,
    slugifyFilename,
  };
}
