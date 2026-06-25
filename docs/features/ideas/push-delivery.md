# Push-based / live delivery — ambient real-time pairing (IDEA / speculative)

**Status:** idea · speculative · not built. Builds on
[ADR 0004](../../decisions/0004-delivery-pluggable-live-via-watcher.md) (pluggable
delivery; live via watcher + Channels) and reuses the human-facing `systemMessage`
render already shipped.

## The gap
Slice-1 delivery is **human-gated and snapshot-based**: the receiver only sees the
pair's new activity when *they themselves submit a prompt* (the `UserPromptSubmit`
hook). Felt live as: *"I only see what gets injected when you send a message — it's
a snapshot, not a live feed."* The wanted experience is **ambient**: the pair's
activity surfaces on screen *while you are idle*, no keystroke required — a shared
brain that taps you on the shoulder, not one you have to poke.

Crucially, only the **delivery trigger** is missing. The render (both the AI's
`additionalContext` and the human's `systemMessage`) already exists; ambient
delivery just needs to fire it without a prompt.

## Constraints (non-negotiable)
- **No central server.** Git stays the transport and the source of truth.
- **No peer-to-peer sockets.** A "local server talking to the other person's
  machine" assumes the network allows it — it generally won't (NAT, firewalls,
  cross-org). Each side may only talk to *its own* local process and the *git
  remote*.
- **Loop-safety preserved.** Inbound (receive → surface) must never trigger outbound
  (share). Receiving a delta writes nothing — the two-pipe guard must survive
  whatever new trigger we add.
- Fat-client / dumb-pipe; harness-agnostic goal; ephemeral.

## Candidate architectures

### A. Local long-poll MCP per side (no cross-peer networking)
Each user runs a **local** HTTP MCP server. The clair CLI, inside it, **efficiently
long-polls its own shadow branches** (a tight `git fetch` of just the orphan ref +
delta read against the local cursor), and the local MCP **pushes via SSE to its own
user's session only**. No side ever connects to another side directly — everyone
talks to their own local MCP and the shared git remote. This sidesteps the
network-won't-allow-it problem entirely. (Sketched live by the pair.)

### B. Watcher daemon + Claude Code Channels
A background `clair` watcher polls the remote shadow ref and emits a Claude Code
**Channel** message into the local session when a delta lands. This is what ADR 0004
anticipated; Channels (`channelsEnabled` / `allowedChannelPlugins`) are the
harness's inbound-message surface.

### C. MCP server push notifications
If/when MCP server-initiated push lands (see research), the bundled clair MCP server
pushes a notification to the session directly — no separate watcher.

## Research (art of the possible)
- MCP **streamable HTTP / SSE** transport — the spec path for server→client streams.
- **`claude/channel`** capability + Channels settings in Claude Code (inbound MCP
  messages pushed into a session).
- `anthropics/claude-code` issue **#36665** — "MCP server push notifications".
- "Pulse" — a community MCP server for real-time Claude Code notifications (prior
  art for the pattern).

## Open questions (resolve before building)
- **Poll cadence & efficiency.** How tight a `git fetch` of one orphan ref can we do,
  how often, with what backoff — without burning battery or rate limits?
- **Idle surfacing.** Which mechanism actually renders to the human *without* a
  prompt — a Channel message, an MCP notification, a status-line poke? Validate one
  empirically before committing.
- **Loop-safety under a new trigger.** Re-prove that an ambient inbound never causes
  an outbound write (the slice-1 guard assumed prompt/stop as the only triggers).
- **Where the smarts live.** CLI doing the polling vs. the harness owning a channel —
  which keeps it harness-agnostic?
- **Cross-machine vs same-machine.** Same-machine solo review is trivial; the real
  win is cross-machine, which must lean *only* on the git remote.
- **Lifecycle.** Who starts/stops the local server or watcher, and when (per repo?
  per pairing session? on `with`?).

Keep this speculative until one delivery mechanism is empirically shown to surface
to an idle human; then it earns a `proposed` ADR and a `doing/` slice.
