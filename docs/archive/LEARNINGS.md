# clair — Carry-Forward Learnings (pre-reset digest)

> The repo is being reset to a clean skeleton. This is the distilled signal from the
> pre-pivot thinking — what survives, what was abandoned, and where to read more. The
> **live source of truth** is [docs/product.md](../product.md); everything else under
> `docs/archive/` is provenance. When this digest and product.md disagree, product.md wins.

## The pivot in one line
clair moved from **same-branch pairing** ("two people, one Claude conversation") to
**repo-level ambient awareness**: every unit of activity is *a clair* — a self-expiring
pointer that surfaces only when it bears on your current work. The mechanism didn't
change much; the *scope and framing* did. The reset keeps the engine and drops the
pairing ritual.

## Durable insights (carry these forward)

- **Progressive-disclosure lens.** Borrowed wholesale from Agent Skills: a cheap,
  always-loaded pointer (`name`+`description`) and an expensive body that loads only
  when the description matches the task. "If skills disclose pre-defined context, a
  clair discloses a live event." This is the whole product.
  → [archive/features/ideas/progressive-disclosure.md](features/ideas/progressive-disclosure.md)
- **L0/L1 grain model.** L0 = the blip (headline + TTL + **about**/match-key), ~free and
  always on. L1 = the detail (prompt/diff/conclusion), paid, on escalation. The **about**
  field is the `description` that gets matched against your work — no about, no rising.
  TTL is what makes ephemerality structural. (The earlier doc framed this as tiers 0/1/2;
  product.md collapsed it to L0/L1 + an explicit-pull L2.)
- **Git is the only backend.** No server, ever. State rides on **orphan shadow refs**
  (`clair/ready`, `clair/<branch>`) that are never merged and meant to be thrown away.
  Append-only JSONL ⇒ concurrent writes never text-conflict (sidesteps merge drivers).
  → [archive/decisions/0002-git-via-shell-out.md](decisions/0002-git-via-shell-out.md),
  [archive/architecture/target.md](architecture/target.md) §2
- **Fat client / dumb pipe.** All smarts in one local Rust binary (`clair-core`); hooks,
  MCP server, CLI, and Skill are thin replaceable adapters over it.
  → [archive/decisions/0001-language-rust.md](decisions/0001-language-rust.md),
  [archive/decisions/0003-dual-integration-mcp-and-skill.md](decisions/0003-dual-integration-mcp-and-skill.md)
- **Two-pipe loop-safety.** Inbound (fetch → render) writes *nothing* (cursor is
  local-only); outbound (share) fires *only on a human-started turn*. Receiving a clair
  never emits one, so two AIs can't ping-pong. This invariant MUST survive any new
  delivery trigger (e.g. Channels). → target.md §3, push-updates.md
- **Ephemerality / "not an audit log."** TTLs evict; nothing accumulates. Enforced by the
  mechanism (self-expiring blips), not a promise. Note: `git push --delete` removes the
  pointer instantly but not the bytes until remote GC — true privacy ⇒ never push shadow
  refs (local-only mode). → [archive/features/ideas/lifecycle.md](features/ideas/lifecycle.md)
- **Intent-classified framing.** Don't hard-code "concluded." The *sender's* AI classifies
  intent at turn-end (cheap, informed, off the receiver's critical path); render maps a
  small vocab (asks/decides/blocked/done/update) → framing. Untagged defaults to neutral
  `update`. → [archive/decisions/0006-intent-classified-actor-framing.md](decisions/0006-intent-classified-actor-framing.md)
- **Identity is a chosen alias**, not a git account — so one account under two aliases =
  two identities that see each other (solo review). Teams (alias spanning many accounts)
  deferred. → [archive/decisions/0005-identity-alias-with-teams-deferred.md](decisions/0005-identity-alias-with-teams-deferred.md)
- **Delivery decoupled from capture/store.** All inbound reads through one
  `entries_since(cursor)`; pull-now vs push-later is additive. The watcher
  detects+delivers, never generates (an LLM watcher is rejected: token cost, can't render
  independently, re-opens the loop). → [archive/decisions/0004-delivery-pluggable-live-via-watcher.md](decisions/0004-delivery-pluggable-live-via-watcher.md)
- **Five clair kinds, cheapest-first:** presence (free/derived) · merge-region collisions
  (cheap/local) · architectural decisions · incidents/P1s · key findings — the last three
  rely on sender-AI intent classification. The first two have cheap *local* escalation
  triggers (file overlap, diff-range overlap) that can live in `clair-core`.

## Tried and abandoned (don't re-litigate)

- **Same-branch live pairing** (the original `clair with @rajiv` dream: two devs typing
  into one shared Claude on one branch). Dropped — it competes with mature live-coding
  tools; the novel value is the shared ambient brain, not co-editing.
  → [archive/seed-ideas.md](seed-ideas.md), [archive/features/ideas/purpose.md](features/ideas/purpose.md)
- **Pair-branch / live code sync** (auto-pull a peer's WIP into your tree). **Ruled out**:
  git is a poor real-time medium, it's a crowded non-differentiator (Live Share et al.),
  and it violates the never-touch-uncommitted-work rule. Only defensible future shape is
  *read-only WIP diff on demand*. → [archive/features/ideas/pair-branch.md](features/ideas/pair-branch.md)
- **Branch-scoping** as the organizing axis — superseded by **repo-scoping**. Branch is
  now just an attribute of a clair ("Rajiv, on `feature/x`"). NB: the shipped code keys
  context per-branch (`clair/<branch>`); product.md's repo-scope is the target the reset
  builds toward. → target.md §2 vs product.md "Principles".
- **Also discarded earlier:** a persistent conversation DAG, a custom git merge driver,
  and auto-compaction (contradict ephemerality, too heavy). → seed-ideas.md.

## The open hard problem (named, not solved)
Everything reduces to one engine: **matching a clair's `about` against your current work
well enough that the right things rise and the rest stays quiet.** Cheap local triggers
(file overlap, merge region) are easy; relevance across a whole repo of solo agents is
not. *What escalates, when* is what clair lives or dies on — deliberately left open in
[product.md](../product.md) and in
[archive/features/ideas/progressive-disclosure.md](features/ideas/progressive-disclosure.md) (escalation triggers + open questions).

## Code that proved the spine (gone after reset, but it worked)
`clair-core` was harness/CLI-free and held the data spine: `entry` (JSONL: id, author,
kind, text, ts, turn), `store` (append-only per-`ShadowRef`, single `entries_since`
read), `cursor` (local-only last-seen), `registry`, `render` (single source of framing
strings), `hooks`, `transcript`. Git via shell-out. BDD via cucumber-rs against a local
bare repo as the "remote." The pieces validated the architecture; the reset rebuilds the
product on top of the same ideas.
