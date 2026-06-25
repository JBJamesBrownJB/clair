# 0004 — Delivery is pluggable; live updates via a watcher + Channels

**Status:** proposed (open) · 2026-06-25

## Context
Inbound shared-context can reach a Claude session two ways:
- **Pull** at the user's next interaction (`UserPromptSubmit` hook) — works today, loop-safe.
- **Push** ambiently while idle — needs **Channels** (MCP `claude/channel` + `--channels`,
  Claude Code ≥ 2.1.80, Anthropic auth), and channel messages are *reacted to* by Claude,
  which risks the echo loop.

Slice 1 ships pull. We want push later **without rebuilding**.

## Decision (proposed)
Decouple **capture → store → delivery**, and make delivery swappable behind a single read:

- Store is git, append-only, with **addressable entries** (monotonic id + ts + author) and a
  **per-consumer last-seen cursor**.
- All inbound delivery — pull *and* future push — reads via one `entries_since(cursor)` function.
- Live delivery is a **plain background process** (`clair watch`/`serve`) that fetches and
  surfaces new entries through Channels. It only *detects + delivers*; it never *generates*.
- A parallel **LLM** "watcher" agent is rejected (token cost, can't render into the main
  session, and an LLM reacting re-opens the loop).

## Open / to resolve before slice 2
- Spike: can a Channel message be made **passive** (display-only, no LLM reaction) → loop-safe?
- Channels' auth + opt-in friction vs. the instant-wow install story.

## Consequences
- Slice 1 **must** implement addressable entries, a local cursor, and the single
  `entries_since(cursor)` read — so swapping pull → push is additive, not a rewrite.
