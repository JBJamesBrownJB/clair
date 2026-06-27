# clair — Security Protocol & Elevation Levels

> **Status: draft for review.** The trust model clair operates under, and the **elevation
> levels** — a staged path from "ship and measure on a trusted repo" to "authenticated against
> untrusted peers." Also defines the **operating modes** (auto vs human-in-the-loop). Grounds
> the encrypted pairwise exchange in [rendezvous-protocol.md](rendezvous-protocol.md), the
> *Trust model* in [data-model.md](data-model.md), and the egress gate in
> [emit-redaction.md](emit-redaction.md).

## The foundational axiom: repo access *is* the trust boundary

clair shares awareness **about a codebase, to parties who already have access to that
codebase.** It never widens the trust boundary beyond repo access. From that, one axiom:

> **Anyone who can attack clair's data can already attack the repo directly — and the repo is
> the bigger prize.** A party with push/fetch access already holds "the keys to the kingdom":
> the source itself, the ability to push malicious commits, the ability to read every branch.
> Forging or reading a clair is a *strictly weaker* capability than what they already have.

So clair's security goal is **not** "defend against everyone." It is two specific things:

1. **Don't leak to parties *outside* the repo's access boundary** — the git host, passive
   network observers, and especially the wider world on a public remote.
2. **Don't make things worse *inside* the boundary** — don't become a new injection vector that
   an already-trusted teammate's *accident* (or the host's curiosity) can exploit.

A **malicious insider** who already has push access is **explicitly out of scope** — that's an
organizational trust problem (they can already push poisoned code), not something clair can or
should solve at the base level. Defending against them is an *elevation* (Level 2), for when
the boundary itself isn't fully trusted.

## Threat model

| Threat | In scope? | Handled by |
|--------|-----------|------------|
| Git **host** (GitHub/GitLab) reads your content | ✅ defended | minimal plaintext L0 + **encrypted** pairwise channel |
| Passive **network** eavesdropper | ✅ defended | encryption + TLS transport |
| Accidental exposure on a **public** remote | ✅ defended | minimal/inspectable L0; sensitive detail only in the encrypted channel |
| **Secret/PII** leaking into the broadcast surface | ✅ defended | the [egress gate](emit-redaction.md) (gitleaks + entropy + LLM filter) |
| A buggy/garbage peer blip corrupting your state | ✅ defended | fold skips malformed/oversized (robustness) |
| **Malicious insider** with push access forging a clair | ❌ out of scope at L1 | accepted (they already own the repo); → **Level 2** if the boundary is untrusted |
| **Active MITM** with push access | ❌ out of scope at L1 | → **Level 2** (authenticated identity binding) |
| Remote **availability / DoS** | ❌ out of scope | it's git; not clair's problem |

## Elevation levels

Each level is **additive** — a strict superset of the one below. v1 ships at **Level 1**; higher
levels are the path to untrusted/public/regulated settings.

| Level | Name | Trust assumption | Adds | For |
|-------|------|------------------|------|-----|
| **L0** | Broadcast hygiene *(always on)* | — | minimal inspectable L0 + the egress gate; nothing sensitive broadcasts in plaintext | every mode, always |
| **L1** | Trusted-repo pairwise encryption **(v1 default)** | push access == trusted teammate | per-instance keypair; pubkey published in presence; pairwise context **encrypted** (TOFU keys); **auto mode** | a private repo / trusted team — ship and measure now |
| **L2** | Authenticated identity binding | the boundary itself may be untrusted | keys provably **bound to identity** (signed presence / git-identity or commit-signature anchor / repo key registry with change-alerts); defeats insider forgery + MITM | public, cross-org, or larger/regulated settings |
| **L3** | *(future, speculative)* | — | key rotation/revocation, per-team scoping, possibly HE for the semantic layer | hardening as needs emerge |

### Level 1 — what ships in v1, and why it's enough *here*

- **Mechanism.** Each instance generates a keypair on enrollment and **publishes its public key
  in its L0 presence** (a pubkey is non-sensitive — fits "light/safe"). The proximity-triggered
  pairwise channel **encrypts to the peer's pubkey**, so the rich context is ciphertext on the
  remote, readable only by the two instances.
- **Keys are trust-on-first-use (TOFU).** No identity authority; you accept a peer's published
  key the first time you see it. (Pin it + alert on change as a cheap L1.5 hardening.)
- **Why it's enough on a trusted repo.** Per the axiom: the only party who could substitute a
  key or forge a peer is someone with push access — who already owns the codebase. Encryption
  still does real work: it hides the rich exchange from the **host** and **anyone outside the
  repo**, which TOFU-without-authentication fully achieves.
- **Residual (stated, not hidden).** A *malicious* insider could publish a key as someone else
  and MITM the channel. Accepted at L1; closed at L2.

### Level 2 — the step up (logged for later, not built now)

When the repo boundary can't be assumed trusted (public/OSS, cross-org, regulated), bind keys
to identity so a peer's key *provably* belongs to the claimed `principal`/`instance`. Candidate
anchors: **signed presence blips**, leveraging **git commit-signing / GPG/SSH identity** the
team already has, or a small **repo-level key registry**. This is the real "authenticity"
guarantee that autonomous (no-human) action needs outside a trusted team.

## Operating modes (orthogonal to levels)

How much the human is involved is **separate** from the crypto level, **configurable**, and
**additive** over time:

- **Auto mode (v1 default).** Agents exchange context and **act autonomously** — no human gate.
  This is the premise: *many agents in one codebase cause measurable token/time/outcome
  inefficiency, and clair fixes it.* Auto mode is what makes that win real. Its safety rests on
  the trust boundary (L1) doing the work the human gate used to.
- **Human-in-the-loop mode (future, optional, additive).** Configurable for teams that want a
  gate. Every collision ends in a **resolution report** — what the two agents are doing, the
  conflict, and a proposed deconfliction — sent to the driver to **approve** before any action.
  This re-introduces the human as a *deliberate choice*, not a default, and is the safe mode for
  higher-stakes work or before a team trusts auto mode.

> **Reversal noted.** Auto mode reverses the earlier locked invariant *"acting on peer input
> stays human-gated."* That invariant's safety job is taken over by **(L1 trust boundary) +
> (the egress gate) + (peer-data robustness)**. Human-loop mode brings the gate back for those
> who want it. Both are first-class; the default is auto because the product's whole reason for
> existing is agent-side efficiency.

## Open questions

1. **Cipher/keys** — which primitives (X25519 + an AEAD; Ed25519 for L2 signing)? Pick boring,
   audited, Rust-native (e.g. the `ring`/`dalek` ecosystem).
2. **TOFU change handling** — silently accept a peer's new key, or alert/pin? (cheap L1.5.)
3. **L2 anchor** — signed presence vs git commit-signing reuse vs repo key registry; which best
   reuses identity a team already has without new infra.
4. **Mode granularity** — auto vs human-loop per-repo, per-kind (auto for spatial ordering,
   human for semantic reconciliation), or per-developer?
