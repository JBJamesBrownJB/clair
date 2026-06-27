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

## The shape — four phases

1. **Beacon** (broadcast, inspectable, safe). The proximity trigger. Minimal structured signal
   only — branch/worktree/glob + kind. No content. (Idea A.)
2. **Handshake** (pairwise, opt-in). The two instances acknowledge and open a **scoped pairwise
   channel** — e.g. a ref `refs/clair/rv/<a>~<b>`. Either side may decline (consent).
3. **Exchange** (bounded rounds, scoped disclosure). Each shares *only* the detail needed to
   deconflict: intended change, touched symbols/signatures, the decision/assumption in play —
   "I'm changing `AuthMiddleware`'s signature; are you calling it?" / "handlers now assume
   authn — adjust." Through the egress gate, or E2E-encrypted (below).
4. **Resolution** (human-gated proposal). The agents converge on a *proposed* plan — ordering,
   who-owns-what, an assumption to adopt — and surface it to each driver for approval. Bounded
   rounds; **no convergence → escalate to the humans.**

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
  - **Caveat:** unauthenticated DH defeats *passive* eavesdroppers (other peers, the host), not
    an *active* MITM — which needs identity bound to keys (the deferred hardening from the
    *Trust model*). Honest framing: confidential against the realistic threat (a co-worker
    reading refs), not against an active attacker with push access, until keys bind to
    identity.

## Invariants it must hold

- **Bounded & terminating.** This is exactly the ping-pong the **two-pipe loop-safety** rule
  guards against. So: explicit turn-taking, a hard round cap, and **converge-or-escalate** —
  a negotiation with a termination condition, never an open-ended chat (which would loop and
  burn tokens).
- **Resolution is a _proposal_, human-gated.** Per the locked invariant (*acting on peer input
  stays human-gated*), agents may negotiate a plan; **executing** it (yielding, rebasing,
  changing approach) is acting on untrusted data → the driver approves. Possible narrow
  auto-exception for purely mechanical ordering, to be earned, not assumed.
- **Counterparty is untrusted.** Forged/adversarial peers are possible (self-asserted
  identity) — proposals are reviewed, never executed blindly; encryption gives confidentiality,
  not authenticity.
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
