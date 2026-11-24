import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  convertBlocksToHtml,
  mapHeadingLevel,
  mapMediumHeadingTag,
  isOrderedGlyph,
} = require('../src/Converter.gs');

describe('heading & glyph mapping helpers', () => {
  it('maps Title to H1 and Heading 1-3 to H2-H4', () => {
    assert.equal(mapHeadingLevel('TITLE'), 1);
    assert.equal(mapHeadingLevel('SUBTITLE'), 2);
    assert.equal(mapHeadingLevel('HEADING1'), 2);
    assert.equal(mapHeadingLevel('HEADING2'), 3);
    assert.equal(mapHeadingLevel('HEADING3'), 4);
    assert.equal(mapHeadingLevel('HEADING4'), 5);
    assert.equal(mapHeadingLevel('HEADING5'), 6);
    assert.equal(mapHeadingLevel('HEADING6'), 6);
    assert.equal(mapHeadingLevel('NORMAL'), 0);
  });

  it('maps Medium heading tags so Heading 1 is Big T (h3) and Subtitle/Heading 2+ are Little T (h4)', () => {
    assert.equal(mapMediumHeadingTag(1, false), 'h1');
    assert.equal(mapMediumHeadingTag(2, false), 'h3');
    assert.equal(mapMediumHeadingTag(2, true), 'h4');
    assert.equal(mapMediumHeadingTag(3, false), 'h4');
    assert.equal(mapMediumHeadingTag(4, false), 'h4');
    assert.equal(mapMediumHeadingTag(6, false), 'h4');
  });

  it('distinguishes ordered and unordered list glyph types', () => {
    assert.equal(isOrderedGlyph('NUMBER'), true);
    assert.equal(isOrderedGlyph('LATIN_LOWER'), true);
    assert.equal(isOrderedGlyph('ROMAN_UPPER'), true);
    assert.equal(isOrderedGlyph('BULLET'), false);
    assert.equal(isOrderedGlyph('HOLLOW_BULLET'), false);
  });
});

describe('convertBlocksToHtml', () => {
  it('renders headings, formatted paragraphs, strikethrough, and soft line breaks', () => {
    const blocks = [
      { type: 'paragraph', headingLevel: 1, indentStart: 0, items: [{ kind: 'text', text: 'Article Title' }] },
      { type: 'paragraph', headingLevel: 2, isSubtitle: true, indentStart: 0, items: [{ kind: 'text', text: 'Article Subtitle' }] },
      { type: 'paragraph', headingLevel: 2, isSubtitle: false, indentStart: 0, items: [{ kind: 'text', text: 'Section One' }] },
      { type: 'paragraph', headingLevel: 3, indentStart: 0, items: [{ kind: 'text', text: 'Subsection' }] },
      { type: 'paragraph', headingLevel: 4, indentStart: 0, items: [{ kind: 'text', text: 'Detail Heading' }] },
      {
        type: 'paragraph',
        headingLevel: 0,
        indentStart: 0,
        items: [
          { kind: 'text', text: 'Hello ' },
          { kind: 'text', text: 'world', bold: true },
          { kind: 'text', text: ' and ' },
          { kind: 'text', text: 'deprecated', strikethrough: true },
          { kind: 'text', text: '\u000bNext line' },
        ],
      },
    ];

    const res = convertBlocksToHtml(blocks);
    assert.equal(
      res.html,
      [
        '<h1>Article Title</h1>',
        '<h2>Article Subtitle</h2>',
        '<h2>Section One</h2>',
        '<h3>Subsection</h3>',
        '<h4>Detail Heading</h4>',
        '<p>Hello <strong>world</strong> and <s>deprecated</s><br>Next line</p>',
      ].join('\n')
    );
    assert.equal(
      res.mediumHtml,
      [
        '<h1>Article Title</h1>',
        '<h4>Article Subtitle</h4>',
        '<h3>Section One</h3>',
        '<h4>Subsection</h4>',
        '<h4>Detail Heading</h4>',
        '<p>Hello <strong>world</strong> and <s>deprecated</s><br>Next line</p>',
      ].join('\n')
    );
    assert.equal(res.warnings.length, 0);
    assert.ok(res.wordCount > 0);
  });

  it('coalesces consecutive indented paragraphs into a single multi-paragraph blockquote', () => {
    const blocks = [
      { type: 'paragraph', headingLevel: 0, indentStart: 36, items: [{ kind: 'text', text: 'First quoted paragraph.' }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 36, items: [{ kind: 'text', text: '   ' }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 36, items: [{ kind: 'text', text: 'Second quoted paragraph.' }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'text', text: 'Back to normal body.' }] },
    ];

    const res = convertBlocksToHtml(blocks);
    assert.equal(
      res.html,
      [
        '<blockquote>',
        '  <p>First quoted paragraph.</p>',
        '  <p>Second quoted paragraph.</p>',
        '</blockquote>',
        '<p>Back to normal body.</p>',
      ].join('\n')
    );
  });

  it('separates distinct blockquotes when separated by an unindented blank paragraph', () => {
    const blocks = [
      { type: 'paragraph', headingLevel: 0, indentStart: 24, items: [{ kind: 'text', text: 'Quote A' }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'text', text: '' }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 24, items: [{ kind: 'text', text: 'Quote B' }] },
    ];

    const res = convertBlocksToHtml(blocks);
    assert.equal(
      res.html,
      [
        '<blockquote>',
        '  <p>Quote A</p>',
        '</blockquote>',
        '<blockquote>',
        '  <p>Quote B</p>',
        '</blockquote>',
      ].join('\n')
    );
  });

  it('coalesces monospace paragraphs into one code block and preserves internal blank lines only', () => {
    const blocks = [
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'text', text: 'function greet(name) {', isMono: true }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'text', text: '' }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'text', text: '  printf(\u201cHi <${name}>\u201d); // \u2014verbose \u2026', isMono: true }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'text', text: '}', isMono: true }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'text', text: '' }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'text', text: 'After \u201ccode\u201d \u2014 prose stays typographic.' }] },
    ];

    const res = convertBlocksToHtml(blocks);
    assert.equal(
      res.html,
      [
        '<pre><code>function greet(name) {\n\n  printf("Hi &lt;${name}&gt;"); // --verbose ...\n}</code></pre>',
        '<p>After \u201ccode\u201d \u2014 prose stays typographic.</p>',
      ].join('\n')
    );
  });

  it('does not turn a monospace heading into a code block', () => {
    const blocks = [
      { type: 'paragraph', headingLevel: 2, indentStart: 0, items: [{ kind: 'text', text: 'API_KEY', isMono: true }] },
    ];
    const res = convertBlocksToHtml(blocks);
    assert.equal(res.html, '<h2><code>API_KEY</code></h2>');
  });

  it('renders 1x1 code-block tables as <pre><code> and normal tables as [TABLE] placeholders', () => {
    const blocks = [
      {
        type: 'table',
        rows: 1,
        cols: 1,
        isCodeBlock: true,
        codeLines: ['const a = 1;', 'console.log(a);'],
      },
      {
        type: 'table',
        rows: 3,
        cols: 2,
        isCodeBlock: false,
      },
    ];

    const res = convertBlocksToHtml(blocks);
    assert.equal(
      res.html,
      [
        '<pre><code>const a = 1;\nconsole.log(a);</code></pre>',
        '<p>[TABLE: 3\u00d72]</p>',
      ].join('\n')
    );
    assert.equal(res.warningCounts.tables, 1);
    assert.equal(res.warnings.length, 1);
  });

  it('emits inline [IMAGE] placeholders and counts image warnings', () => {
    const blocks = [
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'image', altText: 'System Diagram' }] },
      {
        type: 'paragraph',
        headingLevel: 0,
        indentStart: 0,
        items: [
          { kind: 'text', text: 'Look at ' },
          { kind: 'image', altText: '' },
          { kind: 'text', text: ' here.' },
        ],
      },
    ];

    const res = convertBlocksToHtml(blocks);
    assert.equal(
      res.html,
      [
        '<p>[IMAGE: System Diagram]</p>',
        '<p>Look at [IMAGE] here.</p>',
      ].join('\n')
    );
    assert.equal(res.warningCounts.images, 2);
  });

  it('handles ul/ol list transitions, nested list warnings, and horizontal rules', () => {
    const blocks = [
      { type: 'list_item', ordered: false, nestingLevel: 0, items: [{ kind: 'text', text: 'Bullet 1' }] },
      { type: 'list_item', ordered: false, nestingLevel: 1, items: [{ kind: 'text', text: 'Nested bullet' }] },
      { type: 'list_item', ordered: true, nestingLevel: 0, items: [{ kind: 'text', text: 'Step 1' }] },
      { type: 'paragraph', headingLevel: 0, indentStart: 0, items: [{ kind: 'horizontal_rule' }] },
      { type: 'horizontal_rule' },
    ];

    const res = convertBlocksToHtml(blocks);
    assert.equal(
      res.html,
      [
        '<ul>',
        '  <li>Bullet 1</li>',
        '  <li>Nested bullet</li>',
        '</ul>',
        '<ol>',
        '  <li>Step 1</li>',
        '</ol>',
        '<hr>',
        '<hr>',
      ].join('\n')
    );
    assert.equal(res.warningCounts.nestedListsFlattened, 1);
  });
});
