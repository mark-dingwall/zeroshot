/**
 * Tests for doc-reconstruction shared helper.
 * Covers: delta application, split handling, renumbering.
 */

const assert = require('assert');
const {
  reconstructDocument,
  renumberSections,
  sectionsToMarkdown,
} = require('../scripts/lib/doc-reconstruction');

describe('reconstructDocument', function () {
  function makeIter1(sections) {
    return {
      document: {
        title: 'Test Document',
        documentType: 'CHECKLIST',
        sections,
        perspectivesUsed: ['Task Decomposition Analyst'],
      },
    };
  }

  function makeDelta(delta) {
    return { delta };
  }

  it('reconstructs iteration 1 base document', function () {
    const sections = [
      { id: 'I1', category: 'INTRODUCTION', heading: 'Intro', depth: 2, content: 'Hello' },
      { id: 'A1', category: 'ACTION', heading: 'Step 1', depth: 2, content: 'Do thing' },
    ];
    const doc = reconstructDocument([makeIter1(sections)]);

    assert.strictEqual(doc.title, 'Test Document');
    assert.strictEqual(doc.documentType, 'CHECKLIST');
    assert.strictEqual(doc.sections.length, 2);
    assert.strictEqual(doc.sections[0].id, 'I1');
    assert.strictEqual(doc.sections[1].id, 'A1');
  });

  it('applies revised sections from delta', function () {
    const sections = [
      { id: 'A1', category: 'ACTION', heading: 'Step 1', depth: 2, content: 'Original' },
      { id: 'A2', category: 'ACTION', heading: 'Step 2', depth: 2, content: 'Unchanged' },
    ];
    const delta = {
      revisedSections: [
        {
          id: 'A1',
          category: 'ACTION',
          heading: 'Step 1 Revised',
          depth: 2,
          content: 'Updated content',
        },
      ],
      newSections: [],
      removedSections: [],
    };

    const doc = reconstructDocument([makeIter1(sections), makeDelta(delta)]);

    assert.strictEqual(doc.sections.length, 2);
    const a1 = doc.sections.find((s) => s.id === 'A1');
    assert.strictEqual(a1.heading, 'Step 1 Revised');
    assert.strictEqual(a1.content, 'Updated content');
    const a2 = doc.sections.find((s) => s.id === 'A2');
    assert.strictEqual(a2.content, 'Unchanged');
  });

  it('adds new sections from delta', function () {
    const sections = [
      { id: 'A1', category: 'ACTION', heading: 'Step 1', depth: 2, content: 'First' },
    ];
    const delta = {
      revisedSections: [],
      newSections: [
        { id: 'A2', category: 'ACTION', heading: 'Step 2', depth: 2, content: 'Added' },
      ],
      removedSections: [],
    };

    const doc = reconstructDocument([makeIter1(sections), makeDelta(delta)]);

    assert.strictEqual(doc.sections.length, 2);
    assert.ok(doc.sections.find((s) => s.id === 'A2'));
  });

  it('removes sections from delta', function () {
    const sections = [
      { id: 'A1', category: 'ACTION', heading: 'Step 1', depth: 2, content: 'Keep' },
      { id: 'A2', category: 'ACTION', heading: 'Step 2', depth: 2, content: 'Remove' },
    ];
    const delta = {
      revisedSections: [],
      newSections: [],
      removedSections: [{ id: 'A2' }],
    };

    const doc = reconstructDocument([makeIter1(sections), makeDelta(delta)]);

    assert.strictEqual(doc.sections.length, 1);
    assert.strictEqual(doc.sections[0].id, 'A1');
  });

  it('handles string-form removed sections', function () {
    const sections = [
      { id: 'A1', category: 'ACTION', heading: 'Step 1', depth: 2, content: 'Keep' },
      { id: 'A2', category: 'ACTION', heading: 'Step 2', depth: 2, content: 'Remove' },
    ];
    const delta = {
      revisedSections: [],
      newSections: [],
      removedSections: ['A2'],
    };

    const doc = reconstructDocument([makeIter1(sections), makeDelta(delta)]);
    assert.strictEqual(doc.sections.length, 1);
  });

  it('handles split: replace one section with multiple (order + removal)', function () {
    const sections = [
      { id: 'A1', category: 'ACTION', heading: 'Big Step', depth: 2, content: 'Too big' },
      { id: 'A2', category: 'ACTION', heading: 'Next Step', depth: 2, content: 'After' },
    ];
    const delta = {
      revisedSections: [],
      newSections: [
        {
          id: 'A1a',
          category: 'ACTION',
          heading: 'Part 1',
          depth: 3,
          content: 'Sub-step 1',
          replaces: 'A1',
        },
        {
          id: 'A1b',
          category: 'ACTION',
          heading: 'Part 2',
          depth: 3,
          content: 'Sub-step 2',
          insertAfter: 'A1a',
        },
      ],
      removedSections: [{ id: 'A1' }],
    };

    const doc = reconstructDocument([makeIter1(sections), makeDelta(delta)]);

    assert.strictEqual(doc.sections.length, 3);
    // Original A1 should be removed
    assert.ok(!doc.sections.find((s) => s.id === 'A1'), 'A1 should be removed');
    // Order should be: A1a, A1b, A2 (replacements before remaining sections)
    assert.strictEqual(doc.sections[0].id, 'A1a', 'A1a should be first (replaces A1)');
    assert.strictEqual(doc.sections[1].id, 'A1b', 'A1b should be second (insertAfter A1a)');
    assert.strictEqual(doc.sections[2].id, 'A2', 'A2 should be third (original position)');
  });

  it('handles insertAfter: positions new section after anchor', function () {
    const sections = [
      { id: 'A', category: 'ACTION', heading: 'First', depth: 2, content: 'x' },
      { id: 'B', category: 'ACTION', heading: 'Second', depth: 2, content: 'y' },
      { id: 'C', category: 'ACTION', heading: 'Third', depth: 2, content: 'z' },
    ];
    const delta = {
      revisedSections: [],
      newSections: [
        {
          id: 'D',
          category: 'ACTION',
          heading: 'Inserted',
          depth: 2,
          content: 'new',
          insertAfter: 'A',
        },
      ],
      removedSections: [],
    };

    const doc = reconstructDocument([makeIter1(sections), makeDelta(delta)]);

    assert.strictEqual(doc.sections.length, 4);
    assert.strictEqual(doc.sections[0].id, 'A');
    assert.strictEqual(doc.sections[1].id, 'D', 'D should be inserted after A');
    assert.strictEqual(doc.sections[2].id, 'B');
    assert.strictEqual(doc.sections[3].id, 'C');
  });

  it('handles replaces without explicit removedSections (implicit removal)', function () {
    const sections = [
      { id: 'A1', category: 'ACTION', heading: 'Original', depth: 2, content: 'old' },
      { id: 'A2', category: 'ACTION', heading: 'Keep', depth: 2, content: 'stays' },
    ];
    const delta = {
      revisedSections: [],
      newSections: [
        {
          id: 'A1-new',
          category: 'ACTION',
          heading: 'Replacement',
          depth: 2,
          content: 'new',
          replaces: 'A1',
        },
      ],
      removedSections: [],
    };

    const doc = reconstructDocument([makeIter1(sections), makeDelta(delta)]);

    assert.strictEqual(doc.sections.length, 2);
    assert.ok(!doc.sections.find((s) => s.id === 'A1'), 'A1 should be implicitly removed');
    assert.strictEqual(doc.sections[0].id, 'A1-new', 'Replacement should be at A1 position');
    assert.strictEqual(doc.sections[1].id, 'A2');
  });

  it('applies multiple deltas in order', function () {
    const sections = [{ id: 'A1', category: 'ACTION', heading: 'Step 1', depth: 2, content: 'v1' }];
    const delta1 = {
      revisedSections: [
        { id: 'A1', category: 'ACTION', heading: 'Step 1', depth: 2, content: 'v2' },
      ],
      newSections: [],
      removedSections: [],
    };
    const delta2 = {
      revisedSections: [
        { id: 'A1', category: 'ACTION', heading: 'Step 1 Final', depth: 2, content: 'v3' },
      ],
      newSections: [],
      removedSections: [],
    };

    const doc = reconstructDocument([makeIter1(sections), makeDelta(delta1), makeDelta(delta2)]);

    assert.strictEqual(doc.sections[0].content, 'v3');
    assert.strictEqual(doc.sections[0].heading, 'Step 1 Final');
  });

  it('throws on empty messages array', function () {
    assert.throws(() => reconstructDocument([]), /No DRAFT_READY messages/);
  });

  it('throws on missing .document in first message', function () {
    assert.throws(() => reconstructDocument([{ delta: {} }]), /must contain .document/);
  });

  it('handles delta message without delta field (no-op)', function () {
    const sections = [
      { id: 'A1', category: 'ACTION', heading: 'Step 1', depth: 2, content: 'Original' },
    ];
    const doc = reconstructDocument([makeIter1(sections), {}]);
    assert.strictEqual(doc.sections.length, 1);
    assert.strictEqual(doc.sections[0].content, 'Original');
  });
});

describe('renumberSections', function () {
  it('numbers flat H2 sections sequentially', function () {
    const sections = [
      { id: 'I1', heading: 'Intro', depth: 2, content: 'x' },
      { id: 'A1', heading: 'Step 1', depth: 2, content: 'x' },
      { id: 'A2', heading: 'Step 2', depth: 2, content: 'x' },
    ];
    const result = renumberSections(sections);

    assert.strictEqual(result[0].displayNumber, '1');
    assert.strictEqual(result[1].displayNumber, '2');
    assert.strictEqual(result[2].displayNumber, '3');
  });

  it('numbers nested sections with dot notation', function () {
    const sections = [
      { id: 'A1', heading: 'Phase 1', depth: 2, content: 'x' },
      { id: 'A1a', heading: 'Sub-step 1', depth: 3, content: 'x' },
      { id: 'A1b', heading: 'Sub-step 2', depth: 3, content: 'x' },
      { id: 'A2', heading: 'Phase 2', depth: 2, content: 'x' },
    ];
    const result = renumberSections(sections);

    assert.strictEqual(result[0].displayNumber, '1');
    assert.strictEqual(result[1].displayNumber, '1.1');
    assert.strictEqual(result[2].displayNumber, '1.2');
    assert.strictEqual(result[3].displayNumber, '2');
  });

  it('handles triple-nested sections', function () {
    const sections = [
      { id: 'A1', heading: 'Phase', depth: 2, content: 'x' },
      { id: 'A1a', heading: 'Step', depth: 3, content: 'x' },
      { id: 'A1a-i', heading: 'Sub-step', depth: 4, content: 'x' },
    ];
    const result = renumberSections(sections);

    assert.strictEqual(result[0].displayNumber, '1');
    assert.strictEqual(result[1].displayNumber, '1.1');
    assert.strictEqual(result[2].displayNumber, '1.1.1');
  });

  it('resets deeper counters when going back up', function () {
    const sections = [
      { id: 'A1', heading: 'Phase 1', depth: 2, content: 'x' },
      { id: 'A1a', heading: 'Sub 1.1', depth: 3, content: 'x' },
      { id: 'A1b', heading: 'Sub 1.2', depth: 3, content: 'x' },
      { id: 'A2', heading: 'Phase 2', depth: 2, content: 'x' },
      { id: 'A2a', heading: 'Sub 2.1', depth: 3, content: 'x' },
    ];
    const result = renumberSections(sections);

    assert.strictEqual(result[3].displayNumber, '2');
    assert.strictEqual(result[4].displayNumber, '2.1');
  });

  it('defaults depth to 2 when missing', function () {
    const sections = [{ id: 'A1', heading: 'No depth', content: 'x' }];
    const result = renumberSections(sections);
    assert.strictEqual(result[0].displayNumber, '1');
  });
});

describe('sectionsToMarkdown', function () {
  it('formats sections with heading levels and numbers', function () {
    const sections = [
      { displayNumber: '1', heading: 'Introduction', depth: 2, content: 'Hello world' },
      { displayNumber: '2', heading: 'Step 1', depth: 2, content: 'Do thing' },
      { displayNumber: '2.1', heading: 'Sub-step', depth: 3, content: 'Detail' },
    ];
    const md = sectionsToMarkdown(sections);

    assert.ok(md.includes('## 1. Introduction'));
    assert.ok(md.includes('## 2. Step 1'));
    assert.ok(md.includes('### 2.1. Sub-step'));
    assert.ok(md.includes('Hello world'));
    assert.ok(md.includes('Detail'));
  });

  it('handles sections without displayNumber', function () {
    const sections = [{ heading: 'No Number', depth: 2, content: 'Content' }];
    const md = sectionsToMarkdown(sections);
    assert.ok(md.includes('## No Number'));
  });
});
