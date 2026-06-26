# clair — What It Is

> The product spirit, one page. What clair is, how it feels, what it refuses to be.
> The concrete capabilities derived from it live in [core-features.md](core-features.md).
> Supersedes the vision in [seed-ideas.md](archive/seed-ideas.md) and the scratch thinking in
> [features/ideas/purpose.md](archive/features/ideas/purpose.md) (both kept for provenance).

## Identity

**clair gives you and your agents ambient awareness of everyone else's activity across
the repo** — without setup, without a server, and without becoming a log you have to
read.

## The borrowed insight: progressive disclosure

clair takes its core idea from **Agent Skills**. Skills win because of *progressive
disclosure*: a cheap always-loaded pointer (`name` + one-line `description`), and an
expensive **body** that loads *only when the description matches the task*. You never
pay for what isn't relevant.

> **If skills are a way to progressively disclose pre-defined context, a _clair_ is a
> way to progressively disclose a _live event_.**

That single sentence is the whole product. Each unit of activity in the repo is **a
clair** — a tiny, self-expiring pointer that earns its way into your attention only
when it bears on what *you* are doing right now.

## How it feels

One command and you're in. From then on it's **hands-off** — no channels to join, no
config to tend:

```
clair
```

- The repo's activity becomes **ambient noise** — a faint, always-on sense of who's
  where and what's moving.
- The few things that actually matter to your work **rise out of the noise on their
  own** and surface to you.
- You stay the gate. clair shows; **you** decide what to route into your agent. In a
  future of agents working solo on their own branches, "you" is simply whoever is
  driving that agent.

"Hands-off" means **zero-config enrollment**, not autonomous action. Awareness is
automatic; acting on it is yours.

## The two grains

A clair, like a skill, has a cheap front and an expensive body.

| Grain | Analogue (skill) | Content | Cost |
|-------|------------------|---------|------|
| **L0 — the blip** | frontmatter (`name` + `description`) | **headline** ("Rajiv, refactoring auth in `auth.rs`") · **TTL** (when it stops being true) · **about** (the match key: files / symbols / topic) | ~free, always on |
| **L1 — the detail** | the body | the prompt, diff, conclusion, or finding behind the blip | paid, on escalation |

- The **about** field is what makes escalation possible: it's the `description` whose
  job is to be *matched against your current work*. No about, no rising out of the
  noise.
- The **TTL** is how clair stays ephemeral at the data level: blips expire and
  self-evict. This is *"not an audit log"* enforced by the mechanism, not by a promise.
- Escalation is **human-first**: a relevant blip surfaces L1 to you; routing it into
  the agent is a deliberate act.

## What clair surfaces

Five kinds of clair, cheapest and most automatic first:

1. **Presence** — where everyone is in the codebase. Free, derived, always-on.
2. **Merge-region collisions** — you and a peer have diverged in the same hunk; sync
   before it's a conflict. Cheap, local.
3. **Architectural decisions** — a large change or direction someone has committed to.
4. **Incidents / P1s** — something is on fire and being acted on.
5. **Key findings / surprises** — what someone learned that you'd want to know.

The first two are cheap and local. The last three are **highlights** — they rely on the
sender's AI classifying intent, so the right things get raised and the noise stays
noise.

## How it rides on git (the moat)

The principles below sound like magic — no server, nothing to run, ephemeral — until
you see the trick that makes them literal. clair **never touches your working
history.** Its entire state lives on **orphan shadow refs**: branches with no ancestry
to your code, never merged, meant to be thrown away.

That one move is the IP:

- **No server, no new infra.** Shadow refs sync over the git remote you already have
  (`fetch` / `push`). The remote *is* the whole backend — clair adds zero services.
- **Never pollutes your repo.** The refs sit off to the side; they never show up in
  your log, never merge, never conflict with the work you're actually doing.
- **Ephemeral by construction.** Refs and the TTL'd blips on them are pruned and
  deleted as a matter of course — *"not an audit log"* enforced by the storage itself.
- **Read-only by default.** What you've already seen is tracked in a **local-only
  cursor** that is never pushed, so receiving a clair writes nothing back — the ground
  of two-pipe loop-safety.

The *concept* is settled. The exact ref layout for repo-scoped, TTL'd blips is open
design — the archived branch-scoped scheme (`clair/ready` + one `clair/<branch>` log)
is the starting point, not the answer.

## Principles

- **Fat client, dumb pipe.** All smarts run locally. No servers.
- **Git is the pipe.** Sync and storage ride on git; nothing else to run.
- **Repo-scoped, not branch-scoped.** Branch is just an attribute of a clair
  ("Rajiv, on `feature/x`"). Isolation is the default future; awareness is the antidote,
  and it concentrates at repo level and above.
- **Ephemeral, not an audit log.** TTLs evict; nothing accumulates. Archiving is a
  possible future, never a requirement.
- **Hands-off.** One command, then it tends itself forever.
- **Human-first.** clair surfaces; the human (or the agent's driver) routes.
- **Two-pipe loop-safety.** Receiving a clair never emits one — two AIs can't
  ping-pong.
- **Harness-agnostic ambition.** Claude first; no Claude-only assumptions.
- **Instant-wow.** First run should feel like magic.

## Explicitly not

- **Not live code sync.** clair shares *awareness*, not bytes — Live Share et al. own
  co-editing ([why](archive/features/ideas/pair-branch.md)).
- **Not an audit log or history.** Live events that expire, not a record.
- **Not a central server.** Git is the only backend.
- **Not same-branch co-editing.** Pairing on one branch was the old dream; it competes
  with tools that already do it well. The novel thing is the shared, ambient brain.

## The open hard problem

Everything above reduces to one engine: **matching a clair's _about_ against your
current work well enough that the right things rise and the rest stays quiet.** Cheap
local triggers (file overlap, merge region) are easy; relevance across a whole repo of
solo agents is not. That engine — *what escalates, when* — is the thing clair lives or
dies on, and it is deliberately left open here. Naming it is the point; solving it is
the work ahead.
