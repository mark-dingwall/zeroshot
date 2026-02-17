# Local Customisations (on top of upstream v5.4)

These are our additions to zeroshot. Kept separate from README.md and CLAUDE.md to minimise merge pain when new releases land.

## Multi-Agent Workflows

Three multi-agent systems sharing a common architecture: **design reviews** (trace/vector/axiom) examine requirements and design artifacts, **code reviews** (bell/book/candle) examine diffs and PRs, and **document generation** (facet/lens/prism) produces structured documents from briefs.

### Architecture (shared)

Design and code reviews follow the same five-stage pipeline. Document generation uses a six-stage variant with key differences (see below).

1. **Router** — pass-through (fixed tier) or conductor classification
2. **Analysts** — perspective-specific subagents spawned in parallel via Task tool
3. **Validators** — adversarial challenge/defend iterations with analysts
4. **Synthesiser** — compiles confirmed/contested/withdrawn findings into final report
5. **Report writer** — `execute_system_command` writes markdown to CWD (`REPORT_TITLE` env var overrides heading)

Fixed-tier routers use hardcoded boolean params to activate conditional perspectives. Auto-classifying conductors derive the tier from the input.

### Design Reviews (trace / vector / axiom)

| Tier   | Config          | Analysts                 | Validators | Max Iters | Analyst Level | Max Tokens | Use Case         |
| ------ | --------------- | ------------------------ | ---------- | --------- | ------------- | ---------- | ---------------- |
| Trace  | `review-trace`  | 2 core                   | 1          | 3         | level2        | 100k       | Quick scan       |
| Vector | `review-vector` | 3-4 (core + conditional) | 2-3        | 4         | level2        | 150k       | Standard review  |
| Axiom  | `review-axiom`  | 5-8 (all perspectives)   | 2-3        | 5         | level3        | 150k       | Maximum scrutiny |

Boolean flags (`has_test_content`, `is_chain`, `is_sensitive`) activate conditional perspectives. Content-aware activation requires `review-conductor`.

```bash
# Fixed tier
zeroshot run "Review these requirements" --config review-trace
zeroshot run requirements.md --config review-vector
zeroshot run "Review auth design + AC + tests" --config review-axiom

# Auto-classify tier (conductor picks trace/vector/axiom)
zeroshot run "Review this" --config review-conductor
```

Or via the `zs` shell alias (defined in `~/.bash_aliases`):

```bash
zs trace "Review these requirements"
zs vector requirements.md
zs axiom "Review auth design + AC + tests"
```

#### Files

| File                                                    | Purpose                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `cluster-templates/review-trace.json`                   | Fixed trace-tier router config                                           |
| `cluster-templates/review-vector.json`                  | Fixed vector-tier router config                                          |
| `cluster-templates/review-axiom.json`                   | Fixed axiom-tier router config                                           |
| `cluster-templates/review-conductor.json`               | Auto-classifying conductor config                                        |
| `cluster-templates/base-templates/review-workflow.json` | Parameterised base template (analysts, synthesiser, validator, reporter) |
| `scripts/write-review-report.js`                        | Formats SYNTHESIS_COMPLETE data as markdown report                       |

### Code Reviews (bell / book / candle)

The conductor classifies on two dimensions — **ChangeScope** x **RiskDomain** — to pick a tier:

| ChangeScope   | RiskDomain | Tier   |
| ------------- | ---------- | ------ |
| PATCH         | GENERAL    | Bell   |
| PATCH         | SENSITIVE  | Book   |
| MODULE        | GENERAL    | Book   |
| MODULE        | SENSITIVE  | Candle |
| CROSS_CUTTING | any        | Candle |

| Tier   | Config               | Perspectives           | Validators | Max Iters | Analyst Level | Max Tokens | Use Case         |
| ------ | -------------------- | ---------------------- | ---------- | --------- | ------------- | ---------- | ---------------- |
| Bell   | `code-review-bell`   | 2 core + mandatory     | 1          | 3         | level2        | 100k       | Quick scan       |
| Book   | `code-review-book`   | core + all conditional | 2          | 4         | level2        | 150k       | Standard review  |
| Candle | `code-review-candle` | all (core + extended)  | 2          | 5         | level3        | 150k       | Maximum scrutiny |

**Perspectives:**

- **Core (all tiers):** Correctness Analyst, Error Handling Auditor
- **Conditional (activated by boolean flags):** Security Reviewer (`has_security_surface`), Test Coverage Analyst (`has_test_changes`), API/Interface Reviewer (`has_api_changes`)
- **Extended (candle only):** Performance Analyst, Architectural Coherence, Regression Risk Analyst

**Validators** — two complementary roles (book/candle get both, bell gets evidence only):

- **validator-evidence** — Fact-checker. Reads actual source via CLI tools to verify claims about code are factually correct.
- **validator-rigor** — Reasoning quality. Evaluates severity calibration, logical soundness, and whether the argument holds. Assumes quoted code is accurate.

Iteration is monotonic: no new findings after iteration 1. Rejected findings go back to the analyst for refinement or withdrawal.

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

| Tier  | Config      | Perspectives | Validators | Max Iters | Drafter Level | Max Tokens | Use Case                |
| ----- | ----------- | ------------ | ---------- | --------- | ------------- | ---------- | ----------------------- |
| Facet | `doc-facet` | 2-3          | 1          | 3         | level2        | 100k       | Light doc generation    |
| Lens  | `doc-lens`  | 3-5          | 2          | 4         | level2        | 150k       | Standard doc generation |
| Prism | `doc-prism` | 5-8          | 3          | 5         | level3        | 150k       | Deep doc generation     |

All three configs are fixed-tier (no auto-classifying conductor yet).

```bash
# Fixed tier
zeroshot run "Draft a migration checklist" --config doc-facet
zeroshot run "Write a deployment guide" --config doc-lens
zeroshot run "Produce a full API specification" --config doc-prism
```

#### Six-Stage Pipeline

1. **Router** — pass-through that loads the `doc-draft-workflow` base template with tier-specific params. Guards against `_republished` to prevent infinite loops. Republishes ISSUE_OPENED text to trigger the drafter.
2. **Drafter** — reads the brief, selects perspectives from a domain-specific menu, spawns ALL perspective subagents in parallel via Task tool. On iteration 1 returns the full `document`; on iteration 2+ returns a `delta` (revised/new/removed sections).
3. **Validators** — per-section verdicts: ACCEPT, APPROVE_WITH_NOTES, REVISE, REJECT. Suggestion types: DEEPEN, SIMPLIFY, SPLIT, MERGE, CORRECT, RESTRUCTURE.
4. **Revision preparer** — orchestrator that runs `build-revision-context.js` via `execute_system_command`. Builds trimmed REVISION_CONTEXT (document overview + flagged sections + original brief) and publishes it via `contentFromOutput`.
5. **Completion detector** — orchestrator that fires when all validators approve OR `max_iterations` reached. Runs `assemble-doc.js` to produce the final markdown file.
6. **Assembly** — `assemble-doc.js` reconstructs the document from all DRAFT*READY messages (base + deltas), renumbers sections hierarchically, collects APPROVE_WITH_NOTES as a "Reviewer Notes" appendix, and adds a "Contested Sections" table if terminated by max iterations. Output: `{DOCUMENT_TYPE}*{CLUSTER_ID}.md`.

#### Key Differences from Review Workflows

- **Non-monotonic revision** — unlike code review (no new findings after iteration 1), doc drafting allows free structural changes: ADD, SPLIT, MERGE, REMOVE, RESTRUCTURE.
- **Mediated feedback loop** — validators do not directly re-trigger the drafter. Instead: VALIDATION_RESULT → `revision-preparer` (runs script) → REVISION_CONTEXT → drafter. The script pre-processes feedback into a trimmed context.
- **Perspective menu** — the drafter selects from domain-specific perspectives based on document type (checklists, guides, specifications) rather than using fixed analyst roles.
- **Dual output schema** — full `document` on iteration 1, `delta` on iteration 2+ (only changed sections).

#### Validators

- **validator-completeness** (always active) — verifies every requirement in the brief has corresponding sections. Uses Claude CLI.
- **validator-accuracy** (when `validator_count >= 2`) — fact-checks technical claims using CLI tools (Glob, Grep, Read, Bash). Uses Claude CLI.
- **validator-coherence** (when `validator_count >= 3`) — evaluates logical flow, redundancy, terminology consistency. Uses direct API.
- **validator-actionability** (when `has_action_items == true && validator_count >= 2`) — verifies ACTION sections are atomic, clear, and executable. Auto-accepts non-action sections. Uses direct API.

All validators use a `transform` hook (not static `config`) to dynamically compute `approved` from `sectionReviews`. All have `onError` hooks that auto-reject with `validatorError: true`.

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
    "base": "review-workflow",
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

Both `worker-validator` and `full-workflow` templates accept `quality_gate` (boolean, default: `true`). Disable with `{ "params": { "quality_gate": false } }`.

| File                                                     | Purpose                                              |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `scripts/quality-gate-runner.js`                         | Reads `.zeroshot-quality`, runs command, JSON output |
| `scripts/zeroshot-init.sh`                               | One-time setup, generates `.zeroshot-quality`        |
| `cluster-templates/base-templates/worker-validator.json` | quality-gate agent + dual validator triggers         |
| `cluster-templates/base-templates/full-workflow.json`    | Same for STANDARD/CRITICAL templates                 |
| `src/agent/agent-lifecycle.js`                           | `onSuccess`/`onFailure` in execute_system_command    |
| `src/config-validator.js`                                | Validates onSuccess/onFailure topic fields           |
| `tests/quality-gate.test.js`                             | 17 tests covering all paths                          |

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
