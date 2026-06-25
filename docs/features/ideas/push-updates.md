# Push-based real-time pair updates

Currently the shared pair context only surfaces when the user sends a message (the
inject hook fires on `UserPromptSubmit`). The human sees a snapshot, not a live feed.

## Idea

Each session runs a lightweight local HTTP/SSE MCP server that only serves its own
Claude Code instance. The shared medium remains git — each peer writes conclusions to
a dedicated shadow branch (`refs/clair/<alias>`). Each local server polls the remote
with `git fetch refs/clair/*` on a tight loop and pushes new entries to the local
session via SSE the moment they appear.

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

No direct machine-to-machine networking. Works cross-machine as long as both
sessions share a git remote (GitHub etc.). Polling latency of 5–10 s is acceptable
for a pair-brain use case.

## Why not a shared HTTP server?

A single shared server requires both sessions to reach each other over the network
(breaks on restrictive corporate/VPN setups) or requires a hosted relay (kills the
"no server, just git" promise).

## Shadow branch schema

- `refs/clair/<alias>` — append-only log of entries (alias, role, text, timestamp)
- Written by the local server on every hook capture
- Never merged into working branches; pruned on `/clair:unpair`

## Open questions

- MCP `claude/channel` capability: if Claude Code supports unsolicited server→client
  push (issue #36665), the SSE transport is already there. Worth checking before
  building the polling layer.
- Backoff strategy: active session = short poll (~5 s), idle = back off to minutes.
- Auth: git remote credentials are reused — no new auth surface.
