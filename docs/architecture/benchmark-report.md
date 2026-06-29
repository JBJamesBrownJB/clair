# clair — Benchmark Result Report (format + illustrative mock)

> **Status: draft for review.** Defines what a [value-benchmark](value-benchmark.md) run
> *outputs* — the report that answers *"did clair measurably improve outcomes vs disciplined
> isolation, and on what?"* The numbers below are **ILLUSTRATIVE PLACEHOLDERS** to show the
> shape, not results. The report's verdict logic enforces the falsification discipline (a
> conflict-count win that isn't a task-success win is **not** a pass).

> **New to the terms?** *Arm, slice, semantic vs textual conflict, presence/beacon/context-swap,
> RCC* — all defined in plain English in the [glossary at the top of value-benchmark.md](value-benchmark.md#plain-english-glossary-read-this-first).
> Quick version: an **arm** = one way of running the experiment (A = clair off / isolated; B =
> clair on at increasing levels; C = one all-knowing agent = the ceiling). A **slice** = one
> feature. **All-pass rate** = how often the finished app actually works (the headline).
> **Textual conflict** = the normal git merge conflict; **semantic conflict** = merges clean but
> is silently broken (clair's whole point). **RCC** = the coordination tax (lower is better).

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
arena: Larder@<tag>  ·  slices: 5  ·  trials K: 10  ·  agent: Claude Code (headless)
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

## How reports are minted & stored

Same pattern as the [statusline digest](stats-digest.md): **emit raw immutable facts, derive
every view from them, never bake truth into a render.** Three layers, each a pure function of the
one below:

1. **Record** — one JSON file per **trial** (one fleet → merge → gate). Immutable, append-only,
   and **self-describing**: it embeds its *full config* so a number is never orphaned from the
   conditions that produced it. Raw truth.
2. **Rollup** — derived per **config** (arm × level): medians + p10/p90 over the K records.
   Recomputable from records, therefore disposable.
3. **Render** — the `report.md` (the format above) **and** the viewer. Both read the rollup;
   neither is a source of truth. The mock above is a *render target*, not a hand-authored doc.

**The record** (one trial) — sketch; `schema_version` + reader-ignores-unknown, same rule as the
[wire format](data-model.md):

```json
{
  "schema_version": 2,
  "run_id": "larder-<config-hash>-<trial>",
  "minted_at": "<iso8601, stamped by the harness>",
  "config": {
    "arena": { "app": "Larder", "branch": "arena/base", "sha": "1a5cd3d", "ref": "arena-base-v1",
               "gate_sha": "bfa46b5", "seed": "fixed-40-items", "debt": "curated" },
    "arm": "B", "clair_level": "beacon", "scenario": "migration-concurrent",
    "agent": { "harness": "claude-code-headless", "model": "claude-opus-4-8", "version": "<build>" },
    "k_index": 3, "k_total": 10,
    "integration": "mechanical-merge",
    "budget_cap": { "tokens": 6000000, "wall_clock_min": 90 },
    "clair_sha": "<git sha of clair under test>",
    "container": "<image digest>",
    "prompt_hashes": { "slice1": "...", "slice5": "..." }
  },

  "outcome": {
    "all_pass": false,
    "per_feature": { "authz": true, "search": true, "export": false, "deps": true, "upgrade": false },
    "completed_within_budget": true
  },

  "cost": {
    "build_tokens": 4200000,
    "rework_tokens": 900000,
    "sub_agent_tokens": 1100000,
    "clair_overhead_tokens": 180000,
    "tokens_by_io": { "input": 3100000, "output": 1100000, "cached": 700000 },
    "wall_clock_min": 38,
    "integration_min": 3,
    "gate_min": 6,
    "est_usd": 0.0
  },

  "churn": {
    "merged": { "added": 1840, "removed": 320, "net": 1520, "files": 41 },
    "lockfile_loc": 2200
  },

  "per_agent": [
    {
      "slice": "authz", "model": "claude-opus-4-8",
      "tokens": { "total": 980000, "input": 720000, "output": 180000, "cached": 80000 },
      "sub_agents": 2, "turns": 31,
      "wall_clock_min": 22,
      "churn": { "added": 410, "removed": 60, "files": 9 },
      "commits": 4, "tests_written": 6, "own_tests_pass": true,
      "finished": "completed",
      "clair": { "events_emitted": 12, "events_consumed": 7, "acted_on_signal": 3,
                 "overhead_tokens": 60000, "added_latency_ms_p50": 90 }
    }
  ],

  "overlap": {
    "pairs": [
      { "a": "search", "b": "export",
        "shared_files": ["src/shared/serialize.ts", "src/server/queries/items.ts"],
        "jaccard": 0.34 }
    ]
  },

  "conflicts": {
    "textual": { "count": 4, "files": 3, "hunks": 9,
                 "loc": { "p50": 18, "p90": 90, "p99": 120, "max": 120 } },
    "semantic": { "unprotected_endpoints": 2, "duplicate_projections": 1,
                  "version_skew_type_errors": 5, "regressions": 0 }
  },

  "floors": {
    "tsc_errors": 5, "tsc_pass": false,
    "build_pass": true,
    "lint_errors_delta": 0
  },

  "collisions": [
    { "kind": "unprotected_endpoint", "endpoint": "/api/items/export", "blind_to": "authz" }
  ],

  "gate": {
    "suite_sha": "<held-out suite version>", "passed": 33, "failed": 2, "total": 35,
    "failed_by_category": { "authz": 0, "search": 0, "export": 2, "deps": 0, "upgrade": 0, "regression": 0 }
  },

  "merge_cycles": 1,

  "artifacts": { "merged_diff": "<path|digest>", "transcript_dir": "<path>", "per_agent_diffs": "<dir>" },
  "excluded": null
}
```

**Field legend** (the non-obvious ones; reader ignores unknown keys, so the schema can grow):

- **`cost.clair_overhead_tokens`** — clair's *own* cost (emit + query + context-swap payloads),
  counted on clair's side and kept **separate** from `build_tokens`. Zero in Arm A. The B−A
  verdict is read **net of this**, so clair must pay for itself — burying it in the agent totals
  would be dishonest. The matching per-agent breakdown lives in `per_agent[].clair.overhead_tokens`.
- **`churn`** — LOC added/removed/net + files, for the merged result and per agent. **Bin every
  headline metric by churn** so clair can't "win" merely by inducing smaller diffs (the
  proof-of-problem guardrail). `lockfile_loc` is isolated because slices 4 & 5 rewrite the
  lockfile and would otherwise swamp the churn signal.
- **`per_agent[]`** — the **per-agent axis** (conflict behaviour varies ~2× across agents). Per
  slice: tokens (in/out/cached), sub-agents spawned, turns, wall-clock, churn, commits, tests
  written, whether its *own* tests passed, and `finished` ∈ `completed | stalled | hit_cap`
  (a `hit_cap`/`stalled` agent is a real counted outcome, not a retry).
- **`overlap`** — the **touch-set overlap matrix**: which slice pairs edited the same files, with a
  Jaccard score. This is the *independent variable* that manufactures collisions, so it's recorded
  raw, not inferred after the fact.
- **`conflicts.textual.loc`** — the **size distribution** (p50/p90/p99/max), not just a max — the
  tail is where painful merges live. `conflicts.semantic.version_skew_type_errors` is the
  TS-arena's signature failure (a feature written against the pre-upgrade API).
- **`floors`** — the **cheap deterministic semantic-conflict detectors** run *at merge* before the
  full gate: `tsc --noEmit` error count + pass, `build_pass`, and the lint delta. They catch a
  large share of version-skew for ~free.
- **`gate.failed_by_category`** — gate failures bucketed by slice + `regression`, so a fail is
  attributable to *which* feature broke, not just a count.

**Recorded-raw vs derived-in-rollup.** Everything above is a **raw fact** the harness measures for
one trial. The headline efficiency numbers are **derived in the rollup** (pure functions of these
records across K trials), never stored in the record: **RCC** = 1 − SR(k)/SR(1), **cost-to-all-pass**
(tokens + wall-clock among gate-passers only), **tokens-per-passing-feature**, and medians/spread.
Keeping them out of the record preserves the "emit immutable facts, derive every view" rule — a
rollup is always recomputable, a record never lies.

> **Honesty flag carried from the value benchmark:** raw **textual-conflict count is reported but
> never the verdict** — slices 4 & 5 rewrite `pnpm-lock.yaml`, so it's ≈100% in both arms by
> design. Value is read from `rework_tokens`, cost-to-all-pass, the `floors` (tsc/build), and the
> semantic `gate` — never conflict count.

**Storage layout** — immutable records, derived everything-else:

```
benchmark/results/<arena-tag>/
  runs/<config-hash>/<trial>.json   # immutable atomic records — raw truth
  rollups/<config-hash>.json        # derived stats (medians + spread) — regenerable
  reports/<config-hash>.md          # rendered human report
  index.json                        # catalog the viewer reads
```

- **JSON, not YAML** — the harness writes it, nobody hand-edits it, it's `jq`-able and
  unambiguous.
- **Commit the light layer** (records + rollups + index) — small, diffable, gives free trend
  tracking across clair versions (on `main` or a dedicated `results` branch).
- **Keep the heavy layer out of git** — merged diffs and agent transcripts are referenced by
  path/digest from the record and live in a local/artifact store, not version control.
- **`minted_at` is stamped by the harness**, never inside a workflow script (scripts can't read
  the clock); `run_id` is a content hash of the config + trial index, so it's deterministic.

## The viewer

A **local-first static site** (`benchmark/viewer/`) — a single `index.html` + JS, or an
Observable Framework build — that loads `index.json` and the records and renders the same tables
as `report.md` *plus* interactive compare/graph. **Zero infra, runs offline, diffable, deploys to
GH Pages** if it's ever worth sharing. It's a *lens* on the JSON, never a service that owns data.

Charts that earn their place:
- **Arm × level grouped bars**, one panel per headline metric.
- **RCC-vs-k curve** — the money chart: the coordination-tax curve clair must *flatten*.
- **Per-slice all-pass small-multiples** — which feature each arm dies on.
- **Trial-distribution box/strip plot** — so spread is visible, not hidden behind a median.
- **Trend over time / clair version** — regression-watch as clair evolves.

*Alternative considered:* a small Streamlit/Python app — nicer for ad-hoc analysis, but it needs
a runtime and a server. Rejected for v1: the data is already JSON and static keeps the viewer a
lens, not a service.

## Open questions

1. **Significance method** for small K (bootstrap CIs vs a simple sign test) — keep it honest at
   K=10–20.
2. **One report per config**, plus a roll-up across debt/seed/agent variants? (Likely a per-run
   report + a matrix summary — the `index.json` catalog is the seam for the cross-config view.)
3. **Machine-readable companion** — *resolved:* the per-trial JSON **record** is the canonical
   artifact; the `report.md` and viewer are renders derived from it (see above).
