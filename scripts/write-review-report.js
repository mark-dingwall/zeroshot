#!/usr/bin/env node

/**
 * write-review-report.js — Formats SYNTHESIS_COMPLETE data as a markdown report.
 *
 * Called via execute_system_command trigger action.
 * Reads message.content JSON from stdin, writes markdown to CWD.
 *
 * Output filename: {ASSESSMENT}_{CLUSTER_ID}.md
 * Environment: CLUSTER_ID (set by execute_system_command action)
 */

const fs = require('fs');
const path = require('path');

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

function formatFindings(findings, label) {
  if (!findings || findings.length === 0) {
    return `## ${label} (0)\n\n_None_\n`;
  }

  const lines = [`## ${label} (${findings.length})\n`];

  for (const f of findings) {
    const id = f.id || '?';
    const severity = f.severity ? ` [${f.severity}]` : '';
    const description = f.description || 'No description';
    lines.push(`### ${id}${severity} — ${description}\n`);

    if (f.category) lines.push(`- **Category:** ${f.category}`);
    if (f.location) lines.push(`- **Location:** ${f.location}`);
    if (f.evidence) lines.push(`- **Evidence:** "${f.evidence}"`);
    if (f.impact) lines.push(`- **Impact:** ${f.impact}`);
    if (f.suggestedFix) lines.push(`- **Suggested Fix:** ${f.suggestedFix}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatWithdrawn(findings) {
  if (!findings || findings.length === 0) {
    return '## Withdrawn Findings (0)\n\n_None_\n';
  }

  const lines = [`## Withdrawn Findings (${findings.length})\n`];
  lines.push('| ID | Description |');
  lines.push('|----|-------------|');
  for (const f of findings) {
    const id = f.id || '?';
    const desc = f.description || f.reason || 'Withdrawn';
    lines.push(`| ${id} | ${desc} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatStatistics(stats) {
  if (!stats) return '';

  const lines = ['## Statistics\n'];
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');

  if (stats.bySeverity) {
    for (const [severity, count] of Object.entries(stats.bySeverity)) {
      lines.push(`| ${severity} | ${count} |`);
    }
  }

  if (stats.byCategory) {
    lines.push('');
    for (const [category, count] of Object.entries(stats.byCategory)) {
      lines.push(`| ${category} | ${count} |`);
    }
  }

  if (stats.totalFindings !== undefined) {
    lines.push(`| Total Findings | ${stats.totalFindings} |`);
  }

  lines.push('');
  return lines.join('\n');
}

function formatValidatorNotes(notes) {
  if (!notes || notes.length === 0) return '';
  const lines = ['## Validator Notes\n'];
  lines.push('_Observations from validators for human consideration:_\n');
  for (const note of notes) {
    const finding = note.findingId || '?';
    const validator = note.validator || 'unknown';
    lines.push(`- **${finding}** (${validator}): ${note.notes}`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatSeverityAdjustments(adjustments) {
  if (!adjustments || adjustments.length === 0) return '';
  const lines = ['## Severity Adjustments\n'];
  lines.push('_Findings where validators adjusted the severity:_\n');
  lines.push('| Finding | Original | Adjusted | Validator | Reason |');
  lines.push('|---------|----------|----------|-----------|--------|');
  for (const adj of adjustments) {
    const id = adj.findingId || '?';
    const orig = adj.originalSeverity || '?';
    const adjusted = adj.adjustedSeverity || '?';
    const validator = adj.validator || '?';
    const reason = adj.reason || '';
    lines.push(`| ${id} | ${orig} | ${adjusted} | ${validator} | ${reason} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildReport(content) {
  const data = content.data || {};
  const finalReport =
    typeof data.finalReport === 'string' ? JSON.parse(data.finalReport) : data.finalReport || {};

  const VALID_ASSESSMENTS = ['READY', 'NEEDS_WORK', 'SIGNIFICANT_ISSUES', 'NOT_READY'];
  const assessment = VALID_ASSESSMENTS.includes(finalReport.overallAssessment)
    ? finalReport.overallAssessment
    : 'UNKNOWN';
  const iterations = data.totalIterations || '?';
  const termination = data.terminationReason || 'unknown';
  const clusterId = process.env.CLUSTER_ID || 'unknown';
  const date = new Date().toISOString().split('T')[0];

  const summary = finalReport.executiveSummary || content.text || '';

  const sections = [
    (process.env.REPORT_TITLE || '# Design Review Report') + '\n',
    `**Assessment:** ${assessment} | **Iterations:** ${iterations} | **Termination:** ${termination}`,
    `**Cluster:** ${clusterId} | **Date:** ${date}\n`,
  ];

  if (summary) {
    sections.push(`## Executive Summary\n\n${summary}\n`);
  }

  sections.push(formatFindings(finalReport.confirmedFindings, 'Confirmed Findings'));
  sections.push(formatFindings(finalReport.contestedFindings, 'Contested Findings'));
  sections.push(formatWithdrawn(finalReport.withdrawnFindings));

  const notesSection = formatValidatorNotes(finalReport.validatorNotes);
  if (notesSection) sections.push(notesSection);

  const adjustmentsSection = formatSeverityAdjustments(finalReport.severityAdjustments);
  if (adjustmentsSection) sections.push(adjustmentsSection);

  sections.push(formatStatistics(finalReport.statistics));

  return { markdown: sections.join('\n'), assessment, clusterId };
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error('No input received on stdin');
    process.exit(1);
  }

  let content;
  try {
    content = JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse stdin JSON: ${e.message}`);
    process.exit(1);
  }

  const { markdown, assessment, clusterId } = buildReport(content);
  const filepath =
    process.env.ZEROSHOT_OUTPUT_FILE || path.join(process.cwd(), `${assessment}_${clusterId}.md`);

  fs.writeFileSync(filepath, markdown, 'utf-8');
  console.log(`Report written: ${filepath}`);
}

main().catch((err) => {
  console.error(`write-review-report.js failed: ${err.message}`);
  process.exit(1);
});
