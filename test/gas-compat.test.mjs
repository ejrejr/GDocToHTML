import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../src');

const MOCK_ENUMS = {
  ElementType: {
    PARAGRAPH: 'PARAGRAPH',
    LIST_ITEM: 'LIST_ITEM',
    TABLE: 'TABLE',
    HORIZONTAL_RULE: 'HORIZONTAL_RULE',
    TEXT: 'TEXT',
    INLINE_IMAGE: 'INLINE_IMAGE',
    BODY_SECTION: 'BODY_SECTION',
  },
  ParagraphHeading: {
    NORMAL: 'NORMAL',
    TITLE: 'TITLE',
    SUBTITLE: 'SUBTITLE',
    HEADING1: 'HEADING1',
    HEADING2: 'HEADING2',
    HEADING3: 'HEADING3',
    HEADING4: 'HEADING4',
    HEADING5: 'HEADING5',
    HEADING6: 'HEADING6',
  },
  GlyphType: {
    BULLET: 'BULLET',
    NUMBER: 'NUMBER',
    LATIN_LOWER: 'LATIN_LOWER',
    LATIN_UPPER: 'LATIN_UPPER',
    ROMAN_LOWER: 'ROMAN_LOWER',
    ROMAN_UPPER: 'ROMAN_UPPER',
  },
  Attribute: {
    FONT_FAMILY: 'FONT_FAMILY',
  },
};

function createMockText(text, runs = []) {
  const getRunAt = (offset) => {
    for (let i = runs.length - 1; i >= 0; i--) {
      if (offset >= runs[i].start) return runs[i];
    }
    return {};
  };
  return {
    _parent: null,
    getType: () => MOCK_ENUMS.ElementType.TEXT,
    getParent: function () { return this._parent; },
    asText: function () { return this; },
    getText: () => text,
    getTextAttributeIndices: () => runs.length ? runs.map((r) => r.start) : [0],
    isBold: (offset) => Boolean(getRunAt(offset).bold),
    isItalic: (offset) => Boolean(getRunAt(offset).italic),
    isStrikethrough: (offset) => Boolean(getRunAt(offset).strikethrough),
    getLinkUrl: (offset) => getRunAt(offset).linkUrl || null,
    getFontFamily: (offset) => getRunAt(offset).fontFamily || null,
  };
}

function createMockImage(altTitle = '', altDesc = '') {
  return {
    _parent: null,
    getType: () => MOCK_ENUMS.ElementType.INLINE_IMAGE,
    getParent: function () { return this._parent; },
    asInlineImage: function () { return this; },
    getAltTitle: () => altTitle,
    getAltDescription: () => altDesc,
  };
}

function createMockParagraph(children, opts = {}) {
  const para = {
    _parent: null,
    getType: () => MOCK_ENUMS.ElementType.PARAGRAPH,
    getParent: function () { return this._parent; },
    asParagraph: function () { return this; },
    getHeading: () => opts.heading || MOCK_ENUMS.ParagraphHeading.NORMAL,
    getIndentStart: () => (opts.indentStart != null ? opts.indentStart : 0),
    getAttributes: () => (opts.fontFamily ? { [MOCK_ENUMS.Attribute.FONT_FAMILY]: opts.fontFamily } : {}),
    getNumChildren: () => children.length,
    getChild: (i) => children[i],
    getChildIndex: (c) => children.indexOf(c),
  };
  for (const child of children) child._parent = para;
  return para;
}

function createMockCodeBlockTable(lines) {
  const cellChildren = lines.map((line) =>
    createMockParagraph([createMockText(line)], { fontFamily: 'Roboto Mono' })
  );
  const cell = {
    getNumChildren: () => cellChildren.length,
    getChild: (i) => cellChildren[i],
    getAttributes: () => ({ [MOCK_ENUMS.Attribute.FONT_FAMILY]: 'Roboto Mono' }),
  };
  const row = {
    getNumCells: () => 1,
    getCell: () => cell,
  };
  return {
    getType: () => MOCK_ENUMS.ElementType.TABLE,
    asTable: function () { return this; },
    getNumRows: () => 1,
    getRow: () => row,
  };
}

describe('Apps Script V8 compatibility', () => {
  it('contains only valid Apps Script files inside src/', () => {
    const files = fs.readdirSync(SRC_DIR);
    for (const file of files) {
      assert.match(file, /^(\w+\.(gs|html)|appsscript\.json)$/, `Unexpected file in src/: ${file}`);
    }
  });

  it('has a valid appsscript.json manifest with least-privilege scopes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'appsscript.json'), 'utf8'));
    assert.equal(manifest.runtimeVersion, 'V8');
    assert.deepEqual(manifest.oauthScopes, [
      'https://www.googleapis.com/auth/documents.currentonly',
      'https://www.googleapis.com/auth/script.container.ui',
    ]);
  });

  it('has no top-level ES import/export syntax in .gs files', () => {
    const gsFiles = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.gs'));
    for (const file of gsFiles) {
      const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
      assert.doesNotMatch(content, /^\s*(import|export)\s+/m, `${file} contains ES module syntax`);
    }
  });

  it('runs all .gs files in a shared V8 global scope and executes extractContent end-to-end', () => {
    const titlePara = createMockParagraph([createMockText('My Post Title')], {
      heading: MOCK_ENUMS.ParagraphHeading.TITLE,
    });
    const h1Para = createMockParagraph([createMockText('Major Section')], {
      heading: MOCK_ENUMS.ParagraphHeading.HEADING1,
    });
    const h2Para = createMockParagraph([createMockText('Sub Section')], {
      heading: MOCK_ENUMS.ParagraphHeading.HEADING2,
    });
    const bodyText = createMockText('Hello struck world', [
      { start: 0 },
      { start: 6, strikethrough: true },
      { start: 12 },
    ]);
    const bodyPara = createMockParagraph([bodyText, createMockImage('Diagram')]);
    const codeTable = createMockCodeBlockTable(['const x = 42;', 'return x;']);
    const bodyChildren = [titlePara, h1Para, h2Para, bodyPara, codeTable];

    const mockBody = {
      getType: () => MOCK_ENUMS.ElementType.BODY_SECTION,
      getNumChildren: () => bodyChildren.length,
      getChild: (i) => bodyChildren[i],
      getChildIndex: (c) => bodyChildren.indexOf(c),
    };
    for (const c of bodyChildren) c._parent = mockBody;

    const mockSelection = {
      getRangeElements: () => [
        {
          getElement: () => bodyText,
          isPartial: () => true,
          getStartOffset: () => 6,
          getEndOffsetInclusive: () => 11,
        },
        {
          getElement: () => bodyPara.getChild(1),
          isPartial: () => false,
        },
      ],
    };

    const mockDoc = {
      getName: () => 'Master Drafts',
      getActiveTab: () => ({
        getTitle: () => 'Launch Announcement',
        asDocumentTab: () => ({ getBody: () => mockBody }),
      }),
      getBody: () => mockBody,
      getSelection: () => mockSelection,
    };

    const sandbox = vm.createContext({
      DocumentApp: {
        ...MOCK_ENUMS,
        getActiveDocument: () => mockDoc,
      },
    });

    for (const file of ['Formatters.gs', 'Converter.gs', 'Code.gs']) {
      const code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
      vm.runInContext(code, sandbox, { filename: file });
    }

    const docRes = sandbox.extractContent('document');
    assert.equal(docRes.tabTitle, 'Launch Announcement');
    assert.equal(docRes.suggestedFilename, 'launch-announcement.html');
    assert.equal(
      docRes.html,
      [
        '<h1>My Post Title</h1>',
        '<h2>Major Section</h2>',
        '<h3>Sub Section</h3>',
        '<p>Hello <s>struck</s> world[IMAGE: Diagram]</p>',
        '<pre><code>const x = 42;\nreturn x;</code></pre>',
      ].join('\n')
    );
    assert.equal(
      docRes.mediumHtml,
      [
        '<h1>My Post Title</h1>',
        '<h3>Major Section</h3>',
        '<h4>Sub Section</h4>',
        '<p>Hello <s>struck</s> world[IMAGE: Diagram]</p>',
        '<pre><code>const x = 42;\nreturn x;</code></pre>',
      ].join('\n')
    );
    assert.equal(docRes.warnings.length, 1);

    const selRes = sandbox.extractContent('selection');
    assert.equal(selRes.html, '<p><s>struck</s>[IMAGE: Diagram]</p>');
  });
});
