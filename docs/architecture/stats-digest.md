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
    "people": 9,
    "branches": 6,
    "by_area": [ {"area": "auth", "n": 5}, {"area": "api", "n": 3}, {"area": "ui", "n": 2} ],
    "roster": [
      {"principal": "rajiv", "instance": "rajiv.a3f", "area": "auth", "file": "src/auth.rs",     "branch": "feature/auth"},
      {"principal": "mei",   "instance": "mei.0d2",   "area": "api",  "file": "src/api/login.rs", "branch": "feature/api"}
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
| `presence.count` (instances) + `people` + `by_area` | active sessions, distinct humans, and *where the crowd is* (folder buckets) | all live `presence` clairs, keyed per instance | the resting statusline, "who's in the repo?" |
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

The layout follows git's own shared-vs-per-worktree seam (see
[data-model.md, Identity](data-model.md#where-identity-state-lives-and-worktrees)):

```
<common git dir>/                  # shared across all worktrees of the repo
  refs/clair/*       # the shadow refs — the synced bus; every worktree reads them locally
  clair/snapshot/    # raw live clairs, TTL-filtered: source for queries & the dashboard

<per-worktree git dir>/clair/       # $(git rev-parse --git-dir)/clair — one per checkout
  instance           # instance id (e.g. jb.a3f), keyed by harness session id — one per session
  cursor             # seen-set of event ids — local-only, never pushed (loop-safety ground)
  work.json          # my current work context (open/edited paths) — written by an edit hook
  digest.json        # the rollup above: source for the statusline (read every tick)
```

Living under `.git/` is deliberate and matches product.md's "local-only cursor, never
pushed":

- **Invisible to the repo.** Never appears in `git status`, can't be accidentally staged or
  committed, never collides with the user's work.
- **Per-checkout local.** Each worktree has its own `digest`, `cursor`, and `work.json` —
  correct, since `near_you` and "what I've seen" are inherently per-developer/per-checkout.
  The shared `snapshot` and refs mean your own worktrees see each other with **no fetch**.
- **Disposable.** Deleting `clair/` loses nothing durable; the next fetch+reduce rebuilds it
  from the shadow refs. Consistent with *ephemeral, not an audit log*.

Writes are **atomic** (write temp + rename) so a renderer never reads a half-written digest.

## The reduce pipeline — fetch → filter → fold → write

The one step that touches network and clock. Conceptually:

1. **Fetch** the shadow refs into the local store (transport's job; deferred).
2. **Filter** out TTL-expired clairs (`now > ts + ttl`) — the digest only ever sees live
   ones. **Malformed or oversized blips are skipped, not fatal:** a bad peer blip (bad JSON,
   missing required L0 fields, an over-budget body) is dropped and the fold continues, so one
   garbage blip can never fault or stall the digest.
3. **Fold** the survivors:
   - group `presence` by instance (latest-wins) → `count` (instances), `people` (distinct
     principals), `branches`, `by_area`, `roster`;
   - **compute `collision`** (not stored): for instances whose presence overlaps mine, diff
     their **pushed** commits locally to find shared hunks → the `near_you` collision view;
   - intersect the store against `work.json` and score → the rest of `near_you`, `proximity`;
   - `highlights.unseen` = emitted event-ids **not in the local seen-set** (a set-difference
     over the ~4h window) — **never** a UUIDv7-timestamp compare, so cross-machine clock skew
     can't replay or silently skip a shared event.
4. **Write** `snapshot/` (full) and `digest.json` (capped), atomically, stamping `as_of` and
   `stale_after = as_of + refresh_period`.

**Cadence is a config knob.** The reduce/fetch period is **configurable**, not hard-coded —
it runs on a background timer (and opportunistically on git operations). The right value
trades freshness against git-remote load and is **tuned empirically in the benchmark lab**,
which measures remote load as peer count climbs (see [benchmarking.md](benchmarking.md)). No
fixed number is committed pre-measurement.

**Staleness is honest, not hidden.** If the reducer falls behind and `now > stale_after`,
the statusline does **not** invent state — it dims to grey and appends a faint `·stale`. The
line degrades to "I don't know right now" rather than showing confidently wrong numbers.

**`near_you` needs my side too.** It's the one rollup that depends on the consumer's current
work, supplied via `work.json` (written by an edit hook). This is exactly the "consumer work
context" seam deferred in [data-model.md](data-model.md); the reducer is where it plugs in.
Until the relevance engine lands, `near_you` is populated by the cheap deterministic signals
only (same file / same hunk), and `score` is a placeholder weighting.

## The render ladder — the statusline is a slice of the digest

The statusline computes nothing. It reads `presence.people`, picks a rung, and prints the
matching slice. `near_you` always wins when non-empty.

**The headline count is `people`, not `count`.** The ambient line answers *"who's around"*,
and a human reads "14 active" as 14 humans — but `count` is instances/sessions, which
overstates the crowd 2–5× when one person drives many agents. So the bare line leads with the
**principal** count; the session/agent count lives on `/clair:status` and drill-downs
("rajiv: 6 agents"). `by_area.n` stays instance-keyed (it's work density, not headcount).

```
1–2 people    ◈ clair · rajiv ✎ auth   mei ✎ api           ← presence.roster, named
3–5 people    ◈ clair · auth · api · ui · 5 people          ← presence.by_area, areas listed
6+ people     ◈ clair · ●·9 · auth·api busiest              ← by_area top-2 + people count
near-you hit  ⚠ clair · rajiv auth.rs:40 ‹your file›         ← near_you[0] overrides everything
stale         ◈ clair · ·stale                              ← as_of aged past stale_after
```

- **Color is transition-aware, not a level.** A **standing** overlap (you and rajiv both in
  `auth.rs` for an hour) sits at **amber**, not red — otherwise red becomes wallpaper and
  cries wolf (core-features' own "a banner that's always on is a banner nobody reads"). **Red
  is reserved for change:** a `near_you` hit that *just crossed the threshold* — newly
  appeared since the prior digest, or materially worsened (a new hunk, a growing region).
  Amber stays fully visible (recede ≠ dismiss) and **re-escalates to red** if the divergence
  grows. Color is **earned by proximity, never by volume**: 30 happy peers stay grey.
- **"hot" means proximity, never busiest.** The word `hot` is reserved for the proximity
  bucket (`calm | warming | hot`). The 6+ rung's "busiest area" is a *volume* fact, so it
  reads `auth·api busiest`, not "hot" — and the dashboard's "hottest" aligns to the same
  word. (Whether to debounce rung changes at count boundaries is an open tuning question, not
  a mandate; the compaction glyph set stays a deferred cosmetic choice.)
- **Resting summary.** The `3–5` rung lists the distinct areas peers occupy (`auth · api ·
  ui`) straight from `by_area` — a small repo gets a one-glance "where is everyone."

## `/clair:status` — the full render

The statusline is the dial; this is the dashboard. Same digest, plus `snapshot/` for the
uncapped feed. Sections map one-to-one onto digest fields:

```
  clair · status                       feature/login · 9 people · 14 sessions

  NEAR YOU ───────────────────────────────────  ← near_you
  ⚠  rajiv   auth.rs:30–58   diverged from your edits   3m ago
  ◐  mei     auth/login.rs   same folder                just now

  PRESENCE ──────────────────────────────────── ← presence
  9 people · 14 sessions across 6 branches · busiest: auth (5) · api (3)
  ●●●●● auth   ●●● api   ●● ui   ●●●● (4 elsewhere)

  HIGHLIGHTS (last 4h) ───────────────────────── ← highlights
  ◆ decision  rajiv  moved auth guard into AuthMiddleware  12m
  ! incident  mei    login 500s in staging, investigating  40m
  ✦ finding   sol    bcrypt rounds were the p99 culprit      2h

  YOU ─────────────────────────────────────────  ← self
  emitting as 'jb' · last shared 8m ago · 2 highlights unseen
  shared about you: presence (auth) · 1 decision · visible to anyone who can fetch origin
```

The **YOU** section doubles as the *"what clair shares about me"* transparency view that the
consent model (see [core-features.md](../core-features.md), F1) promises — at a glance, what
you're broadcasting and to whom.

Feature 6 queries are the same data taken the other way, and they **roll up to the
principal**: "who's in the repo?" lists `presence.roster` (people, each with their session
count); "what's rajiv doing?" gathers all of rajiv's instances → *"rajiv has 6 agents
active: 3 in auth, 2 in api, 1 in ui…"* then drills into any one; "anyone touched auth.rs?"
matches the `about` key across the snapshot.

## Token & latency budget (informs the benchmark)

The digest exists *because* of these costs; concrete targets are owned and tracked by
[benchmarking.md](benchmarking.md), but the design commitments are:

- **Statusline render: zero tokens, zero network.** It reads one local file. No model call,
  ever. This is non-negotiable — an ambient line that costs tokens to display is a
  contradiction. "~free" scopes to **tokens + network + clair's own render**.
- **clair's render cost is sub-millisecond; the host's per-tick *spawn* cost is separate.**
  Reading + parsing a small JSON + printing is sub-ms in-process — that part clair owns and
  the benchmark gates. But Claude Code **spawns the statusLine command fresh each tick**, and
  OS process creation + runtime init (tens of ms, worst on Windows, worse still for an
  unsigned native binary Defender rescans) **dominates perceived latency and clair does not
  control it**. Implication: the shipped reader must be **cheap-to-spawn and code-signed on
  Windows** — an implementation constraint, not a number we can gate deterministically.
- **Reduce: bounded, off the hot path.** One fetch + a linear fold over live clairs. Its
  period is the tunable; benchmarked against repo size (active instances × blip rate) and
  against git-remote load.
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
6. **Transition detection for color** — "red = just crossed" needs a `near_you`/collision hit
   to carry **stable identity across recomputations** (so the reducer knows it's the same
   overlap, newly worsened vs. already-seen). Does the seen-cursor extend to derived views, or
   does the digest diff against the prior digest? Settle alongside the amber re-escalation
   threshold (a dogfooding tuning surface).
