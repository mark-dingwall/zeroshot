# Local Customisations (on top of upstream v5.4)

These are our additions to zeroshot. Kept separate from README.md and CLAUDE.md to minimise merge pain when new releases land.

## Multi-Agent Workflows

Three multi-agent systems sharing a common architecture: **design reviews** (trace/vector/axiom) examine requirements and design artifacts, **code reviews** (bell/book/candle) examine diffs and PRs, and **document generation** (facet/lens/prism) produces structured documents from briefs.

### Architecture (shared)

All three systems follow a common pipeline: router → analysts (parallel subagents via Task tool) → adversarial validators → synthesiser → report writer (`execute_system_command` writes markdown to CWD, `REPORT_TITLE` env var overrides heading). Document generation adds a revision-preparer stage (see below).

Fixed-tier routers use hardcoded boolean params to activate conditional perspectives. Auto-classifying conductors derive the tier from the input.

### Design Reviews (trace / vector / axiom)

| Tier   | Config               | Analysts                 | Validators | Max Iters | Analyst Level | Max Tokens |
| ------ | -------------------- | ------------------------ | ---------- | --------- | ------------- | ---------- |
| Trace  | `docs-review-trace`  | 2 core                   | 1          | 3         | level2        | 100k       |
| Vector | `docs-review-vector` | 3-4 (core + conditional) | 2-3        | 4         | level2        | 150k       |
| Axiom  | `docs-review-axiom`  | 5-8 (all perspectives)   | 2-3        | 5         | level3        | 150k       |

Boolean flags (`has_test_content`, `is_chain`, `is_sensitive`) activate conditional perspectives. Content-aware activation requires `docs-review-conductor`.

```bash
# Fixed tier
zeroshot run "Review these requirements" --config docs-review-trace
zeroshot run requirements.md --config docs-review-vector
zeroshot run "Review auth design + AC + tests" --config docs-review-axiom

# Auto-classify tier (conductor picks trace/vector/axiom)
zeroshot run "Review this" --config docs-review-conductor
```

Or via the `zs` shell alias (defined in `~/.bash_aliases`):

```bash
zs trace "Review these requirements"
zs vector requirements.md
zs axiom "Review auth design + AC + tests"
```

#### Files

| File                                                         | Purpose                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `cluster-templates/docs-review-trace.json`                   | Fixed trace-tier router config                                           |
| `cluster-templates/docs-review-vector.json`                  | Fixed vector-tier router config                                          |
| `cluster-templates/docs-review-axiom.json`                   | Fixed axiom-tier router config                                           |
| `cluster-templates/docs-review-conductor.json`               | Auto-classifying conductor config                                        |
| `cluster-templates/base-templates/docs-review-workflow.json` | Parameterised base template (analysts, synthesiser, validator, reporter) |
| `scripts/write-review-report.js`                             | Formats SYNTHESIS_COMPLETE data as markdown report                       |

### Code Reviews (bell / book / candle)

The conductor classifies on **ChangeScope** x **RiskDomain** to pick a tier:

| ChangeScope   | RiskDomain | Tier   |
| ------------- | ---------- | ------ |
| PATCH         | GENERAL    | Bell   |
| PATCH         | SENSITIVE  | Book   |
| MODULE        | GENERAL    | Book   |
| MODULE        | SENSITIVE  | Candle |
| CROSS_CUTTING | any        | Candle |

| Tier   | Config               | Perspectives           | Validators | Max Iters | Analyst Level | Max Tokens |
| ------ | -------------------- | ---------------------- | ---------- | --------- | ------------- | ---------- |
| Bell   | `code-review-bell`   | 2 core + mandatory     | 1          | 3         | level2        | 100k       |
| Book   | `code-review-book`   | core + all conditional | 2          | 4         | level2        | 150k       |
| Candle | `code-review-candle` | all (core + extended)  | 2          | 5         | level3        | 150k       |

**Perspectives:** Core (all tiers): Correctness Analyst, Error Handling Auditor. Conditional: Security Reviewer (`has_security_surface`), Test Coverage Analyst (`has_test_changes`), API/Interface Reviewer (`has_api_changes`). Extended (candle only): Performance, Architectural Coherence, Regression Risk.

**Validators:** validator-evidence (fact-checker, CLI tools) + validator-rigor (reasoning quality, direct API). Bell gets evidence only; book/candle get both. Iteration is monotonic: no new findings after iteration 1.

```bash
# Fixed tier
zeroshot run "review my changes" --config code-review-bell
zeroshot run "review PR #42" --config code-review-book
zeroshot run "review auth module changes" --config code-review-candle

# Auto-classify tier (conductor picks bell/book/candle)
zeroshot run "review my changes" --config code-review-conductor
```

#### Files

| File                                                         | Purpose                                         |
| ------------------------------------------------------------ | ----------------------------------------------- |
| `cluster-templates/code-review-bell.json`                    | Fixed bell-tier router config                   |
| `cluster-templates/code-review-book.json`                    | Fixed book-tier router config                   |
| `cluster-templates/code-review-candle.json`                  | Fixed candle-tier router config                 |
| `cluster-templates/code-review-conductor.json`               | Auto-classifying conductor (ChangeScope x Risk) |
| `cluster-templates/base-templates/code-review-workflow.json` | Parameterised base template                     |

### Document Generation (facet / lens / prism)

Multi-perspective document drafting with iterative validator feedback. Generates checklists, guides, specifications, and plans.

| Tier  | Config      | Perspectives | Validators | Max Iters | Drafter Level | Max Tokens |
| ----- | ----------- | ------------ | ---------- | --------- | ------------- | ---------- |
| Facet | `doc-facet` | 2-3          | 1          | 3         | level2        | 100k       |
| Lens  | `doc-lens`  | 3-5          | 2          | 4         | level2        | 150k       |
| Prism | `doc-prism` | 5-8          | 3          | 5         | level3        | 150k       |

All three configs are fixed-tier (no auto-classifying conductor yet).

```bash
zeroshot run "Draft a migration checklist" --config doc-facet
zeroshot run "Write a deployment guide" --config doc-lens
zeroshot run "Produce a full API specification" --config doc-prism
```

#### Six-Stage Pipeline

Extends the shared pipeline with a revision-preparer stage between validators and the drafter:

1. **Router** — loads `doc-draft-workflow` base template with tier-specific params. Guards against `_republished` to prevent infinite loops.
2. **Drafter** — spawns ALL perspective subagents in parallel. Returns full `document` on iteration 1, `delta` (revised/new/removed sections) on iteration 2+.
3. **Validators** — per-section verdicts (ACCEPT, APPROVE_WITH_NOTES, REVISE, REJECT) with suggestion types (DEEPEN, SIMPLIFY, SPLIT, MERGE, CORRECT, RESTRUCTURE).
4. **Revision preparer** — orchestrator running `build-revision-context.js` via `execute_system_command`. Publishes trimmed REVISION_CONTEXT via `contentFromOutput`.
5. **Completion detector** — fires when all validators approve OR `max_iterations` reached. Runs `assemble-doc.js`.
6. **Assembly** — reconstructs document from all DRAFT*READY messages, renumbers sections, collects APPROVE_WITH_NOTES as appendix. Output: `{DOCUMENT_TYPE}*{CLUSTER_ID}.md`.

**Key differences from review workflows:** Non-monotonic revision (free structural changes). Mediated feedback loop (VALIDATION_RESULT → script → REVISION_CONTEXT → drafter). Domain-specific perspective menu. Dual output schema (full document vs delta).

#### Validators

- **validator-completeness** (always) — brief coverage check. Claude CLI.
- **validator-accuracy** (`validator_count >= 2`) — fact-checks technical claims. Claude CLI.
- **validator-coherence** (`validator_count >= 3`) — logical flow, redundancy, terminology. Direct API.
- **validator-actionability** (`has_action_items == true && validator_count >= 2`) — ACTION sections are atomic and executable. Direct API.

All use `transform` hooks to compute `approved` from `sectionReviews`. All auto-reject on error (`validatorError: true`).

#### Files

| File                                                       | Purpose                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `cluster-templates/doc-facet.json`                         | Fixed facet-tier router config                               |
| `cluster-templates/doc-lens.json`                          | Fixed lens-tier router config                                |
| `cluster-templates/doc-prism.json`                         | Fixed prism-tier router config                               |
| `cluster-templates/base-templates/doc-draft-workflow.json` | Parameterised base template (drafter, 4 validators, 2 orch.) |
| `scripts/assemble-doc.js`                                  | Final markdown assembly from ledger                          |
| `scripts/build-revision-context.js`                        | Builds trimmed REVISION_CONTEXT for the drafter              |
| `scripts/lib/doc-reconstruction.js`                        | Shared: `reconstructDocument()`, `renumberSections()`, etc.  |
| `scripts/lib/ledger-helpers.js`                            | Shared: `openLedger()`, `queryMessages()`, etc.              |

## Platform Additions

General-purpose features added to the upstream engine to support the review workflows (and reusable by any cluster template).

### Parameterised Templates

`TemplateResolver` substitutes `{{param}}` placeholders in base templates. Configs reference a base + params:

```json
{
  "action": "load_config",
  "config": {
    "base": "docs-review-workflow",
    "params": {
      "tier": "vector",
      "analyst_level": "level2",
      "validator_count": 2,
      "max_iterations": 4
    }
  }
}
```

Conditional agents use a `"condition"` field — included only if the param evaluates truthy. Unresolved `{{param}}` placeholders fail hard. Pure placeholder values (e.g., `"{{max_tokens}}"`) preserve the original JS type — numbers stay numbers, booleans stay booleans.

Implementation: `src/template-resolver.js`

### `execute_system_command` Trigger

Runs a shell command when a trigger fires. Message content is piped to stdin as JSON. Environment includes `CLUSTER_ID` and `ZEROSHOT_ROOT`.

```json
{
  "triggers": [
    {
      "topic": "SYNTHESIS_COMPLETE",
      "action": "execute_system_command",
      "config": {
        "command": "node $ZEROSHOT_ROOT/scripts/write-review-report.js",
        "stopClusterAfter": true,
        "timeout": 15000,
        "onSuccess": { "topic": "QUALITY_GATE_PASSED" },
        "onFailure": { "topic": "QUALITY_GATE_FAILED" }
      }
    }
  ]
}
```

When `onSuccess`/`onFailure` are set, the outcome routes to those custom topics instead of the defaults (`CLUSTER_FAILED` on error, idle on success). Agent state is set to `idle` (not `failed`) when `onFailure` is configured, allowing re-trigger loops. Output is truncated to 5 000 chars. Without routing fields, `stopClusterAfter: true` stops the cluster on completion.

**`contentFromOutput`** — when `onSuccess.contentFromOutput: true`, the script's stdout is parsed as JSON and used directly as the published message content (instead of the default `"System command passed"` wrapper). Falls back to wrapping unparseable output. This enables scripts to construct arbitrary message content — used by `build-revision-context.js` to produce the REVISION_CONTEXT message.

```json
{
  "onSuccess": {
    "topic": "REVISION_CONTEXT",
    "contentFromOutput": true
  }
}
```

Implementation: `src/agent/agent-lifecycle.js:316`

### Subagent Tracking

Live display of Claude Code subagents (spawned via Task tool) in the StatusFooter.

```
│ ● analyst [executing]  cpu 45%  mem 312M                                │
│    ├─ ● Search codebase for auth patterns                               │
│    └─ ● Analyze error handling                                          │
│ ● synthesiser [executing]  cpu 30%  mem 280M                            │
```

1. `buildSpawnEnv()` sets `ZEROSHOT_TRACK_SUBAGENTS=1` and `ZEROSHOT_SUBAGENT_EVENTS_FILE=<path>` for every agent
2. A Claude hook writes JSONL start/stop events when the Task tool is invoked
3. `SubagentTracker` polls JSONL files every 1s, reads only new bytes (offset tracking)
4. `StatusFooter` renders active subagents as tree-prefixed rows under their parent agent

| File                               | Purpose                                        |
| ---------------------------------- | ---------------------------------------------- |
| `src/subagent-tracker.js`          | JSONL event reader with offset-based polling   |
| `src/status-footer.js`             | Renders subagent tree rows (lines ~750-770)    |
| `src/agent/agent-task-executor.js` | Sets env vars in `buildSpawnEnv()` (line ~679) |
| `src/orchestrator.js`              | Cleans up temp files on stop/kill              |

### Quality Gate

Zero-cost automated checks (lint, typecheck, tests) inserted between worker completion and validator start. Catches basic failures before spending API credits on validators.

```
Worker done → IMPLEMENTATION_READY → quality-gate agent (execute_system_command)
  ├─ pass (or no .zeroshot-quality file) → QUALITY_GATE_PASSED → Validators trigger
  └─ fail → QUALITY_GATE_FAILED (stdout/stderr) → Worker re-triggers, fixes, loops
```

When `quality_gate=false` (or the quality-gate agent is absent), validators trigger directly on `IMPLEMENTATION_READY` — existing behaviour preserved.

**`.zeroshot-quality` convention** — a one-liner in the project root containing the quality check command:

```
npm run lint && npm run typecheck && npm test
```

If missing: auto-pass with warning. Generated once per project via `scripts/zeroshot-init.sh`.

```bash
# AI-assisted (uses claude/codex/gemini CLI to analyse the project)
scripts/zeroshot-init.sh /path/to/repo

# Manual
echo 'npm run lint && npm test' > .zeroshot-quality
```

The init script falls back to heuristic detection (package.json scripts, Cargo.toml, go.mod, pyproject.toml, etc.) when no AI CLI is available. Multi-ecosystem projects (e.g. Laravel + Vite, Tauri) detect both backends.

Templates with quality gate support: `worker-validator`, `full-workflow`, and `code-review-workflow`. All accept `quality_gate` (boolean, default: `true`). Disable with `{ "params": { "quality_gate": false } }`.

**Code review variant:** In code-review workflows, the quality gate runs _before_ analysis (triggers on `ISSUE_OPENED`, not `IMPLEMENTATION_READY`). If it fails, a `quality-gate-stopper` agent fires `exit 1` without `onFailure`, which publishes `CLUSTER_FAILED` and aborts the review — no LLM tokens spent on analysis.

```
ISSUE_OPENED → quality-gate agent (execute_system_command)
  ├─ pass → QUALITY_GATE_PASSED → Analyst triggers
  └─ fail → QUALITY_GATE_FAILED → quality-gate-stopper → CLUSTER_FAILED (review aborted)
```

The analyst's `ISSUE_OPENED` trigger has a logic gate: `cluster.getAgents().find(a => a.role === 'quality-gate'); return !qg;` — fires directly when no quality-gate agent exists (i.e., `quality_gate: false`).

| File                                                         | Purpose                                              |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `scripts/quality-gate-runner.js`                             | Reads `.zeroshot-quality`, runs command, JSON output |
| `scripts/zeroshot-init.sh`                                   | One-time setup, generates `.zeroshot-quality`        |
| `cluster-templates/base-templates/worker-validator.json`     | quality-gate agent + dual validator triggers         |
| `cluster-templates/base-templates/full-workflow.json`        | Same for STANDARD/CRITICAL templates                 |
| `cluster-templates/base-templates/code-review-workflow.json` | quality-gate + stopper agents, analyst gating        |
| `src/agent/agent-lifecycle.js`                               | `onSuccess`/`onFailure` in execute_system_command    |
| `src/config-validator.js`                                    | Validates onSuccess/onFailure topic fields           |
| `tests/quality-gate.test.js`                                 | 17 tests covering all paths                          |
| `tests/quality-gate-code-review.test.js`                     | 9 tests for code-review quality gate integration     |

### CLI Param Overrides (`--skip-quality-gate`)

CLI flags can override template params at runtime via `paramOverrides`. Overrides are stored on the cluster object and merged into template params in `_opLoadConfig()` — they win over conductor-provided params.

```bash
# Skip quality gate for code reviews
zeroshot run "review my changes" --config code-review-bell --skip-quality-gate

# Quality gate runs by default (no flag needed)
zeroshot run "review my changes" --config code-review-bell
```

The mechanism is generic: `buildStartOptions()` maps CLI flags to `{ param: value }` pairs, which are spread over conductor params before `resolver.resolve()`. Future `--skip-*` flags can piggyback without new plumbing.

| File                            | Purpose                                          |
| ------------------------------- | ------------------------------------------------ |
| `cli/index.js`                  | `--skip-quality-gate` option, `paramOverrides`   |
| `src/orchestrator.js`           | Threads overrides through start → \_opLoadConfig |
| `tests/param-overrides.test.js` | 4 tests for override mechanism                   |

### Model Auto-Upgrade

Models below the configured `minLevel`/`minModel` floor are silently upgraded instead of crashing. Previously a model below the floor would throw — now it logs a warning and bumps to the minimum.

Implementation: `src/agent-wrapper.js`, `src/providers/base-provider.js`, `lib/settings.js`

### Config Validator: `execute_system_command` Awareness

The config validator now understands the `execute_system_command` action type properly, preventing false warnings on templates that use orchestrator agents.

- **`onSuccess` topic registration** — topics from `trigger.config.onSuccess` are registered as produced topics, fixing false "never produced" errors for templates with `execute_system_command` agents.
- **`hooks.onComplete` action-type awareness** — warns when `onComplete` is defined on an agent that only uses `execute_system_command` triggers (the hook would never fire; use `trigger.config.onSuccess` instead).
- **Mediated feedback loop recognition** — recognises orchestrator-mediated validation loops (validator → VALIDATION_RESULT → orchestrator script → custom topic → worker) instead of falsely warning that the worker doesn't trigger on VALIDATION_RESULT.
- **Transform script scanning** — scans `hooks.onComplete.transform.script` (not just `logic.script`) for dynamic topic production patterns.
- **Crash fixes** — guards against triggers without `topic` field (`t.topic?.includes(...)`) and fixes `agentExecutesTask()` to correctly treat triggers without an explicit `action` as `execute_task`.

Implementation: `src/config-validator.js`

## Bug Fixes (on top of upstream)

### CLI result envelope rejection (`extractDirectJson`)

When a model bypasses `--json-schema` and returns plain text, the Claude CLI wraps it in a `{type:"result"}` envelope. Without a guard, `extractDirectJson` mistook the envelope itself for structured agent output — causing downstream agents to receive CLI metadata instead of agent findings.

**Fix:** Reject any parsed object with `type === 'result'` in `extractDirectJson`.

Implementation: `src/agent/output-extraction.js:174`

## Known Issues

- **#1B** — `context-pack-builder.js` coerces numeric values to strings (upstream, untouched)
- **#11** — Max iterations CLUSTER_FAILED race: `handleMaxIterations` stop() could kill synthesis on same tick. Works in practice but needs deeper investigation.
- **#14** — `_evaluateCondition` uses raw `params` instead of `paramsWithDefaults` (`template-resolver.js:56`)
