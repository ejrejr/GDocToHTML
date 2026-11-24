/**
 * Pure block-level document converter that transforms normalized Google Docs
 * blocks into clean, style-free semantic HTML and plain-text fallback.
 *
 * Decoupled from live DocumentApp globals so all conversion edge cases can be
 * verified directly with local Node.js unit tests.
 */

function _resolveFormatters() {
  if (typeof formatHtmlRun === 'function') {
    return {
      escapeHtml: escapeHtml,
      formatHtmlRun: formatHtmlRun,
      formatImagePlaceholder: formatImagePlaceholder,
      formatTablePlaceholder: formatTablePlaceholder,
      formatWarnings: formatWarnings,
      normalizeCodeText: normalizeCodeText,
      normalizeSoftBreaks: normalizeSoftBreaks,
    };
  }
  return require('./Formatters.gs');
}

/**
 * Converts an ordered array of normalized document blocks into clean semantic HTML,
 * Medium-tuned HTML (mapping Heading 1 to <h3> Big T and Subtitle/Heading 2+ to <h4> Little T),
 * plain text, word count, and Medium compatibility warnings.
 *
 * @param {Array<Object>} blocks
 * @return {{ html: string, mediumHtml: string, plainText: string, wordCount: number, warnings: string[], warningCounts: { images: number, tables: number, nestedListsFlattened: number } }}
 */
function convertBlocksToHtml(blocks) {
  const fmt = _resolveFormatters();
  const ctx = {
    fmt: fmt,
    htmlParts: [],
    mediumHtmlParts: [],
    plainParts: [],
    openListTag: null,
    inBlockquote: false,
    codeBuffer: [],
    pendingCodeBlankLines: 0,
    warnings: {
      images: 0,
      tables: 0,
      nestedListsFlattened: 0,
    },
  };

  for (let i = 0; i < blocks.length; i++) {
    processNormalizedBlock(blocks[i], ctx);
  }

  flushAllBlocks(ctx);

  const html = ctx.htmlParts.join('\n');
  const mediumHtml = ctx.mediumHtmlParts.join('\n');
  const plainText = ctx.plainParts.join('\n\n').trim();
  const wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;

  return {
    html: html,
    mediumHtml: mediumHtml,
    plainText: plainText,
    wordCount: wordCount,
    warnings: fmt.formatWarnings(ctx.warnings),
    warningCounts: ctx.warnings,
  };
}

function pushSharedHtml(ctx, line) {
  ctx.htmlParts.push(line);
  ctx.mediumHtmlParts.push(line);
}

/**
 * Processes a single normalized block element into the converter context.
 * @param {Object} block
 * @param {Object} ctx
 */
function processNormalizedBlock(block, ctx) {
  if (!block || !block.type) return;

  if (block.type === 'horizontal_rule') {
    flushAllBlocks(ctx);
    pushSharedHtml(ctx, '<hr>');
    ctx.plainParts.push('---');
    return;
  }

  if (block.type === 'table') {
    flushList(ctx);
    flushBlockquote(ctx);

    if (block.isCodeBlock && Array.isArray(block.codeLines)) {
      const normalizedLines = block.codeLines.map(function (line) {
        return ctx.fmt.normalizeCodeText(ctx.fmt.normalizeSoftBreaks(line));
      });
      const joined = normalizedLines.join('\n');
      if (joined.trim()) {
        flushCodeBlock(ctx);
        pushSharedHtml(ctx, '<pre><code>' + ctx.fmt.escapeHtml(joined) + '</code></pre>');
        ctx.plainParts.push(joined);
        return;
      }
    }

    flushCodeBlock(ctx);
    ctx.warnings.tables++;
    const placeholder = ctx.fmt.formatTablePlaceholder(block.rows || 0, block.cols || 0);
    pushSharedHtml(ctx, '<p>' + ctx.fmt.escapeHtml(placeholder) + '</p>');
    ctx.plainParts.push(placeholder);
    return;
  }

  if (block.type === 'list_item') {
    flushBlockquote(ctx);
    flushCodeBlock(ctx);

    const nesting = block.nestingLevel || 0;
    const rendered = renderInlineItems(block.items || [], ctx);
    if (!rendered.plain.trim()) return;

    if (nesting > 0) {
      ctx.warnings.nestedListsFlattened++;
    }

    const listTag = block.ordered ? 'ol' : 'ul';
    if (ctx.openListTag !== listTag) {
      flushList(ctx);
      ctx.openListTag = listTag;
      pushSharedHtml(ctx, '<' + listTag + '>');
    }

    pushSharedHtml(ctx, '  <li>' + rendered.html + '</li>');
    ctx.plainParts.push((block.ordered ? '1. ' : '- ') + rendered.plain);
    return;
  }

  if (block.type === 'paragraph') {
    flushList(ctx);

    const items = block.items || [];
    if (isOnlyHorizontalRuleItems(items)) {
      flushBlockquote(ctx);
      flushCodeBlock(ctx);
      pushSharedHtml(ctx, '<hr>');
      ctx.plainParts.push('---');
      return;
    }

    const rendered = renderInlineItems(items, ctx);
    const indentStart = Number(block.indentStart || 0);
    const headingLevel = Number(block.headingLevel || 0);

    // Handle empty/whitespace-only paragraphs
    if (!rendered.plain.trim()) {
      if (ctx.codeBuffer.length > 0) {
        ctx.pendingCodeBlankLines++;
      }
      if (ctx.inBlockquote && indentStart < 24) {
        flushBlockquote(ctx);
      }
      return;
    }

    // Coalesce consecutive monospace-only body paragraphs into a single code block
    if (!headingLevel && rendered.allMonospace) {
      flushBlockquote(ctx);
      while (ctx.pendingCodeBlankLines > 0) {
        ctx.codeBuffer.push('');
        ctx.pendingCodeBlankLines--;
      }
      ctx.codeBuffer.push(ctx.fmt.normalizeSoftBreaks(rendered.plain));
      return;
    }

    flushCodeBlock(ctx);

    if (headingLevel > 0) {
      flushBlockquote(ctx);
      const clampedLevel = Math.max(1, Math.min(headingLevel, 6));
      const semanticTag = 'h' + clampedLevel;
      const mediumTag = mapMediumHeadingTag(clampedLevel, Boolean(block.isSubtitle));
      ctx.htmlParts.push('<' + semanticTag + '>' + rendered.html + '</' + semanticTag + '>');
      ctx.mediumHtmlParts.push('<' + mediumTag + '>' + rendered.html + '</' + mediumTag + '>');
      ctx.plainParts.push(rendered.plain);
      return;
    }

    // Coalesce consecutive visibly indented body paragraphs (>= 24pt) into one blockquote
    if (indentStart >= 24) {
      if (!ctx.inBlockquote) {
        ctx.inBlockquote = true;
        pushSharedHtml(ctx, '<blockquote>');
      }
      pushSharedHtml(ctx, '  <p>' + rendered.html + '</p>');
      ctx.plainParts.push('> ' + rendered.plain);
      return;
    }

    flushBlockquote(ctx);
    pushSharedHtml(ctx, '<p>' + rendered.html + '</p>');
    ctx.plainParts.push(rendered.plain);
  }
}

/**
 * Renders inline runs, inline images, and inline horizontal rules within a paragraph or list item.
 * @param {Array<Object>} items
 * @param {Object} ctx
 * @return {{ html: string, plain: string, allMonospace: boolean }}
 */
function renderInlineItems(items, ctx) {
  let html = '';
  let plain = '';
  let sawNonEmptyText = false;
  let allMonospace = true;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    if (item.kind === 'image') {
      ctx.warnings.images++;
      const placeholder = ctx.fmt.formatImagePlaceholder(item.altText);
      html += ctx.fmt.escapeHtml(placeholder);
      plain += placeholder;
      allMonospace = false;
      continue;
    }

    if (item.kind === 'horizontal_rule') {
      html += '<hr>';
      plain += '\n---\n';
      allMonospace = false;
      continue;
    }

    if (item.kind === 'text') {
      const raw = item.text || '';
      if (!raw) continue;

      const normalized = ctx.fmt.normalizeSoftBreaks(raw);
      if (normalized.trim().length > 0) {
        sawNonEmptyText = true;
        if (!item.isMono) {
          allMonospace = false;
        }
      }

      plain += normalized;
      html += ctx.fmt.formatHtmlRun(raw, {
        bold: Boolean(item.bold),
        italic: Boolean(item.italic),
        strikethrough: Boolean(item.strikethrough),
        linkUrl: item.linkUrl || null,
        isMono: Boolean(item.isMono),
      });
    }
  }

  return {
    html: html,
    plain: plain,
    allMonospace: sawNonEmptyText && allMonospace,
  };
}

/**
 * Checks whether an inline item list represents only a single horizontal rule
 * (ignoring whitespace-only text runs).
 * @param {Array<Object>} items
 * @return {boolean}
 */
function isOnlyHorizontalRuleItems(items) {
  let hrCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (item.kind === 'horizontal_rule') {
      hrCount++;
    } else if (item.kind === 'text' && !(item.text || '').trim()) {
      continue;
    } else {
      return false;
    }
  }
  return hrCount === 1;
}

function flushList(ctx) {
  if (ctx.openListTag) {
    pushSharedHtml(ctx, '</' + ctx.openListTag + '>');
    ctx.openListTag = null;
  }
}

function flushBlockquote(ctx) {
  if (ctx.inBlockquote) {
    pushSharedHtml(ctx, '</blockquote>');
    ctx.inBlockquote = false;
  }
}

function flushCodeBlock(ctx) {
  ctx.pendingCodeBlankLines = 0;
  if (ctx.codeBuffer.length > 0) {
    const code = ctx.fmt.normalizeCodeText(ctx.codeBuffer.join('\n'));
    pushSharedHtml(ctx, '<pre><code>' + ctx.fmt.escapeHtml(code) + '</code></pre>');
    ctx.plainParts.push(code);
    ctx.codeBuffer = [];
  }
}

function flushAllBlocks(ctx) {
  flushList(ctx);
  flushBlockquote(ctx);
  flushCodeBlock(ctx);
}

/**
 * Maps a semantic heading level to the HTML tag that triggers the right visual
 * heading size on paste into Medium.com's editor:
 * - TITLE (level 1) -> <h1> (Title / Big T)
 * - HEADING1 (level 2, non-subtitle) -> <h3> (Medium Big T, graf--h3)
 * - SUBTITLE & HEADING2-HEADING6 -> <h4> (Medium Little T, graf--h4)
 *
 * @param {number} headingLevel
 * @param {boolean} isSubtitle
 * @return {string}
 */
function mapMediumHeadingTag(headingLevel, isSubtitle) {
  if (headingLevel === 1) return 'h1';
  if (headingLevel === 2 && !isSubtitle) return 'h3';
  return 'h4';
}

/**
 * Maps a Google Docs ParagraphHeading enum (or string name) to semantic HTML heading level.
 * TITLE -> 1 (<h1>), SUBTITLE & HEADING1 -> 2 (<h2>), HEADING2 -> 3 (<h3>),
 * HEADING3 -> 4 (<h4>), HEADING4 -> 5 (<h5>), HEADING5/HEADING6 -> 6 (<h6>).
 *
 * @param {string | Object} heading
 * @param {Object} [headingEnum]
 * @return {number}
 */
function mapHeadingLevel(heading, headingEnum) {
  if (!heading) return 0;

  if (headingEnum) {
    switch (heading) {
      case headingEnum.TITLE:
        return 1;
      case headingEnum.SUBTITLE:
      case headingEnum.HEADING1:
        return 2;
      case headingEnum.HEADING2:
        return 3;
      case headingEnum.HEADING3:
        return 4;
      case headingEnum.HEADING4:
        return 5;
      case headingEnum.HEADING5:
      case headingEnum.HEADING6:
        return 6;
      default:
        return 0;
    }
  }

  const key = String(heading).toUpperCase();
  switch (key) {
    case 'TITLE':
      return 1;
    case 'SUBTITLE':
    case 'HEADING1':
      return 2;
    case 'HEADING2':
      return 3;
    case 'HEADING3':
      return 4;
    case 'HEADING4':
      return 5;
    case 'HEADING5':
    case 'HEADING6':
      return 6;
    default:
      return 0;
  }
}

/**
 * Detects whether a Google Docs list GlyphType represents an ordered list.
 * @param {string | Object} glyph
 * @param {Object} [glyphEnum]
 * @return {boolean}
 */
function isOrderedGlyph(glyph, glyphEnum) {
  if (!glyph) return false;

  if (glyphEnum) {
    return (
      glyph === glyphEnum.NUMBER ||
      glyph === glyphEnum.LATIN_LOWER ||
      glyph === glyphEnum.LATIN_UPPER ||
      glyph === glyphEnum.ROMAN_LOWER ||
      glyph === glyphEnum.ROMAN_UPPER
    );
  }

  const key = String(glyph).toUpperCase();
  return (
    key === 'NUMBER' ||
    key === 'LATIN_LOWER' ||
    key === 'LATIN_UPPER' ||
    key === 'ROMAN_LOWER' ||
    key === 'ROMAN_UPPER'
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    convertBlocksToHtml: convertBlocksToHtml,
    mapHeadingLevel: mapHeadingLevel,
    mapMediumHeadingTag: mapMediumHeadingTag,
    isOrderedGlyph: isOrderedGlyph,
  };
}
