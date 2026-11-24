# Technical Specification: Google Docs to Medium & Markdown Exporter

**Version:** 1.0 (Initial Specification)  
**Target Platform:** Google Apps Script (V8 Runtime, Container-Bound to Google Docs)  
**Revision Control & Local Workflow:** Git / GitHub + `@google/clasp`  
**Intended Agent / IDE Workflow:** Google Antigravity

---

## 1. Project Goal & Problem Statement

### The Problem
Writing long-form articles in Google Docs provides strong real-time grammar checking, spell checking, and cloud drafting, but pasting directly from Google Docs into Medium.com produces severely degraded output. Google Docs places bloated, proprietary inline styles (nested `span` elements, font overrides, and margin rules) onto the clipboard, which Medium's editor mishandles or strips inconsistently. Meanwhile, publishing a parallel copy of an article to a static `github.io` site requires clean Markdown (`.md`).

### The Goal
Build a private, zero-cost, revision-controlled **Google Docs sidebar tool** that:
1. Extracts either the **currently highlighted text** (including partial paragraph selections) or the **entire active Google Docs tab**.
2. Converts Google Docs' native document model into **strictly style-free, semantic HTML** tuned for Medium's editor and places it onto the system clipboard as rendered Rich Text (`text/html` + `text/plain`), enabling high-fidelity `Ctrl+V` pasting directly into Medium.
3. Simultaneously generates **clean, standards-compliant Markdown** (`.md`) that can be copied to the clipboard or downloaded as a slug-named file for publishing to a `github.io` repository.
4. Flags Medium-incompatible elements (inline images, native tables, nested lists) so the author knows exactly what requires manual follow-up in Medium.
5. Keeps 100% of the source code, tests, and configuration under **Git revision control on GitHub**, deploying to Google Apps Script via Google's official CLI (`@google/clasp`).

### Non-Goals for v1.0
* Automated image hosting or uploading local/Drive images to Medium or GitHub.
* Public Google Workspace Marketplace publishing or multi-tenant OAuth verification.
* Direct commits to a separate `github.io` repository via the GitHub REST API (deferred to v1.1+).
* Using Medium's deprecated public API (Medium permanently stopped issuing new API integration tokens).

---

## 2. Chosen Mechanism & Architectural Rationale

### Why Container-Bound Google Apps Script + HTML Sidebar?
* **Docs Canvas Constraint:** Google Docs renders document content on an HTML5 `<canvas>` rather than standard semantic DOM nodes. A Chrome browser extension cannot reliably read heading hierarchies, hyperlinks, font families, or partial selections from the DOM.
* **Authoritative Document Model:** Google Apps Script's `DocumentApp` service reads the exact server-side document tree (`Paragraph`, `ListItem`, `Text` attribute runs, `RangeElement` partial offsets, and `DocumentTab`).
* **Zero Third-Party Trust Risk:** Unlike third-party Marketplace add-ons that request broad Google Drive permissions or route drafts to external servers, a self-owned Apps Script runs exclusively inside the author's Google account under least-privilege scopes (`@OnlyCurrentDoc`).

### Revision Control Architecture (`Git` + `GitHub` + `clasp`)
* **Single Source of Truth:** All source code lives in GitHub under `src/`. Developers and Antigravity edit locally, run automated unit tests, commit to Git, and push to Google Apps Script using `@google/clasp` (`clasp push`). Direct edits inside the browser-based Apps Script IDE should be avoided once initialized.
* **Secret Hygiene:** `.clasp.json` (contains the bound project's `scriptId`) and `~/.clasprc.json` (contains personal OAuth refresh tokens) **must never be committed** to GitHub. A sanitized `.clasp.json.example` template will be committed instead.

### Personal Account Reusability Strategy
Because personal Google accounts cannot privately publish global Workspace Marketplace add-ons, the tool is designed for two friction-free container-bound patterns:
1. **Primary Pattern — Master "Medium Drafts" Doc with Document Tabs:** Uses `doc.getActiveTab().asDocumentTab().getBody()` so a single Google Doc hosts the bound script while each article lives in its own tab.
2. **Secondary Pattern — Template Document:** Attach the script to a blank template Doc and use **File → Make a copy** for each article (Drive copies the bound script automatically).

### Sandboxed Iframe Clipboard Architecture
Apps Script sidebars execute inside a cross-origin sandboxed iframe where `navigator.clipboard.write()` can fail if invoked asynchronously after a `google.script.run` round-trip (due to expired user activation or iframe `Permissions-Policy` restrictions). To guarantee reliable Rich Text clipboard writes without leaking sidebar CSS into Medium:
1. **Two-Step User Interaction:** Step 1 extracts and caches clean `html`, `markdown`, and `plainText` payloads from Apps Script. Step 2 writes the cached payload to the clipboard synchronously on a direct user click.
2. **Dual-Path Clipboard Writer:** First attempts the modern `ClipboardItem` API (`text/html` + `text/plain` blobs). If blocked by the iframe sandbox, immediately falls back to a synchronous `document.execCommand('copy')` intercepted by a scoped `copy` event listener that injects the raw, style-free HTML string directly into `e.clipboardData`.

---

## 3. Functional Requirements & Mapping Rules

### 3.1 Extraction Scopes
* **Extract Selection (`selection`):** Supports multi-block selections as well as partial start/end offsets inside a single paragraph or list item via `RangeElement.isPartial()`. Consecutive partial text runs belonging to the same parent block must be grouped before rendering.
* **Extract Active Tab (`document`):** Reads `doc.getActiveTab().asDocumentTab().getBody()` when available, gracefully falling back to `doc.getBody()` if the tabs API is unavailable.

### 3.2 Google Docs → Clean HTML (Medium) & Markdown Mapping

| Google Docs Construct | Clean HTML Output (for Medium) | Markdown Output (for `github.io`) | Notes |
| :--- | :--- | :--- | :--- |
| `TITLE` / `HEADING1` | `<h1>...</h1>` | `# ...` | Maps to Medium Title / Primary Header |
| `SUBTITLE` / `HEADING2` | `<h2>...</h2>` | `## ...` | Maps to Medium Subtitle / Subheader |
| `HEADING3` | `<h3>...</h3>` | `### ...` | Maps to Medium Subheader |
| `HEADING4` – `HEADING6` | `<h3>...</h3>` (capped at H3) | `####` – `######` | Medium caps headings at H3; preserve full depth in Markdown |
| Normal `PARAGRAPH` | `<p>...</p>` | Plain paragraph | Skip empty/whitespace-only paragraphs |
| Indented `PARAGRAPH` (`indentStart >= 24pt`) | `<blockquote><p>...</p></blockquote>` | `> ...` | Workaround because Google Docs lacks a native blockquote style |
| Bold / Italic / Bold+Italic | `<strong>`, `<em>` | `**...**`, `*...*`, `***...***` | Leading/trailing whitespace must remain outside Markdown emphasis delimiters |
| Hyperlink | `<a href="...">...</a>` | `[text](url)` | Escape attribute quotes (`"`) and HTML entities (`&`, `<`, `>`) |
| Monospace inline run | `<code>...</code>` | `` `...` `` (or ` ``...`` ` if containing backticks) | Detect via regex: `/mono\|courier\|consolas\|inconsolata\|fira code\|source code\|jetbrains\|menlo\|monaco/i` |
| Consecutive monospace-only paragraphs | Coalesced `<pre><code>...</code></pre>` | Fenced ```` ```\n...\n``` ```` | Do not apply code-block coalescing to heading styles |
| Bulleted `LIST_ITEM` | `<ul><li>...</li></ul>` | `- ...` (indented by nesting level) | Medium flattens nested lists; log warning if `nestingLevel > 0` |
| Numbered/Ordered `LIST_ITEM` | `<ol><li>...</li></ol>` | `1. ...` (indented by nesting level) | Detect `NUMBER`, `LATIN_LOWER`, `LATIN_UPPER`, `ROMAN_LOWER`, `ROMAN_UPPER` |
| `HORIZONTAL_RULE` | `<hr>` | `---` | Handle both standalone block and single-child paragraph container |
| `INLINE_IMAGE` | Omitted + Warning | Omitted + Warning | Clipboard cannot upload private Google Doc image blobs to Medium |
| `TABLE` | Omitted + Warning | Omitted + Warning | Medium strips HTML tables on paste |

### 3.3 Sidebar UI Requirements
* Action buttons for **Extract Selection** and **Extract Active Tab**.
* Export controls (disabled until extraction succeeds):
  * **Copy Clean HTML (Medium)** (primary action)
  * **Copy Markdown**
  * **Download `.md`** (filename slugified from active tab title or document name)
* Live status banner (`ok`, `warn`, `err`), Medium compatibility warning panel, scope + word count metadata line, and scrollable rendered HTML preview.

### 3.4 Security & OAuth Scope Requirements
* Include `/** @OnlyCurrentDoc */` JSDoc annotation in Apps Script files.
* Explicitly lock `oauthScopes` in `src/appsscript.json` to:
  * `https://www.googleapis.com/auth/documents.currentonly`
  * `https://www.googleapis.com/auth/script.container.ui`

---

## 4. Proposed Repository Structure

Antigravity should evaluate this structure and produce the initial repository layout accordingly. Note that Google Apps Script executes all `.gs` files in a shared global scope without native ES module `import`/`export` statements. Pure formatting/escaping helpers can be isolated in `src/Formatters.gs` with a safe `if (typeof module !== 'undefined')` guard so they can be unit-tested directly in Node (`node --test`) without requiring a build/bundler step.

```text
gdocs-medium-exporter/
├── src/
│   ├── appsscript.json      # Apps Script manifest (V8 runtime + explicit least-privilege scopes)
│   ├── Code.gs              # Menu hooks, sidebar launcher, DocumentApp traversal
│   ├── Formatters.gs        # Pure formatting, escaping, slugify, and warning helpers (unit-testable)
│   └── Sidebar.html         # Sidebar UI, preview renderer, and dual-path clipboard logic
├── test/
│   └── formatters.test.mjs  # Local Node unit tests for pure formatting & edge cases
├── .clasp.json.example      # Safe template showing rootDir: "src" and placeholder scriptId
├── .claspignore             # Restricts clasp push to src/ artifacts only
├── .gitignore               # Ignores .clasp.json, .clasprc.json, node_modules, OS artifacts
├── package.json             # Scripts: test, lint (optional), push, pull, open
├── README.md                # End-user setup, clasp auth, and Google Docs usage conventions
└── SPECIFICATION.md         # This specification document
```

---

## 5. Initial Suggested Reference Implementation

Antigravity should use the following reference files as the baseline for v1.0. Antigravity is encouraged to refactor the pure helper functions (`formatHtmlRun`, `formatMarkdownRun`, `formatWarnings`, `escapeHtml`, `escapeAttr`, `slugifyFilename`) into `src/Formatters.gs` if splitting improves testability, while ensuring full compatibility with Apps Script's V8 global execution model.

### 5.1 `src/appsscript.json`

```json
{
  "timeZone": "America/Los_Angeles",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/documents.currentonly",
    "https://www.googleapis.com/auth/script.container.ui"
  ]
}
```

### 5.2 `src/Code.gs` (Baseline Reference)

```javascript
/**
 * @OnlyCurrentDoc
 * Medium & Markdown Exporter for Google Docs
 * Container-bound Apps Script (supports Document Tabs + partial selections).
 */

const MONOSPACE_REGEX = /mono|courier|consolas|inconsolata|fira code|source code|jetbrains|menlo|monaco/i;

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Medium Exporter')
    .addItem('Open Exporter Sidebar', 'showExporterSidebar')
    .addToUi();
}

function showExporterSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Medium Exporter')
    .setWidth(340);
  DocumentApp.getUi().showSidebar(html);
}

/**
 * Extracts either the active highlighted selection or the active document tab.
 * @param {'selection' | 'document'} scope
 */
function extractContent(scope) {
  const doc = DocumentApp.getActiveDocument();
  const activeTab = typeof doc.getActiveTab === 'function' ? doc.getActiveTab() : null;
  const tabTitle = activeTab ? activeTab.getTitle() : doc.getName();
  const body = activeTab ? activeTab.asDocumentTab().getBody() : doc.getBody();

  const ctx = {
    htmlParts: [],
    mdParts: [],
    plainParts: [],
    openListTag: null,
    lastMdKind: null,
    codeBuffer: [],
    warnings: { images: 0, tables: 0, nestedListsFlattened: 0 },
  };

  if (scope === 'selection') {
    const selection = doc.getSelection();
    if (!selection) {
      return { error: 'No text is currently highlighted. Highlight content or use "Extract Active Tab".' };
    }
    processSelection(selection.getRangeElements(), ctx);
  } else {
    const count = body.getNumChildren();
    for (let i = 0; i < count; i++) {
      processBlockElement(body.getChild(i), null, ctx);
    }
  }

  flushPendingBlocks(ctx);

  const html = ctx.htmlParts.join('\n');
  const markdown = ctx.mdParts.join('\n\n').trim() + '\n';
  const plainText = ctx.plainParts.join('\n\n').trim();
  const wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;

  return {
    title: doc.getName(),
    tabTitle: tabTitle,
    scope: scope,
    html: html,
    markdown: markdown,
    plainText: plainText,
    wordCount: wordCount,
    warnings: formatWarnings(ctx.warnings),
  };
}

/**
 * Groups RangeElements so partial highlights within the same paragraph stay intact.
 */
function processSelection(rangeElements, ctx) {
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

      if (currentGroup && currentGroup.block === parent) {
        currentGroup.slices.push(slice);
      } else {
        currentGroup = { block: parent, slices: [slice] };
        grouped.push(currentGroup);
      }
    } else {
      currentGroup = null;
      grouped.push({ block: el, slices: null });
    }
  }

  for (let i = 0; i < grouped.length; i++) {
    processBlockElement(grouped[i].block, grouped[i].slices, ctx);
  }
}

function processBlockElement(el, textSlices, ctx) {
  const type = el.getType();

  if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
    flushPendingBlocks(ctx);
    ctx.htmlParts.push('<hr>');
    ctx.mdParts.push('---');
    ctx.lastMdKind = 'hr';
    ctx.plainParts.push('---');
    return;
  }

  if (type === DocumentApp.ElementType.TABLE) {
    flushPendingBlocks(ctx);
    ctx.warnings.tables++;
    return;
  }

  if (type === DocumentApp.ElementType.LIST_ITEM) {
    flushCodeBlock(ctx);
    const listItem = el.asListItem();
    const nesting = listItem.getNestingLevel();
    if (nesting > 0) ctx.warnings.nestedListsFlattened++;

    const rendered = renderContainer(listItem, textSlices, ctx);
    if (!rendered.plain.trim()) return;

    const listTag = isOrderedGlyph(listItem.getGlyphType()) ? 'ol' : 'ul';
    if (ctx.openListTag !== listTag) {
      flushList(ctx);
      ctx.openListTag = listTag;
      ctx.htmlParts.push('<' + listTag + '>');
    }

    ctx.htmlParts.push('  <li>' + rendered.html + '</li>');
    const mdIndent = '  '.repeat(nesting);
    const mdPrefix = listTag === 'ol' ? '1. ' : '- ';
    appendToLastMarkdownBlock(ctx, mdIndent + mdPrefix + rendered.md, 'list');
    ctx.plainParts.push((listTag === 'ol' ? '1. ' : '- ') + rendered.plain);
    return;
  }

  if (type === DocumentApp.ElementType.PARAGRAPH) {
    flushList(ctx);
    const para = el.asParagraph();

    // Standalone horizontal rules live inside a paragraph container in Docs
    if (!textSlices && containsOnlyHorizontalRule(para)) {
      flushCodeBlock(ctx);
      ctx.htmlParts.push('<hr>');
      ctx.mdParts.push('---');
      ctx.lastMdKind = 'hr';
      ctx.plainParts.push('---');
      return;
    }

    const rendered = renderContainer(para, textSlices, ctx);
    if (!rendered.plain.trim()) {
      flushCodeBlock(ctx);
      return;
    }

    const heading = para.getHeading();
    const headingLevel = mapHeadingLevel(heading);

    // Coalesce consecutive monospace-only body paragraphs into a single code block
    if (!headingLevel && rendered.allMonospace) {
      ctx.codeBuffer.push(rendered.plain);
      return;
    }

    flushCodeBlock(ctx);

    if (headingLevel) {
      // Medium supports H1-H3; cap HTML at H3 while keeping semantic depth in Markdown
      const mediumTag = 'h' + Math.min(headingLevel, 3);
      ctx.htmlParts.push('<' + mediumTag + '>' + rendered.html + '</' + mediumTag + '>');
      ctx.mdParts.push('#'.repeat(headingLevel) + ' ' + rendered.md);
      ctx.lastMdKind = 'heading';
      ctx.plainParts.push(rendered.plain);
      return;
    }

    // Treat visibly indented body paragraphs (>= 24pt) as blockquotes
    const indentStart = para.getIndentStart() || 0;
    if (indentStart >= 24) {
      ctx.htmlParts.push('<blockquote><p>' + rendered.html + '</p></blockquote>');
      ctx.mdParts.push('> ' + rendered.md);
      ctx.lastMdKind = 'blockquote';
      ctx.plainParts.push('> ' + rendered.plain);
      return;
    }

    ctx.htmlParts.push('<p>' + rendered.html + '</p>');
    ctx.mdParts.push(rendered.md);
    ctx.lastMdKind = 'paragraph';
    ctx.plainParts.push(rendered.plain);
  }
}

/**
 * Renders inline runs (bold, italic, inline code, links) from a paragraph or list item.
 */
function renderContainer(container, textSlices, ctx) {
  let html = '';
  let md = '';
  let plain = '';
  let sawNonEmpty = false;
  let allMonospace = true;

  const slicesToProcess = [];
  if (textSlices) {
    for (let i = 0; i < textSlices.length; i++) {
      slicesToProcess.push(textSlices[i]);
    }
  } else {
    const childCount = container.getNumChildren();
    for (let i = 0; i < childCount; i++) {
      const child = container.getChild(i);
      const cType = child.getType();
      if (cType === DocumentApp.ElementType.TEXT) {
        slicesToProcess.push({ textEl: child.asText(), start: null, end: null });
      } else if (cType === DocumentApp.ElementType.INLINE_IMAGE) {
        ctx.warnings.images++;
      } else if (cType === DocumentApp.ElementType.HORIZONTAL_RULE) {
        html += '<hr>';
        md += '\n---\n';
      }
    }
  }

  for (let s = 0; s < slicesToProcess.length; s++) {
    const { textEl, start, end } = slicesToProcess[s];
    const fullText = textEl.getText();
    if (!fullText) continue;

    const rangeStart = start !== null ? start : 0;
    const rangeEnd = end !== null ? Math.min(end, fullText.length - 1) : fullText.length - 1;
    if (rangeStart > rangeEnd) continue;

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

      const bold = Boolean(textEl.isBold(segStart));
      const italic = Boolean(textEl.isItalic(segStart));
      const linkUrl = textEl.getLinkUrl(segStart);
      const font = textEl.getFontFamily(segStart) || '';
      const isMono = MONOSPACE_REGEX.test(font);

      if (raw.trim().length > 0) {
        sawNonEmpty = true;
        if (!isMono) allMonospace = false;
      }

      plain += raw;
      html += formatHtmlRun(raw, { bold, italic, linkUrl, isMono });
      md += formatMarkdownRun(raw, { bold, italic, linkUrl, isMono });
    }
  }

  return { html, md, plain, allMonospace: sawNonEmpty && allMonospace };
}

function formatHtmlRun(raw, attrs) {
  let out = escapeHtml(raw);
  if (!raw.trim()) return out;

  if (attrs.isMono) {
    out = '<code>' + out + '</code>';
  } else {
    if (attrs.italic) out = '<em>' + out + '</em>';
    if (attrs.bold) out = '<strong>' + out + '</strong>';
  }
  if (attrs.linkUrl) {
    out = '<a href="' + escapeAttr(attrs.linkUrl) + '">' + out + '</a>';
  }
  return out;
}

function formatMarkdownRun(raw, attrs) {
  if (!raw.trim()) return raw;

  // Keep leading/trailing spaces outside emphasis delimiters for valid Markdown
  const match = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const lead = match[1];
  let core = match[2];
  const trail = match[3];

  if (attrs.isMono) {
    const fence = core.indexOf('`') !== -1 ? '``' : '`';
    core = fence + core + fence;
  } else {
    if (attrs.bold && attrs.italic) {
      core = '***' + core + '***';
    } else if (attrs.bold) {
      core = '**' + core + '**';
    } else if (attrs.italic) {
      core = '*' + core + '*';
    }
  }

  if (attrs.linkUrl) {
    core = '[' + core + '](' + attrs.linkUrl + ')';
  }
  return lead + core + trail;
}

function flushList(ctx) {
  if (ctx.openListTag) {
    ctx.htmlParts.push('</' + ctx.openListTag + '>');
    ctx.openListTag = null;
  }
}

function flushCodeBlock(ctx) {
  if (ctx.codeBuffer.length > 0) {
    const code = ctx.codeBuffer.join('\n');
    ctx.htmlParts.push('<pre><code>' + escapeHtml(code) + '</code></pre>');
    ctx.mdParts.push('```\n' + code + '\n```');
    ctx.lastMdKind = 'code';
    ctx.plainParts.push(code);
    ctx.codeBuffer = [];
  }
}

function flushPendingBlocks(ctx) {
  flushList(ctx);
  flushCodeBlock(ctx);
}

function appendToLastMarkdownBlock(ctx, line, blockKind) {
  if (ctx.mdParts.length > 0 && ctx.lastMdKind === blockKind) {
    ctx.mdParts[ctx.mdParts.length - 1] += '\n' + line;
  } else {
    ctx.mdParts.push(line);
  }
  ctx.lastMdKind = blockKind;
}

function mapHeadingLevel(heading) {
  const H = DocumentApp.ParagraphHeading;
  switch (heading) {
    case H.TITLE:
    case H.HEADING1:
      return 1;
    case H.SUBTITLE:
    case H.HEADING2:
      return 2;
    case H.HEADING3:
      return 3;
    case H.HEADING4:
      return 4;
    case H.HEADING5:
      return 5;
    case H.HEADING6:
      return 6;
    default:
      return 0;
  }
}

function isOrderedGlyph(glyph) {
  const G = DocumentApp.GlyphType;
  return (
    glyph === G.NUMBER ||
    glyph === G.LATIN_LOWER ||
    glyph === G.LATIN_UPPER ||
    glyph === G.ROMAN_LOWER ||
    glyph === G.ROMAN_UPPER
  );
}

function containsOnlyHorizontalRule(para) {
  if (para.getNumChildren() !== 1) return false;
  return para.getChild(0).getType() === DocumentApp.ElementType.HORIZONTAL_RULE;
}

function formatWarnings(w) {
  const out = [];
  if (w.images > 0) {
    out.push(w.images + ' inline image(s) skipped — upload them directly in Medium.');
  }
  if (w.tables > 0) {
    out.push(w.tables + ' table(s) skipped — Medium strips HTML tables (use a GitHub Gist or screenshot).');
  }
  if (w.nestedListsFlattened > 0) {
    out.push(w.nestedListsFlattened + ' nested list item(s) detected — Medium flattens lists to one level.');
  }
  return out;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
```

### 5.3 `src/Sidebar.html` (Baseline Reference)

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #202124;
      margin: 0;
      padding: 12px;
      background: #fff;
    }
    h2 { font-size: 14px; margin: 0 0 8px; }
    .btn-row { display: flex; gap: 6px; margin-bottom: 10px; }
    button {
      flex: 1;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid #dadce0;
      background: #f8f9fa;
      color: #202124;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: #eef1f5; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button.primary {
      background: #1a73e8;
      border-color: #1a73e8;
      color: #fff;
    }
    button.primary:hover:not(:disabled) { background: #1557b0; }
    .status {
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 10px;
      display: none;
      line-height: 1.4;
    }
    .status.ok   { display: block; background: #e6f4ea; color: #137333; }
    .status.warn { display: block; background: #fef7e0; color: #b06000; }
    .status.err  { display: block; background: #fce8e6; color: #c5221f; }
    .warnings {
      background: #fef7e0;
      border-left: 3px solid #f9ab00;
      padding: 8px 10px;
      margin-bottom: 10px;
      font-size: 12px;
      display: none;
    }
    .warnings ul { margin: 4px 0 0; padding-left: 16px; }
    .meta { font-size: 11px; color: #5f6368; margin-bottom: 6px; }
    #preview {
      border: 1px solid #dadce0;
      border-radius: 6px;
      padding: 10px;
      max-height: 360px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.5;
      background: #fafafa;
    }
    #preview h1 { font-size: 16px; margin: 6px 0; }
    #preview h2 { font-size: 14px; margin: 6px 0; }
    #preview h3 { font-size: 13px; margin: 6px 0; }
    #preview blockquote {
      border-left: 3px solid #5f6368;
      margin: 6px 0;
      padding-left: 8px;
      color: #3c4043;
    }
    #preview pre {
      background: #f1f3f4;
      padding: 6px;
      border-radius: 4px;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <h2>1. Extract from Google Docs</h2>
  <div class="btn-row">
    <button id="btnSel" onclick="runExtract('selection')">Extract Selection</button>
    <button id="btnDoc" onclick="runExtract('document')">Extract Active Tab</button>
  </div>

  <h2>2. Export Clean Output</h2>
  <div class="btn-row">
    <button id="btnCopyHtml" class="primary" disabled onclick="copyCleanHtml()">Copy Clean HTML (Medium)</button>
  </div>
  <div class="btn-row">
    <button id="btnCopyMd" disabled onclick="copyMarkdown()">Copy Markdown</button>
    <button id="btnDlMd" disabled onclick="downloadMarkdown()">Download .md</button>
  </div>

  <div id="status" class="status"></div>
  <div id="warnings" class="warnings"></div>
  <div id="meta" class="meta">Click an Extract button above to preview clean HTML.</div>
  <div id="preview"></div>

  <script>
    let lastExport = null;

    function runExtract(scope) {
      setStatus('Extracting clean structure...', 'warn');
      toggleActionButtons(false);
      google.script.run
        .withSuccessHandler(onExtractSuccess)
        .withFailureHandler((err) => setStatus('Error: ' + err.message, 'err'))
        .extractContent(scope);
    }

    function onExtractSuccess(res) {
      if (res.error) {
        setStatus(res.error, 'err');
        return;
      }
      lastExport = res;
      document.getElementById('preview').innerHTML = res.html;
      document.getElementById('meta').textContent =
        (res.scope === 'selection' ? 'Selection' : 'Tab: ' + res.tabTitle) +
        ' • ' + res.wordCount + ' words ready';

      const warnBox = document.getElementById('warnings');
      if (res.warnings && res.warnings.length > 0) {
        warnBox.innerHTML = '<strong>Medium Compatibility Notes</strong><ul>' +
          res.warnings.map((w) => '<li>' + escapeHtml(w) + '</li>').join('') + '</ul>';
        warnBox.style.display = 'block';
      } else {
        warnBox.style.display = 'none';
      }

      toggleActionButtons(true);
      setStatus('Ready! Click "Copy Clean HTML (Medium)" below.', 'ok');
    }

    async function copyCleanHtml() {
      if (!lastExport) return;
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          const item = new ClipboardItem({
            'text/html': new Blob([lastExport.html], { type: 'text/html' }),
            'text/plain': new Blob([lastExport.plainText], { type: 'text/plain' }),
          });
          await navigator.clipboard.write([item]);
          setStatus('Copied clean HTML — paste directly into Medium (Ctrl+V).', 'ok');
          return;
        }
      } catch (e) {
        // Expected if sandboxed iframe blocks async clipboard-write; use fallback below.
      }

      const ok = copyViaCopyEvent(lastExport.html, lastExport.plainText);
      if (ok) {
        setStatus('Copied clean HTML — paste directly into Medium (Ctrl+V).', 'ok');
      } else {
        setStatus('Browser blocked clipboard write. Click inside the preview and press Ctrl+A, Ctrl+C.', 'warn');
      }
    }

    async function copyMarkdown() {
      if (!lastExport) return;
      try {
        await navigator.clipboard.writeText(lastExport.markdown);
        setStatus('Copied Markdown to clipboard.', 'ok');
        return;
      } catch (e) {
        // Fallback to plain-text copy event
      }
      const ok = copyViaCopyEvent(null, lastExport.markdown);
      setStatus(ok ? 'Copied Markdown to clipboard.' : 'Clipboard blocked — use Download .md instead.', ok ? 'ok' : 'warn');
    }

    function downloadMarkdown() {
      if (!lastExport) return;
      const slug = (lastExport.tabTitle || lastExport.title || 'article')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'article';
      const blob = new Blob([lastExport.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = slug + '.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('Downloaded ' + slug + '.md', 'ok');
    }

    function copyViaCopyEvent(html, plainText) {
      const handler = (e) => {
        e.preventDefault();
        if (html) e.clipboardData.setData('text/html', html);
        e.clipboardData.setData('text/plain', plainText);
      };
      document.addEventListener('copy', handler);
      let ok = false;
      try {
        const preview = document.getElementById('preview');
        const range = document.createRange();
        range.selectNodeContents(preview);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        ok = document.execCommand('copy');
        sel.removeAllRanges();
      } finally {
        document.removeEventListener('copy', handler);
      }
      return ok;
    }

    function toggleActionButtons(enabled) {
      document.getElementById('btnCopyHtml').disabled = !enabled;
      document.getElementById('btnCopyMd').disabled = !enabled;
      document.getElementById('btnDlMd').disabled = !enabled;
    }

    function setStatus(msg, level) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = 'status ' + level;
    }

    function escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  </script>
</body>
</html>
```

### 5.4 Starter Config Files

**`.clasp.json.example`**
```json
{
  "scriptId": "REPLACE_WITH_YOUR_APPS_SCRIPT_PROJECT_ID",
  "rootDir": "src"
}
```

**`.claspignore`**
```text
**/**
!src/**
!src/appsscript.json
```

**`.gitignore`**
```text
.clasp.json
.clasprc.json
node_modules/
.DS_Store
Thumbs.db
```

---

## 6. Instructions for Antigravity (v1.0 Build Checklist)

When generating the initial repository files from this specification, please perform the following steps:

1. **Review & Refine Architecture:**
   * Inspect the baseline `Code.gs` and `Sidebar.html` for edge cases (e.g., mixed `ul`/`ol` transitions, consecutive blockquotes, partial selections spanning multiple paragraphs and list items, inline links containing parentheses in Markdown URLs, and XSS safety in the sidebar preview).
   * Separate pure, `DocumentApp`-independent helpers (`formatHtmlRun`, `formatMarkdownRun`, `formatWarnings`, `escapeHtml`, `escapeAttr`, `slugifyFilename`) into `src/Formatters.gs` with a safe conditional export (`if (typeof module !== 'undefined' && module.exports) { ... }`) so they run natively in Apps Script V8 and can also be imported in local Node tests.
2. **Generate Project Files:**
   * Produce `src/appsscript.json`, `src/Code.gs`, `src/Formatters.gs`, `src/Sidebar.html`, `.clasp.json.example`, `.claspignore`, `.gitignore`, `package.json`, and `README.md`.
   * Configure `package.json` with `@google/clasp` as a `devDependency` and convenient npm scripts (`test`, `clasp:login`, `clasp:push`, `clasp:pull`, `clasp:open`) that work cleanly in PowerShell on Windows as well as macOS/Linux.
3. **Write Automated Unit Tests (`test/formatters.test.mjs`):**
   * Use Node's built-in test runner (`node --test`, zero external test framework dependencies).
   * Cover: HTML entity & attribute escaping, bold/italic/combined emphasis with surrounding spaces, inline code containing literal backticks, hyperlinks wrapped around formatted text, Markdown link escaping, warning generation, and filename slugification.
4. **Verify Locally Before First Push:**
   * Run `npm test` and confirm all unit tests pass.
   * Confirm `src/` contains only valid Apps Script files (`.gs`, `.html`, `appsscript.json`) with no ES `import`/`export` syntax that would fail in the Apps Script V8 runtime.
5. **Document Deployment & Manual Smoke Test in `README.md`:**
   * Include exact steps to:
     1. Enable the Google Apps Script API at `https://script.google.com/home/usersettings`.
     2. Run `npx clasp login`.
     3. Bind to an existing Google Doc via `npx clasp create --type docs --title "Medium Exporter" --parentId <DOC_ID> --rootDir src` (or copy `.clasp.json.example` to `.clasp.json` with an existing Script ID from **Extensions → Apps Script → Project Settings**).
     4. Deploy via `npm run clasp:push`.
   * Include a manual Google Docs → Medium smoke test checklist verifying: Title (`H1`), Section Heading (`H2`), Subheading (`H3`), Bold/Italic/Links, Indented Blockquote, Monospace inline & multi-line code block, Bullet & Numbered lists, Horizontal Rule, Partial Selection export, Active Tab export, and `.md` file download.

---

## 7. Future Roadmap (Post-v1.0 Candidates)

* **v1.1 — YAML Front Matter Support:** Optional sidebar fields for `title`, `date`, `tags`, and `description` prepended to downloaded `.md` files for Jekyll/Hugo/Astro on `github.io`.
* **v1.2 — Direct GitHub Commit:** Push exported `.md` files directly to a configured `github.io` repository branch via the GitHub Contents API (`UrlFetchApp` + fine-grained Personal Access Token stored in `PropertiesService.getUserProperties()`).
* **v1.3 — GitHub Actions CI/CD:** Automated `npm test` on PRs and optional `clasp push --force` on merge to `main` using repository secrets (`CLASPRC_JSON`, `CLASP_JSON`).

---

## 8. Authoritative References

* [Google Apps Script — Command Line Interface (`clasp`)](https://developers.google.com/apps-script/guides/clasp)
* [Google Apps Script — Extend Google Docs](https://developers.google.com/apps-script/guides/docs)
* [Google Apps Script — Class `DocumentTab`](https://developers.google.com/apps-script/reference/document/document-tab)
* [Google Apps Script — Authorization Scopes & `@OnlyCurrentDoc`](https://developers.google.com/apps-script/concepts/scopes)
* [Google Apps Script — Dialogs and Sidebars](https://developers.google.com/apps-script/guides/dialogs)
* [Medium Help Center — Using the story editor](https://help.medium.com/hc/en-us/articles/215194537-Using-the-story-editor)
* [MDN Web Docs — Interact with the Clipboard](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard)