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

## Alternative delivery triggers (if the local-server route stalls)
- **Watcher daemon + Claude Code Channels** — a background `clair` watcher polls the
  remote shadow ref and emits a Channel message into the local session. This is what
  ADR 0004 anticipated; Channels (`channelsEnabled` / `allowedChannelPlugins`) are
  the harness's inbound-message surface.
- **MCP server push notifications** — if/when server→client push lands (issue
  #36665), the bundled clair MCP server pushes directly, no separate watcher.

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

## Research (art of the possible)
- MCP **streamable HTTP / SSE** transport — the spec path for server→client streams.
- **`claude/channel`** capability + Channels settings in Claude Code.
- `anthropics/claude-code` issue **#36665** — "MCP server push notifications".
- "Pulse" — a community MCP server for real-time Claude Code notifications (prior art).

## Open questions (union of both drafts)
- **`claude/channel` first.** Does Claude Code already support unsolicited
  server→client push (issue #36665)? If so the SSE transport exists and we may skip a
  bespoke polling layer. **Check this before building anything.**
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
