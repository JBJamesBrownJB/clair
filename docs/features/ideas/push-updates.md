# Push-based real-time pair updates (IDEA / speculative)

**Status:** idea · speculative · not built. Merged from two parallel drafts (the JB
and Rajiv sessions wrote one each while pairing). Builds on
[ADR 0004](../../decisions/0004-delivery-pluggable-live-via-watcher.md) and reuses
the human-facing `systemMessage` render already shipped.

## The gap
Today the shared pair context only surfaces when the user sends a message (the inject
hook fires on `UserPromptSubmit`). The human sees a **snapshot, not a live feed**.
The wanted experience is **ambient**: the pair's activity appears on screen *while
you are idle*, no keystroke required. Crucially, only the **delivery trigger** is
missing — the render (AI `additionalContext` + human `systemMessage`) already exists.

## Constraints (non-negotiable)
- **No central server.** Git stays the transport and the source of truth.
- **No peer-to-peer sockets.** "A local server talking to the other machine" assumes
  the network allows it — it generally won't (NAT, corporate/VPN, cross-org). Each
  side may only talk to *its own* local process and the *git remote*.
- **Loop-safety preserved.** Inbound (receive → surface) must never trigger outbound
  (share). Receiving a delta writes nothing — the two-pipe guard must survive the new
  trigger.
- Fat-client / dumb-pipe; harness-agnostic; ephemeral.

## Leading candidate: a local SSE server per side
Each session runs a lightweight **local** HTTP/SSE MCP server that serves only its own
Claude Code instance. clair polls the remote shadow ref(s) on a tight loop
(`git fetch` of just the orphan ref + delta read against the local cursor) and pushes
new entries to *its own* session via SSE the moment they appear. No machine connects
to another machine — everyone talks to their own local server and the shared git
remote.

```
[JB's Claude Code] <--SSE-- [JB's local clair server]
                                      |
                               git fetch / push
                                      |
                             [shared git remote]
                                      |
                               git fetch / push
                                      |
[Rajiv's Claude Code] <--SSE-- [Rajiv's local clair server]
```

Works cross-machine as long as both sessions share a git remote (GitHub etc.).
Polling latency of 5–10 s is fine for a pair-brain. Backoff: active session ≈ 5 s
poll, idle backs off to minutes. Auth: reuse the existing git-remote credentials — no
new auth surface.

### Why not a shared / central HTTP server?
A single shared server either requires both sessions to reach each other over the
network (breaks on restrictive corporate/VPN setups) or requires a hosted relay
(kills the "no server, just git" promise). The local-server-per-side design avoids
both.

## Channels: the inbound mechanism — status (researched 2026-06-25)
Claude Code **Channels** is exactly the inbound leg this design needs, and it is
**live as a research preview** (requires Claude Code ≥ **v2.1.80**). A "channel" is a
local MCP server that pushes `notifications/claude/channel` events into an OPEN
session; the user opts in per session with `--channels` (gated by `channelsEnabled`).
Two-way chat bridges (Telegram, Discord, iMessage) already ship as channel plugins.
So clair would be a **one-way channel** — poll git, push new entries in. **Channels
IS the "SSE → Claude" leg; no bespoke SSE server is needed.**

**The catch — the exact leg we depend on (deliver to an _idle_ session) is the buggy
one right now:**
- **#61797** — MCP notifications silently dropped when delivered to an IDLE session
  via `--channels` (literally our use case).
- **#58469** — `--channels` and `channelsEnabled: true` both ignored on personal Max
  accounts; inbound silently dropped.
- #40729 / #36472 / #44283 — Discord/Telegram channel inbound not delivered.

**Do NOT design around raw MCP push.** The generic "MCP server push / unsolicited
messages" request (**#36665**) was **closed as not planned** — Channels is the
sanctioned path. Build on Channels, not raw server→client notifications.

**Verdict:** architecture validated and the mechanism exists, but it is preview-grade
and the idle-delivery path has open defects. Building today means riding a preview
with the precise bug we'd hit. Gate the build on (a) Claude Code ≥ v2.1.80 **and**
(b) the idle-delivery issues (#61797, #58469) closing. Until then, slice-1's
prompt-gated `systemMessage` delivery stands as the shipped experience.

## How we'd build it on Channels (implementation sketch)
A channel is just an MCP server that (a) declares
`capabilities.experimental['claude/channel'] = {}` and (b) emits
`notifications/claude/channel` with `{ content, meta }`. The content lands in the
session as `<channel source="clair" …>…</channel>`, pushed live even when idle. clair
already ships an MCP server (`clair serve`), so it becomes a **one-way channel** with
four additions:

1. Declare the `claude/channel` capability on `clair serve`.
2. A background **git-poll loop** inside `clair serve`: `git fetch` the shadow ref
   ~every 5 s, read entries past the local cursor.
3. Emit one `notifications/claude/channel` per new entry — `content` = the human
   banner we already render (reuse `render_inbound_human`).
4. An `instructions` string so the AI handles events **smartly, not muted**: present
   them to the human as a short pair-awareness note; do **not** start working on the
   teammate's task; do **not** reply into the channel.

### Loop-safety with live channel delivery (the invariant)
A channel event *triggers a Claude turn* (Claude receives it and responds). Smart
display is fine — but that turn must **not** produce a new shared entry, or it
ping-pongs: JB's prompt → Rajiv's channel → Rajiv's AI reacts → Rajiv's `Stop` shares
it → JB's channel → … . **Rule: the outbound pipe fires only on _human-started_
turns.** A channel-triggered turn has no `UserPromptSubmit`, so the `Stop` hook must
skip sharing it. Small change to the share-gate; the two-pipe loop-guard holds while
the AI is as smart as the instructions allow.

### Turning it on (today, preview)
- Claude Code ≥ **v2.1.80**.
- Launch each session with `claude --dangerously-load-development-channels plugin:clair@clair`.
- That `--dangerously-…` flag is the **research-preview gate for channels not on
  Anthropic's curated allowlist** — temporary. Once clair is allowlisted (official-
  marketplace listing / partner coordination, or an org's `allowedChannelPlugins`)
  it becomes the ordinary `--channels plugin:clair@clair` (no "dangerously"). A
  lightweight per-session opt-in (`--channels` / `channelsEnabled`) likely remains by
  design — friction, but nothing alarming.

### Gating build risk — spike this first
Every Channels example is the **JS** MCP SDK. **Unproven for us:** can our Rust
`rmcp` server declare an `experimental` capability and emit a raw
`notifications/claude/channel` *outside* a tool call? Spike *just that* (~30 min)
before committing. Clean ⇒ the poll loop + instructions + share-gate are
straightforward; not clean ⇒ send a raw JSON-RPC notification ourselves, or it's a
wall.

## Alternative delivery triggers (if Channels idle-delivery stays unreliable)
- **Watcher daemon + Channels** — a background `clair` watcher polls the remote
  shadow ref and emits a Channel notification into the local session (the
  poll/deliver split of the leading candidate; ADR 0004 anticipated this).
- ~~**Raw MCP server push** (issue #36665)~~ — **ruled out**: closed as not planned;
  Channels supersedes it.

## Shadow-branch shape — an open divergence to resolve
The two drafts disagree on keying, and this is the crux:

- Rajiv's draft: `refs/clair/<alias>` — an append-only log **per alias** (alias, role,
  text, timestamp), written by the local server on every hook capture, pruned on
  `/clair:unpair`.
- Slice-1 (shipped): `clair/<branch>` — context **per branch**.

Per-alias vs per-branch key the brain differently. This is the same axis flagged in
[teams.md](teams.md) ("brain keyed by alias / session / branch"). **Resolve before
building:** does ambient delivery follow the *branch you're on* (current model) or
your *alias across branches*?

## Research trail (see the Channels status section above for findings)
- [Channels reference — Claude Code Docs](https://code.claude.com/docs/en/channels-reference)
- `claude/channel` capability + Channels settings (`channelsEnabled`,
  `allowedChannelPlugins`, `--channels`).
- Idle-delivery defects: issues #61797, #58469, #40729, #36472, #44283.
- Raw MCP push request #36665 — **closed as not planned** (Channels supersedes).

## Open questions (union of both drafts)
- ~~**`claude/channel` first.**~~ **ANSWERED (2026-06-25):** Channels is live as a
  research preview (≥ v2.1.80) and is the inbound mechanism — but idle-session
  delivery has open bugs (see status section). The remaining gate is those bugs
  closing, not whether the feature exists.
- **Brain keying:** per-branch vs per-alias (the divergence above).
- **Loop-safety under a new trigger:** re-prove an ambient inbound never causes an
  outbound write (the slice-1 guard assumed prompt/stop were the only triggers).
- **Poll cadence & efficiency / backoff:** active short (~5 s), idle long (minutes).
- **Idle surfacing:** which mechanism actually renders to an *idle* human — validate
  one empirically before committing.
- **Lifecycle:** who starts/stops the local server or watcher, and when (per repo? per
  pairing session? on `with`?).
- **Cross-machine** leans *only* on the git remote (works); never direct peer sockets.

Keep this speculative until one delivery mechanism is empirically shown to surface to
an idle human; then it earns a `proposed` ADR and a `doing/` slice.
