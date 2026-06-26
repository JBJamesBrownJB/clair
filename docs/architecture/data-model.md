# clair — Data Model: the clair (blip)

> **Status: draft for review.** The keystone spec. Defines *the clair* — the one live
> event everything else is built on. Scope is the **data model only**: the object, its
> grains, its `about` key, and its lifecycle. **Transport** (ref layout, sync, TTL prune),
> the **relevance engine**, and the **consumer "work context"** are named here but
> specified elsewhere. Derived from [../product.md](../product.md) and
> [../core-features.md](../core-features.md); grounded by [../research/landscape.md](../research/landscape.md).

## The object

A **clair** is one live event in the repo. Like an Agent Skill it has a **cheap front and
an expensive body**:

- **Frontmatter (L0)** — small, always synced, always scannable. This is what the radar
  reads and what relevance matches against.
- **Body (L1)** — the detail, **fetched on demand** (on escalation or query). The
  transport may store/sync it separately so L0 stays cheap; that split is a transport
  concern, deferred.

### Frontmatter (L0) — always present, always synced

| Field | Type | Notes |
|-------|------|-------|
| `id` | string (UUIDv7) | Unique, **time-ordered** (orders cleanly, drives cursors). |
| `kind` | enum | `presence` · `collision` · `decision` · `incident` · `finding`. |
| `class` | enum | `derived` or `emitted` — implied by `kind`, stated for lifecycle (below). |
| `actor` | alias | Who. (`collision` carries `actors: [alias, alias]`.) |
| `branch` | string | The actor's branch — an **attribute**, not a scope. |
| `headline` | string | The short human line the radar shows ("rajiv refactoring auth"). |
| `about` | object | The **match key** — `{ paths[], symbols[], tags[] }` (see below). |
| `ts` | RFC3339 | When emitted/computed. |
| `ttl` | duration | Lifetime; **expiry = `ts` + `ttl`**. The ephemerality teeth. |

### Body (L1) — fetched on demand

| Field | Type | Notes |
|-------|------|-------|
| `body` | object \| string | The detail behind the headline: a conclusion, a prompt, a diff region, a finding. Empty for bare presence. Referenced, not carried in L0. |

## The `about` key — structured facets

`about` is what relevance (feature 3) and queries (feature 6) match against. It is
**structured facets**, not free text:

| Facet | Example | Role |
|-------|---------|------|
| `paths` | `["src/auth.rs", "src/auth/"]` | **Spatial** key. Repo-relative; prefix/glob-matchable. |
| `symbols` | `["AuthMiddleware", "auth::check"]` | Finer spatial/semantic key. Exact match. |
| `tags` | `["auth", "refactor"]` | Coarse **semantic** key. Controlled vocabulary. |

**Matching** = `match(my_work, clair.about) → score`, computed as weighted overlap: path
prefix/glob ∩, symbol exact ∩, tag exact ∩. Deterministic, local, cheap enough for the
1-second statusline poll. **Why facets over embeddings:** the landscape research shows the
spatial signal (same file/hunk) is the proven, cheap win; a free-text/embedding step is
heavier, can't reliably run in <1s locally, and is fuzzier to query. Semantic matching is
**layered on later behind the same `match()` interface** — facets first, embeddings as a
pluggable upgrade, never a blocker.

> The consumer side — what represents *"my current work"* (my open/edited paths, touched
> symbols, active tags) — is defined in the architecture spec, not here.

## Two lifecycles — derived vs emitted

The five kinds are not uniform. They split by how they come to exist and how they are
stored:

| Kind | Class | Lifecycle | Storage semantics | AI? |
|------|-------|-----------|-------------------|-----|
| `presence` | derived | continuous while active | **state** — latest-wins **per actor** (a register cell) | no |
| `collision` | derived | true while divergence exists | **state** — computed from peers' state/diffs | no |
| `decision` | emitted | a discrete event | **event** — append, each expires individually | yes |
| `incident` | emitted | a discrete event | **event** — append | yes |
| `finding` | emitted | a discrete event | **event** — append | yes |

- **Derived clairs** (`presence`, `collision`) are *computed from activity*, carry **no AI
  judgment**, and are **latest-wins** — there is one current presence per actor, not a
  growing log. High-churn, short TTL, cheap. Per the landscape lesson (Crystal's
  false-positive finding), `collision` must be gated on **committed/pushed** state, not raw
  keystrokes.
- **Emitted clairs** (`decision`, `incident`, `finding`) are *intentionally shared
  events*, **intent-classified by the sender's AI** (feature 5), and **append-only** —
  each is a discrete fact that expires on its own TTL.

This split is the single most load-bearing decision for the transport spec: a **register**
(latest-per-actor) and a **log** (append events) want different ref shapes.

## TTL — first-pass defaults (to tune)

Expiry is `ts + ttl`. Consumers ignore expired clairs; the transport prunes them.

| Kind | Default TTL | Rationale |
|------|-------------|-----------|
| `presence` | ~5 min | Refreshed continuously while active; vanishes fast when idle/quit. |
| `collision` | ~15 min | Lives while the overlap does; recomputed. |
| `decision` / `incident` / `finding` | ~4 h | Stays relevant across a work session, then ages out. |

These are guesses (the archived lifecycle thinking used 30 min / 4 h). Tune empirically.

## Worked examples

**Presence** (derived, state, latest-wins per actor):
```json
{ "id": "0199e...", "kind": "presence", "class": "derived",
  "actor": "rajiv", "branch": "feature/auth",
  "headline": "rajiv active in auth",
  "about": { "paths": ["src/auth.rs", "src/auth/"], "symbols": ["AuthMiddleware"], "tags": ["auth"] },
  "ts": "2026-06-26T12:00:00Z", "ttl": "5m" }
```

**Collision** (derived, computed, two actors):
```json
{ "id": "0199f...", "kind": "collision", "class": "derived",
  "actors": ["jb", "rajiv"], "branch": "feature/auth",
  "headline": "merge-risk: you & rajiv both in auth.rs",
  "about": { "paths": ["src/auth.rs"], "symbols": ["AuthMiddleware::check"], "tags": [] },
  "ts": "2026-06-26T12:01:00Z", "ttl": "15m",
  "body": { "region": "src/auth.rs:30-58", "your_branch": "feature/login", "their_branch": "feature/auth" } }
```

**Decision** (emitted, event, append, AI-classified):
```json
{ "id": "019a0...", "kind": "decision", "class": "emitted",
  "actor": "rajiv", "branch": "feature/auth",
  "headline": "rajiv moved the auth guard into AuthMiddleware",
  "about": { "paths": ["src/auth.rs", "src/middleware.rs"], "symbols": ["AuthMiddleware"], "tags": ["auth", "refactor"] },
  "ts": "2026-06-26T12:05:00Z", "ttl": "4h",
  "body": "Moved the guard out of each handler into AuthMiddleware; handlers now assume authn." }
```

## Deferred (explicitly out of scope here)

- **Transport** — ref layout (register vs log), append + TTL-prune mechanics at repo scale,
  sync cadence, the local snapshot/cursor. → architecture spec.
- **Relevance engine** — `match()` beyond facet overlap (semantic/embedding); the
  consumer "work context". → sealed seam, the open hard problem.
- **Schema versioning** — a `v` field will be needed once the wire format is fixed.

## Open questions for review

1. **Body storage** — inline vs referenced (`body_ref` to a git object)? Affects how cheap
   L0 sync stays. Leaning referenced for emitted clairs, inline for tiny ones.
2. **Is `collision` a stored clair at all**, or purely computed on the consumer side from
   peers' `presence` + diffs (never written)? If computed-only, it has no TTL/storage and
   the model simplifies to *one* derived-stored kind (presence) + emitted events.
3. **Controlled `tags` vocabulary** — fixed set, or free with conventions? Free is easier
   to emit; fixed is easier to match/query.
4. **Per-actor presence granularity** — one presence cell per actor, or per actor×branch
   (an actor in two worktrees)?
