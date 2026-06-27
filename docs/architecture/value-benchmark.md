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

> **Steal CooperBench's feature-construction method** (arXiv:2601.13295). Build each slice as an
> **anchor feature** (derived from a *real* PR in the forked app) **+ synthetic adjacent
> features** authored to *"plausibly co-occur and create natural overlap without adversarial
> specifications"* — natural collision, not booby-traps. Then **validate every feature
> combination is independently-implementable-but-conflicting** (each passes its own tests solo;
> pairs contend on shared code). Run with **information asymmetry**: each slice agent sees only
> *its own* feature spec, never the others' — the realistic condition that produces duplication
> and divergent-architecture failures.

## The arms — the heart of it

The same workload run under different conditions; clair's value is the **delta**.

| Arm | Setup | Role |
|-----|-------|------|
| **A — Disciplined isolation baseline** | N agents, own worktrees, **no awareness**, but **with the incumbent discipline** (small PRs, one-writer-per-module where natural), integrate at the end | the *fair* control clair must beat |
| **B — clair on** | identical, **plus clair** at a specified capability level | the treatment; value = **B − A** |
| **C — Single full-context agent** | one agent does all 5 in series with global context | the **RCC ceiling** — `SR(1)`, the collision-free upper bound |

> **The control must be the *disciplined* incumbent, not a naive one.** Proof-of-problem found
> worktrees + small-PR + one-writer discipline already cut conflicts ~80%, and this skeptic
> claim is **unrefuted**. If Arm A is a strawman (naive agents that obviously collide), a clair
> "win" proves nothing. A has to be the real-world best practice for B − A to mean anything.

**Capability ablation within B.** Run B at increasing clair levels — *presence only* → *+
proximity beacon* → *+ context-swap* — to attribute **which capability earns the value** (and
catch the case where the cheap beacon already captures most of it).

## Outcome is a fixed gate, not a fuzzy grade — the hidden acceptance suite

The backbone that separates *"does it work"* from *"how efficiently."* The harness owns a
**hidden, held-out acceptance suite** — a solid, comprehensive pass/fail definition of **"all 5
features work and nothing regressed"** — that the slice agents **never see** (visible tests get
gamed). Agents write their own tests as part of their process; the hidden suite is the
**ground-truth arbiter**, run by the harness after integration. Every run then factors cleanly:

- **Completion (outcome axis).** Did the arm reach the all-pass gate? Report **per-feature pass +
  the all-pass rate** (not pure binary — keep per-feature signal). This is the success-rate / RCC
  numerator.
- **Cost-to-completion (efficiency axis, isolated).** Among runs that reached the gate, tokens /
  wall-clock / rework / merge cycles spent. Outcome held constant → the journey is the measurement.

clair's value shows as **either a higher all-pass rate or a lower cost-to-all-pass** (ideally
both) vs the disciplined baseline.

Why it's the right backbone:
- **Stabilizes the dependent variable** — outcome is objective ground truth, not LLM judging,
  cutting the stochastic-agent variance head-on.
- **It _is_ the semantic-conflict + silent-deletion instrument** — to make "all-pass" mean "truly
  works," the hidden suite must include **cross-feature integration + behavioral-regression**
  tests, i.e. the cumulative behavioral suite the proof-of-problem named as the headline. One
  mechanism, both jobs.
- **Falsification-proof in the right way** — clair cannot win by gaming conflict counts, only by
  raising all-pass rate or lowering cost-to-all-pass (closes the CooperBench trap).

Pair it with a **budget cap** (max tokens/time per run) so cost-to-completion is bounded; a run
that doesn't reach the gate by the cap is counted as **did-not-complete** (a failure, not
dropped). **Hidden ≠ the agents' own tests** — keep the arbiter strictly held out, or it stops
measuring real quality.

## Metrics (dependent variables)

The full instrument list — with real-world baselines and methods — is the metrics table in
[proof-of-problem.md](../research/proof-of-problem.md). The evidence reshaped the priorities:

**The headline metrics — where clair's value actually lives ⭐**
- **Semantic / dynamic conflict rate** — *cleanly-merged* pairs that still break compile/lint/
  tests. Worktrees + git defuse the *textual* case, so this is the differentiator. Run the full
  gate on **every cleanly-merged pair**.
- **Feature-deletion / silent-regression** — a **cumulative behavioral test suite that grows as
  each agent ships**, re-run in full after every merge. The only instrument that catches
  "globally incoherent" damage per-branch tests miss.
- **Relative Coordination Cost** `RCC = 1 − SR(k)/SR(1)` — the single cleanest headline: Arm C
  (full-context single agent) vs k isolated agents, with/without clair. Sweep k → the curve
  clair must flatten.

**Supporting — objective**
- Tokens (total + **rework tokens after a detected collision**); wall-clock to all-green;
  textual merge-conflict rate + **p90/p99 magnitude (the tail)**; duplicated-work rate;
  post-merge defect rate; intervention rate.

**Supporting — LLM-judged** (adversarial-verification caution)
- Rework, contradictory decisions, "built as intended" rubric over diffs. Use CooperBench's
  **failure taxonomy as the label set**: work-overlap/duplication, divergent-architecture,
  repetition, unresponsiveness, broken-commitment — so judged results are categorized, not
  freeform.

> **Design to FALSIFY, not confirm.** The sharpest finding: CooperBench showed inter-agent
> communication cut merge conflicts but **did not raise task success**. So **success = end-to-end
> task success / fewer post-merge regressions — never merely "fewer textual conflicts."** A
> textual-conflict win with no outcome gain is the failure mode this benchmark exists to expose.
> **Control for churn size** (bin metrics by induced LOC) so clair can't "win" by inducing
> smaller PRs, and **keep a per-agent axis** (conflict behavior varies ~2× across agents).

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

## The concrete arena

Locked: **`system-register`** — see [benchmark-arena.md](benchmark-arena.md) for the
instantiation (the event-sourced CQRS app, the shared-substrate map, the 5 grounded slice
features, the deterministic seed, and the hidden acceptance gate).

## Open questions

1. **Arena: build vs adopt.** *Resolved:* adopt `system-register` (decontaminated + team-owned
   → the two validity axes). Stack is Java/Quarkus — an agent-competence watch-item, controlled
   across arms. See [benchmark-arena.md](benchmark-arena.md).
2. **N agents / K trials** to start — smallest configuration that still produces collisions.
3. **The exact 5 features** and their **touch-set overlap matrix** (the collision design).
4. **Scoring split** — how much pure-objective vs LLM-judge; the rubric for "rework" and
   "contradiction."
5. **How clair is injected into Arm B** — via its plugin/MCP/hooks into whatever agent harness
   runs the slices; needs the agents to be clair-aware without hand-coding the coordination.
