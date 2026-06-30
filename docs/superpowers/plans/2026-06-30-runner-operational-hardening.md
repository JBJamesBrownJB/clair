# Runner Operational Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. `- [ ]` steps.

**Goal:** Make live runs **diagnosable and non-cascading**: a failed Windows teardown must never corrupt
a run's git state, delete its evidence, or break the next run. Plus surface the fix-loop's cost and
recalibrate budgets now that cached tokens are counted.

**Why:** Three live runs in a row were left un-diagnosable because teardown (`git worktree remove --force`)
fails on Windows file locks, leaving half-removed worktrees whose `.git` link then resolves to the parent
repo (corruption), AND teardown deletes the run branches — destroying the only inspectable record. With a
fixed runId, the leftovers also collide with the next run.

**Tech Stack:** Node/TS · git worktrees · the existing runner.

## Global Constraints
- **Preserve evidence:** teardown must NOT delete the run's branches; they are the post-hoc record.
- **No cascade:** a failed teardown must not break a later run (unique runId per run decouples them).
- **No corruption:** never leave a worktree in a half-removed state that resolves git to the parent repo.
- **Mechanical + pr-queue both** benefit; don't special-case.

---

## Task 1: Unique runId + evidence-preserving teardown

**Files:** `benchmark/runner/run.ts`, `benchmark/runner/workspace.ts`, tests `__tests__/run.test.ts`,
`__tests__/workspace.test.ts`.

**Unique runId:** in `run.ts`, before provisioning, derive an **effective runId** =
`${run.id}__${timestamp}` (timestamp = `new Date().toISOString().replace(/[:.]/g,"-")`; Date is fine — this
is the normal-Node runner, not a workflow script) and set `run.id = effectiveRunId` so EVERY stage
(provision branches `run/<id>/Sx`, the integration branch, the results file) uses the unique id. Two runs
never share a branch/worktree/results name. (The logical config id is still visible as the prefix.)

**Evidence-preserving, non-corrupting teardown** (`workspace.ts teardown`):
- **Remove the DELETE-BRANCH step entirely.** Teardown removes worktrees only; branches survive for
  inspection. (Unique runIds mean they don't collide; a separate prune/GC can clean old ones later.)
- Worktree removal: `git worktree remove --force <dir>`; on failure (Windows lock / not-empty), do NOT
  leave a half-state — instead `git worktree remove --force` is retried once after a short delay, and if it
  still fails, leave the worktree **registered and intact** (do not delete the dir out from under git) and
  log a clear warning naming the dir. Always finish with `git worktree prune` (safe — only prunes entries
  whose dir is truly gone). Never `rm -rf` a worktree dir whose `.git` link is still registered.
- Keep teardown idempotent and best-effort (never throws).

**Tests:**
- run.ts: provisioned branch/integration names include the effective (timestamped) runId; two invocations
  with the same config produce different effective runIds (inject the timestamp or assert the prefix +
  uniqueness). Stage fakes still asserted.
- workspace.ts: teardown does NOT delete branches (after teardown, the run branch still resolves);
  teardown on a locked/undeletable worktree does not throw and does not corrupt (leaves it registered);
  the existing real-git tests now use a **unique throwaway runId** per test (kills the known flakiness).

## Task 2: Surface the fix-loop cost in the report

**Files:** `benchmark/runner/report.ts`, test `__tests__/report.test.ts`.

`PrQueueResult.integrationCost` (the fix-loop tokens/turns/wallMs) and each PR's `fixCost`/`rounds` are
currently NOT in the report JSON. Add to the `prQueue` report block: `integrationCost` and, per PR, its
`reason`/`fixCost`/`rounds`/`tampered`. Summary: when not all-merged, show each blocked PR's fix spend
(e.g. `S1: blocked (ci-fail) — fix spent 1.2M tok / 40 turns`). So a reader can see whether the fix agents
actually worked (nonzero spend) or barely ran.

**Tests:** a `prQueue` with a blocked PR carrying a fixCost → JSON includes `integrationCost` + the PR's
fixCost; summary shows the per-PR fix spend. Mechanical run unchanged.

## Task 3: Recalibrate budget caps (config)

**Files:** `benchmark/runs/standard-L1-prqueue.run.yaml`, `benchmark/runs/standard-L1.run.yaml` (+ the L2/L3
configs' per-agent `budget` if they share the stale value).

Cached tokens are now counted, so a real build agent spends ~1.7–3M (the old `1.5M` cap flagged every agent
`did-not-complete`). Raise the build-agent `budget` to a realistic ceiling (e.g. `max_tokens_per_agent:
6000000`, keep `max_turns_per_agent: 120` — turns are the real bound). Leave a comment that these were
recalibrated from the first cache-inclusive live run (build agents observed at 1.7–3M tokens / 37–68 turns).
The pr-queue `queue_budget` (4M/400) is per-fix-agent; keep it but add a comment that with N blocked PRs the
total can be ~N×. Verify both dry-runs still print correctly.

---

## What this unlocks
After this, a live run leaves: the run branches intact (inspectable), worktrees at unique paths (no
collisions, no corruption even if a removal failed), the fix-loop's real cost in the report, and budgets
that don't spuriously flag completion. Then the next live `pr-queue` run gives a result I can actually
open up and certify — real finding vs CI-environment artifact.

## Risks / notes
- Old leftover worktrees/branches from prior runs still exist; a one-time manual cleanup (or a small
  `prune-runs` helper) clears them. Out of scope here; note it.
- Keeping branches grows refs over time; fine for now (manual GC). Revisit if it becomes noise.
