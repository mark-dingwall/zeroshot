# Status Check Race Condition — Investigation Notes

## Incident: 2026-04-14

Clusters `hyper-ocean-46` and `stormy-desert-27` (Candle tier code review) — synthesizer crashed 3x with "Task failed with no output". All CLI tasks completed successfully (exit_code=0).

## Deferred Fixes (pending diagnostic data)

### Grace period before first status check

**File:** `src/agent/agent-task-executor.js` — `createLogFollower`

Delay first status check by N ms after `followClaudeTaskLogs` starts. The data shows failures at exactly ~1900ms (= 1000ms interval + ~400ms exec + 500ms setTimeout), meaning the very first status check triggers premature resolution.

**Considerations:**

- 3000ms should suffice (1900ms is the failure window, 3s gives margin)
- 5000ms (plan's original suggestion) adds unnecessary latency for genuine early failures
- Adds up to N ms latency for fast-completing tasks (TRIVIAL tier)
- Tasks that genuinely fail at startup (bad model, auth error) take longer to detect

**Implementation:**

```javascript
// Current: status check starts immediately
state.statusCheckInterval = setInterval(() => { ... }, 1000);

// Fix: delay first status check
setTimeout(() => {
  state.statusCheckInterval = setInterval(() => { ... }, 1000);
}, GRACE_PERIOD_MS);
```

### Minimum runtime guard

**File:** `src/agent/agent-task-executor.js` — `handleStatusCompletion`

Track task start time. Don't resolve as failed if the task has been running less than a threshold (e.g., 10s). Log warning and continue polling.

**Considerations:**

- Only apply to `isStale` status, NOT `isFailed` — genuine immediate failures shouldn't be delayed
- Need to track `state.startTime = Date.now()` in `createLogFollowState`
- Defense-in-depth — if the grace period above is implemented, this may be redundant

## Timing Evidence

PROCESS_SPAWNED → failure deltas (all 10 failed attempts):

| Cluster          | Agent                    | Delta  |
| ---------------- | ------------------------ | ------ |
| hyper-ocean-46   | validator-evidence att 1 | 1859ms |
| hyper-ocean-46   | validator-rigor att 1    | 1905ms |
| hyper-ocean-46   | synthesizer att 1        | 1900ms |
| hyper-ocean-46   | synthesizer att 2        | 1946ms |
| hyper-ocean-46   | synthesizer att 3        | 1933ms |
| stormy-desert-27 | validator-evidence att 1 | 1911ms |
| stormy-desert-27 | validator-rigor att 1    | 1918ms |
| stormy-desert-27 | synthesizer att 1        | 1898ms |
| stormy-desert-27 | synthesizer att 2        | 2013ms |
| stormy-desert-27 | synthesizer att 3        | 1917ms |

All orphan tasks: status=completed, exit_code=0, runtimes 1-5 minutes.

## Open Questions

1. **What does the first status check actually return?** The diagnostic logging fix (being implemented now) will answer this. Possible answers: "stale (process died)", exec error, or something unexpected.

2. **Why do validators recover on attempt 2 but synthesizer doesn't?** Validators have 7-13s total retry delay (backoff + jitter), synthesizer has 2-5s (no jitter). Whatever condition causes the first status check to fail may resolve within 7-13s but not 2-5s.

3. **Is `isProcessRunning(pid)` returning false for a running process?** All PIDs were valid, processes ran for minutes. No obvious reason for `process.kill(pid, 0)` to fail. WSL2-specific behavior? SQLite WAL visibility race? Unknown.
