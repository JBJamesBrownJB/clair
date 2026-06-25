# 0006 — Shared-entry framing is intent-classified by the sender's AI

**Status:** accepted · 2026-06-25 (target; today's render still hard-codes the verbs)

## Context
The render layer frames each shared entry with a **fixed verb keyed only on its
kind**: `prompt → "<author> asked …"`, `summary → "<author>'s AI concluded …"`. But
a turn does not always *conclude*. It can end in a question back to the pair, a
blocker, a decision, a proposal, or just progress. Hard-coding "concluded"
mislabels all of those.

Observed live (the bug that forced this): a teammate's AI ended a turn with the
clarifying question *"Which angle do you want to pursue — A or B?"* and clair
rendered it as **"Rajiv's AI concluded: …"**. It concluded nothing — it asked. The
framing should reflect what actually happened, not the entry's storage kind.

## Decision
Frame shared entries by their **intent**, classified by the **sender's AI** at the
moment its turn ends — the one place that is both *informed* (it just wrote the
message) and *cheap* (no extra LLM call, no latency on the receiver's critical
path). This is the "offload the smarts to the local Claude" principle applied to
framing.

- **Prompts stay neutral and verbatim** — `💬 <author>: "<text>"`. A prompt is
  shared at `UserPromptSubmit`, *before* any AI has reasoned about it, so there is
  nothing to classify yet. (Drops the presumptuous "asked".)
- **The AI's turn-end carries an intent** the sender's AI picks. Mechanism: extend
  the existing `CLAIR-SUMMARY:` sentinel the Skill already uses —
  `CLAIR-SUMMARY[<intent>]: <text>`. The `Stop` hook parses the optional tag and
  stores it on the `summary` entry. Render maps intent → framing:

  | intent | framing |
  |--------|---------|
  | `asks` | `❓ <author>'s AI needs your input:` |
  | `decides` | `→ <author>'s AI decided:` |
  | `blocked` | `⛔ <author>'s AI is stuck on:` |
  | `done` | `✓ <author>'s AI concluded:` |
  | `update` (default) | `· <author>'s AI:` |

- **Untagged defaults to `update`** (neutral). This alone removes the wrong
  "concluded" even when the AI emits no tag — correctness without requiring the
  optional smarts.
- The intent vocabulary is **small (≤5)** on purpose; expand only when a real need
  appears.
- Both renders — AI-facing `additionalContext` and human-facing `systemMessage` —
  use the **same** intent→framing map (one source of truth in `render.rs`), so they
  never diverge.

## Consequences
- `Entry` gains an optional `intent` (additive; absent ⇒ `update`). Old entries with
  no intent render neutrally — back-compatible.
- The Skill instructs the AI to tag intent **only** when its turn genuinely ends in
  a question / blocker / decision; otherwise omit and accept the neutral default.
- Classification stays at the sender, at `Stop` — never a blocking classifier call
  on the receiver's prompt path (consistent with the fail-open hook design).
- Keys nothing on the receiver: the receiver's binary renders the label it was
  handed, so the experience is identical across harnesses.

## Current state / next step
As of 0.1.5 `render.rs` still hard-codes `asked` / `'s AI concluded`. The immediate
implementation step is the **neutral default** (kills the mislabel); the
`CLAIR-SUMMARY[<intent>]` tag + the mapping table land on top. Until then this ADR
is the agreed target, logged so the framing is not re-litigated.
