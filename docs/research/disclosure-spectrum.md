# clair — Disclosure Spectrum: how much a clair should actually carry

> **Status: research / idea bank (not decided).** Captures a live design thread: *how much
> real information does a clair need to put on the wire to be useful?* Three ideas — a minimal
> "get-in-touch" beacon, semantic vectors, and the encryption question — turn out to be one
> axis. Promoted from scratch (`crazy-pivot-vectors.md`). Relates to
> [../architecture/data-model.md](../architecture/data-model.md) (`about`, the deferred
> semantic-matching upgrade), [../architecture/emit-redaction.md](../architecture/emit-redaction.md)
> (the egress gate this could shrink), and the kill-criterion in
> [../product.md](../product.md).

## The seed idea

What if L0/L1 carried **no real data** — just a **vector** of the area/theme/files — so peers
sense "two agents are getting too close" by **semantic distance**, never minting real data on
the remote? It would (a) collapse the privacy/redaction problem (nothing legible to leak) and
(b) hand us semantic proximity — the hard relevance problem — for free.

It doesn't fully work as a *replacement*, but it points at a useful **axis of disclosure**.

## The axis: how much a clair carries

| Level | What's on the wire | Leak surface | Cost | Legibility |
|-------|--------------------|--------------|------|------------|
| **A — beacon** | structured signal only: `{ paths-glob, kind, instance }` | tiny (a path/glob) | µs, 0 tokens | "go sync re: `src/auth/**`" |
| **B — semantic** | A + a **vector facet** of the area/theme | embedding *inversion* (lossy text recovery) | embed model on warm path | a proximity score, no words |
| **C — rich** | B + real **headline/body** (decisions, findings) | full free-text → needs the egress gate | summarize + LLM filter | fully human-readable |

The current spec is mostly **C** for highlights and a thin **A** for presence. The two "pivot"
ideas are really *"what if we lived lower on this axis?"*

---

## Idea A — the "get-in-touch" beacon (the strongest)

Share only a minimal **coordination beacon** — *"someone is active in `src/auth/**`"* — and
**nothing else**: no headline, no prose, no diff. The blip says *that* you should sync, not
*what* the other agent is doing; the content is pulled **out of band / on demand with
consent** (feature 6) or handled human-to-human.

**Why it's attractive:**
- **Almost nothing to leak** — a path glob is the smallest sensitive surface (only the
  existing `about.paths` scrub), and it **sidesteps the egress gate for L0 entirely**.
- **It's exactly what v1 already locks** — paths-only, deterministic, sub-ms, zero-token,
  hot-path. No embeddings, no LLM, no redaction-of-prose.
- **Honest product framing** — clair's floor becomes a *rendezvous beacon*, mapping cleanly
  onto "**push is the magic (the trigger), pull is the guarantee (the content)**." The trigger
  is a pure structured signal; content is a consented pull.

**How minimal can it go?** Possibly just **branch / worktree** — *"someone is on
`feature/auth`"* — a pure *get-in-touch* signal rather than direct communication. That's the
smallest useful unit: enough to know a rendezvous is warranted, nothing about *what* is being
done.

**Cost:** less "magical" — it tells you to go look, not what they're doing. But that may be the
*more defensible* product: maximal coordination value, minimal disclosure. Worth treating as a
serious candidate for the **default L0 philosophy** (minimize to a beacon; pull content), with
rich bodies reserved for explicit, gated highlights.

### The crux: "auto-push is risky unless data can *never* contain sensitive data"

This is the real driver behind the whole thread, and it deserves a blunt answer.

- **No format gives an absolute guarantee.** Vectors leak via inversion (idea B). Free text
  obviously leaks. Even a "structural" field can leak: a **path** (`customers/acme/...`) or a
  **branch name** (`feature/acme-acquisition`) can itself encode something sensitive.
- **But "tractable" beats "opaque."** The useful property isn't *zero* leak surface — it's a
  surface you can **deterministically reason about and scrub**. A glob/branch string is
  **bounded and inspectable**: a regex/allow-list can vet it completely, with no model in the
  loop. Free text and vectors are **unbounded/opaque** — you can only ever *probabilistically*
  filter them (the LLM stage), never prove them clean.
- **So vectorising does _not_ solve it** (inversion), and is actually *worse* for this goal
  than the minimal signal, because a vector is un-inspectable — you can't look at it and
  confirm what it reveals. The **structured get-in-touch signal is the closest thing to the
  guarantee the user wants**, precisely because it's the only option whose safety you can
  *verify deterministically* rather than *trust a filter for*.

Practical reading: push **structured, inspectable signals by default** (branch / worktree /
path-glob + kind), deterministically vetted; treat any *legible free text* (and any vector) as
the exception that must clear the egress gate. "Never sensitive" is unreachable as an absolute,
but "deterministically inspectable, and minimal" is reachable — and is the honest version of
the same goal.

---

## Idea B — semantic vectors (a later upgrade, with sharp caveats)

Add a **vector facet** to `about` (alongside paths/symbols) so the relevance engine scores
semantic distance — the concrete form of the **deferred semantic-matching upgrade** the
data-model already names. It helps the **semantic** axis (logical/conceptual drift), *not* the
cheap **spatial** one (same file/hunk is better served by exact path/diff overlap — vectors
would make a crisp signal fuzzy).

**Four issues, one near-fatal to the privacy story:**

1. **Embeddings are invertible (the near-fatal one).** A research line (embedding inversion /
   "vec2text") shows text embeddings can be partially **reconstructed back into source text**.
   So "no real data is passed" is **false** — a vector leaks a lossy version of its input, and
   you can't un-leak a vector. The privacy win is much weaker than it looks. **[E — to verify
   how much a small code/path embedding actually leaks]**
2. **Comparability needs a pinned model.** Distance is meaningful only if every peer embeds
   with the *same model + version*; vectors from different models are silently incomparable
   (no error, just garbage). → see *embed the model in the CLI*, below.
3. **It's the expensive upgrade, not the cheap floor.** Embedding every edit runs a model on
   the hot path — the opposite of the locked "paths-only, sub-ms, zero-token v1."
4. **Vectors kill legibility.** A pure-vector blip is a number with no words; the statusline
   headline and the "what's rajiv doing?" pull leg need real text. So you'd still ship *some*
   legible field → back through the egress gate for that part.

### Embedding the vector model in the CLI

This is the right answer to issue #2 **if** we do vectors at all: ship the embedding model
**with clair**, so "same clair version → same model" turns comparability into the
already-accepted version-drift problem.

- **Feasible in Rust:** `candle` (HF's Rust ML), `fastembed-rs` (ONNX wrappers for small models
  like `bge-small` / `MiniLM`), and especially **model2vec-style static embeddings** (distilled
  to a lookup table — *microsecond* inference, single-digit MB), which could get close to
  hot-path-cheap.
- **Tradeoffs:** binary bloat (model weights ship in the CLI — single-digit to tens of MB,
  taxing the zero-config download); a real transformer is ~ms/embed (fine for emit/reduce
  cadence, too slow for every keystroke); and it **still doesn't fix inversion**.

---

## Idea C — encryption: can we encrypt before embedding?

**No — encryption and semantic distance are fundamentally opposed.**

- **Encrypt-then-embed** (embed the ciphertext): dead. Ciphertext is by-design
  random/structureless (diffusion); embedding it yields noise, distance is meaningless.
  Encryption's whole job (destroy structure) opposes embedding's whole job (preserve it).
- **Embed-then-encrypt** (standard cipher on the vector): also kills distance. Computing
  distance on encrypted vectors needs **homomorphic / functional encryption** — orders of
  magnitude slower *and* needs **key distribution**, which on a keyless, serverless,
  all-peers-can-read bus is the **server-shaped problem clair rejects**.
- **Distance-preserving transforms** (shared-secret orthogonal rotation, LSH) preserve distance
  but a shared-secret transform *is* key distribution again, and preserving distance preserves
  the very structure inversion attacks exploit. Weak.
- **And it's moot for the main threat:** every peer on the repo can already read every blip
  (clone ACL), so encryption only helps *outside* that ACL (e.g., a public remote) — and that
  reintroduces key distribution. Encryption is orthogonal to the leak we care about.

**Verdict:** crypto doesn't rescue the vector privacy claim; the honest mitigations are
*share less* (idea A) and the egress gate (for what must be legible).

---

## What to measure before betting on any of this

These ideas are mechanisms; the prior question is whether the problem is real — which is the
kill-criterion conversation:

1. **Is semantic/logical collision a real, costly, frequent problem?** Worktree isolation
   already removes *file-level* collisions; the only thing that justifies clair is the residual
   **logical** collision (two agents committing to contradictory decisions) costly at merge.
   Get numbers first: how often, how costly, how much does clean isolation + rebase already
   absorb? If isolation handles ~95%, neither vectors nor rich bodies are worth it.
2. **How much does a small-model embedding of code/paths actually leak under inversion?** This
   is measurable and decides whether vectors are even an acceptable wire format.
3. **Does a pure beacon (idea A, no content) change agent behaviour enough?** If the beacon
   alone moves outcomes in dogfooding, we can skip vectors *and* rich bodies for L0 — the
   cheapest, safest path wins.

## Open threads

- Treat **idea A (beacon) as a serious candidate for the default L0 philosophy** — minimize to
  a coordination signal, pull content on demand/consented; reserve rich bodies for gated
  highlights.
- Keep **idea B (vectors) as the concrete form of the deferred semantic-matching upgrade**,
  behind the relevance seam, with the inversion risk stated up front and the model shipped in
  the CLI for comparability.
- **Idea C (encryption) is closed** for the proximity use-case — recorded so we don't relitigate
  it.
