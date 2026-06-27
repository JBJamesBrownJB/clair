# clair — Value Benchmark: the multi-agent collision arena

> **Status: draft for review.** The **stochastic, end-to-end experiment** that tests whether
> clair *measurably improves multi-agent coding outcomes* (tokens, time, quality) versus plain
> worktree isolation. This is the **kill-criterion instrument**. It complements — and must not
> be confused with — [benchmarking.md](benchmarking.md) (the deterministic cost micro-benchmark).
> It instruments the metrics established in
> [../research/proof-of-problem.md](../research/proof-of-problem.md).

## Plain-English glossary (read this first)

This doc and its siblings use trial/research shorthand. Here's every term in plain words, hung
on one story: **give several AI agents the same app, tell each to build a different feature at
the same time, then check whether the finished app actually works — and do that a few different
ways and compare.**

| Term | Plain English |
|---|---|
| **Slice** | One feature. "Thin slice" = it cuts top-to-bottom through the whole app (frontend + backend + database), like a slice through a cake. We have **5 slices** = 5 features; each agent builds one. |
| **Arm** | One *way of running* the experiment (the word's from medical trials: same patients, different treatment, compare results). Every arm builds the same 5 features on the same app — only the agents' setup changes. |
| **Arm A · isolation** | Each agent works **alone, blind to the others**, in its own copy. The control group. **clair is off.** |
| **Arm B · presence** | clair on, **lightest** setting: agents can *see that others exist* and roughly where they're working ("someone's in the auth files"). |
| **Arm B · beacon** | clair on, **medium**: agents can also *ping a short signal* when they're about to step on each other. |
| **Arm B · context-swap** | clair on, **heaviest**: agents actually *exchange details* about what they're building. |
| **Arm C · ceiling** | **One** agent builds all 5 features by itself with full knowledge. Not realistic, but it's the best-possible case (one brain, nothing to coordinate) — the score to aspire to. |
| **Ablation** | Turning clair's capabilities on *one at a time* (presence → beacon → context-swap) to see which one actually earns its keep — so we ship the cheapest level that works. |
| **All-pass rate** | **The headline score.** Out of K tries, how often did the finished app pass *all* our hidden tests = "all 5 features genuinely work and nothing else broke." |
| **Textual conflict** | The classic **git merge conflict** — two agents edited the same lines, git can't auto-combine. Annoying, but git *tells you*, so it's the *less* dangerous kind. **This is "the merge-conflict stat."** |
| **Semantic conflict** | The dangerous one, and clair's whole reason to exist. Code merges **cleanly** (git is happy) but the app is **broken or wrong** because two agents made incompatible assumptions. Only the tests catch it. |
| **Unprotected-endpoint gap** | A concrete semantic conflict: a URL that *should* require login but doesn't (the search agent didn't know the auth agent's login landed). An unlocked door git never warned about. |
| **Duplicate projection** | Two agents independently built the *same* data-crunching code because neither knew the other was → wasted work and money. |
| **Build tokens / cost** | How much AI compute it burned (≈ the bill). **Wall-clock** = how long it took. |
| **RCC** (Relative Coordination Cost) | The "coordination tax." One agent alone succeeds X% of the time; run several in parallel and they trip over each other and succeed *less*. RCC = how much you lost to that tripping. **Lower = less tax.** |
| **Hidden / held-out gate** | The secret test suite the agents never see, run by the harness *after* everything's merged. It's the impartial judge of "does the finished app truly work." Held out so agents can't game it. |
| **The headline idea** | We lead with "does the finished app work" (all-pass rate), **not** merge-conflict counts — because the failures that hurt are the *silent* ones git doesn't flag (the unlocked door), not the noisy textual ones. |

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

## Arena layout — external, branched, pinned by tag

The arena (`system-register`) stays its **own repo** — never vendored into clair. The runner
clones it **fresh per trial** (each agent needs a clean worktree), so a vendored copy would never
be the thing that runs; reproducibility comes from **pinning an immutable ref**, not co-location.
clair holds the *harness*; the arena is a *swappable, pinned fixture*.

Three branches on the arena:
- **`legacy`** — the original stack frozen as-cloned (Quarkus 1.7 / CRA3). Base for the
  *migration-concurrent* scenario.
- **`main`** — upgraded to a current, green stack. Base for the *standard* scenario (features not
  yet added — agents add them).
- **`reference`** (held out) — `main` + all 5 features integrated and passing. **Never seen by
  benchmark agents.**

**The `reference` branch earns its keep three ways:** (1) it **proves a coherent all-5 solution
exists**, so a failing arm is attributable to *coordination*, not an impossible task — the
attribution backbone; (2) it is the **source of the hidden acceptance gate** (behavioral tests +
seed-data expected values); (3) a supporting "built-as-intended" quality oracle. **Guardrail:**
the gate tests *behavior* ("every endpoint authz-gated," "search returns seeded systems"),
**never structure** ("matches reference's classes") — diff-matching would measure conformance,
not capability, and punish valid divergence.

**Pinning — done last, once each ref is frozen and green:** `legacy` is immutable on cut; tag
`main` → `arena-base-v1` once the upgrade is green; tag `reference` → `arena-reference-v1` once
the 5 features integrate and the gate passes. Use **annotated tags** (readable label → immutable
SHA); the harness config references tags. Revising the arena later = a **new tag** (`v2`); past
runs keep their old tag, so cross-version comparability is preserved.

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

### Scenario configs (what the workload runs as)

The same arms run under two scenarios, both terminating at the *same* modern-stack + 5-features
state → **the same `reference` gate judges both**:

- **Standard (control / calibration).** Base `main` (already upgraded); 5 feature agents. The
  cheap **problem-in-vivo first experiment** runs here (mechanical merge, no resolver).
- **Migration-concurrent (flagship).** Base `legacy`; 5 feature agents **+ 1 stack-migration
  agent** running concurrently; **resolver in the loop**. Maximal cross-cutting churn → the
  showcase demo *and* a high-signal measurement — *"ship 5 features while migrating the entire
  stack, no human untangling the wreck."* **Caveat that keeps it honest:** raw textual-conflict
  rate is *intentionally ignored* here (≈100% in both arms — a global `javax`→`jakarta`/MUI sweep
  collides with everything); value is read from **rework tokens, cost-to-all-pass, and the
  semantic gate**, never conflict count. Kept **out of the first experiment** — a resolver-less
  merge would fail in every arm and discriminate nothing. It stresses a *different* failure mode
  (mass-rebase / freeze-coordination) than the standard batch (duplication / divergent-arch /
  silent-semantic), and it's where clair's "global migration in flight — rebase/gate" signal is
  arguably strongest.

## Integration: build → fixed-merge → gate (and what we measure where)

The procedure, and the one rule that keeps it attributable:

1. **Build** — each agent builds its slice blind, in its own worktree (measure build tokens/time).
2. **Integrate** — the harness merges the branches. **This step is held FIXED and identical across
   arms.** *Why:* clair acts at **build time** (ambient awareness while coding), **not** as a
   merge resolver — so its value is that Arm B's agents produce outputs that *collide less*. If
   agents resolved conflicts with clair on, you'd conflate "helped avoid" with "helped resolve"
   and lose attribution. So whatever integrates is the same mechanism, clair-off, every arm. (The
   v2 rendezvous/deconfliction protocol is *also* build-time, so it too shows up as cleaner
   merges — integration still stays fixed.)
3. **Gate + score** — run the hidden suite on the integrated result.

Two instrumentation points, one run:
- **At first merge** — textual conflicts (count/size) + the hidden gate on the merged result →
  semantic conflicts, regressions, unprotected endpoints. *The raw collision measurement.*
- **Through to a working whole** — completion (reached all-pass?) + cost-to-completion.

**Sequencing — start simple:**
- **First experiment (baseline / problem-in-vivo):** build → **mechanical** merge → gate, **no
  resolver**. A non-auto-merge or gate failure = *did-not-complete*. Cheapest way to measure
  whether the problem exists in our arena; if isolated agents already merge clean and pass, stop.
- **Richer experiment (later):** add a **fixed resolver** (standard integration agent,
  budget-capped, clair-off) to drive toward all-pass → adds *cost-to-resolution* and a softer
  completion rate.

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

## The runner — headless agents, one flag for clair

Each slice agent is a **headless Claude Code run** (`claude -p`, or the Agent SDK for structured
token/result capture) executing **non-interactively** in **its own git worktree inside a
disposable container** (skip-permissions + arbitrary command execution demands a sandbox, not
the host). Per agent: the feature-intent prompt (its own feature only — information asymmetry),
rules (work in your worktree, write tests, commit when done, **never wait for input, decide and
continue if blocked**), pre-granted permissions, a **max-turns / token budget cap**, and freedom
to spawn sub-agents (token accounting aggregates them).

- **Completion is bounded, not guaranteed.** A non-interactive agent can still stall, finish
  early, or hit the cap — so the **hidden gate decides** whether it truly completed;
  *did-not-complete within budget* is a real, counted outcome (the success-rate axis), not a
  retry.
- **Arm A vs Arm B = clair plugin off vs on**, in the *identical* harness (resolves the
  injection question): same spin-up, prompts, and containers; the only difference is whether the
  clair plugin/MCP is configured. Keeps B testing *clair*, not bespoke glue — a one-flag toggle.
- **The loop:** spawn N agents → wait → **merge the worktrees** (collisions surface here) → run
  the hidden gate → score. × K trials × arms × levels.
- **Agent-agnostic by design.** Start with headless Claude (scriptable, available); keep the
  runner pluggable so Codex/Cursor/etc. can slot in later (per-agent axis — conflict behaviour
  varies ~2× across agents).

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
