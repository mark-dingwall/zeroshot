#!/usr/bin/env node

/**
 * doc-reconstruction.js — Shared helper for doc-draft workflow scripts.
 *
 * Reconstructs a document from DRAFT_READY messages (iter 1 base + deltas).
 * Used by both build-revision-context.js and assemble-doc.js.
 */

/**
 * Reconstruct the current document state from an ordered array of DRAFT_READY messages.
 * First message must contain .document (full doc), subsequent contain .delta.
 *
 * @param {Array<Object>} draftReadyMessages - Ordered DRAFT_READY message content.data objects
 * @returns {{ title: string, documentType: string, sections: Array<Object>, perspectivesUsed: string[] }}
 */
function reconstructDocument(draftReadyMessages) {
  if (!draftReadyMessages || draftReadyMessages.length === 0) {
    throw new Error('No DRAFT_READY messages to reconstruct from');
  }

  const first = draftReadyMessages[0];
  if (!first.document) {
    throw new Error('First DRAFT_READY message must contain .document');
  }

  // Start from iter 1 base
  const doc = {
    title: first.document.title,
    documentType: first.document.documentType,
    perspectivesUsed: [...(first.document.perspectivesUsed || [])],
  };

  // Index sections by ID for mutation
  let sectionsById = new Map();
  for (const section of first.document.sections || []) {
    sectionsById.set(section.id, { ...section });
  }

  // Apply deltas from iter 2+
  for (let i = 1; i < draftReadyMessages.length; i++) {
    const msg = draftReadyMessages[i];
    const delta = msg.delta;
    if (!delta) continue;

    // Snapshot order before changes (for replaces positioning)
    const originalOrder = [...sectionsById.keys()];

    // Process removed sections first
    for (const removed of delta.removedSections || []) {
      const id = typeof removed === 'string' ? removed : removed.id;
      sectionsById.delete(id);
    }

    // Handle implicit removal from replaces in newSections
    for (const newSection of delta.newSections || []) {
      if (newSection.replaces && sectionsById.has(newSection.replaces)) {
        sectionsById.delete(newSection.replaces);
      }
    }

    // Process revised sections (update in-place)
    for (const revised of delta.revisedSections || []) {
      if (!revised.id) continue;
      sectionsById.set(revised.id, { ...revised });
    }

    // Process new sections (added at end initially)
    for (const newSection of delta.newSections || []) {
      if (!newSection.id) continue;
      sectionsById.set(newSection.id, { ...newSection });
    }

    // Reorder based on replaces and insertAfter
    const toReorder = (delta.newSections || []).filter((s) => s && (s.replaces || s.insertAfter));
    if (toReorder.length > 0) {
      const ordered = [...sectionsById.entries()];

      for (const ns of toReorder) {
        if (!ns.id) continue;

        const curIdx = ordered.findIndex(([id]) => id === ns.id);
        if (curIdx === -1) continue;
        const [entry] = ordered.splice(curIdx, 1);

        let inserted = false;

        if (ns.insertAfter) {
          const anchorIdx = ordered.findIndex(([id]) => id === ns.insertAfter);
          if (anchorIdx !== -1) {
            ordered.splice(anchorIdx + 1, 0, entry);
            inserted = true;
          }
        }

        if (!inserted && ns.replaces) {
          // Insert where the replaced section was in original order
          const origIdx = originalOrder.indexOf(ns.replaces);
          if (origIdx !== -1) {
            let insertIdx = ordered.length;
            for (let j = 0; j < ordered.length; j++) {
              const origPos = originalOrder.indexOf(ordered[j][0]);
              if (origPos > origIdx || origPos === -1) {
                insertIdx = j;
                break;
              }
            }
            ordered.splice(insertIdx, 0, entry);
            inserted = true;
          }
        }

        if (!inserted) {
          ordered.push(entry);
        }
      }

      sectionsById = new Map(ordered);
    }
  }

  doc.sections = [...sectionsById.values()];
  return doc;
}

/**
 * Category prefix map for section IDs.
 */
const CATEGORY_PREFIX = {
  INTRODUCTION: 'I',
  CONTEXT: 'C',
  ACTION: 'A',
  REFERENCE: 'R',
  EXAMPLE: 'E',
  WARNING: 'W',
  OTHER: 'O',
};

/**
 * Renumber sections sequentially for clean output.
 * H2 = 1, 2, 3... H3 under H2 = 1.1, 1.2... H4 = 1.1.1, etc.
 * Internal hierarchical IDs (A4a, A4a-i) are replaced with clean numbering.
 *
 * @param {Array<Object>} sections - Sections with .depth (2-6) and .heading
 * @returns {Array<Object>} Sections with .displayNumber added
 */
function renumberSections(sections) {
  const counters = [0, 0, 0, 0, 0]; // depth 2-6
  const result = [];

  for (const section of sections) {
    const depth = section.depth || 2;
    const depthIndex = Math.min(Math.max(depth - 2, 0), 4);

    // Increment counter at this depth
    counters[depthIndex]++;

    // Reset all deeper counters
    for (let i = depthIndex + 1; i < counters.length; i++) {
      counters[i] = 0;
    }

    // Build display number from counters
    const parts = [];
    for (let i = 0; i <= depthIndex; i++) {
      parts.push(counters[i]);
    }
    const displayNumber = parts.join('.');

    result.push({
      ...section,
      displayNumber,
    });
  }

  return result;
}

/**
 * Format sections as markdown with proper heading levels and numbering.
 *
 * @param {Array<Object>} sections - Renumbered sections
 * @returns {string} Markdown string
 */
function sectionsToMarkdown(sections) {
  const lines = [];

  for (const section of sections) {
    const depth = section.depth || 2;
    const hashes = '#'.repeat(depth);
    const number = section.displayNumber || '';
    const heading = number
      ? `${hashes} ${number}. ${section.heading}`
      : `${hashes} ${section.heading}`;

    lines.push(heading);
    lines.push('');
    if (section.content) {
      lines.push(section.content);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Read JSON from stdin.
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

module.exports = {
  reconstructDocument,
  renumberSections,
  sectionsToMarkdown,
  readStdin,
  CATEGORY_PREFIX,
};
