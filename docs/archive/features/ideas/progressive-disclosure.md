# Progressive disclosure of live activity (LENS / principle)

**Status:** idea · a lens, not a feature. Reframes how clair should surface ambient
activity, and defines the word **"smartly"** that [purpose.md](purpose.md) leaves
undefined. Informs [statusline-widget.md](statusline-widget.md) (tier 0) and
[push-updates.md](push-updates.md) (the tier-1 delivery leg).

## The borrowed insight
Agent Skills win on **progressive disclosure**. The always-loaded cost is tiny — just
`name` + a one-line `description`. The expensive **body** loads *only when the
description matches the task*. That ordering is the whole trick, and it works because
it mirrors cognitive **chunking**: a cheap pointer you expand on demand, never the
whole thing up front.

clair today does the opposite. It eagerly injects the full prompt + conclusion banner
on **every** turn. That is a flat firehose, not awareness — token-heavy, and a banner
that is *always* on screen becomes a banner nobody reads. **"Ambient" delivered as a
dump is just noise.** The fix is to borrow the skills mechanism wholesale: disclose
live activity in tiers, cheapest-always-on, and let each item earn its way up.

## The tier model
Each tier is a different **grain** of the same activity, surfaced at a different
moment and cost.

| Tier | Cost | Content | Skill analogue |
|------|------|---------|----------------|
| **0 — headline** | ~free, always on | "3 active · Rajiv in `auth.rs`" | the `name` + `description` |
| **1 — context** | on demand / triggered | the actual prompt, conclusion, diff snippet | loading the **body** when it matches |
| **2 — deep** | explicit pull | full session / transcript handoff | reading a bundled reference file |

Tier 0 is the **statusline-widget** idea, exactly. Tier 1 is today's banner — but
*gated* instead of unconditional. Tier 2 is a future explicit "show me everything
Rajiv has been doing."

## Escalation triggers — the crux
Progressive disclosure is **more than "hide then show."** A skill's `description` is a
**trigger**: it tells the model *when* the body is worth loading. clair needs the same
— a trigger model that decides when an activity item jumps **tier-0 → tier-1**.

Candidate triggers, flagged by what they cost to detect:

- **File overlap** — you are about to edit a file a peer is active in. *Cheap, local
  (paths only).*
- **Merge region** — you and a peer have diverged in the same hunk; sync up before it
  becomes a conflict. *Cheap-ish, local (diff ranges).*
- **Decision point** — you are making a call a peer's conclusion bears on. *Needs
  smarts — the AI, or a relevance match against peer summaries.*
- **Explicit ask** — you (or your AI) request it. *Free; this is tier-2's normal door
  too.*

The cheap-local triggers can live in `clair-core`; the decision-point trigger is where
"smartly" actually costs something and is the real open question (below).

## What this re-homes
- **statusline-widget.md** → this is **tier 0**. Mark it so; it stops being a loose
  one-liner and becomes the always-on layer of a coherent model.
- **push-updates.md** → that design is the tier-1 **delivery** mechanism (Channels:
  how a tier-1 item reaches an idle session). This lens adds the missing half:
  tier-1 **triggering** (*which* items escalate, and *when*). Delivery ≠ triggering;
  push-updates answers "how it arrives," this answers "what earns arrival."
- **purpose.md** → "clair will smartly bring things to your attention" now has a
  concrete definition: **escalate the grain of disclosure as relevance rises.**
  "Smartly" = the trigger model, not a vibe.

## Open questions
- **Who decides escalation** — a local heuristic in `clair-core`, or the session AI?
  Cheap triggers (overlap, merge region) want to be local and deterministic;
  decision-point relevance may need the AI. A split is likely.
- **Per-tier token budget** — tier 0 must stay ~free or it is not always-on; tier 1
  needs a ceiling per surfaced item.
- **Who consumes each tier** — the human (statusline, banner) or the AI
  (`additionalContext`)? They may want different default tiers.
- **Loop-guard interaction** — escalation must remain **inbound-only**: deciding to
  surface tier-1 to *me* must never write an entry. The two-pipe guard
  ([target §3](../../architecture/target.md)) holds, but a trigger that consults the
  AI must not let that turn become a shared outbound.
- **Demotion** — once shown, does an item fall back to tier 0, or stay expanded? A
  conclusion you have already read should not keep re-surfacing.
