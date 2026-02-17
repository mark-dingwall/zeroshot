#!/usr/bin/env node

/**
 * build-revision-context.js — Builds trimmed REVISION_CONTEXT for the drafter.
 *
 * Called via execute_system_command when all validators responded and at least
 * one gave REVISE/REJECT. Reads message.content from stdin (triggering
 * VALIDATION_RESULT), queries ledger for full context, outputs REVISION_CONTEXT.
 *
 * Environment: CLUSTER_ID, ZEROSHOT_ROOT
 * stdin: JSON of triggering VALIDATION_RESULT message content
 * stdout: JSON of REVISION_CONTEXT content (published via onSuccess.contentFromOutput)
 */

const { reconstructDocument, readStdin } = require('./lib/doc-reconstruction');
const { openLedger, queryMessages, deserializeContent } = require('./lib/ledger-helpers');

async function main() {
  const clusterId = process.env.CLUSTER_ID;
  if (!clusterId) {
    throw new Error('CLUSTER_ID not set');
  }

  // Read triggering message from stdin (not used directly, but validates we have input)
  const raw = await readStdin();
  if (!raw.trim()) {
    throw new Error('No input received on stdin');
  }

  const db = openLedger(clusterId);

  try {
    // Get all DRAFT_READY messages to reconstruct current document state
    const draftRows = queryMessages(db, clusterId, 'DRAFT_READY', 'drafter');
    if (draftRows.length === 0) {
      throw new Error('No DRAFT_READY messages found');
    }

    const draftContents = draftRows.map(deserializeContent);
    const draftDataMessages = draftContents.map((c) => c.data);

    // Reconstruct current document state
    const doc = reconstructDocument(draftDataMessages);

    // Get the latest round of VALIDATION_RESULTs (since last DRAFT_READY)
    const lastDraftTimestamp = draftContents[draftContents.length - 1].timestamp;
    const allValidationRows = queryMessages(db, clusterId, 'VALIDATION_RESULT');
    const roundResults = allValidationRows
      .filter((r) => r.timestamp >= lastDraftTimestamp)
      .map(deserializeContent);

    // Collect all section reviews from all validators this round
    const sectionVerdicts = new Map(); // sectionId → { verdicts, suggestions, reasons }
    for (const result of roundResults) {
      const reviews = result.data.sectionReviews || [];
      for (const review of reviews) {
        if (!review.id) continue;
        if (!sectionVerdicts.has(review.id)) {
          sectionVerdicts.set(review.id, { verdicts: [], suggestions: [], reasons: [] });
        }
        const entry = sectionVerdicts.get(review.id);
        entry.verdicts.push(review.verdict);
        if (review.suggestions) entry.suggestions.push(...review.suggestions);
        if (review.reason) entry.reasons.push(review.reason);
      }
    }

    // Build document overview (all sections with their aggregate verdict)
    const documentOverview = doc.sections.map((section) => {
      const verdictInfo = sectionVerdicts.get(section.id);
      let verdict = 'ACCEPT';
      if (verdictInfo) {
        if (verdictInfo.verdicts.includes('REJECT')) verdict = 'REJECT';
        else if (verdictInfo.verdicts.includes('REVISE')) verdict = 'REVISE';
        else if (verdictInfo.verdicts.includes('APPROVE_WITH_NOTES'))
          verdict = 'APPROVE_WITH_NOTES';
      }
      return { id: section.id, heading: section.heading, verdict };
    });

    // Build revisions needed (full content of flagged sections + feedback)
    const revisionsNeeded = [];
    for (const section of doc.sections) {
      const verdictInfo = sectionVerdicts.get(section.id);
      if (!verdictInfo) continue;
      if (!verdictInfo.verdicts.includes('REVISE') && !verdictInfo.verdicts.includes('REJECT'))
        continue;

      const verdict = verdictInfo.verdicts.includes('REJECT') ? 'REJECT' : 'REVISE';
      const dedupedSuggestions = [...new Set(verdictInfo.suggestions)];

      revisionsNeeded.push({
        id: section.id,
        heading: section.heading,
        content: section.content,
        verdict,
        suggestions: dedupedSuggestions,
        reason: verdictInfo.reasons.join(' | '),
      });
    }

    // Also include MISSING_* entries from validators (sections they want added)
    for (const [id, verdictInfo] of sectionVerdicts) {
      if (!id.startsWith('MISSING_')) continue;
      revisionsNeeded.push({
        id,
        heading: id.replace('MISSING_', ''),
        content: '',
        verdict: 'REJECT',
        suggestions:
          verdictInfo.suggestions.length > 0 ? [...new Set(verdictInfo.suggestions)] : ['DEEPEN'],
        reason: verdictInfo.reasons.join(' | '),
      });
    }

    // Get original brief
    const issueRows = queryMessages(db, clusterId, 'ISSUE_OPENED');
    const originalBrief = issueRows.length > 0 ? issueRows[0].content_text || '' : '';

    const revisionContext = {
      text: `Revision context: ${revisionsNeeded.length} sections need work`,
      data: {
        documentOverview,
        revisionsNeeded,
        originalBrief,
      },
    };

    process.stdout.write(JSON.stringify(revisionContext));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`build-revision-context.js failed: ${err.message}`);
  process.exit(1);
});
