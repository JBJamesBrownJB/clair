# clair — Benchmark Result Report (format + illustrative mock)

> **Status: draft for review.** Defines what a [value-benchmark](value-benchmark.md) run
> *outputs* — the report that answers *"did clair measurably improve outcomes vs disciplined
> isolation, and on what?"* The numbers below are **ILLUSTRATIVE PLACEHOLDERS** to show the
> shape, not results. The report's verdict logic enforces the falsification discipline (a
> conflict-count win that isn't a task-success win is **not** a pass).

## What the report must do

- Lead with a **verdict** keyed to **task success** (all-pass rate / cost-to-completion), never
  to conflict count alone.
- Show the **arms side by side** with the clair-level ablation, so we see *which* capability
  earned the value.
- Report **medians + spread over K trials** (it's a distribution, not a verdict) and flag when a
  delta is within noise.
- Surface the **concrete collisions** (the auth-gap, the duplicate projections), not just rates.
- Separate **cost** (tokens/time) from **correctness** (all-pass), per the proof-of-problem.

---

## ILLUSTRATIVE MOCK

```
clair · Value Benchmark — Run Report                         (ILLUSTRATIVE — placeholder numbers)
arena: system-register@<tag>  ·  slices: 5  ·  trials K: 10  ·  agent: Claude Code (headless)
integration: mechanical-merge + hidden gate (no resolver)  ·  debt: clean  ·  seed: fixed-30-systems
```

### Verdict

> **clair @ _beacon_ is validated** on this config: **all-pass rate 30% → 50%** (+20pp, p=0.04)
> at **−16% build tokens**. The win is on **task success**, not merely conflict count → passes the
> falsification check. *presence-only*: no significant effect. *context-swap*: higher success
> (+24pp) but +cost — diminishing return over beacon here.

### Arms × headline metrics — median [p10–p90] over K=10

| Metric (arrow = better) | A · isolation | B1 · presence | B2 · beacon | B3 · context-swap |
|---|---|---|---|---|
| **All-pass rate** ↑ (the headline) | 30% | 32% | **50%** | 54% |
| Cost-to-completion, build tokens (M) ↓ | 4.2 | 4.3 | **3.5** | 4.6 |
| Semantic-conflict rate ↓ | 41% | 38% | 22% | 18% |
| Textual-conflict rate ↓ | 33% | 25% | 19% | 17% |
| Unprotected-endpoint gaps /run ↓ | 2.1 | 1.9 | 0.6 | 0.4 |
| Duplicate projections /run ↓ | 0.7 | 0.6 | 0.3 | 0.2 |
| Wall-clock (min) | 38 | 39 | 35 | 44 |
| **RCC** = 1 − SR(k)/SR(1) ↓ | 0.55 | 0.53 | **0.26** | 0.20 |

*Ceiling: single full-context agent (Arm C) SR(1) = 67% all-pass. RCC measures how much of that
each arm loses to coordination.*

### Per-slice (Arm A vs beacon — all-pass contribution)

| Slice | solo | A · parallel | beacon | dominant failure |
|---|---|---|---|---|
| auth + authz + roles | 8/10 | 4/10 | 7/10 | divergent middleware design |
| per-system history | 9/10 | 7/10 | 8/10 | event-pipeline contention w/ auth |
| risk heatmap | 9/10 | 5/10 | 8/10 | **dup projection** w/ graph |
| ownership graph | 9/10 | 5/10 | 8/10 | **dup projection** w/ heatmap |
| search | 8/10 | 4/10 | 7/10 | **unauthenticated endpoint** |

### Headline collision — the semantic security gap

> In **Arm A**, the heatmap / graph / search agents added endpoints blind to the auth agent's
> middleware → **68% of runs shipped ≥1 unprotected endpoint** (caught only by the hidden
> cross-feature security test, not by any agent's own tests). **beacon: 19%** — later agents saw
> auth activity in the request pipeline and gated their endpoints. *This is the "clean merge,
> silently insecure" failure isolation cannot catch — and the clearest demonstration of value.*

### Duplication detail

> heatmap + graph both add a projection in `eventsourcing/calculators`. **Arm A: 6/10 runs**
> built two near-duplicate aggregators (wasted ~0.4M tokens). **beacon: 2/10** — the second agent
> saw the first's presence in `calculators` and reused it.

### Cost

| | Arm A | beacon | Δ |
|---|---|---|---|
| Build tokens (incl. sub-agents) | 4.2M | 3.5M | −16% |
| Rework tokens (post-collision) | 0.9M | 0.3M | −67% |
| Est. cost @ API rates | $X | $0.84·X | − |

### Falsification check ✅

clair's win is on **all-pass rate** (task success) and **cost-to-completion**, not merely
textual-conflict reduction. *A conflict-count-only improvement would be reported here as
**NOT VALIDATED** (the CooperBench trap).*

### Confidence & caveats

- K=10 (medium); high variance on Java/Quarkus — widen K before any strong claim.
- did-not-complete within budget: A 7/10, beacon 5/10 (counted as failures, not dropped).
- 2 trials excluded for infra failure (container OOM), logged.
- Per-agent axis: this run is Claude-only; conflict behaviour varies ~2× across agents — not yet
  generalised.

---

## The verdict logic (how the headline is decided)

1. Compute B−A on **all-pass rate** and **cost-to-completion**, with significance over K.
2. **Validated** only if clair improves all-pass rate **or** cost-to-completion at the same
   all-pass rate. Conflict-count / duplication improvements are *reported as supporting*, never
   sufficient.
3. Attribute to the cheapest clair level that earns it (ablation), so we ship the minimum that
   works.
4. If no arm beats A on task success → **clair NOT validated on this config** (the kill-criterion
   firing — a real, publishable outcome).

## Open questions

1. **Significance method** for small K (bootstrap CIs vs a simple sign test) — keep it honest at
   K=10–20.
2. **One report per config**, plus a roll-up across debt/seed/agent variants? (Likely a per-run
   report + a matrix summary.)
3. **Machine-readable companion** (JSON) alongside the human report, for trend tracking across
   clair versions.
