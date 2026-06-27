# clair — Proximity Rendezvous & Deconfliction Protocol

> **Status: research / idea bank (not decided), phase-2 candidate.** Extends the
> "get-in-touch" beacon ([disclosure-spectrum.md](disclosure-spectrum.md), idea A): once a
> beacon says *"you two should talk,"* what if there were a **protocol** for the two agents to
> exchange just enough to resolve/defend against the proximity? This turns clair from an
> **awareness** layer into a **coordination** one — powerful, and a real scope step. Relates to
> the trust invariant in [../architecture/data-model.md](../architecture/data-model.md), the
> egress gate in [../architecture/emit-redaction.md](../architecture/emit-redaction.md), and
> the kill-criterion in [../product.md](../product.md).

## The idea

A beacon is a one-way trigger: *"instance A and instance B are proximate in `src/auth/**`."*
On its own it just says *go look*. The extension: a **bounded, point-to-point protocol** the
two agents run to communicate the details needed to deconflict — and ideally resolve, or at
least surface a proposed resolution to their drivers.

This is the difference between **awareness** (the field's gap clair already targets) and
**coordination/negotiation** (a further step). It's the most agent-native capability the
agent-centric thesis points at — but it raises the stakes, because agents would change
behaviour based on peer input.

## Staged: context-swap first, negotiation later

The full vision is negotiation (agents agree a plan), but that drags in the hardest problems —
convergence, termination, agreeing, acting on an agreement. So it's **staged**, cheapest-safest
first:

- **v1 — Scoped context-swap (decided).** Beacon → handshake → exchange detail → **each agent
  independently acts on its own richer context.** *No agreement machinery.* The collision
  dissolves not because they negotiated, but because **they stopped being blind to each other.**
  Targets the **spatial** case first (concrete, mechanical, easy to show value).
- **v2 — Negotiation.** Add proposals, convergence, who-owns-what / ordering.
- **v3 — Auto-resolution.** Narrow mechanical cases act without further exchange.

### The v1 phases

1. **Beacon** (broadcast, inspectable, safe). The proximity trigger. Minimal structured signal
   only — branch/worktree/glob + kind — **plus the instance's public key**. No content. (Idea A.)
2. **Handshake** (pairwise, opt-in). The two instances open a **scoped encrypted pairwise
   channel** — e.g. a ref `refs/clair/rv/<a>~<b>`. Either side may decline (consent).
3. **Exchange** (bounded rounds, scoped, encrypted). Each shares *only* the detail needed to
   deconflict: intended change, touched symbols/signatures — "I'm changing `AuthMiddleware`'s
   signature; are you calling it?" Encrypted to the peer's key (see
   [security-protocol.md](../architecture/security-protocol.md), Level 1).
4. **Act** (v1: **autonomous**, no human gate). Each agent uses the richer context to adjust its
   own plan. No convergence step, no "who yields" — that's v2. Safety rests on the **trusted-repo
   boundary** (Level 1), the egress gate, and peer-data robustness — not a human gate.

## Why this *improves* the privacy story

The beacon raised the "auto-push is risky" crux. The protocol answers it in two ways:

- **Scoped, not broadcast.** Detail goes to **one** counterparty about **one** collision —
  a far smaller, more justifiable disclosure than broadcasting bodies to the whole repo.
- **The one place encryption actually fits clair.** Broadcast can't be encrypted (no shared
  key with "everyone"). But a **pairwise** channel has exactly two parties, *discovered via the
  beacon*, so they can run a **Diffie-Hellman key exchange over the refs** and get a shared
  secret — the detailed exchange is then **end-to-end encrypted, readable only by the two**,
  even though the ref is fetchable by all. Sensitive detail never broadcasts; it goes encrypted
  to one peer.
  - **Caveat → resolved by the trust axiom.** Encryption with trust-on-first-use keys defeats
    *passive* eavesdroppers (the host, anyone outside the repo), not an *active* MITM with push
    access. But per [security-protocol.md](../architecture/security-protocol.md)'s axiom, a MITM
    with push access **already owns the codebase** — so this is out of scope at **Level 1**
    (trusted repo) and closed at **Level 2** (identity-bound keys) for untrusted/public settings.

## Invariants it must hold

- **Bounded & terminating.** This is exactly the ping-pong the **two-pipe loop-safety** rule
  guards against. So: explicit turn-taking, a hard round cap, and **converge-or-escalate** —
  a negotiation with a termination condition, never an open-ended chat (which would loop and
  burn tokens).
- **v1 acts autonomously — safety moves to the trust boundary.** v1 has no human gate (the
  product's whole premise is agent-side efficiency). The anti-injection job of the old
  "human-gated" invariant is taken over by **Level 1** (push access == trusted teammate; a
  forger already owns the repo), the egress gate, and peer-data robustness. **Human-in-the-loop
  is a future, optional, additive _mode_** — when on, every collision ends in a **resolution
  report** to the driver to approve before acting (see
  [security-protocol.md](../architecture/security-protocol.md), *Operating modes*).
- **Counterparty trust is bounded by the security level.** At L1, forgery is out of scope (the
  trust axiom); at L2, identity-bound keys make the counterparty authentic. Encryption gives
  confidentiality at every level; authenticity arrives at L2.
- **Consented on both ends.** Either side may decline the handshake; declining falls back to
  the plain beacon ("a human should look").

## Prior art to borrow

Classic **multi-agent negotiation** has well-studied protocols: **FIPA ACL** (agent
communication language) and the **Contract Net Protocol** (Smith, 1980) — announce / bid /
award / settle. clair's twist is novel: negotiation **triggered by ambient git-proximity** and
**transported over ephemeral refs**, with no server and no central orchestrator.

## The discipline — why this is phase-2, not now

- **It's a scope leap.** Awareness → negotiation is arguably a *different product* with a much
  larger surface. The contrarian read: **prove the beacon alone changes agent outcomes** before
  building a protocol on top of it. Build the cheap trigger, dogfood it, *then* decide if
  automated deconfliction is worth the complexity.
- **It compounds every open risk** — trust, loop-safety, token cost, human-gating — so it
  should only be designed once the awareness floor is validated against the kill-criterion.

## What to measure first

1. When a real proximity/collision is surfaced, **what do humans/agents actually do** to
   resolve it today — and would a structured exchange have saved time or a bad merge? (If a
   one-line beacon + a manual glance already resolves it, the protocol is overkill.)
2. **Convergence rate** of a bounded negotiation on real collisions — does it reach a useful
   proposal in N rounds, or mostly escalate? (Mostly-escalate → just escalate directly.)
3. **Token cost per resolved collision** vs the cost of the merge conflict it prevents — the
   only ratio that justifies the protocol existing.
