# clair — Benchmarking Harness

> **Status: draft for review.** The spec for an **in-repo benchmarking harness** that spins
> up synthetic repo scenarios, measures **latency** and **token usage** across clair's
> surfaces, and tracks both over time so we can tune deliberately instead of guessing. This
> is the empirical backstop for the budgets asserted in [stats-digest.md](stats-digest.md)
> and the cost claims in [../product.md](../product.md). Scope: the harness itself — scenario
> model, metrics, runner, regression gate. It measures the system; it does not define it.

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

## What we measure

Two families, each per surface.

### Latency

| Surface | Metric | Target (first pass, to tune) |
|---------|--------|------------------------------|
| Statusline render | read `digest.json` → printed line | **< 10 ms** (≪ 1 s tick) |
| Reduce step | fetch → filter → fold → atomic write | **< 250 ms** at 20 peers |
| `/clair:status` | refresh + full render | **< 500 ms** |
| Feature 6 query | fetch + filter snapshot + answer | **< 1 s** (excl. model time) |
| **End-to-end awareness** | peer emits → it appears in my digest | **< fetch period + 1 reduce** |

Report **p50 / p95 / p99**, not means — the tail is what gets a tool switched off.

### Token usage

The statusline and reduce paths must be **0 tokens** — the benchmark asserts this as a hard
floor, catching any accidental model call on the ambient path. Tokens are spent only on the
deliberate paths, and there we track cost per operation:

| Path | Tokens counted | Budget posture |
|------|----------------|----------------|
| Statusline render | must be **0** | hard assert; any non-zero is a failure |
| Reduce / digest build | must be **0** | hard assert |
| Emit a clair (feature 5) | classify intent + distil headline/about | minimize; this fires per shared event |
| Feature 6 query | NL question → store filter → answer | minimize; per deliberate ask |
| Relevance engine (future semantic) | whatever scoring costs | the seam most at risk; watch closely |

Token counts come from the harness driving the real emit/query code paths and summing model
usage (input + output) reported by the harness, attributed per scenario.

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
peers       = 20
branches    = 8
blip_rate   = "1/30s"                 # emitted clairs per peer
ttl_profile = "default"              # presence 5m, collision 15m, events 4h

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
stops surfacing the collision fails just as loudly as one that gets slow.

### Scenario families to cover

- **Scale ladder** — 1, 2, 5, 20, 100, 500 active peers. Watch reduce latency and digest
  size grow; find where compaction must kick in.
- **Proximity cases** — no overlap / same-folder / same-file / same-hunk, to exercise each
  radar rung and `near_you` scoring.
- **Churn** — high blip rate vs idle, to test TTL pruning and latest-wins presence.
- **Emit & query** — drive feature 5 and feature 6 to attribute token cost per operation.
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
- **Gate.** CI runs the suite and **fails on regression past a tolerance** (e.g. p95 latency
  +15%, or *any* token increase on a path asserted to be 0/minimal). Hard floors (statusline
  = 0 tokens, render < tick) are non-negotiable asserts.
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
2. **Token metering source** — for emit/query, count tokens from a real model call (true
   cost, but slow/non-deterministic CI) or from a recorded/stubbed model with fixed usage
   (deterministic, but a proxy)? Probably stubbed in the gate, real in a nightly.
3. **Where the gate runs** — every PR (catches regressions early, costs CI minutes) vs
   nightly (cheaper, slower feedback). Likely fast latency asserts per-PR, full token suite
   nightly.
4. **End-to-end timing** — the awareness-latency metric spans a fetch period; do we benchmark
   it against a real loopback git remote, or model the transport as a fixed delay until the
   transport spec exists?
5. **Crate boundary** — `clair-bench` as a dev-only crate vs an optional workspace member;
   how to keep its deps out of the shipping binary entirely.
