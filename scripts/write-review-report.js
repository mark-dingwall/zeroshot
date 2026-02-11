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
    '# Design Review Report\n',
    `**Assessment:** ${assessment} | **Iterations:** ${iterations} | **Termination:** ${termination}`,
    `**Cluster:** ${clusterId} | **Date:** ${date}\n`,
  ];

  if (summary) {
    sections.push(`## Executive Summary\n\n${summary}\n`);
  }

  sections.push(formatFindings(finalReport.confirmedFindings, 'Confirmed Findings'));
  sections.push(formatFindings(finalReport.contestedFindings, 'Contested Findings'));
  sections.push(formatWithdrawn(finalReport.withdrawnFindings));
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
  const filename = `${assessment}_${clusterId}.md`;
  const filepath = path.join(process.cwd(), filename);

  fs.writeFileSync(filepath, markdown, 'utf-8');
  console.log(`Report written: ${filepath}`);
}

main().catch((err) => {
  console.error(`write-review-report.js failed: ${err.message}`);
  process.exit(1);
});
