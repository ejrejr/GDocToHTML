import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
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
} = require('../src/Formatters.gs');

describe('escapeHtml & escapeAttr', () => {
  it('escapes HTML special characters in text', () => {
    assert.equal(escapeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
    assert.equal(escapeHtml(null), '');
  });

  it('escapes quotes in HTML attributes', () => {
    assert.equal(escapeAttr('https://example.com/?a="1"&b=\'2\''), 'https://example.com/?a=&quot;1&quot;&amp;b=&#39;2&#39;');
  });
});

describe('sanitizeUrl', () => {
  it('allows safe http, https, mailto, anchor, and relative URLs', () => {
    assert.equal(sanitizeUrl(' https://medium.com/story '), 'https://medium.com/story');
    assert.equal(sanitizeUrl('http://example.com'), 'http://example.com');
    assert.equal(sanitizeUrl('mailto:author@example.com'), 'mailto:author@example.com');
    assert.equal(sanitizeUrl('#section-1'), '#section-1');
    assert.equal(sanitizeUrl('/posts/article.html'), '/posts/article.html');
  });

  it('rejects dangerous or empty URLs', () => {
    assert.equal(sanitizeUrl('javascript:alert(1)'), null);
    assert.equal(sanitizeUrl('  JAVASCRIPT:void(0) '), null);
    assert.equal(sanitizeUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(sanitizeUrl('   '), null);
    assert.equal(sanitizeUrl(null), null);
  });
});

describe('soft line breaks & monospace detection', () => {
  it('normalizes Google Docs vertical tabs and CRLF to newlines', () => {
    assert.equal(normalizeSoftBreaks('line1\u000bline2\r\nline3\rline4'), 'line1\nline2\nline3\nline4');
  });

  it('escapes HTML and turns soft breaks into <br>', () => {
    assert.equal(formatTextWithBreaks('A < B\u000bC & D'), 'A &lt; B<br>C &amp; D');
  });

  it('detects common monospace fonts', () => {
    assert.equal(isMonospaceFont('Roboto Mono'), true);
    assert.equal(isMonospaceFont('Courier New'), true);
    assert.equal(isMonospaceFont('Consolas'), true);
    assert.equal(isMonospaceFont('JetBrains Mono'), true);
    assert.equal(isMonospaceFont('Cascadia Code'), true);
    assert.equal(isMonospaceFont('Arial'), false);
    assert.equal(isMonospaceFont(''), false);
    assert.equal(isMonospaceFont(null), false);
  });
});

describe('formatHtmlRun', () => {
  it('renders plain, bold, italic, combined, strikethrough, and inline code runs', () => {
    assert.equal(formatHtmlRun('hello', {}), 'hello');
    assert.equal(formatHtmlRun('bold', { bold: true }), '<strong>bold</strong>');
    assert.equal(formatHtmlRun('italic', { italic: true }), '<em>italic</em>');
    assert.equal(formatHtmlRun('both', { bold: true, italic: true }), '<strong><em>both</em></strong>');
    assert.equal(formatHtmlRun('old', { strikethrough: true }), '<s>old</s>');
    assert.equal(formatHtmlRun('old bold', { bold: true, strikethrough: true }), '<s><strong>old bold</strong></s>');
    assert.equal(formatHtmlRun('const x = 1;', { isMono: true }), '<code>const x = 1;</code>');
    assert.equal(formatHtmlRun('deprecated()', { isMono: true, strikethrough: true }), '<s><code>deprecated()</code></s>');
  });

  it('wraps formatted runs in sanitized hyperlinks and drops unsafe schemes', () => {
    assert.equal(
      formatHtmlRun('Docs', { bold: true, linkUrl: 'https://example.com/a?x=1&y="2"' }),
      '<a href="https://example.com/a?x=1&amp;y=&quot;2&quot;"><strong>Docs</strong></a>'
    );
    assert.equal(
      formatHtmlRun('click me', { linkUrl: 'javascript:alert(1)' }),
      'click me'
    );
  });

  it('preserves whitespace and standalone soft line breaks cleanly', () => {
    assert.equal(formatHtmlRun('   ', { bold: true }), '   ');
    assert.equal(formatHtmlRun('\u000b', { bold: true }), '<br>');
    assert.equal(formatHtmlRun('Line 1\u000bLine 2', { italic: true }), '<em>Line 1<br>Line 2</em>');
  });
  it('straightens smart quotes, dashes, ellipsis, and NBSP in code text', () => {
    assert.equal(
      normalizeCodeText('printf(\u201cHello\u201d, \u2018world\u2019); // \u2014flag a\u2013b \u2026\u00a0ok'),
      'printf("Hello", \'world\'); // --flag a-b ... ok'
    );
  });

  it('straightens typographic characters inside inline monospace runs but preserves them in prose', () => {
    assert.equal(
      formatHtmlRun('\u201cfoo\u201d \u2014flag \u2026', { isMono: true }),
      '<code>"foo" --flag ...</code>'
    );
    assert.equal(
      formatHtmlRun('\u201cHello\u201d \u2014 world\u2026', {}),
      '\u201cHello\u201d \u2014 world\u2026'
    );
  });
});

describe('placeholders, warnings, and filename slugification', () => {
  it('formats image and table placeholders', () => {
    assert.equal(formatImagePlaceholder(''), '[IMAGE]');
    assert.equal(formatImagePlaceholder('  Hero   banner \n '), '[IMAGE: Hero banner]');
    assert.equal(formatTablePlaceholder(4, 3), '[TABLE: 4\u00d73]');
    assert.equal(formatTablePlaceholder(0, 0), '[TABLE]');
  });

  it('formats Medium compatibility warnings only for non-zero counts', () => {
    assert.deepEqual(formatWarnings({ images: 0, tables: 0, nestedListsFlattened: 0 }), []);
    const warnings = formatWarnings({ images: 2, tables: 1, nestedListsFlattened: 3 });
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /2 inline image\(s\)/);
    assert.match(warnings[1], /1 table\(s\)/);
    assert.match(warnings[2], /3 nested list item\(s\)/);
  });

  it('slugifies filenames safely with fallback', () => {
    assert.equal(slugifyFilename('My First Medium Post! (2026)'), 'my-first-medium-post-2026');
    assert.equal(slugifyFilename('   ---   '), 'article');
    assert.equal(slugifyFilename(''), 'article');
  });
});
