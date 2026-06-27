# clair — Stats Digest & Statusline

> **Status: draft for review.** The **materialized-view layer** that sits between the data
> model and the UI. Defines the *digest* — the precomputed stats object every surface
> renders — its storage under `.git/clair/`, the reduce pipeline that builds it, and the
> render ladder the statusline walks. Scope is the **view layer only**: the raw clair object
> lives in [data-model.md](data-model.md); **transport** (how refs sync) is deferred to the
> architecture spec; the **relevance engine** that scores `near_you` is the sealed seam.
> Derived from [../core-features.md](../core-features.md) (features 2 and 6) and
> [../product.md](../product.md).

## The principle: one digest, many renders

The statusline cannot run `git fetch` on its refresh tick — Claude Code's `refreshInterval`
fires as often as every second, and a network round-trip there would stall the line. So the
**network and the display are decoupled** by a cheap local file in between:

```
git shadow refs ──fetch──▶ raw clair store ──reduce──▶ digest.json ──read──▶ renders
 (truth, synced)            (.git/clair/snapshot)        (the stats)          ├─ statusline (1 line)
                                                                              ├─ /clair:status (full)
                                                                              └─ "who's in the repo?" (feature 6)
```

- **Fetch + reduce** is the *only* step that touches the network and the clock. It pulls
  the shadow refs, drops TTL-expired blips, folds the survivors into a stats rollup, and
  writes the result atomically.
- **Every renderer only reads `digest.json`** (or the richer `snapshot/` for deep queries).
  No renderer fetches on the hot path. The statusline polls one small file; sub-millisecond.

The load-bearing idea: **the digest is a materialized view over the clair store, and the
statusline is one render of it.** The dashboard and feature 6 are other renders of the same
source. Nothing downstream of the digest computes — it reads and styles.

## The digest — the stats data model

A pure function of *(live clairs at time `as_of`, my current work context)*. Every number
any surface shows is a field here.

```json
{
  "as_of": "2026-06-27T14:03:11Z",
  "stale_after": "2026-06-27T14:03:41Z",
  "repo": "clair",

  "presence": {
    "count": 14,
    "branches": 6,
    "by_area": [ {"area": "auth", "n": 5}, {"area": "api", "n": 3}, {"area": "ui", "n": 2} ],
    "roster": [
      {"actor": "rajiv", "area": "auth", "file": "src/auth.rs",     "branch": "feature/auth"},
      {"actor": "mei",   "area": "api",  "file": "src/api/login.rs", "branch": "feature/api"}
    ]
  },

  "near_you": [
    {"actor": "rajiv", "kind": "collision", "region": "src/auth.rs:30-58",
     "headline": "merge-risk: you & rajiv both in auth.rs", "score": 0.91}
  ],

  "highlights": {
    "unseen": 2,
    "by_kind": {"decision": 1, "incident": 1, "finding": 1},
    "items": [ {"id": "019a0…", "kind": "decision", "actor": "rajiv",
                "headline": "moved auth guard into AuthMiddleware", "age": "12m"} ]
  },

  "self": {"alias": "jb", "branch": "feature/login",
           "last_emit": "2026-06-27T13:55:02Z", "unseen": 2},

  "proximity": "hot"
}
```

Three derived rollups carry all the weight:

| Field | What it is | Reduced from | Powers |
|-------|-----------|--------------|--------|
| `presence.count` + `by_area` | headcount, and *where the crowd is* (folder buckets) | all live `presence` clairs | the resting statusline, "who's in the repo?" |
| `near_you` | relevance hits: clairs whose `about` overlaps **my** work, scored | clair store ∩ `work.json` | the radar color, escalation |
| `highlights` | emitted events with an unseen count | live `decision`/`incident`/`finding` vs the cursor | "N new", the dashboard feed |

`proximity` is `max` over `near_you[].score`, bucketed to `calm | warming | hot` and
**precomputed** so the statusline does zero logic — it reads one enum and picks a color.

### Field cost — why two stores, not one

`roster` and `highlights.items` are capped (e.g. roster to ~8 entries, items to the most
recent few) so `digest.json` stays small enough to read and parse on every 1s tick. The
**uncapped, full-fidelity** data lives in `snapshot/` and is read only by surfaces that can
afford it (`/clair:status`, feature 6). The split is purely by cost: tiny digest for the
hot path, rich snapshot for the cold path.

## Storage — under `.git/`, never in the working tree

```
.git/clair/
  cursor          # what I've already seen — local-only, never pushed (the loop-safety ground)
  work.json       # my current work context (open/edited paths, symbols) — written by an edit hook
  snapshot/       # raw live clairs, TTL-filtered: source for queries & the dashboard
  digest.json     # the rollup above: source for the statusline (read every tick)
```

Living under `.git/` is deliberate and matches product.md's "local-only cursor, never
pushed":

- **Invisible to the repo.** Never appears in `git status`, can't be accidentally staged or
  committed, never collides with the user's work.
- **Per-clone local.** Each checkout has its own digest — correct, since `near_you` and the
  cursor are inherently per-developer.
- **Disposable.** Deleting `.git/clair/` loses nothing durable; the next fetch+reduce
  rebuilds it from the shadow refs. Consistent with *ephemeral, not an audit log*.

Writes are **atomic** (write temp + rename) so a renderer never reads a half-written digest.

## The reduce pipeline — fetch → filter → fold → write

The one step that touches network and clock. Conceptually:

1. **Fetch** the shadow refs into the local store (transport's job; deferred).
2. **Filter** out TTL-expired clairs (`now > ts + ttl`) — the digest only ever sees live ones.
3. **Fold** the survivors:
   - group `presence` by actor (latest-wins) → `count`, `branches`, `by_area`, `roster`;
   - intersect the store against `work.json` and score → `near_you`, `proximity`;
   - diff emitted events against `cursor` → `highlights.unseen` and the feed.
4. **Write** `snapshot/` (full) and `digest.json` (capped), atomically, stamping `as_of` and
   `stale_after = as_of + refresh_period`.

**Cadence.** Runs on a background timer and opportunistically on git operations. It is the
unit we benchmark and tune (see [benchmarking.md](benchmarking.md)) — its period trades
freshness against fetch cost.

**Staleness is honest, not hidden.** If the reducer falls behind and `now > stale_after`,
the statusline does **not** invent state — it dims to grey and appends a faint `·stale`. The
line degrades to "I don't know right now" rather than showing confidently wrong numbers.

**`near_you` needs my side too.** It's the one rollup that depends on the consumer's current
work, supplied via `work.json` (written by an edit hook). This is exactly the "consumer work
context" seam deferred in [data-model.md](data-model.md); the reducer is where it plugs in.
Until the relevance engine lands, `near_you` is populated by the cheap deterministic signals
only (same file / same hunk), and `score` is a placeholder weighting.

## The render ladder — the statusline is a slice of the digest

The statusline computes nothing. It reads `presence.count`, picks a rung, and prints the
matching slice. `near_you` always wins when non-empty.

```
1–2 people    ◈ clair · rajiv ◐ auth   mei ◑ api          ← presence.roster, named
3–5 people    ◈ clair · auth · api · ui · 5 active         ← presence.by_area, areas listed
6+ people     ◈ clair · ●·14 · auth, api hot               ← by_area top-2 + count
near-you hit  ⚠ clair · rajiv auth.rs:40 ‹your file›        ← near_you[0] overrides everything
stale         ◈ clair · ·stale                             ← as_of aged past stale_after
```

- **Color** is read straight from `proximity` (`calm`→grey, `warming`→amber, `hot`→red).
  Earned by proximity, **never by volume**: a repo with 30 happy peers stays grey; one peer
  diverging in your hunk goes red.
- **Compaction dialect** (dots / orbs / sparkline / queue) is *only* the glyph set for the
  `6+` rung. All dialects render the same `by_area` + `count` fields, so the choice is a
  cosmetic late-binding, not a data decision — deliberately left open here.
- **Resting summary.** The `3–5` rung lists the distinct areas peers occupy (`auth · api ·
  ui`) straight from `by_area` — a small repo gets a one-glance "where is everyone."

## `/clair:status` — the full render

The statusline is the dial; this is the dashboard. Same digest, plus `snapshot/` for the
uncapped feed. Sections map one-to-one onto digest fields:

```
  clair · status                              feature/login · 14 active

  NEAR YOU ───────────────────────────────────  ← near_you
  ⚠  rajiv   auth.rs:30–58   diverged from your edits   3m ago
  ◐  mei     auth/login.rs   same folder                just now

  PRESENCE ──────────────────────────────────── ← presence
  14 active across 6 branches · hottest: auth (5) · api (3)
  ●●●●● auth   ●●● api   ●● ui   ●●●● (4 elsewhere)

  HIGHLIGHTS (last 4h) ───────────────────────── ← highlights
  ◆ decision  rajiv  moved auth guard into AuthMiddleware  12m
  ! incident  mei    login 500s in staging, investigating  40m
  ✦ finding   sol    bcrypt rounds were the p99 culprit      2h

  YOU ─────────────────────────────────────────  ← self
  emitting as 'jb' · last shared 8m ago · 2 highlights unseen
```

Feature 6 queries are the same data taken the other way: "who's in the repo?" lists
`presence.roster`; "what's rajiv doing?" filters `snapshot/` to one actor; "anyone touched
auth.rs?" matches the `about` key across the snapshot.

## Token & latency budget (informs the benchmark)

The digest exists *because* of these costs; concrete targets are owned and tracked by
[benchmarking.md](benchmarking.md), but the design commitments are:

- **Statusline render: zero tokens, zero network.** It reads one local file. No model call,
  ever. This is non-negotiable — an ambient line that costs tokens to display is a
  contradiction.
- **Statusline render: sub-millisecond, ≪ refresh period.** Read + parse a small JSON +
  print. Must finish far inside the 1s tick with margin.
- **Reduce: bounded, off the hot path.** One fetch + a linear fold over live clairs. Its
  period is the tunable; benchmarked against repo size (number of active peers × blip rate).
- **Emit / query: the only token costs**, and only on the user's or agent's deliberate turn
  (feature 5 emit, feature 6 query) — never ambiently.

## Open questions for review

1. **Reduce trigger** — pure background timer, or also hook-driven on edit/commit so
   `near_you` updates the instant my work moves? Timer is simpler; hook-driven is fresher.
2. **`work.json` source** — which hook populates it (file-edit hook, LSP, git diff of the
   working tree)? This is the consumer-context seam; pick the cheapest signal first.
3. **Digest caps** — exact roster / items limits before the line and dashboard truncate, and
   how truncation is signalled honestly (`+N more`).
4. **Snapshot format** — one file per clair, or a single rolled file? Affects query speed vs
   write churn; ties to the transport spec's ref layout.
5. **Multi-repo** — one `.git/clair/` per repo is implied; does a developer in several repos
   want a merged statusline, or strictly the focused repo (per `workspace.repo.*` on stdin)?
