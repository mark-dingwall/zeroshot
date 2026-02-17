#!/usr/bin/env node

/**
 * assemble-doc.js — Deterministic document synthesis.
 *
 * Called via execute_system_command when all validators approve or max iterations reached.
 * Reads all DRAFT_READY + VALIDATION_RESULT messages from the ledger,
 * reconstructs the final document, collects notes, writes markdown to CWD.
 *
 * Output filename: {DOCUMENT_TYPE}_{CLUSTER_ID}.md
 * Environment: CLUSTER_ID, ZEROSHOT_ROOT
 * stdin: JSON of triggering VALIDATION_RESULT message content
 */

const fs = require('fs');
const path = require('path');
const {
  reconstructDocument,
  renumberSections,
  sectionsToMarkdown,
  readStdin,
} = require('./lib/doc-reconstruction');
const { openLedger, queryMessages, deserializeContent } = require('./lib/ledger-helpers');

function collectNotes(validationRows) {
  const notes = [];
  for (const row of validationRows) {
    const content = deserializeContent(row);
    const reviews = content.data.sectionReviews || [];
    for (const review of reviews) {
      if (review.verdict === 'APPROVE_WITH_NOTES' && review.notes) {
        notes.push({
          sectionId: review.id,
          notes: review.notes,
          validator: content.sender,
        });
      }
    }
  }
  return notes;
}

function collectContestedSections(doc, validationRows, lastDraftTimestamp) {
  // Find sections still contested (REVISE/REJECT) in the final round
  const roundResults = validationRows
    .filter((r) => r.timestamp >= lastDraftTimestamp)
    .map(deserializeContent);

  const contested = [];
  for (const result of roundResults) {
    for (const review of result.data.sectionReviews || []) {
      if (review.verdict === 'REVISE' || review.verdict === 'REJECT') {
        const section = doc.sections.find((s) => s.id === review.id);
        if (section) {
          contested.push({
            sectionId: review.id,
            heading: section.heading,
            verdict: review.verdict,
            reason: review.reason,
            validator: result.sender,
          });
        }
      }
    }
  }
  return contested;
}

function buildMarkdown(doc, notes, contested, clusterId, iterationCount, terminationReason) {
  const date = new Date().toISOString().split('T')[0];
  const renumbered = renumberSections(doc.sections);

  const lines = [];

  // Title
  lines.push(`# ${doc.title}`);
  lines.push('');

  // Metadata
  lines.push(
    `**Type:** ${doc.documentType} | **Iterations:** ${iterationCount} | **Termination:** ${terminationReason}`
  );
  lines.push(`**Cluster:** ${clusterId} | **Date:** ${date}`);
  if (doc.perspectivesUsed && doc.perspectivesUsed.length > 0) {
    lines.push(`**Perspectives:** ${doc.perspectivesUsed.join(', ')}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Document body
  lines.push(sectionsToMarkdown(renumbered));

  // Notes section (from APPROVE_WITH_NOTES)
  if (notes.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Reviewer Notes');
    lines.push('');
    lines.push('_Suggestions from validators for human consideration:_');
    lines.push('');
    for (const note of notes) {
      lines.push(`- **${note.sectionId}** (${note.validator}): ${note.notes}`);
    }
    lines.push('');
  }

  // Contested sections (if terminated by max_iterations)
  if (contested.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Contested Sections');
    lines.push('');
    lines.push('_These sections were still flagged when max iterations was reached:_');
    lines.push('');
    lines.push('| Section | Verdict | Validator | Reason |');
    lines.push('|---------|---------|-----------|--------|');
    for (const c of contested) {
      lines.push(`| ${c.sectionId} (${c.heading}) | ${c.verdict} | ${c.validator} | ${c.reason} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const clusterId = process.env.CLUSTER_ID;
  if (!clusterId) {
    throw new Error('CLUSTER_ID not set');
  }

  // Read triggering message from stdin
  const raw = await readStdin();
  if (!raw.trim()) {
    throw new Error('No input received on stdin');
  }

  const db = openLedger(clusterId);

  try {
    // Get all DRAFT_READY messages
    const draftRows = queryMessages(db, clusterId, 'DRAFT_READY', 'drafter');
    if (draftRows.length === 0) {
      throw new Error('No DRAFT_READY messages found');
    }

    const draftContents = draftRows.map(deserializeContent);
    const draftDataMessages = draftContents.map((c) => c.data);
    const iterationCount = draftRows.length;

    // Reconstruct final document
    const doc = reconstructDocument(draftDataMessages);

    // Get all VALIDATION_RESULTs
    const validationRows = queryMessages(db, clusterId, 'VALIDATION_RESULT');

    // Collect APPROVE_WITH_NOTES across all iterations
    const notes = collectNotes(validationRows);

    // Check termination reason
    const lastDraftTimestamp = draftContents[draftContents.length - 1].timestamp;
    const roundResults = validationRows
      .filter((r) => r.timestamp >= lastDraftTimestamp)
      .map(deserializeContent);

    const allApproved =
      roundResults.length > 0 &&
      roundResults.every((r) => {
        const approved = r.data.approved;
        return approved === true || approved === 'true';
      });

    const terminationReason = allApproved ? 'ALL_APPROVED' : 'MAX_ITERATIONS';

    // Collect contested sections if MAX_ITERATIONS
    const contested =
      terminationReason === 'MAX_ITERATIONS'
        ? collectContestedSections(doc, validationRows, lastDraftTimestamp)
        : [];

    // Build markdown
    const markdown = buildMarkdown(
      doc,
      notes,
      contested,
      clusterId,
      iterationCount,
      terminationReason
    );

    // Write file
    const docType = (doc.documentType || 'DOCUMENT').toUpperCase();
    const filename = `${docType}_${clusterId}.md`;
    const filepath = path.join(process.cwd(), filename);

    fs.writeFileSync(filepath, markdown, 'utf-8');
    console.log(`Document written: ${filepath}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`assemble-doc.js failed: ${err.message}`);
  process.exit(1);
});
