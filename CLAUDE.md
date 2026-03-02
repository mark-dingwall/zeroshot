# Zeroshot: Multi-Agent Coordination Engine

Message-passing primitives for multi-agent workflows. **Install:** `npm i -g @covibes/zeroshot` or `npm link` (dev).

## CRITICAL RULES

| Rule                               | Why                          | Forbidden                                    | Required                                         |
| ---------------------------------- | ---------------------------- | -------------------------------------------- | ------------------------------------------------ |
| **GENERAL PURPOSE ONLY**           | Zeroshot runs on ANY repo    | Hardcoded paths, scripts, languages, domains | Discover from target repo's CLAUDE.md/README     |
| **Never spawn without permission** | Consumes API credits         | "I'll run zeroshot on 123"                   | User says "run zeroshot"                         |
| **Never use git in validators**    | Git state unreliable         | `git diff`, `git status` in prompts          | Validate files directly                          |
| **Never ask questions**            | Agents run non-interactively | `AskUserQuestion`, waiting for confirmation  | Make autonomous decisions                        |
| **Never edit CLAUDE.md**           | Context file for Claude Code | Editing this file                            | Read-only unless explicitly asked to update docs |

### 🔴 GENERAL PURPOSE REQUIREMENT (CRITICAL)

**Zeroshot is a GENERAL-PURPOSE multi-agent orchestrator. It MUST work on ANY repository, ANY programming language, ANY domain.**

**FORBIDDEN in templates/prompts:**

- Hardcoded script names (`check-all.sh`, `validate.sh`)
- Hardcoded test commands (`npm test`, `pytest`, `cargo test`)
- Hardcoded file paths (`server/`, `src/`, `tests/`)
- Hardcoded context file names (`CLAUDE.md` - other providers use different files)
- Language-specific assumptions (TypeScript, Python, Rust)
- Domain-specific assumptions (web, CLI, mobile)
- Provider-specific assumptions (Claude, Codex, Gemini)
- Covibes-specific patterns

**REQUIRED:**

- Discover validation commands from target repo's context files (README, Makefile, package.json, pyproject.toml, Cargo.toml, etc.)
- Discover test runners from target repo's build system
- Use generic examples in prompts (e.g., "the repo's validation script" NOT "./scripts/check-all.sh")
- Use generic terms for context files ("repo context files" NOT "CLAUDE.md")
- Work correctly on: Python projects, Rust crates, Go modules, Ruby gems, Java/Kotlin, C/C++, etc.
- Work correctly with: Claude, Codex, Gemini, OpenAI, and any future providers

**Worker git operations:** Allowed with isolation (`--worktree`, `--docker`, `--pr`, `--ship`). Forbidden without isolation (auto-injected restriction).

**Read-only safe:** `zeroshot list`, `zeroshot status`, `zeroshot logs`

**Destructive (needs permission):** `zeroshot kill`, `zeroshot clear`, `zeroshot purge`

**Detached runs:** Always forward `zeroshot run` options via `ZEROSHOT_RUN_OPTIONS` (see `buildDaemonEnv` + `buildStartOptions`) so PR/worktree config survives daemon mode.

## 🔴 BEHAVIORAL STANDARDS

```
WHEN USER POSTS LOGS → THERE IS A BUG. INVESTIGATE.
WHEN TESTS FAIL → Test is source of truth unless PROVEN otherwise.
FAIL FAST. Silent failures are worst. Errors > Warnings. Don't swallow errors.
KEEP IT SIMPLE: don't overengineer, read existing code before writing new, build what was asked — not what you think should be built.
VALIDATION_RESULT is law: workers must address every validator complaint before claiming completion.
```

## Where to Look

| Concept                  | File                                |
| ------------------------ | ----------------------------------- |
| Conductor classification | `src/conductor-bootstrap.js`        |
| Base templates           | `cluster-templates/base-templates/` |
| Message bus              | `src/message-bus.js`                |
| Ledger (SQLite)          | `src/ledger.js`                     |
| Trigger evaluation       | `src/logic-engine.js`               |
| Agent wrapper            | `src/agent-wrapper.js`              |
| Providers registry       | `src/providers/index.js`            |
| Provider implementations | `src/providers/`                    |
| Provider detection       | `lib/provider-detection.js`         |
| Provider capabilities    | `src/providers/capabilities.js`     |
| Rust TUI (Ratatui)       | `tui-rs/crates/zeroshot-tui/`       |
| Docker mounts/env        | `lib/docker-config.js`              |
| Container lifecycle      | `src/isolation-manager.js`          |
| Issue providers          | `src/issue-providers/`              |
| Git remote detection     | `lib/git-remote-utils.js`           |
| Input helpers            | `src/input-helpers.js`              |
| Settings                 | `lib/settings.js`                   |

## CLI Quick Reference

```bash
# Flag cascade: --ship → --pr → --worktree
zeroshot run 123                  # Local, no isolation
zeroshot run 123 --worktree       # Git worktree isolation
zeroshot run 123 --pr             # Worktree + create PR
zeroshot run 123 --pr --pr-base dev # PR base: dev, worktree base: origin/dev (incl. -d)
zeroshot run 123 --ship           # Worktree + PR + auto-merge
zeroshot run 123 --docker         # Docker container isolation
zeroshot run 123 -d               # Background (daemon) mode

# Management
zeroshot list                     # All clusters (--json)
zeroshot status <id>              # Cluster details
zeroshot logs <id> [-f]           # Stream logs
zeroshot resume <id> [prompt]     # Resume failed cluster
zeroshot stop <id>                # Graceful stop
zeroshot kill <id>                # Force kill

# Utilities
zeroshot                          # Rust TUI (TTY only)
zeroshot tui                      # Rust TUI explicit entry
zeroshot watch                    # Rust TUI Monitor view
zeroshot export <id>              # Export conversation
zeroshot agents list              # Available agents
zeroshot settings                 # View/modify settings
zeroshot providers                # Provider status and defaults
```

**UX modes:**

- Foreground (`zeroshot run`): Streams logs, Ctrl+C **stops** cluster
- Daemon (`-d`): Background, Ctrl+C detaches
- Attach (`zeroshot attach`): Connect to daemon, Ctrl+C **detaches** only

**Settings:** `defaultProvider`, `providerSettings` (claude/codex/gemini), legacy `maxModel`, `defaultConfig`, `logLevel`

**Git Auto-Detection:** Bare numbers (e.g., `123`) automatically detect provider from git remote URL.

Priority order for bare numbers:

1. Force flags (`--github`, `--gitlab`, `--devops`) - Explicit CLI override
2. Git remote detection - Automatic from `git remote get-url origin`
3. Settings (`defaultIssueSource`) - Global user preference
4. Legacy fallback - GitHub (only when no git context and no settings)

## Architecture

**Pub/sub message bus + SQLite ledger.** Agents subscribe to topics, execute on trigger match, publish results.

```
Agent A → publish() → SQLite Ledger → LogicEngine → trigger match → Agent B executes
```

### Core Primitives

| Primitive    | Purpose                                                     |
| ------------ | ----------------------------------------------------------- |
| Topic        | Named message channel (`ISSUE_OPENED`, `VALIDATION_RESULT`) |
| Trigger      | Condition to wake agent (`{ topic, action, logic }`)        |
| Logic Script | JS predicate for complex conditions                         |
| Hook         | Post-task action (publish message, execute command)         |

### Agent Configuration (Minimal)

```json
{
  "id": "worker",
  "role": "implementation",
  "modelLevel": "level2",
  "triggers": [{ "topic": "ISSUE_OPENED", "action": "execute_task" }],
  "prompt": "Implement the requested feature...",
  "hooks": {
    "onComplete": {
      "action": "publish_message",
      "config": { "topic": "IMPLEMENTATION_READY" }
    }
  }
}
```

### Provider Model Levels

- Use `modelLevel` (`level1`/`level2`/`level3`) for provider-agnostic configs.
- Set `provider` per agent or `defaultProvider`/`forceProvider` at cluster level.
- Provider names: `claude`, `codex`, `gemini`, `opencode` (legacy `anthropic`/`openai`/`google` map to these).
- `model` remains a provider-specific escape hatch.
- Codex/Opencode only: `reasoningEffort` (`low`/`medium`/`high`/`xhigh`).

### Logic Script API

```javascript
// Ledger (auto-scoped to cluster)
ledger.query({ topic, sender, since, limit });
ledger.findLast({ topic });
ledger.count({ topic });

// Cluster
cluster.getAgents();
cluster.getAgentsByRole('validator');

// Helpers
helpers.allResponded(agents, topic, since);
helpers.hasConsensus(topic, since);
```

### Context Strategy `since` Values

Acceptable: `cluster_start`, `last_task_end`, `last_agent_start`, or an ISO timestamp string.
`last_agent_start` scopes history to the most recent iteration start for the executing agent.

## Conductor: 2D Classification

Classifies tasks on **Complexity × TaskType**, routes to parameterized templates.

| Complexity | Description            | Validators |
| ---------- | ---------------------- | ---------- |
| TRIVIAL    | 1 file, mechanical     | 0          |
| SIMPLE     | 1 concern              | 1          |
| STANDARD   | Multi-file             | 3          |
| CRITICAL   | Auth/payments/security | 5          |

| TaskType | Action                |
| -------- | --------------------- |
| INQUIRY  | Read-only exploration |
| TASK     | Implement new feature |
| DEBUG    | Fix broken code       |

**Base templates:** `single-worker`, `worker-validator`, `debug-workflow`, `full-workflow`

## Isolation Modes

| Mode     | Flag         | Use When                                           |
| -------- | ------------ | -------------------------------------------------- |
| Worktree | `--worktree` | Quick isolated work, PR workflows                  |
| Docker   | `--docker`   | Full isolation, risky experiments, parallel agents |

**Worktree:** Lightweight git branch isolation (<1s setup).

**Docker:** Fresh git clone in container, credentials mounted, auto-cleanup.

## Docker Mount Configuration

Configurable credential mounts for `--docker` mode. See `lib/docker-config.js`.

| Setting                | Type                    | Default              | Description                                           |
| ---------------------- | ----------------------- | -------------------- | ----------------------------------------------------- |
| `dockerMounts`         | `Array<string\|object>` | `['gh','git','ssh']` | Presets or `{host, container, readonly}`              |
| `dockerEnvPassthrough` | `string[]`              | `[]`                 | Extra env vars (supports `VAR`, `VAR_*`, `VAR=value`) |
| `dockerContainerHome`  | `string`                | `/root`              | Container home for `$HOME` expansion                  |

**Mount presets:** `gh`, `git`, `ssh`, `aws`, `azure`, `kube`, `terraform`, `gcloud`, `claude`, `codex`, `gemini`, `opencode`

Provider CLIs in Docker require credential mounts; Zeroshot warns when missing.

**Env var syntax:** `VAR` (pass if set) · `VAR_*` (wildcard match) · `VAR=value` (always set) · `VAR=` (set empty)

**Config priority:** CLI flags > `ZEROSHOT_DOCKER_MOUNTS` env > settings > defaults

```bash
zeroshot settings set dockerMounts '["gh","git","ssh","aws"]'  # Persistent
zeroshot run 123 --docker --mount ~/.custom:/root/.custom:ro   # Per-run
zeroshot run 123 --docker --no-mounts                          # Disable all
```

## Anti-Patterns (Zeroshot-Specific)

### 1. Running Zeroshot Without Permission

❌ `zeroshot run 123` without user consent · ✅ Ask first, wait for "run zeroshot"
**WHY:** Multi-agent runs consume significant API credits.

### 2. Git Commands in Validator Prompts

❌ `"Run git diff to verify..."` · ✅ `"Read src/index.js and verify function exists..."`
**WHY:** Multiple agents modify git state concurrently. Validators read stale state.

### 3. Asking Questions in Autonomous Workflows

❌ `await AskUserQuestion(...)` · ✅ Make autonomous decision with reasoning
**WHY:** Zeroshot agents run non-interactively. Blocking = stuck forever.

### 4. Worker Git Operations Without Isolation

❌ `zeroshot run 123` (pollutes main) · ✅ `--worktree`, `--pr`, `--docker`
**WHY:** Prevents contamination, enables parallel work.

### 5. Using Git Stash

❌ `git stash` (hides work) · ✅ `git add -A && git commit -m "WIP: ..."`
**WHY:** WIP commits are visible to other agents, never lost, squashable.

### 6. Hardcoding in Templates

Parameterize from `cluster.config.complexity`, never hardcode in templates.

## Git Workflow

**Merge queue enforces CI on rebased code before merge.**

```
feature-branch → pre-push hook (~5s) → push → gh pr create --base main
→ CI on PR → gh pr merge --auto --squash → merge queue rebases + CI → merge
```

**Pre-push hook blocks:** Direct pushes to `main`. Must use PR workflow.

```bash
git switch -c feat/my-feature
# ... make changes ...
git push -u origin feat/my-feature
gh pr create --base main
gh pr merge --auto --squash
```

**Git Safety (multi-agent):** Use WIP commits instead of stashing. Use `git switch` instead of `git checkout`. Use `git restore` instead of `git checkout --`.

## Development Process

- **Test-First:** Write tests WITH code. Pre-commit hook validates test file exists.
- **Validation:** Run `npm run lint && npm run test` for >50-line changes. Trust pre-commit for trivial.
- **CI Diagnosis:** Diagnose each failing job independently. Fix one, push, rerun, repeat. Do NOT assume single root cause.
- **Release Pipeline:** Dev requires `check` only (merge queue). Main requires `check` + `install-matrix`. Cross-platform `install-matrix` runs in CI for main only.

## Enforcement Philosophy

**ENFORCE > DOCUMENT. If enforceable, don't document.**

| Preference | Method                         |
| ---------- | ------------------------------ |
| Best       | Type system (compile-time)     |
| Good       | ESLint rule (build-time)       |
| Okay       | Pre-commit hook, runtime guard |
| Worst      | Documentation                  |

**The error message IS the documentation.** Write error messages with what + fix.

## Persistence + Known Limitations

| File                        | Content               |
| --------------------------- | --------------------- |
| `~/.zeroshot/clusters.json` | Cluster metadata      |
| `~/.zeroshot/<id>.db`       | SQLite message ledger |

Clusters survive crashes. Resume: `zeroshot resume <id>`

**Bash subprocess output not streamed:** Claude CLI returns `tool_result` after subprocess completes.

**Kubernetes/SQLite:** Network filesystems (EFS/NFS/CephFS) cause latency and lock contention. Set `ZEROSHOT_SQLITE_JOURNAL_MODE=DELETE` for non-WAL-friendly FS. Don't run multiple pods against the same `~/.zeroshot` volume.

## Fixed Bugs (Reference)

**Template Agent CWD Injection (2026-01-03):** `--ship` worktree created but template agents ran in main dir. Fix: cwd injection in `_opAddAgents()` + resume path. Test: `tests/worktree-cwd-injection.test.js`

**PR Mode Completion Hang (2026-01-15):** PR-mode clusters hung after PR creation — no `CLUSTER_COMPLETE` published. Fix: `onComplete` hook in `src/agents/git-pusher-agent.json`. Test: `tests/integration/orchestrator-flow.test.js`

## CLAUDE.md Writing Rules

- **Scope:** Narrowest possible. Module-specific → nested CLAUDE.md. Cross-cutting → root.
- **Priority:** Critical gotchas > routing tables > anti-patterns with WHY > commands/troubleshooting
- **Delete:** Tutorial content, directory trees, interface definitions, parent duplicates
- **Format:** Tables over prose. `ALWAYS`/`NEVER`/`CRITICAL` for rules. ❌/✅ examples with WHY.

## Multi-Agent Constraints

| Pattern                   | Why                                                   |
| ------------------------- | ----------------------------------------------------- |
| No global mutable state   | Agents run in parallel. Globals = race conditions.    |
| Never block on user input | Agents are non-interactive. Blocking = stuck forever. |

## TODO

- Investigate standardising the conductor classification pattern (2D matrix → boolean flags → conditional agent activation) across doc-gen, code-review, and docs-review systems, or document why per-system variations are intentional.
