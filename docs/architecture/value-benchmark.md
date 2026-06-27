# clair — Value Benchmark: the multi-agent collision arena

> **Status: draft for review.** The **stochastic, end-to-end experiment** that tests whether
> clair *measurably improves multi-agent coding outcomes* (tokens, time, quality) versus plain
> worktree isolation. This is the **kill-criterion instrument**. It complements — and must not
> be confused with — [benchmarking.md](benchmarking.md) (the deterministic cost micro-benchmark).
> It instruments the metrics established in
> [../research/proof-of-problem.md](../research/proof-of-problem.md).

## Two benchmarks, do not confuse them

| | **Cost micro-benchmark** ([benchmarking.md](benchmarking.md)) | **Value macro-benchmark** (this doc) |
|---|---|---|
| Question | Is clair itself cheap/fast? | Does clair improve agent *outcomes*? |
| Method | synthetic scenarios, **deterministic (seeded)** | a real app + real agents, **stochastic** |
| Repeatability | exact (same seed → same result), **gated in CI** | statistical (**K trials**, medians + spread), run periodically |
| Proves | clair stays in budget | the **thesis** (awareness > isolation) |

This benchmark cannot be seed-deterministic — agents are nondeterministic — so it is **trial-
based and statistical**, never a single run.

## The arena (the example app)

A small but **realistic** application, pinned at a git tag for reproducibility:

- **Shape:** web frontend + 2–3 backend services + auth + a shared datastore. The point is a
  realistic **shared substrate** — auth middleware, the user model, shared types / API client,
  DB schema & migrations, routing — because that substrate is the **contention surface** where
  parallel agents collide.
- **Test coverage:** good but **deliberately incomplete** — enough that breakage is detectable,
  loose enough that agents can still ship regressions (realistic).
- **Tech debt:** deliberate, **commonly-found**, and **fixed across all runs** so it's a
  controlled obstacle: e.g. a bloated shared util / god-file everyone must edit, inconsistent
  error handling, a fragile shared type, a missing abstraction that invites copy-paste. Debt
  that funnels agents through the *same* files **amplifies collisions** — that's the point.

## The workload — 5 thin-slice features

Five **thin-slice** features, each cutting through **all layers** (frontend → service → auth →
DB), with **well-known implementations** (low novelty = lower variance), e.g. favourite/
bookmark, soft-delete, audit-log, CSV export, rate-limit, search filter.

- **Touch-sets deliberately overlap.** Features are chosen so their file/symbol footprints
  *intersect* on the shared substrate (everyone edits the user model / auth / shared client).
  Overlap is the independent knob that creates collisions; design it explicitly, don't leave it
  to chance.
- **Prompts are feature/intent-level only** — "users can bookmark items," not a task list. Each
  **slice agent is free to spawn its own sub-agents**, plan a strategy, and implement **with
  tests** (normal agent behaviour).

## The arms — the heart of it

The same workload run under different conditions; clair's value is the **delta**.

| Arm | Setup | Role |
|-----|-------|------|
| **A — Isolation baseline** | N agents, each own worktree/branch, **no awareness**, integrate (merge) at the end | the status quo clair bets against |
| **B — clair on** | identical, **plus clair** at a specified capability level | the treatment; value = **B − A** |
| **C — Sequential/oracle** *(optional)* | one agent does all 5 in series | collision-free **upper bound** on quality, **lower bound** on parallel speed — the reference frame |

**Capability ablation within B.** Run B at increasing clair levels — *presence only* → *+
proximity beacon* → *+ context-swap* — to attribute **which capability earns the value** (and
catch the case where the cheap beacon already captures most of it).

## Metrics (dependent variables)

Instrument the [proof-of-problem.md](../research/proof-of-problem.md) metric list. Grouped by
how hard they are to score:

**Objective / auto-scored**
- **Tokens** — total across all agents + their sub-agents (the efficiency headline).
- **Wall-clock** — time to *all features merged and green*.
- **Merge conflicts** — count and size at integration (from git).
- **Regressions** — previously-green tests broken (test-result diff).
- **Final quality** — full-suite pass rate; do the features actually function.
- **Duplicated work** — same thing built twice (heuristic: near-duplicate new functions/util
  across slices).

**LLM-judged (with adversarial-verification caution)**
- **Rework** — commits reverted/rewritten; code churned then deleted.
- **Contradictory decisions** — two agents make incompatible choices on shared code.
- **"Built as intended"** — a rubric judgment over each slice's diff/PR.

## Reproducibility & statistics

- **Pin everything controllable:** model + version, temperature (where settable), identical
  prompts, identical repo tag, identical feature set + order, fixed tech debt.
- **K trials per (arm × level).** Report **medians and spread**, not single runs; check the B−A
  delta is real against trial variance (low K can be swamped by noise — start small to find
  signal, scale K once it's there).
- **Every run ends in an integration step** (merge all slices) → run the full suite → score.

## Sequencing — the smart first move

**Run Arm A (isolation) first, alone.** It measures how bad the problem is *in your own arena* —
the experimental half of proof-of-problem (the literature sweep is the other half). If 5
isolated agents already merge clean with no rework, **the problem is absent → clair is moot →
stop before building it.** Only a measurable isolation-arm collision cost justifies proceeding
to test clair against it. This is exactly the written kill-criterion from
[../product.md](../product.md), made executable.

## Honest risks

- **Cost.** arms × levels × K trials × (5 slice agents + their sub-agents) = many full agent
  runs. Budget deliberately; start with small N and few trials to find signal, scale later.
- **Variance may swamp signal** at low K — the result is a distribution, not a verdict.
- **Auto-scoring quality is imperfect** — objective metrics are solid; judged metrics need the
  same adversarial care as any LLM-judge.
- **Building the arena is real work** — the app, the overlapping features, and the curated debt
  are upfront investment, but they're a one-time fixture.

## Open questions

1. **Arena: build vs adopt.** Bespoke app vs fork an existing realistic sample; which stack
   (one mainstream stack keeps agent competence high and variance low).
2. **N agents / K trials** to start — smallest configuration that still produces collisions.
3. **The exact 5 features** and their **touch-set overlap matrix** (the collision design).
4. **Scoring split** — how much pure-objective vs LLM-judge; the rubric for "rework" and
   "contradiction."
5. **How clair is injected into Arm B** — via its plugin/MCP/hooks into whatever agent harness
   runs the slices; needs the agents to be clair-aware without hand-coding the coordination.
