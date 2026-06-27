# clair — Emit Redaction Pipeline (the data-egress gate)

> **Status: draft for review.** The **mandatory gate** every emitted clair passes before it
> can touch a ref. Implements the **emit-safety** requirement named in
> [data-model.md](data-model.md) (*Trust model* + Open Questions) and
> [core-features.md](core-features.md) (F5). Scope: the screening pipeline and its code
> boundary. Out of scope: the summarizer's own prompt design (named, not specced here) and
> transport (how the screened blip syncs).

## Why this is the highest-severity path

**Emit exposure == the remote's read ACL.** A clair you emit is readable by anyone who can
`fetch` your remote, and — because the bytes persist on the remote until a client prunes
(see *best-effort ephemerality*) — **a leak is effectively unrecoverable.** One API key, one
`.env` diff, one pre-disclosure vuln in a `finding`, one PII-bearing stack trace is enough.

So egress gets treated like the security boundary it is: **defense-in-depth, fail-closed, and
enforced at the type level** so no code path can emit around it. Distilling intent (the
summarizer's job) is **not** redaction — that's the mistake this pipeline exists to prevent.

## Principles

- **Two engines, different failure modes.** A **deterministic** secrets/PII scanner catches
  *known patterns* with zero model dependency and no false-negatives on its ruleset; a
  **cautious LLM filter** catches *semantic / contextual* leaks regex can't ("the staging DB
  password is the usual one"). Neither is trusted alone; they cover each other's blind spots.
- **Fail-closed.** Uncertainty → redact or withhold, **never** emit. The security default is
  silence; awareness degrades before safety does.
- **One choke point, enforced by types.** No clair crate can emit content except through this
  gate. The emit API accepts only a **sealed `Emittable`** that *only this crate can mint* —
  so emitting un-screened content is a **compile error**, not a code-review checklist item.
- **Decoupled & segregated.** Its own crate; the summarizer and the two scanners are
  **separate stages with separate responsibilities**. The LLM filter is swappable/optional;
  the deterministic gate is mandatory and never disabled.

## The pipeline

```
raw activity (your prompt / diff / conclusion)        ← never leaves the machine unscreened
        │
        ▼
[1] Deterministic PRE-scan      secrets/PII engine, in-process
        │   mask known secrets BEFORE anything else sees them, so the summarizer
        │   model never even receives a raw credential
        ▼
[2] Summarize                   sender's AI: scrubbed raw → headline + about + structured body
        │   operates only on pre-scrubbed material; job = fidelity
        ▼
[3] LLM secondary filter        separate, single-purpose, adversarial — job = suspicion
        │   "does this summary contain or imply any secret / credential / PII /
        │    pre-disclosure detail? if unsure, redact." fail-closed.
        ▼
[4] Deterministic POST-scan     same engine, over the final wire fields
        │   belt-and-suspenders: headline + about + body must ALL pass again
        ▼
   Emittable  ─────────────────▶ transport   (only a clean, sealed value reaches a ref)
        │
        └─ on any block → emit HeadlineOnly, or drop; record the catch locally (never the secret)
```

**Why deterministic at _both_ ends.** The pre-scan keeps raw secrets out of the summarizer's
context entirely. The post-scan is the hard floor: even if the LLM filter is bypassed,
prompt-injected, or reintroduces a pattern, **no known-pattern secret leaves**, with no model
in the trust path. The LLM filter sits between them as the semantic net for what regex misses.

**Why the summarizer and the filter are _separate_ calls.** They have opposite jobs —
fidelity vs suspicion. Merging them into one prompt invites the summarizer to "helpfully"
include the very detail the filter should cut, and a single prompt is easier to
injection-trip. Separation = clearer responsibility + smaller attack surface.

| Stage | Engine | Responsibility | Failure mode it covers | Cost |
|-------|--------|----------------|------------------------|------|
| 1 PRE-scan | deterministic | strip known secrets/PII from raw input | secret reaching the summarizer model | µs, 0 tokens |
| 2 Summarize | sender's AI | distil headline + about + body | — (produces the candidate) | 1 model call |
| 3 LLM filter | **sender's main model**, distinct call | redact semantic/contextual leaks | what regex can't pattern-match | 1 model call |
| 4 POST-scan | deterministic | re-scan final wire fields | LLM miss / reintroduction / bypass | µs, 0 tokens |

The stage-3 filter runs on the **sender's main model** (no extra dependency or config — the
session model is already there), as a **separate, single-purpose call** from the summarizer,
never a merged prompt.

## The code boundary (segregation, enforced)

A dedicated crate — **`clair-redact`** — owns the whole pipeline. The guarantee is structural:

```
clair-redact
  screen(raw: RawEmission, summarizer: &dyn Summarizer, filter: &dyn Filter) -> Screened

  enum Screened {
      Emittable(Emittable),       // headline + about + body, all four stages passed
      HeadlineOnly(Emittable),    // body withheld; headline + about survived
      Blocked { reason: Reason }, // nothing emits
  }

  // Emittable's fields are private; its ONLY constructor lives inside clair-redact.
  pub struct Emittable(/* sealed */);
```

The transport/emit crate's `emit(e: Emittable)` accepts **only** an `Emittable` — a value no
other crate can construct. So the pipeline isn't a convention to remember; **the type system
makes "emit raw content" un-writable.** The two scanners and the summarizer/filter sit behind
their own traits so the deterministic engine and the model can each be swapped or tested in
isolation — but `screen()` is the only door, and it always runs stages 1 and 4.

## Policy — block / redact / headline-only

| Finding | Action |
|---------|--------|
| High-confidence secret (private key, cloud cred, token) | redact the span to a typed placeholder `‹redacted:aws-access-key›`; if redaction guts the meaning → **HeadlineOnly** |
| PII (email / SSN / card / phone) | redact the span |
| Sensitive **path** in `about.paths` (e.g. `customers/acme/embargo.md`) | drop the offending path facet |
| LLM-flagged uncertainty | redact the implicated sentence; if the whole body is implicated → **HeadlineOnly** |
| High-sensitivity kinds (`incident` / `finding`) | **same span-redact path as every other kind** — emit the body with flagged spans masked; not HeadlineOnly-by-default. Richer awareness, leaning on both engines to catch embargo/pre-disclosure detail. |
| Uncommitted content the author hasn't pushed | never publish (emit must not outrun the author's own commit boundary) |

Default posture: **prefer redact-and-emit** (awareness preserved) over dropping — but
**never** emit a field that failed the POST-scan.

### Fail-closed matrix

| Condition | Outcome |
|-----------|---------|
| LLM filter unavailable / errors / times out | **HeadlineOnly** — deterministic stages still ran; you still get presence + `about` + headline, just no free-text body. Safety holds; awareness degrades. |
| Deterministic engine error | **Blocked** — the hard floor must hold or nothing emits. |
| Body over size budget | truncate → re-scan, or HeadlineOnly. |

## The deterministic engine — decided

A deterministic scanner is just a **matcher + a ruleset**. The matcher (regex + a Shannon-
**entropy** check for high-randomness strings with no known pattern) is small and fast in
Rust; the value is the ruleset, and the best one is open data.

**Decision: embed the gitleaks ruleset + entropy + a small structured-PII set, in-process.**

- **gitleaks ruleset** — the de-facto-standard, MIT-licensed corpus of ~150+ secret regexes
  (cloud creds, tokens, private keys, JWTs, …). It's portable **data**, so we run it with our
  own Rust matcher — vendored, version-pinned, **no external binary** (a shell-out to
  `gitleaks`/`trufflehog` would break zero-config and add spawn cost).
- **+ entropy check** — catches novel/unknown keys the named patterns miss.
- **+ small structured-PII set** — email / SSN / card (Luhn) / phone / IP. *Unstructured* PII
  (a name or address in prose) is **not** regex's job — that's the stage-3 LLM filter's lane,
  so we deliberately don't pull in a heavy NER engine (Presidio et al.) here.
- **+ org-extensible** custom-rule file for site-specific secrets.

**No live verification.** Unlike TruffleHog, the gate never calls a provider to confirm a key
is live — that would be a network/phone-home on the egress path. A *suspected* secret is
treated as a secret (fail-closed). The ruleset is data, refreshed by shipping a new clair
version (residual *ruleset-drift* risk noted below).

> **Caveat — ruleset drift on a P2P bus.** Peers run whatever clair version they installed,
> so an older sender screens against an older ruleset. The gate protects the *sender* with
> *their* ruleset; it cannot retroactively protect against a pattern only newer rules catch.
> Keep the bundled ruleset current; this is a residual risk to state, not hide.

## Transparency

Every redaction/block is recorded **locally** — the *category* and *field*, **never the
secret value** — and surfaced in the *"what clair shares about me"* view (the **YOU** panel
in [stats-digest.md](stats-digest.md)). The user can see clair caught something, which builds
the trust the consent model depends on.

## Cost

- **Deterministic:** microseconds, **zero tokens** (regex over a small body), run twice.
- **LLM filter:** one extra deliberate model call per emit, input-dominated by the small
  summary. Emit is already a deliberate, token-costing path; the filter roughly doubles its
  calls. Tracked under the **emit token family** in [benchmarking.md](benchmarking.md), and
  skippable → HeadlineOnly when budget or availability demands (fail-closed by construction).

## Open questions for review

1. **Inbound display safety** — should the reader also run a light scan when *rendering* a
   peer's body (defense against a baited/poisoned blip), or is sender-side screening +
   the *untrusted-data* invariant enough? (Cross-ref data-model *Trust model*.)
2. **Org allow-list** — an opt-in for teams that explicitly *want* certain paths/labels shared
   that the default PII rules would strip.
3. **Ruleset provenance/update** — how the bundled gitleaks ruleset is pinned, audited, and
   refreshed, given peers don't coordinate versions.

*Decided:* deterministic engine = embedded gitleaks ruleset + entropy + structured-PII,
in-process (no shell-out, no live verification); stage-3 filter = sender's main model;
high-sensitivity kinds = span-redact like every other kind.
