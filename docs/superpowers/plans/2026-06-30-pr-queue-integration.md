# PR-Queue Integration (cost-to-success) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> task-by-task. Steps use `- [ ]` tracking. Each task's failing-test list is given; TDD it.

**Goal:** Replace the loose single-agent "resolver" with a faithful **PR-queue integration**: every slice
branch is processed as a pull request, each gated by CI, and a clair-OFF fix-loop unblocks failing PRs
until the whole app is green or the budget runs out. This yields the metric the experiment needs —
**cost-to-success** (total spend to reach all-green) and **success rate** — and makes silently dropping a
branch structurally impossible.

**Architecture:** A new integration mode `pr-queue`. After the build agents commit, the integration phase
processes the slice branches **in fixed order** into one integration worktree. For each: merge → run **CI**
(build + typecheck + the visible test suite). Green ⇒ the PR merges. Red/conflict ⇒ the PR is **blocked**
(recorded, never dropped). A budget-capped **fix-loop** then has a clair-OFF agent unblock each blocked PR
(resolve conflict / fix failing CI) until it goes green and merges — or the budget is exhausted. The
held-out gate runs last on the final integration as the correctness audit. Mechanical mode stays as the
cheap kill-criterion baseline; the old loose `resolver` mode is removed.

**Tech Stack:** Node 24 · TypeScript (tsx) · git worktrees · pnpm · `claude -p` headless (reuse `agent.ts`).

## Global Constraints

- **No silent drops — by construction.** Every branch gets an explicit, recorded PR outcome
  (`merged` | `blocked: <reason>`). "Reached success" requires ALL branches merged green. This replaces
  the bolt-on I-1 guard with a structural guarantee.
- **CI = visible signals only** (build + typecheck + the arena's *visible* test suite). The fix agent is
  **clair-OFF and gate-blind** — it never sees `gate/` (checked out only afterwards, by `runGate`). The
  hidden gate is the held-out correctness audit, never a target the fix-loop optimizes.
- **Cost-to-success is the headline → token accounting must be accurate.** Fix the cache-token
  under-count (I-3) as part of this work — it is no longer deferrable: `cost-to-success` is the number the
  A/B comparison trades on.
- **Fixed PR order** (slice order S1→S2→S3) for cross-arm comparability; later PRs merge onto earlier ones
  (realistic rebase pressure).
- **Budget-capped.** A total integration budget + per-fix cap. Exhausting it with PRs still blocked =
  `did-not-complete` (counted, excluded from the cost-to-success average, included in the success-rate
  denominator).
- **clair held fixed + OFF in the fix-loop**, identical across arms — clair acts at build time; the fix
  agent must be constant so `costToSuccess(A) − costToSuccess(B)` attributes cleanly.
- **Reuse, don't reimplement:** the fix agent launches via `agent.ts`'s `runAgent`; CI shell-out reuses a
  shared command runner (consolidating the `gate.ts`/`resolve.ts` duplication).
- **Tests are append-only / tamper-evident (or the metric is worthless).** A fix agent told "make tests
  pass" will delete a failing test or gut an assertion if allowed. Defenses, layered: (1) **judge green
  against a FROZEN snapshot** of the merged test files taken before the fix-loop — run those against the
  agent's final source, so it cannot lower the bar by editing its copy; (2) the **hidden gate** is the
  un-gameable backstop (agent never sees it → tampering shows up as visible-green/hidden-fail); (3)
  **flag tampering**: if test count or assertion (`expect`) count drops vs the snapshot, record it and the
  run does NOT count as success. Agents (build and fix) may ADD tests and edit source; weakening/deleting an
  existing assertion is forbidden. (Wrinkle: a genuine conflict in a shared test file may be resolved, so
  the rule is "assertion count must not go *down*," not "tests are untouchable.")
- **Definitive correctness = the hidden gate.** Visible-green = "the team thinks it shipped"; the held-out
  behavioral gate (authored from the reference, run last, never seen by agents) is the final verdict on
  whether it's actually correct. The shipped-but-wrong gap is a headline finding.

---

## Definitions (the metrics this produces)

- **PR outcome** (per branch): `merged` | `blocked` (+ reason: conflict files, or which CI step failed).
- **Reached-success:** all branches `merged` with CI green, within budget.
- **Cost-to-success:** total tokens + wall-clock to reach success = build-agent cost + integration/CI cost
  + fix-loop cost. Reported broken down (build vs integration vs fix) and only meaningful for successful runs.
- **Success rate:** fraction of K runs that reached success in budget.
- **did-not-complete:** budget exhausted with ≥1 PR still blocked.
- **Hidden-gate audit:** does the green, shipped integration actually pass the held-out gate? (the
  "shipped ≠ correct" / semantic-gap finding — reported alongside, never as the fix-loop's target).
- **Test-discipline signal** (the agent-quality question): test files each slice branch added — recorded so
  we can see whether build agents actually write tests.

---

## File-structure impact

- **New:** `benchmark/runner/ci.ts` — `runCI(dir, deps?) → { buildClean, tscClean, testPass, testTotals }`
  over a worktree (build + typecheck + visible test). The shared CI/cost gate.
- **New:** `benchmark/runner/prQueue.ts` — `runPrQueue(run, branches, integration, budget, deps?)` — the
  queue + fix-loop.
- **New:** `benchmark/runner/shell.ts` — the single `RunCmdFn` default impl (consolidates the verbatim
  `gate.ts`/`resolve.ts` copies; Windows-safe spawn, drained stderr).
- **Modify:** `benchmark/runner/agent.ts` — token accounting includes cache tokens (I-3).
- **Modify:** `benchmark/runner/report.ts` — PR-queue metrics block; cost-to-success breakdown;
  test-discipline counts.
- **Modify:** `benchmark/runner/run.ts` — `integration.mode: pr-queue`; remove the old `resolver` mode.
- **Modify:** `benchmark/runner/merge.ts` — reused for the per-PR merge step (its `leave` mode);
  the `resolve.ts` module is deleted.
- **Modify:** `benchmark/runs/` — a `pr-queue` run-config; drop `standard-L1-resolver.run.yaml`; README.

---

## Task 1: Accurate token accounting (I-3) + shared shell runner

**Why first:** cost-to-success is the headline; every later metric depends on tokens being real. And the
shared shell runner removes duplication the next tasks would otherwise copy again.

**Files:** Modify `benchmark/runner/agent.ts`; Create `benchmark/runner/shell.ts`; Test:
`benchmark/runner/__tests__/agent.test.ts`, `__tests__/shell.test.ts`.

**Changes:**
- `agent.ts` usage parse: `tokens = input_tokens + output_tokens + cache_creation_input_tokens +
  cache_read_input_tokens` (read all defensively; missing → 0). Update the existing token tests' fixtures
  to include cache fields and assert they're summed.
- `shell.ts`: export the single `RunCmdFn` default (`{argv, cwd} → {stdout, exit}`) with win32 `shell:true`
  AND a **drained stderr** handler (fixes the undrained-stderr hang risk). `gate.ts` and the new `ci.ts`
  import it instead of each defining their own.

**Test list:** a usage JSON with cache tokens → `tokens` includes them; `shell.ts` runner resolves exit
codes and never leaves stderr undrained (mock the child process).

## Task 2: CI runner

**Files:** Create `benchmark/runner/ci.ts`; Test: `__tests__/ci.test.ts`.

**Produces:** `runCI(dir, deps?: { runCmd?: RunCmdFn }) → Promise<CIResult>` where `CIResult =
{ buildClean, tscClean, testPass, testTotals: { passed, failed } }`. Runs `pnpm typecheck`, `pnpm build`,
`pnpm test` (the VISIBLE suite, `--reporter=json` for `testTotals`) in `dir`. `green = buildClean &&
tscClean && testPass`.

**Test list (inject fake runCmd):** all exit 0 + passing vitest json → `green`; a failing test → `testPass:false`;
tsc non-zero → `tscClean:false`. No real pnpm.

## Task 3: PR-queue core + fix-loop

**Files:** Create `benchmark/runner/prQueue.ts`; Test: `__tests__/prQueue.test.ts`.

**Interfaces consumed:** `mergeSlices`(leave mode) or per-branch `git merge`; `runCI` (Task 2); `runAgent`
(`agent.ts`) for the fix agent; `RunCmdFn` (shell.ts).

**Produces:** `runPrQueue(run, branches, integration, budget, deps?) → Promise<PrQueueResult>`:
- Provision/set up the integration worktree (install → db:generate → db:reset), checking exit codes
  (surface env-setup failure distinctly — the I-2 watch-item).
- **First pass:** for each branch in fixed order — `git merge` it; `runCI`; green ⇒ keep (PR `merged`),
  red/conflict ⇒ `git merge --abort` (leave integration clean) and mark PR `blocked` with reason.
- **Fix-loop:** while blocked PRs remain AND budget remains — re-merge a blocked PR leaving conflicts in
  the tree, launch a clair-OFF gate-blind fix agent (via `runAgent`, budget-capped) to resolve+fix until
  `runCI` is green, then it stays merged; record fix cost (tokens/turns/wallMs) and round count. If a fix
  exhausts its cap without green, the PR stays blocked.
- Return `PrQueueResult = { prs: Array<{branch, outcome:'merged'|'blocked', reason?, fixCost?}>,
  reachedSuccess: boolean, rounds: number, integrationCost: {tokens,turns,wallMs}, didNotComplete: boolean }`.
  `reachedSuccess` = every PR `merged`.

**CRITICAL:** `reachedSuccess` is true ONLY when every branch is merged green — a branch that never merges
keeps `reachedSuccess` false. No path can mark success with an unprocessed branch.

**Test integrity:** snapshot the merged test files BEFORE the fix-loop. Judge each post-fix `runCI` against
the SNAPSHOT tests (not the agent's working copy), so a fix agent cannot reach green by weakening/deleting
tests. Record per-fix whether assertion/test count dropped vs the snapshot; a run with tampering does not
count as `reachedSuccess` (and is flagged in the report).

**Test list (inject fake runCmd + fake runAgent + fake runCI — no real claude/pnpm/git):**
1. all branches CI-green on first merge → all PRs `merged`, `reachedSuccess:true`, fix-loop never runs.
2. one branch blocks, fix agent makes CI green on retry → that PR ends `merged`, `reachedSuccess:true`,
   fixCost recorded, rounds≥1.
3. a branch stays red past its fix budget → PR `blocked`, `reachedSuccess:false`, `didNotComplete:true`.
4. every branch is explicitly represented in `prs` (no branch silently absent) — assert `prs.length ===
   branches.length` for a 3-branch run including a permanently-blocked one.

## Task 4: Report — cost-to-success + PR outcomes + test discipline

**Files:** Modify `benchmark/runner/report.ts`; Test: `__tests__/report.test.ts`.

**Changes:** `RunReport` gains `prQueue?: { prs, reachedSuccess, rounds, didNotComplete }`,
`costToSuccess?: { total, build, integration, fix }` (tokens + wallMs, present only when `reachedSuccess`),
and `testDiscipline?: Record<sliceId, { testFilesAdded: number }>` (computed from each branch's diff vs
`arena/base` — passed in by the wiring). Summary prints: per-PR outcomes, reached-success, cost-to-success
breakdown (or "DID NOT COMPLETE — N PRs blocked"), and the hidden-gate audit line. `outcome`/gate unchanged
(gate still audits the final integration).

**Test list:** success fixture → `costToSuccess` present + summary shows the breakdown and "3/3 PRs merged";
did-not-complete fixture → `costToSuccess` absent, summary shows blocked PRs; testDiscipline counts surface.

## Task 5: Wire `pr-queue` mode into run.ts; remove old resolver

**Files:** Modify `benchmark/runner/run.ts`, `types.ts`; delete `resolve.ts` + `__tests__/resolve.test.ts`.

**Changes:** `integration.mode: 'mechanical' | 'pr-queue'` (remove `'resolver'`). pr-queue pipeline:
provision → runAgents → **runPrQueue** (merge+CI+fix-loop) → runGate(final integration) → compute
testDiscipline (diff each slice branch vs arena/base for added test files) → writeReport({...prQueue,
costToSuccess, testDiscipline, gate}) → teardown(finally). Mechanical mode unchanged. Map
`integration.queue_budget` → the fix-loop budget. Dry-run prints the mode + budget.

**Test list (inject all stage fakes):** pr-queue mode call order provision → runAgents → runPrQueue →
runGate → writeReport → teardown; mechanical mode does NOT call runPrQueue; resolver mode no longer exists
(loading a config with `mode: resolver` is rejected or treated as unknown); teardown still in finally.

## Task 6: Run-config + dry-run + docs

**Files:** Create `benchmark/runs/standard-L1-prqueue.run.yaml`; delete `standard-L1-resolver.run.yaml`;
Modify `benchmark/runs/README.md`. 

**Changes:** config mirrors `standard-L1.run.yaml` with distinct `id` and `integration: { mode: pr-queue,
queue_budget: { max_tokens: 4000000, max_turns: 400 } }` (generous — the fix-loop may work several PRs;
flagged as a calibration starting point). README: document `mechanical` (baseline kill-criterion) vs
`pr-queue` (cost-to-success), and that `resolver` is removed. Dry-run surfaces mode + budget. Verify both
dry-runs print correctly (no live run).

---

## Sequencing

```
T1 token accuracy + shell.ts ─► T2 runCI ─► T3 PR-queue + fix-loop ─► T4 report ─► T5 wire (delete resolver) ─► T6 config+docs
```

## What this resolves

- **Silent drop** → impossible (every branch an explicit PR outcome; success requires all merged).
- **False-green** → impossible (success = all PRs CI-green, not "the subset present passes").
- **Cost-to-success** → directly produced (total spend to drain the queue green), with build/integration/fix
  breakdown, accurate tokens.
- **"Always ends in success?"** → no, and that's correct: the fix-loop *drives* to success (the reference
  proves it's solvable), most runs land it, and the ones that hit budget are the real "too messy to
  integrate affordably" signal clair is meant to reduce.
- **Agent test-discipline** (your hypothesis) → measured (test files added per slice), surfaced as a finding.

## Risks / notes

- **Fix-loop variance + cost:** the fix agent is stochastic and may burn budget; cost-to-success is a
  distribution over K runs, not one number. Budget caps bound it.
- **Order sensitivity:** fixed S1→S2→S3 order is a chosen convention; note it (a different order shifts which
  PR hits the rebase conflict).
- **Visible-green ≠ gate-pass is intended:** the fix-loop ships on visible CI; the hidden gate audits
  correctness. Keep them distinct in the report — the gap is a headline finding, not a bug.
- **Env setup on a conflicted tree (I-2):** runCI/setup must check exit codes and surface a broken toolchain
  distinctly so it isn't misread as a resolver/agent failure.
