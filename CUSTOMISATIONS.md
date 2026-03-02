# Local Customisations (on top of upstream v5.5)

Kept separate from README.md and CLAUDE.md to minimise merge pain when new releases land.

## Multi-Agent Workflows

Three systems sharing a common pipeline: router → analysts (parallel subagents via Task tool) → adversarial validators → synthesiser → report writer. Fixed-tier routers use hardcoded boolean params; auto-classifying conductors derive the tier from input.

### Tiers

| System             | Tier   | Config               | Analysts           | Validators | Iters | Level | Tokens |
| ------------------ | ------ | -------------------- | ------------------ | ---------- | ----- | ----- | ------ |
| **Design review**  | Trace  | `docs-review-trace`  | 2 core             | 1          | 3     | L2    | 100k   |
|                    | Vector | `docs-review-vector` | 3-4                | 2-3        | 4     | L2    | 150k   |
|                    | Axiom  | `docs-review-axiom`  | 5-8                | 2-3        | 5     | L3    | 150k   |
| **Code review**    | Bell   | `code-review-bell`   | 2 core             | 1          | 3     | L2    | 100k   |
|                    | Book   | `code-review-book`   | core + conditional | 2          | 4     | L2    | 150k   |
|                    | Candle | `code-review-candle` | all                | 2          | 5     | L3    | 150k   |
| **Doc generation** | Facet  | `doc-facet`          | 2-3                | 1          | 3     | L2    | 100k   |
|                    | Lens   | `doc-lens`           | 3-5                | 2          | 4     | L2    | 150k   |
|                    | Prism  | `doc-prism`          | 5-8                | 3          | 5     | L3    | 150k   |

Auto-classifying conductors: `docs-review-conductor`, `code-review-conductor`, `doc-draft-conductor` (DocumentIntent x ContentDomain).

```bash
# Fixed tier (or use zs alias: zs trace, zs vector, zs bell, zs facet, etc.)
zeroshot run "Review these requirements" --config docs-review-trace
zeroshot run "review my changes" --config code-review-bell
zeroshot run "Draft a migration checklist" --config doc-facet

# Auto-classify (or use zs alias: zs docs-review, zs code-review, zs doc-gen)
zeroshot run "Review this" --config docs-review-conductor
zeroshot run "review my changes" --config code-review-conductor
zeroshot run "Generate acceptance criteria for login" --config doc-draft-conductor
```

### Code Review Classification

The conductor classifies on **ChangeScope** x **RiskDomain**: PATCH/GENERAL → Bell, PATCH/SENSITIVE or MODULE/GENERAL → Book, MODULE/SENSITIVE or CROSS_CUTTING → Candle.

**Perspectives:** Core (all tiers): Correctness, Error Handling. Conditional: Security (`has_security_surface`), Tests (`has_test_changes`), API (`has_api_changes`). Extended (candle): Performance, Architecture, Regression Risk.

**Validators:** validator-evidence (fact-checker, CLI tools) + validator-rigor (reasoning quality, direct API). Bell = evidence only; book/candle = both. Monotonic: no new findings after iteration 1.

### Document Generation Pipeline

Supports 9 document types: CHECKLIST, GUIDE, SPECIFICATION, PLAN, QUESTIONNAIRE, REQUIREMENTS, ACCEPTANCE_CRITERIA, TEST_PLAN, OTHER. The `doc-draft-conductor` classifies on DocumentIntent (INFORMATIONAL/ACTIONABLE) x ContentDomain (GENERAL/SENSITIVE) to select tier and set `has_action_items` for actionability validation.

Extends shared pipeline with a revision-preparer stage:

1. **Router** → 2. **Drafter** (all perspectives in parallel; full doc on iter 1, delta on iter 2+) → 3. **Validators** (per-section: ACCEPT/APPROVE_WITH_NOTES/REVISE/REJECT) → 4. **Revision preparer** (`build-revision-context.js` via `execute_system_command`, publishes trimmed REVISION_CONTEXT) → 5. **Completion detector** → 6. **Assembly** (`assemble-doc.js`, reconstructs + renumbers sections, APPROVE_WITH_NOTES appendix)

**Validators:** completeness (always), accuracy (≥2 validators), coherence (≥3), actionability (`has_action_items` + ≥2). All use `transform` hooks to compute `approved` from `sectionReviews`.

### Workflow Files

Base templates: `cluster-templates/base-templates/{docs-review,code-review,doc-draft}-workflow.json`
Tier configs: `cluster-templates/{docs-review,code-review}-{tier}.json`, `cluster-templates/doc-{tier}.json`
Conductors: `cluster-templates/{docs-review,code-review,doc-draft}-conductor.json`
Scripts: `scripts/write-review-report.js`, `scripts/assemble-doc.js`, `scripts/build-revision-context.js`, `scripts/lib/doc-reconstruction.js`, `scripts/lib/ledger-helpers.js`

## Platform Additions

### Parameterised Templates

`TemplateResolver` substitutes `{{param}}` placeholders in base templates. Conditional agents (`"condition"` field) included only if param is truthy. Unresolved placeholders fail hard. Pure placeholder values preserve JS types.

Implementation: `src/template-resolver.js`

### `execute_system_command` Trigger

Runs a shell command on trigger fire. Message content piped to stdin as JSON. Env includes `CLUSTER_ID` and `ZEROSHOT_ROOT`. Options: `stopClusterAfter`, `timeout`, `onSuccess`/`onFailure` topic routing (idle on failure when configured, enabling re-trigger loops). Output truncated to 5000 chars. `contentFromOutput: true` uses script stdout as published message content.

Implementation: `src/agent/agent-lifecycle.js:316`

### Subagent Tracking

Live StatusFooter display of Claude Code subagents (Task tool). `buildSpawnEnv()` sets `ZEROSHOT_TRACK_SUBAGENTS=1` + events file path → Claude hook writes JSONL start/stop events → `SubagentTracker` polls with offset tracking → `StatusFooter` renders tree rows.

Implementation: `src/subagent-tracker.js`, `src/status-footer.js`, `src/agent/agent-task-executor.js:679`

### Quality Gate

Zero-cost checks (lint, typecheck, tests) between worker completion and validator start. Reads `.zeroshot-quality` file from project root. Templates: `worker-validator`, `full-workflow`, `code-review-workflow` (all accept `quality_gate` param, default `true`).

```
Worker done → IMPLEMENTATION_READY → quality-gate → pass → QUALITY_GATE_PASSED → Validators
                                                  → fail → QUALITY_GATE_FAILED → Worker retries
```

**Code review variant:** quality gate runs on `ISSUE_OPENED` (before analysis). Failure aborts the review immediately via `quality-gate-stopper` — no LLM tokens spent.

**Setup:** Auto-detected on first `zeroshot run` (heuristic with LLM fallback, stored in `~/.zeroshot/projects/`). **Skip:** `--skip-quality-gate` CLI flag (generic `paramOverrides` mechanism in `cli/index.js` + `src/orchestrator.js`).

### Other

- **Config Validator** — `execute_system_command` awareness: `onSuccess` topic registration, `onComplete` action-type warnings, mediated feedback loop recognition, transform script scanning, crash fixes for missing `topic` field. (`src/config-validator.js`)

## Bug Fixes (on top of upstream)

| Bug                                              | Root Cause                                                                                       | Fix                                                                                                    | Files                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| **Analyst context overflow** on top-tier reviews | 5-8 subagents spawned in one message exceed 200K context before auto-compaction                  | Batch spawns (max 4/message), `AUTOCOMPACT_PCT_OVERRIDE` by level (90/87/84%), output density guidance | `agent-task-executor.js:700`, base templates |
| **Validator infinite loop** on 0 findings        | `reviews.length > 0 &&` guard → `approved: false` on clean code (`[].every()` is vacuously true) | Removed guard from all 10 transforms across 3 templates. Also: persist `paramOverrides` on resume      | base templates, `orchestrator.js`            |

_Now upstream (v5.5):_ Task ID collision fix, CLI result envelope fix, model auto-upgrade.

## CI & Branch Protection

### Ruleset: `main-protection`

GitHub ruleset on `main`: require PRs (0 approvals), require status checks (`check`, both `install-matrix` jobs), strict up-to-date policy. Auto-merge enabled. Merge queue unavailable (requires GitHub Team plan).

### Audit Exclusion Filter

`.audit-ignore` (gitignored) lists known-unfixable GHSA IDs → pre-push hook syncs to `AUDIT_IGNORE` GitHub Actions secret → CI filters `npm audit --json` output, failing only on new advisories.

**Staleness check:** pre-push blocks if `# Last reviewed:` date is >30 days old. Resolution: run `npm audit --omit=dev`, remove fixed advisories, update date.

| File                         | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `.audit-ignore`              | GHSA exclusion list (gitignored, single source of truth) |
| `.github/workflows/ci.yml`   | Reads `AUDIT_IGNORE` secret, filters audit JSON          |
| `.husky/pre-push` (PART 4/5) | Staleness check + secret sync                            |

## Known Issues

- **#1B** — `context-pack-builder.js` coerces numeric values to strings (upstream, untouched)

_Fixed in fork:_ `_evaluateCondition` now uses `paramsWithDefaults` instead of raw `params` (#14, `template-resolver.js:56`).

_Fixed upstream (v5.5):_ Task ID collision fix, CLI result envelope fix, model auto-upgrade, max iterations CLUSTER_FAILED race (#11 — `handleMaxIterations` now uses correct `<` comparison, `agent-lifecycle.js:464`).
