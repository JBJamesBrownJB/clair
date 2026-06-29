# clair — What It Is

> The product spirit, one page. What clair is, how it feels, what it refuses to be.
> The concrete capabilities derived from it live in [core-features.md](core-features.md).
> Supersedes the vision in [seed-ideas.md](archive/seed-ideas.md) and the scratch thinking in
> [features/ideas/purpose.md](archive/features/ideas/purpose.md) (both kept for provenance).

## Identity

**clair gives you and your agents ambient awareness of everyone else's activity across
the repo** — without setup, without a server, and without becoming a log you have to
read. In one line: **agent proximity awareness through progressive disclosure of live
context.** Ambient awareness is the always-on layer; **proximity** is what earns a live
event out of that noise and into your attention.

**Who it's really for: the agent-majority repo.** Assume a near future where most repo
activity comes from **agents**, not humans, and a human is increasingly an **orchestrator**
of a fleet. clair is judged on two questions that follow from that: does it give the human
**more control over their agents**, and does it **improve agent outcomes** — an agent that
knows what its peers just decided or where they're colliding makes better moves than one
walled off in isolation. (See *The bet*, below.)

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

**Installing the plugin is all it takes** — there's no setup command. From then on it's
**hands-off**: clair derives who you are, joins the ambient layer, and tends itself. The
only commands that exist are optional — `clair:alias` to set your name, `clair:pause` to
go quiet.

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
- The **TTL** is how clair stays ephemeral at the data level: every reader treats an
  expired blip as gone. This is *"not an audit log"* by **best-effort on cooperating
  clients** — the read side is enforced; the bytes on the remote still need a client to
  prune them (see the moat, below).
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
noise. (Only four are *stored*: a collision is **computed** by each consumer from peers'
presence + diffs, never written or synced — see [data-model.md](architecture/data-model.md).)

## How it rides on git (the moat)

The principles below sound like magic — no server, nothing to run, ephemeral — until
you see the trick that makes them literal. clair **never touches your working
history.** Its entire state lives on **orphan shadow refs**: branches with no ancestry
to your code, never merged, meant to be thrown away.

- **No server, no new infra.** Shadow refs sync over the git remote you already have
  (`fetch` / `push`). The remote *is* the whole backend — clair adds zero services.
- **Never pollutes your repo.** The refs sit off to the side; they never show up in
  your log, never merge, never conflict with the work you're actually doing.
- **Ephemeral, best-effort.** TTL makes every *reader* treat blips as expired, so the
  layer looks ephemeral — but nothing in TTL alone deletes refs/objects from the shared
  remote, and with no server **some client must push the deletes** (a deleted ref also
  doesn't reclaim objects until host GC). So *"not an audit log"* holds on cooperating
  clients; naming who prunes is a transport-spec requirement, not magic.
- **"Read-only by default" = I don't write back, not "others can't read."** Your
  local-only **cursor** is never pushed, so receiving a clair writes nothing (the ground
  of two-pipe loop-safety). But git remotes are all-or-nothing: **anyone who can clone can
  read every blip body**, with no per-team/per-principal scoping; on a public remote,
  "others" is the world. If sensitivity matters, run **local-only** (never push).

**Where the moat actually is.** Metadata-in-git is itself *precedented* — git-bug,
git-appraise, and Radicle already store collaboration data in git, serverlessly (see
[landscape.md](research/landscape.md) §3). So the defensible, un-occupied slice is **not**
"serverless metadata in git" in general — it's the **ephemeral, TTL'd, throwaway use of
orphan refs as an *awareness* bus**, paired with relevance quality and plugin distribution.
That's the claim to defend.

The *concept* is settled. The exact ref layout for repo-scoped, TTL'd blips is open
design — the archived branch-scoped scheme (`clair/ready` + one `clair/<branch>` log)
is the starting point, not the answer.

## Consent & visibility

Because **install = enrollment**, the first run also begins **broadcasting**: your blips are
visible to anyone who can `fetch` your remote — the same audience as your branches, but
finer-grained and pre-commit. We keep that honest without breaking zero-config:

- A **one-time, non-blocking** first-run line says plainly *who can see your activity* and
  points to `clair:pause` / local-only. Instant-wow is preserved; the trade is that you
  *are* visible until you opt out.
- **Local-only is a first-class mode** — read peers, never emit — for when sensitivity
  matters.
- Confidentiality scoping and body encryption are **out of scope** (they'd need a server);
  the trust boundary is the remote's clone ACL, stated plainly rather than papered over.

## Principles

Smart clairvoyance across all your agents using progressive disclosure and progressive escalation

- **Fat client, dumb pipe.** All smarts run locally. No servers.
- **Git is the pipe.** Sync and storage ride on git; nothing else to run.
- **Repo-scoped, not branch-scoped.** Branch is just an attribute of a clair
  ("Rajiv, on `feature/x`"). Isolation is the default future; awareness is the antidote,
  and it concentrates at repo level and above.
- **Ephemeral, not an audit log.** TTLs evict on every reader; nothing is *meant* to
  accumulate. Best-effort on cooperating clients (a client must prune the remote), not a
  storage guarantee. Archiving is a possible future, never a requirement.
- **Hands-off.** Installing it is the whole setup; then it tends itself forever.
- **Human-first routing, agent-first value.** clair surfaces; the human (or the agent's
  driver) routes — acting on a clair is never automatic. But the *value* is judged on agent
  outcomes, so the human surface stays calm while the **agent-facing leg may escalate
  aggressively** (an agent's interruption cost is ≈zero).
- **Inbound is data, never instructions.** A peer's blip is self-asserted and could be
  forged, so it enters an agent's context only as quoted, attributed data — never executed.
- **Two-pipe loop-safety.** Receiving a clair never emits one — two AIs can't
  ping-pong.
- **Harness-agnostic ambition.** Claude first; no Claude-only assumptions.
- **Instant-wow — honest about cold-start.** First run should feel like magic *when there's
  activity to show*. For a lone adopter the first-run value is **your own parallel
  agents/worktrees** (presence and self-collision across your fleet); a genuinely idle,
  single-session repo is quiet, and we don't pretend otherwise.

## Explicitly not

- **Not live code sync.** clair shares *awareness*, not bytes — Live Share et al. own
  co-editing ([why](archive/features/ideas/pair-branch.md)).
- **Not an audit log or history.** Live events that expire, not a record.
- **Not a central server.** Git is the only backend.
- **Not same-branch co-editing.** Pairing on one branch was the old dream; it competes
  with tools that already do it well. The novel thing is the shared, ambient brain.
- **Not confidential.** No per-team/per-principal scoping and no body encryption — the read
  boundary is the remote's clone ACL. Sensitivity → local-only, not a clair.

## The bet (and how we'll know if it's wrong)

clair's whole premise is that **awareness beats isolation**: that an agent (or its driver)
seeing what peers are doing produces better outcomes than the popular alternative — wall
every agent into its own worktree/branch and reconcile only at merge. **That bet is
unvalidated.** Worse, the prior-art lineage shows awareness tools usually die of *noise*,
not of missing events ([landscape.md](research/landscape.md)).

So we hold ourselves honest two ways:

- **Measure value, not just cost.** Being cheap and accurate ("the collision surfaced") is
  not the same as being *useful* ("it changed what an agent did"). Cost and recall are
  benchmarked ([benchmarking.md](architecture/benchmarking.md)); value is not something a
  benchmark can assert.
- **A written kill-criterion.** We ship the **thinnest push-leg + statusline first**,
  precisely to use it on real multi-agent work and ask: *did a surfaced clair change an
  action versus clean worktree isolation + rebase?* If, after a fair dogfood, the answer is
  reliably "no," we pivot or stop — rather than polishing something nobody needs. The thin
  build **is** the experiment.

## The open hard problem

Everything above reduces to one engine: **matching a clair's _about_ against your
current work well enough that the right things rise and the rest stays quiet.** Cheap
local triggers (file overlap, merge region) are easy; relevance across a whole repo of
solo agents is not. That engine — *what escalates, when* — is the thing clair lives or
dies on, and it is deliberately left open here. Naming it is the point; solving it is
the work ahead.
