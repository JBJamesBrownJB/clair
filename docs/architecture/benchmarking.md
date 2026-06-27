# clair — Benchmarking Harness

> **Status: draft for review.** The spec for an **in-repo benchmarking harness** that spins
> up synthetic repo scenarios, measures **latency** and **token usage** across clair's
> surfaces, and tracks both over time so we can tune deliberately instead of guessing. This
> is the empirical backstop for the budgets asserted in [stats-digest.md](stats-digest.md)
> and the cost claims in [../product.md](../product.md). Scope: the harness itself — scenario
> model, metrics, runner, regression gate. It measures the system; it does not define it.
>
> **This is the _cost_ benchmark (deterministic): "is clair cheap/fast?"** The separate
> [_value_ benchmark](value-benchmark.md) — "does clair improve multi-agent outcomes?" — is
> stochastic (real app, real agents, K trials) and is the kill-criterion instrument. Don't
> confuse the two.

## Why this exists

clair makes two quantitative promises it must keep, or it has no reason to exist:

1. **The ambient layer is ~free.** The statusline costs zero tokens and renders far inside
   its refresh tick; the reduce step stays cheap as a repo gets crowded.
2. **Awareness is timely.** A peer's relevant move surfaces within seconds, not minutes —
   bounded by fetch cadence, not by a slow path.

Both degrade silently as the design grows (more peers, more blips, a heavier relevance
engine, a chattier emit path). The only way to hold the line is to **measure continuously
against repeatable scenarios** and fail the build when a number regresses. The harness is
how "stay in the low-interruption, low-cost quadrant" (the landscape lesson) becomes a
test, not an aspiration.

> **Cost and recall are not value.** This harness measures whether clair is *cheap* and
> whether it *surfaces the right blip* — it **cannot** measure whether surfacing it improved
> an outcome. A green gate means "fast and correct," **never** "the thesis is proven." Value
> (did a surfaced clair change an agent's action vs clean worktree isolation?) is settled by
> dogfooding against the kill-criterion in [../product.md](../product.md), *The bet* — not
> here. Keep the two from being confused: a passing benchmark is necessary, not sufficient.

## What we measure

Two families, each per surface.

### Latency

| Surface | Metric | Target (first pass, to tune) | Gated? |
|---------|--------|------------------------------|--------|
| Statusline render (clair's part) | read `digest.json` → printed line, **in-process** | **< 1 ms** | ✅ gated |
| Statusline **spawn** (host's part) | OS process create + runtime init per tick | informational only | ⚠️ smoke, not gated |
| Reduce **fold** (transport-independent) | filter → fold → atomic write | **< 200 ms** at 20 instances | ✅ gated |
| Reduce **fetch** term | pull shadow refs | **mocked** (fixed delay) | ❌ not gated |
| `/clair:status` | refresh + full render | **< 500 ms** | ✅ gated |
| Feature 6 query | filter snapshot + answer | **< 1 s** (excl. model + fetch) | ✅ gated |
| **End-to-end awareness** | peer emits → appears in my digest | < fetch period + 1 reduce | 📊 tracked, not gated (transport mocked) |

Report **p50 / p95 / p99**, not means — the tail is what gets a tool switched off.

**Why the splits.** The harness materializes synthetic refs in a local store with no real
network, so it can only honestly gate the **transport-independent** work (the fold) and must
**label the fetch/transport term as mocked** — otherwise a green gate would certify "500
instances fine" while never exercising the very thing that melts at scale. And the statusline
budget splits clair's **in-process render** (sub-ms, gated) from the **host's per-tick spawn
cost** (tens of ms, worst on Windows / unsigned binaries) which clair doesn't control — see
[stats-digest.md](stats-digest.md). The spawn cost gets one machine-tagged wall-clock smoke
check **outside** the deterministic gate; the shipped reader must be cheap-to-spawn and
code-signed.

**Transport-tier metrics (wired when transport exists, gated then).** First-class, tracked
like token count: **refs-advertised-per-fetch**, **remote-bytes-per-reduce**, **packed-refs
rewrite time under presence-TTL churn**, and **the developer's *own* git latency**
(`status`/`commit`/`checkout` p95/p99) while clair refreshes presence at 20/100 instances —
clair's footprint on the host repo. A separate **remote-load-vs-peers** sweep against a real
hosted remote is the lab that **tunes the configurable sync cadence** (the riskiest
assumption; run once, outside the deterministic gate).

### Token usage

The statusline and reduce paths must be **0 tokens**. But a runtime token meter asserting
"0" is nearly a tautology — those paths contain no model client, so a one-line lint catches
it better. So the ambient-free guarantee is **primarily a static reachability lint** (no
model/Anthropic symbol is reachable from the statusline or reduce crates), with the runtime
0-token meter kept only as a **backstop** for dynamic-dispatch / subprocess calls the lint
can't see. Real token cost lives on the deliberate paths:

| Path | Tokens counted | Budget posture |
|------|----------------|----------------|
| Statusline render | must be **0** | static lint (reachability) + runtime backstop |
| Reduce / digest build | must be **0** | static lint + runtime backstop |
| Emit a clair (feature 5) | **input** (real tokenizer) + **output** | input gated per-PR; output nightly |
| Feature 6 query | **input** (real tokenizer) + **output** | input gated per-PR; output nightly |
| Relevance engine (future semantic) | whatever scoring costs | the seam most at risk; watch closely |

**Input vs output, because of determinism.** A real model call is non-deterministic (output
tokens vary run to run), so gating it per-PR would flap. But the **input** prompt is
deterministic — count it with the real tokenizer and gate it per-PR, which is exactly what
catches a prompt that doubles emit cost. **Output** tokens come from a real model run
**nightly**, not the per-PR gate. (This replaces the earlier "fails on any token increase"
claim, which a stubbed fixed-usage meter could never honestly back.)

## The scenario model

A scenario is a **declarative description of a synthetic repo moment** the harness can
materialize, drive, and tear down deterministically. Stored as data (one file per scenario)
so the suite grows by adding files, not code.

```toml
# scenarios/crowded-auth.toml
name        = "crowded-auth"
description = "20 peers active, 5 converging on auth, one true collision with me"
seed        = 42                      # deterministic — no wall-clock, no RNG drift

[repo]
instances   = 20                      # sessions, not humans — the count unit
branches    = 8
blip_rate   = "1/30s"                 # emitted clairs per instance
ttl_profile = "default"              # presence 5m, events 4h (collision is computed, no TTL)

[[actor]]                            # the collision we expect to detect
alias = "rajiv"; branch = "feature/auth"; touches = ["src/auth.rs:30-58"]

[me]
branch  = "feature/login"
working = ["src/auth.rs:40-50"]       # overlaps rajiv → must surface as near_you

[expect]                             # assertions, so a scenario is also a correctness test
near_you_contains = ["rajiv"]
proximity         = "hot"
statusline_tokens = 0
```

The `[expect]` block makes every scenario double as a **correctness fixture**: the harness
asserts the digest came out right *and* records what it cost to get there. A scenario that
stops surfacing a real collision fails just as loudly as one that gets slow — **and so does a
scenario that surfaces a _spurious_ one.** A false amber/red is a **hard failure on equal
footing with a missed hot**, because the lineage died of noise, not of missed events
(landscape.md). Recall without precision is not a passing grade.

### Scenario families to cover

- **Scale ladder** — 1, 2, 5, 20, 100, 500 active instances. Watch **fold** latency and
  digest size grow. (The transport term is mocked here, so the ladder certifies the fold, not
  the network — see the latency splits above.)
- **Proximity cases** — no overlap / same-folder / same-file / same-hunk, to exercise each
  radar rung and `near_you` scoring.
- **Precision / negatives** — edits that must **not** surface: refactors in unrelated files,
  exploratory churn, a peer who touches-and-reverts. `[expect]` asserts `proximity = "calm"`
  and `near_you_contains = []`. This family guards the existential false-positive rate.
- **Churn** — high blip rate vs idle, to test TTL pruning and latest-wins presence; includes
  the **developer's-own-git-latency** check while presence refreshes.
- **Garbage input** — malformed JSON / missing required L0 fields / oversized body: assert
  the digest still builds and latency holds (the fold skips and continues).
- **Emit & query** — drive feature 5 and feature 6 to attribute input-token cost per
  operation.
- **Cold vs warm** — first fetch vs steady state, to separate setup from hot-path cost.

## How the harness runs

```
scenario.toml ──▶ [materialize] ──▶ synthetic shadow refs + work.json
                                          │
                                          ▼
                   [drive] run the REAL clair code paths (reduce, render, emit, query)
                                          │
                       ┌──────────────────┼──────────────────┐
                       ▼                  ▼                  ▼
                  latency probes     token meter       [expect] asserts
                       │                  │                  │
                       └──────────────────┴──────────────────┘
                                          ▼
                              results/<scenario>/<run>.json  (timestamped, seed-stamped)
```

- **Materialize** builds a throwaway git repo (or a temp `.git/clair/` store) populated to
  the scenario's spec — synthetic peers, blips, and a `work.json` for "me." Deterministic
  from `seed`; no wall-clock, no real network.
- **Drive** invokes clair's *actual* code, not a mock — the reduce pipeline, the render
  ladder, the emit and query paths. Benchmarks must exercise real code or they measure
  nothing.
- **Measure** wraps each path in a latency probe and a token meter, and checks the `[expect]`
  block.
- **Record** writes a structured result per run so numbers are comparable over time.

The harness lives in its own crate (e.g. `crates/clair-bench`) so it never weighs on the
shipping binary, and exposes a CLI:

```
clair-bench run                 # whole suite, default seeds
clair-bench run crowded-auth    # one scenario
clair-bench compare <a> <b>     # diff two result sets, flag regressions
clair-bench baseline update     # promote current results to the tracked baseline
```

## Tracking over time — the regression gate

Each run appends to a tracked baseline (`benchmarks/baseline.json`), so we can answer "did
that change make the statusline slower or the emit path pricier?" with a number.

- **Baseline.** Committed p50/p95/p99 latencies and token costs per scenario.
- **Gate.** CI runs the suite and **fails on regression past a tolerance** (e.g. p95 fold
  latency +15%, or an **input-token** increase on emit/query). Hard floors — the ambient-free
  lint (no model reachable from statusline/reduce), clair's in-process render < tick, and a
  spurious escalation — are non-negotiable. Mocked-transport terms are tracked, not gated.
- **Trend.** Results are timestamped and seed-stamped so a chart of cost-over-commits is
  trivially derivable — tuning becomes visible, not anecdotal.

Determinism is essential: same seed + same code ⇒ identical synthetic input, so a number
moving means *clair* moved, not the scenario. (Mirrors the no-`Date.now()`/no-RNG discipline
clair's own code follows — measurements must be reproducible.)

## Relationship to the rest of the design

- It **validates [stats-digest.md](stats-digest.md)'s budget** — the statusline-is-free and
  reduce-is-cheap claims become enforced numbers.
- It **guards the relevance seam** — when semantic matching (the open hard problem) lands, it
  arrives behind these benchmarks, so we see its latency/token cost immediately and can keep
  it "an upgrade, never a blocker" as [data-model.md](data-model.md) promises.
- It **does not define behavior** — scenarios encode expectations drawn from the specs; the
  harness measures, it doesn't decide.

## Open questions for review

1. **Synthetic vs replay** — author scenarios by hand (clear, but artificial), or also
   capture/replay real multi-agent sessions (realistic, but noisier and harder to make
   deterministic)? Likely both: hand-authored for the gate, replay for discovery.
2. **Token metering source** — *resolved:* gate **deterministic input** tokens per-PR (real
   tokenizer over the real prompt) and run **output** tokens against a real model **nightly**.
   No fixed-usage stub pretending to be a gate.
3. **Where the gate runs** — *resolved direction:* fast latency + input-token asserts per-PR;
   full output-token suite + real-remote sweeps nightly.
4. **End-to-end / transport timing** — *resolved for now:* model the transport as a **fixed
   delay**; the real loopback/container remote is **deferred until the transport spec lands**
   — do **not** build the container harness yet. The one exception is the run-once
   remote-load-vs-peers sweep that tunes cadence, explicitly outside the deterministic gate.
5. **Crate boundary** — `clair-bench` as a dev-only crate vs an optional workspace member;
   how to keep its deps out of the shipping binary entirely.
