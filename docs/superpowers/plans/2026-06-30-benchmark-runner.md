# Benchmark Runner (L1 Arm-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement task-by-task. Steps use `- [ ]` tracking.

**Goal:** Execute one benchmark run from a run-config — clone `arena/base` into per-slice worktrees, run
a headless agent per slice (blind to the others), merge mechanically, run the held-out gate, and report
metrics. Just enough to answer the kill-criterion question: *do isolated agents collide in our arena?*

**Architecture:** A small Node/TS CLI under `benchmark/runner/`. It reads a `runs/*.run.yaml`, derives
each slice's prompt from `backlog/backlog.md` (information-asymmetric), shells out to `git` / `pnpm` /
`claude -p`, and writes a metrics report. Stochastic agents → this is one trial (`k=1`); the K-loop and
Arm B are later.

**Tech Stack:** Node 24 · TypeScript (tsx) · `yaml` parser · git worktrees · pnpm · `claude -p` (headless).

## Global Constraints

- **Information asymmetry:** each agent sees ONLY its own slice's spec — never another slice's, never the
  backlog at large, never `arena/reference`/`gate/`.
- **Integration held fixed, clair-off:** mechanical `git merge`, no resolver. (This is the Arm-A control;
  Arm B only flips the clair plugin on — out of scope here.)
- **Gate is held out:** the gate comes from `arena/reference`, run by the runner *after* merge. Agents
  never see it.
- **Budget cap = outcome:** an agent that exceeds its token/turn cap, or a merge/gate that fails, is a
  counted `did-not-complete` — not a retry.
- **Run only the level's gate subset:** an L1 run scores against the S1–S3 gate assertions only (the
  reference also contains S4/S5; asserting those against an L1 build would falsely fail).
- **Scope = standard-L1.run.yaml, Arm A, k=1, local worktrees.** No containers, no Arm B, no K-loop, no
  L2/L3 — all noted as extension points, none built.

## Honest caveat (read before running)

Minimal v1 runs `claude -p` with skip-permissions **in a local worktree, not a container**. That's
acceptable for a throwaway arena on your own machine to get first signal; it is **not** isolated from the
host and must not be the model for scaled runs. Containerisation is the first hardening step after signal.

## Prerequisite check — RESOLVED (no arena change needed)

Confirmed on `arena/reference`: the gate is already slice-selectable. `gate/acceptance.test.ts` is split
into `describe('slice 1 — authz …')`, `describe('slice 2 — search …')`, `describe('slice 3 — export …')`
(the three L1 features); `gate/upgrades.test.ts` holds slices 4–5. `test:gate` = `vitest run --config
vitest.gate.config.ts`.

→ **L1 subset selector:** run `gate/acceptance.test.ts` only (or `vitest run -t "slice 1|slice 2|slice 3"`).
L2 adds `gate/upgrades.test.ts`. The runner's gate step (Task 5) uses this; no selection mechanism needs
adding to the arena branch.

---

## Task 1: Config + per-slice prompt extraction

**Files:** Create `benchmark/runner/loadRun.ts`, `benchmark/runner/sliceSpec.ts`, `benchmark/runner/types.ts`;
Test: `benchmark/runner/__tests__/sliceSpec.test.ts`.

**Produces:** `loadRun(path): RunConfig` (parsed YAML) and
`buildSliceSpecs(run, backlogPath): SliceSpec[]` where each `SliceSpec = { id, title, prompt }` and
`prompt` contains only that slice's title + its backlog items' rationale + **acceptance criteria** (the
behavioral target the agent builds toward), with an explicit instruction to work only in its worktree,
write tests, commit when done, never block.

**Test list:** given `standard-L1.run.yaml` + `backlog.md`, returns 3 specs (S1/S2/S3); S1's prompt
contains `F-08` ACs and **not** any S2/S3 text (asymmetry); each prompt names the slice's touch-set as
hints, not commands.

## Task 2: Workspace provisioning

**Files:** Create `benchmark/runner/workspace.ts`; Test: `benchmark/runner/__tests__/workspace.test.ts`.

**Produces:** `provision(run): Workspace[]` — for each slice, `git worktree add <tmp>/<runId>-<sliceId>
arena/base` on a fresh branch `run/<runId>/<sliceId>`, then `pnpm install`. Returns paths + branch names.
Plus `teardown(workspaces)`.

**Test list:** provisioning N slices yields N distinct worktree dirs each on its own branch off
`arena/base`; teardown removes them and prunes; re-running with the same runId is clean (idempotent).

## Task 3: Headless agent launch + usage capture

**Files:** Create `benchmark/runner/agent.ts`; Test: `benchmark/runner/__tests__/agent.test.ts` (mock the
`claude` child process).

**Produces:** `runAgent(workspace, spec, budget): AgentResult` where
`AgentResult = { sliceId, committed: boolean, tokens, turns, wallMs, exit }`. Spawns
`claude -p "<spec.prompt>"` in the worktree with pre-granted permissions and the budget cap; captures
usage from the run; marks `committed` true iff the worktree HEAD advanced past `arena/base`.

**Test list:** with a mocked claude that commits, returns `committed:true` and parsed tokens/turns; with a
mock that exceeds budget, returns `committed:false` and a `did-not-complete` flag; runs the 3 agents
concurrently.

## Task 4: Mechanical merge + textual-conflict capture

**Files:** Create `benchmark/runner/merge.ts`; Test: `benchmark/runner/__tests__/merge.test.ts`.

**Produces:** `mergeSlices(run, branches): MergeResult` — create `run/<runId>/integration` from
`arena/base`, `git merge --no-ff` each slice branch in order, capturing per-merge textual conflicts
(count + files). On conflict: record it, abort that merge (no resolver), continue per config. Returns
`{ integrationBranch, textualConflicts, mergedCleanly }`.

**Test list:** two branches editing disjoint files merge clean (0 conflicts); two editing the same line
record a conflict with the file path; the integration branch exists regardless.

## Task 5: Gate execution on the merged result

**Files:** Create `benchmark/runner/gate.ts`; Test: `benchmark/runner/__tests__/gate.test.ts`.

**Produces:** `runGate(integrationBranch, run): GateResult` — copy the held-out `gate/` from
`arena/reference` into the integration worktree, run **only the slices in `run.slices`** (the subset
selector from the prerequisite), plus `tsc --noEmit` and `pnpm build` as floors. Returns
`{ perSlice: {S1:pass|fail,…}, allPass, tscClean, buildClean }`.

**Test list:** an integration that satisfies S1–S3 reports `allPass:true`; one missing S2 behavior reports
S2 fail + `allPass:false`; a type-skew integration reports `tscClean:false`.

## Task 6: Report

**Files:** Create `benchmark/runner/report.ts`; Test: `benchmark/runner/__tests__/report.test.ts`.

**Produces:** `writeReport(runId, parts): string` — a metrics JSON
(`benchmark/runner/out/<runId>.json`: per-slice committed/tokens/turns, textual conflicts, gate per-slice
+ allPass, tsc/build, totals, wall-clock) **and** a short human summary printed to stdout (the headline:
all-pass yes/no, conflicts, semantic = clean-merge-but-gate-fail).

**Test list:** given fixture parts, JSON has every field; summary flags the semantic case (mergedCleanly
&& !allPass) explicitly.

## Task 7: End-to-end driver + first real run

**Files:** Create `benchmark/runner/run.ts` (CLI entry: `tsx benchmark/runner/run.ts <run.yaml>`),
`benchmark/runner/README.md`; Modify `package.json`-equivalent note in the runner README.

**Steps:**
- [ ] Wire T1→T6 into `run.ts`: load → buildSpecs → provision → runAgents → merge → gate → report →
      teardown.
- [ ] Dry-run guard: a `--dry-run` flag that does everything except launch agents (prints the 3 prompts
      and the plan) — verify asymmetry by eye.
- [ ] Run for real: `tsx benchmark/runner/run.ts benchmark/runs/standard-L1.run.yaml`.
- [ ] Read the report. **Interpret:** clean merge + all-pass → problem absent (kill-criterion hit, reconsider
      clair). Conflicts or gate fails → problem real → proceed to Arm B.

---

## What this deliberately does NOT do (extension points)

- **Arm B (clair on)** — same harness, flip the plugin via config; one new branch in `runAgent`.
- **K-trials** — wrap `run.ts` in a loop, aggregate medians/spread.
- **Containers** — replace worktree-on-host with a disposable sandbox per agent (first hardening step).
- **L2 / L3** — already expressed by the run-configs; the runner is level-agnostic once the gate subset
  selector works, so L2 needs no runner change; L3 needs reference v2 to exist first.

## Risk notes

- **Gate subset selection** is the one external dependency — if `arena/reference`'s gate isn't sliceable,
  do the prerequisite task first.
- **Agent stochasticity:** k=1 is a smoke signal, not a measurement. Don't conclude from one run; it exists
  to prove the pipeline works and give a first read.
- **Budget calibration:** the `1.5M tokens / 120 turns` caps in the run-config are guesses — the first run
  tells you if they're sane.
