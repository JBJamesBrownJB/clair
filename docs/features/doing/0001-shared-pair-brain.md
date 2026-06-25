# Slice 1 — The Shared Pair Brain (v0)

**Status:** doing · 2026-06-25
**Destination it serves:** *shared memory / two brains, one context* — your Claude stays
aware of what your pair's Claude just did, through git, ephemeral, no server.

> This is the first **lean vertical slice**: it stands up the whole foundation (Rust
> workspace, `clair-core`, git shell-out, cucumber-rs harness, the Claude hooks/skill) and
> delivers a real, felt moment — *"whoa, my Claude already knew what Rajiv did."*

---

## 1. The felt experience

JB and Rajiv each work in their **own** Claude, both on branch `feature/login`.

1. JB types a prompt. Rajiv sees, in **his** Claude session: `↪ JB asked his AI: "refactor the auth guard…"` — and it does **not** make Rajiv's AI do anything.
2. JB's Claude finishes its work. Its final reply is distilled to one paragraph and surfaces in Rajiv's session: `✓ JB's AI concluded: "Moved the guard to middleware; tests still red on the token case."`
3. Symmetric the other way. Each person's Claude is quietly **aware** of the pair's latest context on their next turn.

No new ritual: you just use Claude. clair shares your deltas and shows you theirs.

## 2. Commands (the Agent Skill surface)

| Command | Effect |
|---------|--------|
| `/clair ready` | Register me as **available to pair** in this repo (writes my entry to the `clair/ready` registry, pushes). |
| `/clair pair` | Fetch the registry and **list who's ready** to pair in this repo. |
| `/clair with rajiv` | Resolve `rajiv` to a registered user, **start a pairing session** on the current branch (signal both sides), and activate the capture+inject hooks. |

## 3. How content actually reaches the session (confirmed mechanism)

Built on Claude Code hooks (verified capabilities):

- **Outbound — capture:**
  - `UserPromptSubmit` hook → captures my prompt → `clair` pushes a `prompt` entry.
  - `Stop` hook (fires when Claude finishes) → reads the final reply from the transcript, distils a one-paragraph summary → `clair` pushes a `summary` entry.
- **Inbound — deliver:**
  - `UserPromptSubmit` hook → `clair` fetches the shared branch and returns my pair's **new** entries as `additionalContext` (≤10k chars), so they're visible and my Claude is aware — passively, riding my own next prompt. **No autonomous LLM turn.**

**Ambient idle-push (while you touch nothing) is OUT of slice 1.** The candidate is
**Channels** (MCP `claude/channel` + `--channels`, Claude Code ≥ 2.1.80), but it needs
Anthropic auth + an opt-in flag, and channel messages are *reacted to* by Claude — which
risks the echo loop. → tracked as a spike (§8), not built here.

## 4. Data flow

```mermaid
sequenceDiagram
    actor JB
    participant JBC as JB's Claude (hooks)
    participant G as Shadow branch (remote)
    participant RC as Rajiv's Claude (hooks)
    actor Rajiv

    JB->>JBC: submits a prompt
    Note over JBC: UserPromptSubmit hook fires
    JBC->>G: push prompt entry (JB asked his AI ...)
    JBC-->>JB: LLM works the prompt
    Note over RC: Rajiv's next prompt - hook fetches and injects (passive)
    G-->>RC: deliver JB's prompt entry
    RC-->>Rajiv: shows "JB asked his AI ..."
    Note over JBC: Stop hook distils the final reply
    JBC->>G: push summary entry (one paragraph)
    G-->>RC: deliver JB's summary entry
    RC-->>Rajiv: shows "JB's AI concluded ..."
```

## 5. Components

```mermaid
flowchart LR
    subgraph JBM["JB's machine"]
        direction TB
        JBhook["Claude Code<br/>UserPromptSubmit + Stop hooks"]
        JBbin["clair binary (core)<br/>git shell-out"]
        JBhook -->|invokes| JBbin
    end
    subgraph REM["Git remote (e.g. GitHub)"]
        direction TB
        READY[("clair/ready<br/>orphan · append-only<br/>who's ready to pair")]
        CTX[("clair/&lt;branch&gt;<br/>orphan · append-only JSONL<br/>shared pair context")]
    end
    subgraph RJM["Rajiv's machine"]
        direction TB
        RJbin["clair binary (core)<br/>git shell-out"]
        RJhook["Claude Code<br/>UserPromptSubmit + Stop hooks"]
        RJbin -->|injects| RJhook
    end
    JBbin <-->|"push / fetch"| CTX
    RJbin <-->|"push / fetch"| CTX
    JBbin <-->|"ready / list"| READY
    RJbin <-->|"ready / list"| READY
```

## 6. Git branching (the backend)

All clair state lives on **orphan branches** prefixed `clair/` — never merged into code,
zero impact on history.

```mermaid
flowchart TD
    CODE["your real branches<br/>main, feature/login, …<br/>(untouched by clair)"]
    READY["clair/ready<br/>orphan · never merged<br/>registry of available pairers"]
    CTX["clair/&lt;working-branch&gt;<br/>orphan · never merged<br/>append-only shared context (JSONL)"]
    CODE -. "branch name maps the scope 1:1" .-> CTX
```

- **`clair/ready`** — one registry for the repo. Append-only entries; latest-per-user wins.
- **`clair/<working-branch>`** — the shared context for that branch's pairing session.
  Append-only JSONL ⇒ concurrent writes never text-conflict (sidesteps the merge-driver
  question entirely, and fits *ephemeral, not an audit log*).

### Data model

```jsonc
// clair/<branch>  — one JSON object per line
{ "id":"uuid", "author":"JB", "kind":"prompt|summary|signal",
  "text":"…", "ts":"2026-06-25T10:00:00Z", "turn":"uuid" }

// clair/ready — one object per line, latest-per-user wins
{ "user":"JB", "repo":"clair", "branch":"feature/login", "ts":"…" }
```

## 7. Loop prevention (the guard, made concrete)

- **Two pipes never cross:** *inbound* (fetch → display/inject) never writes; *outbound*
  (push) only fires from **my own** `UserPromptSubmit`/`Stop` turns.
- **Deltas only:** the summary describes *my* turn, never recaps the pair's state.
- **Provenance + last-seen id:** inject only the pair's entries I haven't seen; never my own.
- **Regression test:** *receiving/injecting a peer entry produces zero new entries.*

## 8. Open questions / spikes

1. **Ambient idle-push** — can a **Channel** message be made display-only (passive) so it
   doesn't trigger the recipient's LLM? If yes, that's the path to true live updates. (→ new ADR.)
2. **Summarisation source** — slice 1: the skill asks Claude to emit a one-paragraph shared
   summary as the last step of each turn; the `Stop` hook captures it. (Alt: `clair` calls a
   local model.)
3. **Prompt privacy** — slice 1 shares the prompt text verbatim, framed "JB asked his AI: …".
   A redaction/opt-out toggle is future work.
4. **Identity resolution** — `with rajiv` fuzzy-matching a registry handle; slice 1 may
   require a near-exact handle.

## 9. Test approach (BDD-first)

cucumber-rs `.feature` files run against a **local bare repo as the remote** + two working
copies (JB, Rajiv) — also the local dev setup a user can poke. Scenarios:

- `ready` → my entry appears in the registry; `pair` lists it.
- `with rajiv` → a session signal is visible to the other side.
- A `prompt` entry propagates and renders framed in the pair's context.
- A `summary` entry propagates and renders.
- **Loop guard:** receiving an entry writes nothing back.
- **Scope:** entries on branch A are invisible on branch B.

## 10. Scope

**In:** the three commands, prompt+summary capture/share, passive inbound injection, orphan
shadow branches, append-only model, loop guards, cucumber harness, the thin Claude skill+hooks.

**Out (later slices):** ambient idle-push (Channels), true single shared conversation,
compaction, rich/structured memory, non-Claude harness adapters (isolate behind a capture
trait, don't build), identity fuzzy-matching polish.
