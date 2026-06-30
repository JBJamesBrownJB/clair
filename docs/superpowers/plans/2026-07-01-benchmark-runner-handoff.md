# Benchmark Runner — Handoff & Next Steps (2026-07-01)

Durable record of where the benchmark runner stands, what's certified, the current blocker, and what to
do next. The blow-by-blow SDD ledger is in `.superpowers/sdd/progress.md` (git-ignored scratch).

## What exists (all on branch `feat/benchmark-runner`, 126 tests green)

A Node/TS benchmark runner under `benchmark/runner/` that executes one multi-agent trial:
- **Build phase:** N headless `claude -p` agents, one per slice, each blind to the others, in its own git
  worktree off `arena/base`. (`workspace.ts`, `agent.ts`, `sliceSpec.ts`.)
- **Two integration modes** (`run.ts`, `integration.mode`):
  - `mechanical` — merge branches, conflict ⇒ did-not-complete. The cheap kill-criterion baseline.
  - `pr-queue` — every branch is a PR: merge → local CI (build+typecheck+visible tests) → land if green,
    else a **clair-OFF, gate-blind fix agent** tries to fix it; assertion-count tamper check; roll back to
    last-green if it can't land. Yields **cost-to-success** + success rate. (`prQueue.ts`, `ci.ts`.)
- **Held-out gate** runs last as the definitive correctness audit (`gate.ts`, from `arena/reference`).
- **Report** (`report.ts`): per-PR outcomes, cost-to-success (build/integration split), fix-loop cost,
  test-discipline (test files added per slice), `shippedButWrong` flag, results kept per-run in
  `benchmark/results/<runId>__<stamp>.json`.
- The old loose "resolver" was replaced by the PR-queue and deleted.

**Plans (committed):** `docs/superpowers/plans/2026-06-30-benchmark-runner.md` (the runner),
`…-pr-queue-integration.md` (the PR-queue model + rationale), `…-runner-operational-hardening.md`
(today's fixes), `…-resolver-and-results.md` (superseded resolver), `…-arena-reference-v2.md` (future).

## How to run / inspect

```bash
cd benchmark/runner
pnpm exec tsx run.ts ../runs/standard-L1-prqueue.run.yaml --dry-run   # safe preview
pnpm exec tsx run.ts ../runs/standard-L1-prqueue.run.yaml             # live (pr-queue, cost-to-success)
pnpm exec tsx run.ts ../runs/standard-L1.run.yaml                     # live (mechanical baseline)
```
Each run uses a **unique runId** (`<config-id>__<timestamp>`); branches `run/<runId>/*` **survive
teardown** for inspection. Results in `benchmark/results/`. Pre-run, clear old junk:
`git worktree prune && for b in $(git for-each-ref --format='%(refname:short)' refs/heads/ | grep -E '/run/'); do git branch -D "$b"; done && rm -rf benchmark/runner/.work`.

## CERTIFIED FINDING (from the live runs so far)

- **The agents do quality work.** S1 (authz) was checked out fresh from its surviving branch, installed
  properly, and ran: **`tsc` clean, 33/33 tests pass.** Agents build real, *tested* features (test files
  added per slice: typically 1–2). The "lazy agents" worry is unfounded.
- **Every live run's "FAIL / all-PRs-blocked-ci-fail" is a TOOL ARTIFACT, not a result.** The runner's CI
  ran against an **incomplete `node_modules` in the worktrees** (`'tsc' / 'vitest' is not recognized`), so
  it failed every PR regardless of the work's quality. Same class of bug as the earlier Prisma-generate
  issue (which is fixed).
- The PR-queue **integrity machinery works**: no silent drops, no false-green, no tampering, fix-loop
  genuinely ran (~2.6M tokens on the last run), `did-not-complete` reported honestly, cost surfaced.
- **Today's operational fixes paid off:** because branches now survive teardown, the uncontaminated
  repro above was possible — that's what let us certify "tool bug, not result." Before, every run was
  undiagnosable.

## THE BLOCKER (next task) — CI-environment install reliability

`pnpm install` in the runner's worktrees does **not** reliably produce a complete `node_modules`
(missing `.bin/tsc`, `.bin/vitest`), so CI (`typecheck`/`build`/`test`) can't run and every PR
fails for a fake reason. A *manual* `pnpm install` in a fresh worktree works fine (33 tests pass), so it's
specific to the runner's automated flow. **Leading hypothesis:** concurrent `pnpm install` across the 3
slice worktrees during `provision` (plus the integration worktree) races against the shared pnpm
content-addressable store / hardlink step on Windows, leaving partial `node_modules`. **Also:** a failed
Windows teardown (`git worktree remove --force` is **not atomic** — it tears the worktree's `.git` link
and starts deleting `node_modules` before failing on the locked dir) gutted the *original* worktrees;
branches survived so inspection still worked, but the teardown approach needs hardening too.

**Next plan to scope:** "Runner CI-environment reliability" —
1. Make worktree provisioning installs **reliable** (serialize installs, or `pnpm install --frozen-lockfile`
   with verification that `.bin/tsc`+`.bin/vitest` exist post-install and retry/fail-loud if not; consider
   a shared/parent `node_modules` or pnpm `--config.node-linker` strategy; or `pnpm install` once + copy/
   hardlink). Verify the integration worktree's install too.
2. **Verify the toolchain after install** in `ci.ts`/provision (assert `tsc`/`vitest` resolvable; surface a
   distinct `env-broken` outcome instead of `ci-fail` so a broken toolchain never masquerades as a feature
   failure).
3. **Harden teardown** for the non-atomic `git worktree remove` (kill lingering child processes first;
   accept that worktree dirs may linger as gitignored junk but never corrupt the repo; rely on unique
   runIds + a `prune-runs` housekeeping helper).
Then re-run `standard-L1-prqueue` → a real cost-to-success number, with the gate as the correctness judge.

## Deferred watch-items (revisit before any Arm-A-vs-B comparison)
- `queue_budget` (4M/400) is **per fix-agent**, not a total ledger → with N blocked PRs the run can spend
  ~N×. Token cap is post-hoc (only `--max-turns` is enforced). Consider a total integration budget.
- Arm-B validity: confirm `arena/base` ships the clair plugin **inert** for Arm A (it is, since clair needs
  `init`/`pair`); Arm B enables it. Same fixed integration across arms.
- `costToSuccess.*.wallMs` excludes CI/env wall (tokens accurate; use top-level `report.wallMs` for true
  elapsed). `countAssertions` is a grep tripwire (comment-out evades it) — hidden gate is the authority.
- I-2 residual: a fix agent could still drop the *incoming* branch's own test if its merge **conflicted**
  (pre-merge baseline there); the hidden gate catches it.
- Arena reference v2 (L3 saturation slices + gate) — `docs/superpowers/plans/2026-06-30-arena-reference-v2.md`.

## State pins
- Branch `feat/benchmark-runner` @ `83fea22`. `arena/base` @ `1a5cd3d`, `origin/arena/reference` @ `bfa46b5`.
- 126 tests green (`cd benchmark/runner && pnpm test`). Working tree clean except untracked
  `benchmark/results/` (kept run evidence).
