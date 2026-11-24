# GDocToHTML

A private, container-bound **Google Apps Script** sidebar for Google Docs that extracts either the **active document tab** or the **current text selection** into strictly style-free, semantic HTML ready to paste into **Medium.com** or publish directly as `.html` to **GitHub**.

I publish articles on Medium. I've become accustomed to writing in Google Docs but a straight copy and paste from Google Docs into Medium does not end well. So this side bar extension for Google Docs will allow you to stage -- for either the entire tab or your selection -- HTML that you can put onto the clipboard and then paste into your Medium article.

## Key Features
- **Clean Semantic HTML:** Strips Google Docs' inline styles, nested `<span>` bloat, and proprietary font overrides.
- **Full Authoring Support:** `Title` (`<h1>`) + `Heading 1–3` (`<h2>`–`<h4>`), bold, italic, strikethrough (`<s>`), soft line breaks (`Shift+Enter` → `<br>`), sanitized links, multi-paragraph indented blockquotes (`<blockquote>`), monospace code blocks (preserving blank lines and Docs 1×1 Code Block building blocks), lists, and horizontal rules.
- **Medium Compatibility Placeholders & Warnings:** Replaces inline images and non-code tables with visible placeholders (`[IMAGE]`, `[IMAGE: alt]`, `[TABLE: R×C]`) and surfaces a warning summary in the sidebar.
- **Three Export Actions:** **Copy Clean HTML (Medium)** (dual-path rich clipboard), **Copy Raw HTML**, and **Download `.html`**, plus a **Rendered / HTML Source** preview toggle.
- **Least-Privilege Security:** Scoped strictly with `@OnlyCurrentDoc` (`documents.currentonly` + `script.container.ui`).

## Repository Layout
- `src/` — Google Apps Script V8 source (`appsscript.json`, `Code.gs`, `Converter.gs`, `Formatters.gs`, `Sidebar.html`)
- `test/` — Automated Node 24 unit and Apps Script compatibility tests (`node --test`)
- `docs/` — Project documentation and specifications:
  - [Setup, Deployment & Authoring Guide](docs/setup-and-deployment.md)
  - [Original Technical Specification](docs/google_docs_to_medium_markdown_exporter_specification.md)

## Quick Start
```powershell
mise install
npm install
npm test
```

See [docs/setup-and-deployment.md](docs/setup-and-deployment.md) for one-time `clasp` login, binding to your Google Doc, and pushing updates.

## License
[MIT](LICENSE)
