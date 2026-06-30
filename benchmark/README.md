# clair — Benchmark (operational home)

> **Status: scaffolding (design approved).** This folder holds the *operational* assets of the
> value benchmark — the **backlog** of work the arena can be asked to build, the **levels** that
> ramp how much of it a run targets, and the **run-configs** that pin each run so it's repeatable.
> It is the counterpart to the *methodology* docs under
> [`../docs/architecture/`](../docs/architecture/) (`value-benchmark.md`,
> `benchmark-arena-ts.md`, `benchmark-scenarios.md`).

## What lives here vs. what lives elsewhere

| | Where | What |
|---|---|---|
| **Methodology** (the *why* and *how-measured*) | `docs/architecture/value-benchmark.md` & siblings | arms, metrics, the hidden gate, attribution rules |
| **The app** (the arena itself) | `arena/*` orphan branches, pinned by tag | the Larder TS/React app, base + reference |
| **Operational assets** (this folder) | `benchmark/` on `main` | the backlog, levels, run-configs — the *what to build* and *how to run* |

This folder is clair **harness** material, so it lives on `main`, never on an `arena/*` branch. It
*describes* features to add to the arena; it does not contain arena app code.

## The three axes of a run

A benchmark run is fully defined by three independent dials:

1. **Arm** — `A` disciplined-isolation control · `B` clair-on (at a capability level) · `C`
   single-agent ceiling. *Defined in [value-benchmark.md](../docs/architecture/value-benchmark.md).*
2. **Topology** — how agents are deployed. **Locked to local worktrees (Scenario 2).** *Defined in
   [benchmark-scenarios.md](../docs/architecture/benchmark-scenarios.md).*
3. **Level** — *how much work* is thrown at the arena in one run. **Defined here**, in
   [`levels.md`](levels.md). One agent per slice, so agent count scales with the work (1:1).

A `run-config` (`runs/*.run.yaml`) picks one value on each axis plus the reproducibility pins
(model, seed/tag, budget, K trials) → a single repeatable run.

## Layout

```
benchmark/
  README.md          # this file — the design of record
  backlog/
    README.md        # how a backlog item is structured + the overlap matrix
    backlog.md       # THE BANK — every feature / debt / migration / ux-fix, stable IDs
  levels.md          # L1 / L2 / L3 — which backlog IDs each level pulls in, + agent count
  runs/
    README.md        # the run-config schema, in plain words
    *.run.yaml        # one declarative, repeatable run definition each
```

## The backlog (the "bank")

A large, growing set of work items the arena can be asked to build. Each item is **grounded in real
arena files** (CooperBench-style natural overlap, never adversarial booby-traps) and carries a stable
ID, a type, its touch-set on the shared substrate, what it collides with, an independently-
implementable check, and **behavioral acceptance criteria** (the raw material for the hidden gate).
Full field spec in [`backlog/README.md`](backlog/README.md).

Item types: `feature` (new vertical capability) · `ux-fix` (e.g. free-text Category/Unit → discrete
dropdowns) · `debt` (curated obstacle that funnels agents through shared files) · `migration`
(framework/dependency churn) · `improvement` (polish, a11y, perf).

## Levels

| Level | Workload | Agents | Role |
|-------|----------|--------|------|
| **L1 · Standard** | 3 vertical feature slices | 3 | calibration / problem-in-vivo |
| **L2 · Migration-concurrent** | L1 + Dependabot-remediation + framework-major-upgrade | 5 | today's flagship |
| **L3 · Saturation** | L2 + a large UX/feature/improvement batch | N (1:1) | maximal collision density |

Exact backlog-ID membership per level is in [`levels.md`](levels.md).

## Run-config

A `runs/*.run.yaml` is the **repeatable definition of one run** — runner-agnostic, so any harness can
execute it. It pins: base tag, arm, topology, level (→ resolved backlog IDs), agent count, model +
version, temperature, per-agent budget cap, integration mode (mechanical merge / no resolver for the
first experiment), the reference/gate tag, K trials, and the metrics captured. Schema in
[`runs/README.md`](runs/README.md).

## Scope of the current effort

**Design + backlog only.** This folder, the backlog bank, the level definitions, and example
run-configs. **Not** in scope yet: actually implementing the new features into a working
`arena/reference` branch + hidden gate — that is a separate, larger build, planned on its own once
the backlog is settled.
