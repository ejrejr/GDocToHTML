# Setup, Deployment & Authoring Guide

This guide covers local development, one-time Google Apps Script setup via `@google/clasp`, Google Docs authoring conventions, and manual verification in Medium.com.

---

## 1. Prerequisites

- **Node.js 24** managed via `mise` (pinned in `mise.toml`)
- A Google account with a Google Doc you want to attach the exporter to (recommended: a single master **"Medium Drafts"** Doc using Google Docs **Tabs** for each article, or a blank template Doc you duplicate with **File → Make a copy**)

Install local dependencies and run the test suite:

```powershell
mise install
npm install
npm test
```

---

## 2. One-Time Google Apps Script & `clasp` Setup

### Step A: Enable the Google Apps Script API
1. Visit [https://script.google.com/home/usersettings](https://script.google.com/home/usersettings).
2. Turn **Google Apps Script API** **On**.

### Step B: Sign In Locally with `clasp`
Run:

```powershell
npm run clasp:login
```

This opens a browser window to authorize `clasp` against your Google account and saves your personal OAuth token locally in `~/.clasprc.json` (outside this repository; `.clasprc.json` is also git-ignored for safety).

### Step C: Bind This Repo to Your Google Doc
Choose **one** of the following options to create your local, git-ignored `.clasp.json`:

**Option 1 — Bind to an existing Google Doc's Apps Script project (simplest)**
1. Open your Google Doc and click **Extensions → Apps Script** in the Google Docs menu bar.
2. *(Recommended)* Click **Untitled project** in the top-left corner of the Apps Script editor and rename it (for example, **Medium Exporter** or **GDocToHTML**) so Google's authorization prompt displays a recognizable project name instead of "Untitled project".
3. In the Apps Script editor, open **Project Settings** (gear icon) and copy the **Script ID**.
4. Copy `.clasp.json.example` to `.clasp.json`:
   ```powershell
   Copy-Item .clasp.json.example .clasp.json
   ```
5. Replace `REPLACE_WITH_YOUR_APPS_SCRIPT_PROJECT_ID` in `.clasp.json` with your copied Script ID.

**Option 2 — Create a new container-bound script via CLI**
1. Copy the Document ID from your Google Doc URL (`https://docs.google.com/document/d/<DOC_ID>/edit`).
2. Run:
   ```powershell
   npx clasp create --type docs --title "Medium Exporter" --parentId <DOC_ID> --rootDir src
   ```

> **Privacy check:** `.clasp.json`, `.clasprc.json`, `.env*`, and key/token files are all ignored in `.gitignore`. Run `git status` before committing to verify no private files are staged.

---

## 3. Pushing Updates to Google Docs

After making local edits and passing tests:

```powershell
npm test
npm run clasp:push
```

Then reload your Google Doc. A **Medium Exporter** menu will appear in the top toolbar → click **Medium Exporter → Open Exporter Sidebar** (the first run will prompt you to authorize access strictly to the current document and sidebar UI).

---

## 4. Google Docs → Clean HTML Mapping Reference

| Google Docs Construct | Semantic HTML (`Copy Raw HTML` / `.html`) | Medium HTML (`Copy Clean HTML`) | Notes |
| :--- | :--- | :--- | :--- |
| `Title` | `<h1>...</h1>` | `<h1>...</h1>` | Top-level title (Medium Title / Big T) |
| `Subtitle` | `<h2>...</h2>` | `<h4>...</h4>` | Medium Little T (`graf--h4`) |
| `Heading 1` | `<h2>...</h2>` | `<h3>...</h3>` | Medium Big T (`graf--h3`) |
| `Heading 2` | `<h3>...</h3>` | `<h4>...</h4>` | Medium Little T (`graf--h4`) |
| `Heading 3` – `Heading 6` | `<h4>` – `<h6>` | `<h4>...</h4>` | Preserves full depth in `.html`; maps to Little T in Medium |
| Normal Paragraph | `<p>...</p>` | `<p>...</p>` | Empty/whitespace-only paragraphs are skipped |
| Indented Paragraph (`>= 24pt`) | `<blockquote><p>...</p></blockquote>` | `<blockquote><p>...</p></blockquote>` | Consecutive indented paragraphs coalesce into one multi-paragraph `<blockquote>` |
| Bold / Italic / Strikethrough | `<strong>`, `<em>`, `<s>` | `<strong>`, `<em>`, `<s>` | Nested cleanly with HTML entity escaping |
| Soft Line Break (`Shift+Enter`) | `<br>` | `<br>` | Preserved inline inside paragraphs, headings, lists, and blockquotes |
| Hyperlink | `<a href="...">...</a>` | `<a href="...">...</a>` | Validates URL protocol (`http:`, `https:`, `mailto:`, `#`, `/`) |
| Monospace Inline Run | `<code>...</code>` | `<code>...</code>` | Matches Courier, Consolas, Roboto Mono, JetBrains Mono, Cascadia, Menlo, Monaco, etc.; straightens smart quotes, em/en dashes, ellipsis, and NBSP |
| Consecutive Monospace Paragraphs | `<pre><code>...</code></pre>` | `<pre><code>...</code></pre>` | Internal blank lines preserved; straightens smart quotes, em/en dashes, ellipsis, and NBSP |
| Docs Code Block Building Block | `<pre><code>...</code></pre>` | `<pre><code>...</code></pre>` | 1×1 monospace tables are detected and exported as code blocks with code typography cleanup |
| Bullet / Numbered Lists | `<ul><li>...</li></ul>` / `<ol><li>...</li></ol>` | `<ul><li>...</li></ul>` / `<ol><li>...</li></ol>` | Nested lists log a compatibility warning (Medium flattens nested lists) |
| Horizontal Rule | `<hr>` | `<hr>` | Supports standalone and paragraph-wrapped dividers |
| Inline Image | `[IMAGE]` or `[IMAGE: <alt>]` | `[IMAGE]` or `[IMAGE: <alt>]` | Inline placeholder + compatibility warning (upload manually in Medium) |
| Native Table (non-code) | `[TABLE: R×C]` | `[TABLE: R×C]` | Inline placeholder + compatibility warning (Medium strips HTML tables) |

---

## 5. Manual Smoke-Test Checklist

Before relying on a newly pushed build, verify the following in a test tab of your Google Doc and paste into a Medium draft:

- [ ] **Title + Sections:** `Title` (`<h1>`), `Heading 1` (`<h2>`), `Heading 2` (`<h3>`), `Heading 3` (`<h4>`) paste cleanly.
- [ ] **Inline Formatting:** Bold, italic, bold+italic, strikethrough (`<s>`), inline monospace (`<code>`), links, and `Shift+Enter` soft line breaks (`<br>`).
- [ ] **Multi-Paragraph Blockquote:** Two consecutive indented paragraphs (`>= 24pt`) render inside a single `<blockquote>`.
- [ ] **Code Blocks:** Multi-line monospace paragraphs (including an internal blank line) and a Docs Code Block building block both export as `<pre><code>`.
- [ ] **Lists & Dividers:** Bullet list, numbered list, transition between them, nested list warning, and horizontal rule (`<hr>`).
- [ ] **Placeholders & Warnings:** Inline image renders `[IMAGE]` (or `[IMAGE: alt]`), regular table renders `[TABLE: R×C]`, and both appear in the sidebar's **Medium Compatibility Notes**.
- [ ] **Scopes:** Both **Extract Active Tab** and **Extract Selection** (including partial paragraph highlight) work as expected.
- [ ] **Exports:**
  - **Copy Clean HTML (Medium)** pastes clean rich text into Medium via `Ctrl+V` without Google Docs font/span bloat.
  - **Copy Raw HTML** copies raw HTML markup as plain text.
  - **Download `.html`** downloads `<tab-slug>.html`.
  - **Rendered / HTML** preview toggle switches cleanly without breaking clipboard copy.
