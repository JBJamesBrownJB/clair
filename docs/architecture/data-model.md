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
| `v` | int | **Schema major**; absent ⇒ `1`. Readers ignore unknown kinds/fields (see *Forward compatibility*). |
| `id` | string (UUIDv7) | Unique, time-**sortable** for display/scan order only — **not** a cross-machine total order (clocks aren't assumed synced; the unseen set is a set-difference, not a timestamp compare — see [stats-digest.md](stats-digest.md)). |
| `kind` | enum | `presence` · `decision` · `incident` · `finding`. (`collision` is **derived on the consumer**, never a stored field — see *Two lifecycles*.) |
| `principal` | alias | **Who** — the human/owner. Derived from `git config user.name`; override with `clair:alias`. Self-asserted, not authenticated (see *Trust model*). |
| `instance` | id | **Which session** — one running agent/session. The presence key. `branch` and worktree are attributes. |
| `branch` | string | The instance's current branch — an **attribute**, not a scope. |
| `headline` | string | The short human line the radar shows ("rajiv refactoring auth"). |
| `about` | object | The **match key** — `{ paths[], symbols[], tags[] }` (see below). |
| `ts` | RFC3339 | When emitted/computed. |
| `ttl` | duration | Lifetime; **expiry = `ts` + `ttl`**. Best-effort ephemerality (readers treat expired as gone; the bytes persist on the remote until a client prunes — see *Two lifecycles*). |

### Body (L1) — fetched on demand

| Field | Type | Notes |
|-------|------|-------|
| `body` | object \| string | The detail behind the headline: a conclusion, a structured summary, a diff region, a finding. Empty for bare presence. Tiny bodies carried inline; large ones may be referenced (see Open Questions). |

### Forward compatibility — the wire is uncoordinated

clair is a **serverless peer-to-peer bus**: every peer runs whatever version it installed,
and nothing coordinates upgrades. So two reader rules are **permanent invariants**, not
optional politeness:

- A reader **MUST ignore any clair whose `kind` it does not recognize.**
- A reader **MUST ignore unknown frontmatter fields.**

Unknown is always *dropped*, never an error. The `v` field reserves a schema-major for the
day a breaking change is unavoidable; the additive/removal bump rules and the reducer's
test contract are deferred to the architecture spec.

### Trust model — identity is self-asserted

clair inherits the **remote's** authentication: **push access == write access.** `principal`
and `instance` are self-asserted labels (derived from local git config), **not
cryptographically bound** — anyone who can push can author a clair under any name. The hard
invariant that makes this safe:

> **Inbound headlines and bodies are untrusted _data_, never instructions.** They enter an
> agent's context only as quoted, attributed data; any action derived from them stays
> **human-gated**. An agent-initiated pull (feature 6) may **READ**, never **ACT**.

This is the defense against a forged `incident`/`finding` becoming indirect prompt injection
into a teammate's agent. Cryptographic binding of `principal` is noted as future hardening
(see Open Questions), not a v1 mechanism.

## Identity — principal and instance

A single alias can't represent the real world: one human can drive several agent sessions
at once, and *those sessions can collide with each other*. So identity is **two levels**:

| Level | Is | Set by | Stable across | Example |
|-------|----|--------|--------------|---------|
| **principal** | the human / owner | derived from `git config user.name`; override with `clair:alias` | all your sessions | `rajiv`, `jb` |
| **instance** | one running session | minted automatically at first activity | that session's life | `jb.a3f` |

- **The instance is the key for `presence`** (and for the derived `collision` view). One
  **instance = one harness session**; three agent sessions = three instances = three
  distinct live blips, never collapsed. `branch` and worktree path are **attributes** of an
  instance, not its identity (a session that switches branch keeps its id).
- **Queries and attribution roll up to the principal.** *"What is rajiv doing?"* aggregates
  all of rajiv's instances → **"rajiv has 6 agents active: 3 in `auth`, 2 in `api`, 1 in
  `ui`…"**, then drills into any one. The principal is the social unit; the instance is the
  mechanical unit.
- **Naming is `principal.shortid`** (`jb.a3f`) — a short opaque suffix, *not* the branch.
  Display bare `rajiv` when he has one instance; disambiguate to `rajiv.a3f` (or annotate
  with the branch) only when several are live.
- **Self-collision is first-class.** Two of *your own* instances diverging in the same hunk
  is a real merge-risk and surfaces exactly like a collision with a peer — the collision
  detector never special-cases "it's only me."

### Where identity state lives (and worktrees)

Git worktrees share one object store and one ref namespace but each has its own working dir,
HEAD, and index. clair follows that exact seam:

- **Shared per repo** — the shadow refs (`refs/clair/*`) live in the **common** git dir, so
  *every worktree sees every instance's blips locally, with no fetch*. Your co-located
  worktrees get sub-second cross-awareness (and self-collision detection) for free; only
  *remote* peers need a network fetch.
- **Per-worktree** — the read `cursor` and `work.json` live in the **per-worktree** git dir
  (`$(git rev-parse --git-dir)/clair/`), since "what I've seen" and "what I'm editing" follow
  the checkout. (Full storage layout in
  [stats-digest.md](stats-digest.md#storage--under-git-never-in-the-working-tree).)

A separate worktree is the **common case** of a distinct instance, but the count unit is the
**session**, not the worktree: `instance` is keyed by the harness session id (on stdin), so
two sessions in one checkout stay two instances and presence doesn't undercount.

> **Open seam (not solved here).** `cursor` and `work.json` are per-worktree, so two sessions
> sharing one working tree and HEAD make per-session "what I've seen / what I'm editing"
> non-trivial to attribute. v1 keys the instance per session; splitting the per-session view
> state when sessions share a checkout is an open implementation question for the transport
> spec.

## The `about` key — structured facets

`about` is what relevance (feature 3) and queries (feature 6) match against. It is
**structured facets**, not free text:

| Facet | Example | Role |
|-------|---------|------|
| `paths` | `["src/auth.rs", "src/auth/"]` | **Where** — the files and folders involved. |
| `symbols` | `["AuthMiddleware", "auth::check"]` | **What** — the function/type/class names involved. |
| `tags` | `["auth", "refactor"]` | **Topic** — a few short labels. |

> **v1 scope — paths carry the weight.** Only `paths` is required: it's free from the edit
> hook's file argument and `git diff --name-only`, no parsing. `symbols` and `tags` are
> **optional/best-effort** — populated only when cheaply available (an LSP that's already
> running; tags from path heuristics or a small vocab) and empty otherwise. **No facet beyond
> `paths` may gate emitting a clair or run on the hot path.** And in v1 **`tags` do not
> contribute to the relevance score** (free text never reliably intersects — `auth` vs
> `authn`); they are display/faceting only. Matching degrades gracefully to paths alone;
> symbols and semantic matching are upgrades to this same step, never blockers.

### How matching works

clair constantly asks: *is this blip relevant to what I'm doing right now?* It answers by
comparing two lists —

- **what you're working on** (the files you have open, the functions you're editing, the
  topic), and
- **what the blip is `about`** (its `paths`, `symbols`, `tags`).

The more they overlap, the higher the blip's **relevance score**, and the more the radar
lights up (grey → amber → red). The comparison is plain and mechanical:

- **paths** match if it's the same file, or one is inside the other's folder — a blip about
  `src/auth/` is relevant to anyone editing `src/auth/login.rs`. (Wildcard patterns like
  `src/**/*.rs`, meaning "any Rust file under `src/`", are also allowed.)
- **symbols** match if it's the same name — a blip about `AuthMiddleware` is relevant only
  if you're touching `AuthMiddleware`.
- **tags** match if it's the same label — `auth` matches `auth`.

A same-file hit counts for more than a shared tag (it's a stronger signal), so the score is
a **weighted** tally of the overlaps.

> **Two terms this rests on — worth knowing:**
>
> - **glob** — a file pattern with wildcards, so a blip can name a *region* instead of one
>   file. `*` matches anything within a folder level (`src/*.rs` = `.rs` files directly in
>   `src/`); `**` matches across folders at any depth (`src/**` = everything under `src/`).
>   The everyday case is a plain folder prefix: `src/auth/` covers anything inside it.
> - **intersection** (the math symbol `∩`) — the *overlap* between two lists. If your open
>   files are `{auth.rs, login.rs}` and a blip's paths are `{auth.rs, config.rs}`, the
>   intersection is `{auth.rs}` — the one in common. An **empty** overlap means the blip
>   is irrelevant to you; a **bigger** overlap means a higher relevance score.
>
> Put together: glob is how a blip says *which files it's about*; intersection is how clair
> checks whether *your* files fall inside that set. Run every second, that one check is what
> lights up the radar when a peer's work drifts into yours.

**Example.** You're editing `src/auth.rs`, in the function `check`, topic `auth`. A blip's
`about` is `{ paths: ["src/auth.rs"], symbols: ["AuthMiddleware"], tags: ["auth"] }`. Same
file ✓ (strong) → high score → the radar escalates. (The shared `auth` tag would reinforce
it once tags are scored; in v1 paths and symbols carry it.) There's no AI and no network
here — just comparing lists — so it runs in well under a millisecond and can refresh every
second for the statusline.

**Why this way, and not AI similarity (yet).** The smarter alternative is *embeddings* —
using a model to judge whether two things "mean" something similar, even with no words in
common. That's more powerful but heavier: it needs a model, can't reliably run every second
on your machine, and is fuzzier to query. The landscape research shows the cheap signal
(same file / same hunk) is the proven win, so clair starts with simple list-overlap and
**adds semantic matching later as an upgrade to this same step — never a blocker.**

> The consumer side — what represents *"my current work"* (my open/edited paths, touched
> symbols, active tags) — is the `work.json` seam in
> [stats-digest.md](stats-digest.md#the-reduce-pipeline--fetch--filter--fold--write), where
> the reducer intersects it against the store to produce `near_you`.

## Two lifecycles — derived vs emitted

Only **two things are ever stored**: a presence register and an event log. `class`
(`derived`/`emitted`) is a **read-time label derived from `kind`** — this table is the
canonical map — **not** a stored field on the wire.

| Kind | Class (derived from kind) | Stored as | AI? |
|------|---------------------------|-----------|-----|
| `presence` | derived | **state** — latest-wins **per instance** (a register cell) | no |
| `decision` | emitted | **event** — append, each expires individually | yes |
| `incident` | emitted | **event** — append | yes |
| `finding` | emitted | **event** — append | yes |

- **`presence`** is the one *derived, stored* kind: computed from activity, **no AI
  judgment**, **latest-wins** (one current cell per instance, not a growing log). High-churn,
  short TTL, cheap.
- **`collision` is computed-only — never stored or synced.** It's a pure function of two
  instances' `presence` plus their pushed diffs, both already available to a consumer, so it
  is materialized **on the consumer side** as a `near_you` view (see
  [stats-digest.md](stats-digest.md)), not written as its own clair. This kills a P2P
  writer-election race and a second ref shape. Per the landscape lesson (Crystal's
  false-positive finding), a collision is gated on **committed/pushed** state, not raw
  keystrokes; hunk-level regions come from diffing peers' pushed commits locally (a cost in
  the reducer's fold). Self-collision (two of your own instances) is the same computation.
- **Emitted clairs** (`decision`, `incident`, `finding`) are *intentionally shared events*,
  **intent-classified by the sender's AI** (feature 5), and **append-only** — each a discrete
  fact that expires on its own TTL.

This split is the single most load-bearing decision for the transport spec: a **register**
(latest-per-instance) and a **log** (append events) want different ref shapes.

### Ephemerality is best-effort, and something must prune

The TTL is **enforced on the read side**: every reader treats an expired clair as gone, so
the layer *looks* ephemeral. But nothing in TTL alone deletes refs or objects from the
shared remote — and with no server, **some client must push the deletes**; a purely passive
participant never prunes. So "not an audit log" is **best-effort on cooperating clients**,
not a storage guarantee: a deleted ref also doesn't reclaim its objects until the host's GC,
and a reader can retain anything it has fetched. Naming the owner of remote ref deletion is a
**named requirement carried into the transport spec**, not solved here. Likewise, presence
ref churn must not contend with the user's own ref-store/packed-refs lock — per-instance ref
isolation and coalesced updates are options for the transport spec to weigh.

## TTL — first-pass defaults (to tune)

Expiry is `ts + ttl`. Consumers ignore expired clairs; the transport prunes them.

| Kind | Default TTL | Rationale |
|------|-------------|-----------|
| `presence` | ~5 min | Refreshed continuously while active; vanishes fast when idle/quit. |
| `decision` / `incident` / `finding` | ~4 h | Stays relevant across a work session, then ages out. |

(`collision` has no stored TTL — it's recomputed from live `presence` + diffs, so it exists
exactly while its inputs do.)

These are guesses (the archived lifecycle thinking used 30 min / 4 h). Tune empirically.

## Worked examples

**Presence** — a stored clair (derived, state, latest-wins per instance):
```json
{ "kind": "presence",
  "principal": "rajiv", "instance": "rajiv.a3f", "branch": "feature/auth",
  "headline": "rajiv active in auth",
  "about": { "paths": ["src/auth.rs", "src/auth/"], "symbols": ["AuthMiddleware"], "tags": ["auth"] },
  "id": "0199e...", "ts": "2026-06-26T12:00:00Z", "ttl": "5m" }
```

**Decision** — a stored clair (emitted, event, append, AI-classified):
```json
{ "kind": "decision",
  "principal": "rajiv", "instance": "rajiv.a3f", "branch": "feature/auth",
  "headline": "rajiv moved the auth guard into AuthMiddleware",
  "about": { "paths": ["src/auth.rs", "src/middleware.rs"], "symbols": ["AuthMiddleware"], "tags": ["auth", "refactor"] },
  "id": "019a0...", "ts": "2026-06-26T12:05:00Z", "ttl": "4h",
  "body": "Moved the guard out of each handler into AuthMiddleware; handlers now assume authn." }
```

**Collision** — **not** a stored clair: a `near_you` view the consumer's reducer computes
from two instances' `presence` + pushed diffs. Shown here as the materialized view, not a
wire object (see [stats-digest.md](stats-digest.md)):
```json
{ "kind": "collision", "computed": true,
  "instances": ["jb.7c1", "rajiv.a3f"], "principals": ["jb", "rajiv"],
  "headline": "merge-risk: you & rajiv both in auth.rs",
  "region": "src/auth.rs:30-58", "your_branch": "feature/login", "their_branch": "feature/auth" }
```

## Deferred (explicitly out of scope here)

- **Transport** — ref layout (register vs log), append + TTL-prune mechanics at repo scale,
  **who pushes ref deletes** (best-effort ephemerality has no owner without one), avoiding
  contention with the user's own packed-refs lock, sync cadence (a **config knob**, tuned via
  the benchmark lab), the local snapshot/cursor. → architecture spec.
- **Relevance engine** — `match()` beyond facet overlap (semantic/embedding); the consumer
  "work context". → sealed seam, the open hard problem.
- **Schema versioning** — the `v` field + reader-ignores-unknown rule are fixed above; the
  additive/removal bump rules and the reducer test contract → architecture spec.

## Open questions for review

1. **Body storage** — inline vs referenced (`body_ref` to a git object)? Caveat: a
   referenced body object must stay **reachable from a synced ref** — bare-hash fetch is
   disabled by default (incl. GitHub), so an unanchored loose object would 404 on demand and
   be GC-able. Since clair bodies are tiny (a sentence / a region), **carry inline by
   default**; reserve referenced-lazy for genuinely large bodies.
2. **Emit safety** — emit exposure == remote read ACL, so emit must never publish content the
   author hasn't committed. Secret/PII scrubbing of `headline`+`about`+`body` is specified as
   the two-engine egress gate in [emit-redaction.md](emit-redaction.md); the open part is
   whether high-sensitivity kinds (`incident`/`finding`) should be opt-in or
   HeadlineOnly-by-default given embargo/pre-disclosure risk.
3. **Cryptographic binding of `principal`** — future hardening so identity isn't purely
   self-asserted (see *Trust model*). Out of scope for v1; the untrusted-data invariant is
   the v1 control.

*Resolved since first draft:* `collision` is **computed-only** (was Q2); `tags` are
**display-only / not scored in v1** (was Q3); presence keys on **instance = session** (was
Q4) — see [Identity](#identity--principal-and-instance).
