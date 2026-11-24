/**
 * @OnlyCurrentDoc
 * Google Docs to Clean HTML Exporter (Medium & GitHub)
 * Container-bound Apps Script supporting Document Tabs and partial selections.
 */

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Medium Exporter')
    .addItem('Open Exporter Sidebar', 'showExporterSidebar')
    .addToUi();
}

function showExporterSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Medium Exporter')
    .setWidth(360);
  DocumentApp.getUi().showSidebar(html);
}

/**
 * Extracts either the active highlighted selection or the active document tab
 * and converts it into clean, style-free semantic HTML.
 *
 * @param {'selection' | 'document'} scope
 */
function extractContent(scope) {
  const doc = DocumentApp.getActiveDocument();
  const activeTab = typeof doc.getActiveTab === 'function' ? doc.getActiveTab() : null;
  const tabTitle = activeTab ? activeTab.getTitle() : doc.getName();
  const body = activeTab ? activeTab.asDocumentTab().getBody() : doc.getBody();

  let blocks = [];

  if (scope === 'selection') {
    const selection = doc.getSelection();
    if (!selection) {
      return {
        error: 'No text is currently highlighted. Highlight content or use "Extract Active Tab".',
      };
    }
    blocks = extractBlocksFromSelection(selection.getRangeElements());
  } else {
    const count = body.getNumChildren();
    for (let i = 0; i < count; i++) {
      const block = extractBlockFromElement(body.getChild(i), null);
      if (block) blocks.push(block);
    }
  }

  const result = convertBlocksToHtml(blocks);

  return {
    title: doc.getName(),
    tabTitle: tabTitle,
    scope: scope,
    html: result.html,
    mediumHtml: result.mediumHtml,
    plainText: result.plainText,
    wordCount: result.wordCount,
    warnings: result.warnings,
    suggestedFilename: slugifyFilename(tabTitle || doc.getName()) + '.html',
  };
}

/**
 * Groups RangeElements so partial highlights within the same paragraph or list
 * item remain intact before conversion.
 *
 * @param {GoogleAppsScript.Document.RangeElement[]} rangeElements
 * @return {Array<Object>}
 */
function extractBlocksFromSelection(rangeElements) {
  const grouped = [];
  let currentGroup = null;

  for (let i = 0; i < rangeElements.length; i++) {
    const re = rangeElements[i];
    const el = re.getElement();
    const type = el.getType();

    if (type === DocumentApp.ElementType.TEXT) {
      const parent = el.getParent();
      const slice = re.isPartial()
        ? { textEl: el.asText(), start: re.getStartOffset(), end: re.getEndOffsetInclusive() }
        : { textEl: el.asText(), start: null, end: null };

      if (currentGroup && isSameDocElement(currentGroup.block, parent)) {
        currentGroup.slices.push(slice);
      } else {
        currentGroup = { block: parent, slices: [slice] };
        grouped.push(currentGroup);
      }
    } else if (type === DocumentApp.ElementType.INLINE_IMAGE) {
      const parent = el.getParent();
      const imageSlice = { imageEl: el.asInlineImage() };

      if (currentGroup && isSameDocElement(currentGroup.block, parent)) {
        currentGroup.slices.push(imageSlice);
      } else {
        currentGroup = { block: parent, slices: [imageSlice] };
        grouped.push(currentGroup);
      }
    } else {
      currentGroup = null;
      grouped.push({ block: el, slices: null });
    }
  }

  const blocks = [];
  for (let i = 0; i < grouped.length; i++) {
    const block = extractBlockFromElement(grouped[i].block, grouped[i].slices);
    if (block) blocks.push(block);
  }
  return blocks;
}

/**
 * Compares two DocumentApp elements across wrapper instances using structural parent indices.
 * @param {GoogleAppsScript.Document.Element} a
 * @param {GoogleAppsScript.Document.Element} b
 * @return {boolean}
 */
function isSameDocElement(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.getType() !== b.getType()) return false;

  const parentA = a.getParent();
  const parentB = b.getParent();
  if (!parentA || !parentB) return false;
  if (parentA.getType() !== parentB.getType()) return false;

  try {
    return parentA.getChildIndex(a) === parentB.getChildIndex(b);
  } catch (e) {
    return false;
  }
}

/**
 * Converts a single DocumentApp block element into a normalized block object
 * suitable for convertBlocksToHtml().
 *
 * @param {GoogleAppsScript.Document.Element} el
 * @param {Array<Object> | null} slices
 * @return {Object | null}
 */
function extractBlockFromElement(el, slices) {
  const type = el.getType();
  const E = DocumentApp.ElementType;

  if (type === E.HORIZONTAL_RULE) {
    return { type: 'horizontal_rule' };
  }

  if (type === E.TABLE) {
    return extractTableBlock(el.asTable());
  }

  if (type === E.LIST_ITEM) {
    const listItem = el.asListItem();
    const containerFont = getInheritedFontFamily(listItem);
    return {
      type: 'list_item',
      ordered: isOrderedGlyph(listItem.getGlyphType(), DocumentApp.GlyphType),
      nestingLevel: listItem.getNestingLevel(),
      items: extractInlineItems(listItem, slices, containerFont),
    };
  }

  if (type === E.PARAGRAPH) {
    const para = el.asParagraph();
    const containerFont = getInheritedFontFamily(para);
    const heading = para.getHeading();
    return {
      type: 'paragraph',
      headingLevel: mapHeadingLevel(heading, DocumentApp.ParagraphHeading),
      isSubtitle: heading === DocumentApp.ParagraphHeading.SUBTITLE,
      indentStart: Number(para.getIndentStart() || 0),
      items: extractInlineItems(para, slices, containerFont),
    };
  }

  return null;
}

/**
 * Extracts a TABLE element, detecting Google Docs' 1x1 monospace Code Block
 * building blocks so they convert to <pre><code> instead of a table placeholder.
 *
 * @param {GoogleAppsScript.Document.Table} table
 * @return {Object}
 */
function extractTableBlock(table) {
  const numRows = table.getNumRows();
  let numCols = 0;
  for (let r = 0; r < numRows; r++) {
    const rowCols = table.getRow(r).getNumCells();
    if (rowCols > numCols) numCols = rowCols;
  }

  if (numRows === 1 && numCols === 1) {
    const cell = table.getRow(0).getCell(0);
    const cellFont = getInheritedFontFamily(cell);
    const codeLines = tryExtractCodeBlockLines(cell, cellFont);
    if (codeLines !== null) {
      return {
        type: 'table',
        rows: 1,
        cols: 1,
        isCodeBlock: true,
        codeLines: codeLines,
      };
    }
  }

  return {
    type: 'table',
    rows: numRows,
    cols: numCols,
    isCodeBlock: false,
  };
}

/**
 * Attempts to read a 1x1 TableCell as a monospace code block.
 * Returns an array of code lines if all non-empty text runs are monospace, or null otherwise.
 *
 * @param {GoogleAppsScript.Document.TableCell} cell
 * @param {string} cellFont
 * @return {string[] | null}
 */
function tryExtractCodeBlockLines(cell, cellFont) {
  const childCount = cell.getNumChildren();
  const lines = [];
  let sawNonEmpty = false;

  for (let i = 0; i < childCount; i++) {
    const child = cell.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) {
      return null;
    }

    const para = child.asParagraph();
    const fallbackFont = getInheritedFontFamily(para) || cellFont;
    const inlineItems = extractInlineItems(para, null, fallbackFont);
    let lineText = '';

    for (let j = 0; j < inlineItems.length; j++) {
      const item = inlineItems[j];
      if (item.kind !== 'text') return null;
      if (item.text.trim().length > 0) {
        sawNonEmpty = true;
        if (!item.isMono) return null;
      }
      lineText += item.text;
    }

    lines.push(lineText);
  }

  return sawNonEmpty ? lines : null;
}

/**
 * Extracts normalized inline items (text runs, images, horizontal rules) from a
 * Paragraph or ListItem container (or from explicit partial selection slices).
 *
 * @param {GoogleAppsScript.Document.ContainerElement} container
 * @param {Array<Object> | null} slices
 * @param {string} containerFont
 * @return {Array<Object>}
 */
function extractInlineItems(container, slices, containerFont) {
  const items = [];
  const E = DocumentApp.ElementType;

  if (slices) {
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      if (slice.imageEl) {
        items.push({ kind: 'image', altText: getImageAltText(slice.imageEl) });
      } else if (slice.textEl) {
        appendTextRuns(slice.textEl, slice.start, slice.end, containerFont, items);
      }
    }
    return items;
  }

  const childCount = container.getNumChildren();
  for (let i = 0; i < childCount; i++) {
    const child = container.getChild(i);
    const cType = child.getType();
    if (cType === E.TEXT) {
      appendTextRuns(child.asText(), null, null, containerFont, items);
    } else if (cType === E.INLINE_IMAGE) {
      items.push({ kind: 'image', altText: getImageAltText(child.asInlineImage()) });
    } else if (cType === E.HORIZONTAL_RULE) {
      items.push({ kind: 'horizontal_rule' });
    }
  }

  return items;
}

/**
 * Splits a Google Docs Text element along attribute boundaries into normalized inline text runs.
 *
 * @param {GoogleAppsScript.Document.Text} textEl
 * @param {number | null} start
 * @param {number | null} end
 * @param {string} fallbackFont
 * @param {Array<Object>} outItems
 */
function appendTextRuns(textEl, start, end, fallbackFont, outItems) {
  const fullText = textEl.getText();
  if (!fullText) return;

  const rangeStart = start !== null ? start : 0;
  const rangeEnd = end !== null ? Math.min(end, fullText.length - 1) : fullText.length - 1;
  if (rangeStart > rangeEnd) return;

  const indices = textEl.getTextAttributeIndices();
  const cuts = [rangeStart];
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] > rangeStart && indices[i] <= rangeEnd) {
      cuts.push(indices[i]);
    }
  }
  cuts.push(rangeEnd + 1);

  for (let i = 0; i < cuts.length - 1; i++) {
    const segStart = cuts[i];
    const segEnd = cuts[i + 1];
    const raw = fullText.slice(segStart, segEnd);
    if (!raw) continue;

    const font = textEl.getFontFamily(segStart) || fallbackFont || '';
    outItems.push({
      kind: 'text',
      text: raw,
      bold: Boolean(textEl.isBold(segStart)),
      italic: Boolean(textEl.isItalic(segStart)),
      strikethrough: Boolean(textEl.isStrikethrough(segStart)),
      linkUrl: textEl.getLinkUrl(segStart),
      isMono: isMonospaceFont(font),
    });
  }
}

/**
 * Safely reads an inherited FONT_FAMILY attribute from a container element.
 * @param {GoogleAppsScript.Document.Element} el
 * @return {string}
 */
function getInheritedFontFamily(el) {
  if (!el || typeof el.getAttributes !== 'function') return '';
  const attrs = el.getAttributes();
  return (attrs && attrs[DocumentApp.Attribute.FONT_FAMILY]) || '';
}

/**
 * Reads optional alt text from an InlineImage element.
 * @param {GoogleAppsScript.Document.InlineImage} img
 * @return {string}
 */
function getImageAltText(img) {
  if (!img) return '';
  const title = typeof img.getAltTitle === 'function' ? img.getAltTitle() : '';
  const desc = typeof img.getAltDescription === 'function' ? img.getAltDescription() : '';
  return title || desc || '';
}
