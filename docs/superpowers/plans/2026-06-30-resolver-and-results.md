# Resolution Agent + Results Store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> task-by-task. Steps use `- [ ]` tracking. Each task's failing-test list is given; TDD it.

**Goal:** Add (1) a **fixed, clair-off integration/resolution agent** that merges the slice branches into
one working whole — resolving git conflicts and fixing failures until the app is green — so we can
measure **resolution cost** (tokens/time/did-it-reach-green); and (2) a **results store** that persists
every run as its own JSON file instead of overwriting one.

**Architecture:** Extend the existing L1 runner (`benchmark/runner/`). After the build agents commit,
a new **resolution phase** takes over integration: it merges the slice branches *leaving conflicts in
the tree*, then launches ONE headless Claude agent (same infra as the build agents, **clair OFF**) in
the integration worktree, told to produce a coherent working app using the **visible** signals
(`pnpm test`, `tsc`, `build`) — it never sees the held-out gate. We capture its cost. Then the existing
hidden gate judges the resolved result. A run-config flag selects `mechanical` (today's behaviour) vs
`resolver`.

**Tech Stack:** Node 24 · TypeScript (tsx) · git worktrees · pnpm · `claude -p` headless (reusing
`agent.ts`).

## Global Constraints

- **The resolver is FIXED and clair-OFF, identical across arms.** clair acts at *build* time; if it also
  helped the resolver, we couldn't separate "helped avoid the mess" from "helped clean it up." Holding
  the resolver constant is what makes `resolutionCost(A) − resolutionCost(B)` a clean attribution of
  clair's value. The resolver dispatch must never enable the clair plugin.
- **The resolver never sees the held-out gate.** During resolution the integration worktree contains
  only the app + its *visible* tests. `gate/` is checked out only afterwards, in `runGate`. The resolver
  drives toward green using `pnpm test` / `tsc` / `pnpm build` and its own judgment — never the gate.
- **Budget-capped = a real outcome.** A resolver that can't reach green within its token/turn cap is
  `didNotResolve: true` (counted), not retried.
- **Reuse, don't duplicate:** the headless-claude launch + usage capture already exists in `agent.ts`
  (`runAgent`/`runClaude`, Windows-safe spawn, JSON-usage parse). The resolver reuses it.
- **Determinism where possible:** resolver agent is stochastic → its cost is a distribution (report
  per-run, average across K). Same pinning as the build agents (model, temperature).

---

## File-structure impact

- **New:** `benchmark/runner/resolve.ts` — the resolution phase (merge-leaving-conflicts + resolver agent).
- **New:** `benchmark/results/` — persisted run reports (`<runId>__<timestamp>.json`), one per run.
- **Modify:** `benchmark/runner/merge.ts` — add a "leave conflicts in tree" mode (don't `--abort`), for the
  resolver to act on. Mechanical mode unchanged.
- **Modify:** `benchmark/runner/report.ts` — add `resolution` metrics block; write to `results/` (kept) in
  addition to `out/` (latest).
- **Modify:** `benchmark/runner/run.ts` — pipeline gains the resolution phase, gated by `integration.mode`.
- **Modify:** `benchmark/runs/*.run.yaml` — add `integration: { mode, resolver_budget }`.

---

## Task 1: Results store — one JSON per run, kept

**Why first:** small, independent, and immediately fixes the "every run overwrites `out/<runId>.json`"
pain we hit doing the 4 consistency runs by hand.

**Files:** Modify `benchmark/runner/report.ts`; Test: `benchmark/runner/__tests__/report.test.ts`.

**Change:** `writeReport` gains an `opts.resultsDir` (default `benchmark/results`). It writes the report
to BOTH `out/<runId>.json` (latest, as now) and `results/<runId>__<stamp>.json` (kept). `stamp` is a
filesystem-safe timestamp passed in by the caller (run.ts supplies `new Date().toISOString()` →
sanitised) so the function stays testable with a fixed stamp. Return both paths.

**Test list:** given a fixed `stamp`, a file appears at `results/<runId>__<stamp>.json` with the full
report; the `out/<runId>.json` latest is still written; two writes with different stamps produce two
result files (no overwrite). Use a temp dir; clean up.

**Decision flagged for approval:** results location `benchmark/results/`, and **kept in git** (the
experiment's evidence is worth versioning). Say the word for top-level `results/` or git-ignored instead.

## Task 2: Merge — "leave conflicts" mode for the resolver

**Files:** Modify `benchmark/runner/merge.ts`; Test: `benchmark/runner/__tests__/merge.test.ts`.

**Change:** add `opts.onConflict: 'abort' | 'leave'` (default `'abort'` = today's mechanical behaviour,
unchanged). In `'leave'` mode, a conflicting `git merge` is **not** aborted — the conflict markers stay
in the working tree and the merge is left in-progress (or committed-with-markers per what the resolver
needs), and the conflict is still recorded. This gives the resolver a real conflicted state to fix.

**Test list:** `'abort'` mode behaves exactly as the existing tests (no regression); `'leave'` mode after
a same-line conflict leaves conflict markers in the file (assert `<<<<<<<` present) and records the
conflicted path; the integration worktree is usable by a subsequent step.

## Task 3: Resolver core — `runResolver`

**Files:** Create `benchmark/runner/resolve.ts`; Test: `benchmark/runner/__tests__/resolve.test.ts`.

**Interfaces consumed:** `mergeSlices` (Task 2, `'leave'` mode) for the conflicted integration worktree;
`runAgent`/`runClaude` from `agent.ts` for the headless launch + usage capture; `RunConfig`, `Workspace`.

**Produces:** `runResolver(run, slices, integration, budget, deps?) → ResolutionResult` where
`ResolutionResult = { ran: boolean; tokens; turns; wallMs; reachedGreen: boolean; didNotResolve: boolean }`.
- Launch ONE headless agent (via the injectable claude runner — tests fake it) in `integration.dir`,
  with a **resolver prompt**: "Several feature branches were merged into this worktree and some
  conflict or fail. Resolve all git conflicts, then make the app coherent and green: `pnpm typecheck`,
  `pnpm build`, and `pnpm test` must all pass. Commit when green. Never block." **No mention of the gate;
  the gate is not present.** Clair plugin OFF.
- After it finishes, capture tokens/turns/wallMs. `reachedGreen` = the agent's commit makes
  `tsc`+`build`+visible-`test` pass (the runner verifies by running those three, via the injectable cmd
  runner). `didNotResolve` = budget exceeded OR not green.

**Test list (fake the claude runner + the verify commands):** a fake resolver that "commits a green
tree" → `reachedGreen:true`, `didNotResolve:false`, parsed tokens/turns; a fake that exceeds budget →
`didNotResolve:true`; a fake whose result still fails `tsc` → `reachedGreen:false`. No real claude, no
real pnpm.

## Task 4: Report — resolution metrics + post-resolution outcome

**Files:** Modify `benchmark/runner/report.ts`; Test: `benchmark/runner/__tests__/report.test.ts`.

**Change:** `RunReport` gains `resolution?: ResolutionResult` and a `resolutionCost` convenience
(`{ tokens, turns, wallMs }`, zero/absent when mechanical). The summary prints a resolution line when
present: "Resolution: reached-green=<bool> cost=<tokens> tokens / <wallMs>ms". `outcome`/`gate` are
computed on the **resolved** integration (the gate still runs after resolution).

**Test list:** with a `resolution` part present and `reachedGreen:true`, the JSON carries the resolution
block and the summary contains the resolution line; with no resolution part (mechanical run) the report
is unchanged from today; `resolutionCost` sums correctly.

## Task 5: Wire the resolution phase into `run.ts`

**Files:** Modify `benchmark/runner/run.ts`; Test: `benchmark/runner/__tests__/run.test.ts`.

**Change:** read `run.integration.mode` (`'mechanical'` | `'resolver'`, default `'mechanical'`). Pipeline:
- `mechanical`: provision → agents → `mergeSlices(abort)` → gate → report → teardown (today, unchanged).
- `resolver`: provision → agents → `mergeSlices(leave)` → **`runResolver`** → gate → report → teardown.
  Order constraint unchanged: everything before teardown; teardown in `finally`.
- Pass the resolver its own budget from `run.integration.resolver_budget`.

**Test list (inject all stage fakes):** in `resolver` mode the call order is provision → runAgents →
mergeSlices → runResolver → runGate → writeReport → teardown; in `mechanical` mode `runResolver` is
NOT called; resolver-stage failure still hits teardown in `finally`.

## Task 6: Run-config + dry-run surfacing

**Files:** Create `benchmark/runs/standard-L1-resolver.run.yaml`; Modify `benchmark/runs/README.md`; the
dry-run plan in `run.ts` prints the integration mode + resolver budget.

**Change:** a new config identical to `standard-L1.run.yaml` but with
`integration: { mode: resolver, resolver_budget: { max_tokens: 2000000, max_turns: 200 } }` and a
distinct `id` (so its results don't collide). Document both modes in the runs README. `--dry-run` prints
which integration mode will run.

**Verify:** `--dry-run` on the resolver config shows mode=resolver + the budget; no real run in this task.

---

## What this unlocks (the measurement)

Per run you now get, on top of the build/collision numbers:
- **Resolution cost:** tokens + wall-clock the integration agent spent untangling the mess.
- **Resolution success:** did it reach green within budget (a softer completion rate than mechanical's
  hard did-not-complete).
- **Post-resolution outcome:** the hidden gate on the *resolved* app.

Then the real experiment is **Arm A vs Arm B with the SAME resolver:** clair's value =
`resolutionCost(A) − resolutionCost(B)` (+ any all-pass-rate lift). If clair-on agents collide less, the
fixed resolver finishes cheaper — that subtraction is clair's dollar value, attributable because the
resolver is held constant.

## Risks / notes

- **Resolver variance:** it's a stochastic agent → its cost is a distribution; report per-run, average
  over K. Don't read one resolver run as a verdict.
- **"Green" ≠ gate-pass:** the resolver optimises the *visible* suite; the hidden gate may still fail
  (that's the point — it measures whether visible-green actually means correct). Keep them separate in the
  report.
- **Budget tuning:** resolver caps (2M/200) are guesses; the first real resolver run calibrates them.
- **Reuse `agent.ts`:** do not re-implement headless launch/usage parsing; thread the same code so the
  Windows-spawn + JSON-field fixes apply here too.
