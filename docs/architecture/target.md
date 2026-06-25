# clair — Target Architecture

> A visual synthesis of where clair is heading. Diagrams are labelled **SHIPPED**
> (built + tested), **TARGET** (agreed, not yet built), or **SPECULATIVE** (an idea
> doc, design still open). Deep mechanics live in the linked ADRs and `features/`
> docs; this page is the map that ties them together.

## Thesis
clair lets developers pair through their AI harness. The **smarts live in one local
binary**; **Git is the only backend**; harnesses plug in through **portable, standard
surfaces** (MCP tools + an Agent Skill). No central server.

## Locked principles (see [vision](../seed-ideas.md))
Fat client / dumb pipe · **Git is the pipe** · branch-scoped · **ephemeral, not an
audit log** · two-pipe loop-safety · instant-wow.

---

## 1. System overview — SHIPPED
Each developer runs their own Claude Code with the clair plugin. The plugin carries
two background hooks, an MCP server (`clair serve`), and the CLI — all faces of one
Rust binary. The only thing crossing machines is **git**.

```mermaid
flowchart LR
  subgraph JBM["JB's machine"]
    direction TB
    JBcc["Claude Code session"]
    JBpl["clair plugin<br/>hooks · clair serve (MCP) · CLI"]
    JBrepo["local clone<br/>.git/clair/ : alias + cursor"]
    JBcc <--> JBpl
    JBpl --> JBrepo
  end
  subgraph RJM["Rajiv's machine"]
    direction TB
    RJcc["Claude Code session"]
    RJpl["clair plugin<br/>hooks · clair serve (MCP) · CLI"]
    RJrepo["local clone<br/>.git/clair/ : alias + cursor"]
    RJcc <--> RJpl
    RJpl --> RJrepo
  end
  REMOTE[("shared git remote<br/>orphan shadow refs:<br/>clair/ready · clair/main")]
  JBrepo <-->|"git fetch / push"| REMOTE
  RJrepo <-->|"git fetch / push"| REMOTE
```

The **smarts** are entirely in `clair-core` (git shell-out + local logic); the hooks,
MCP server, and CLI are thin adapters over it.

---

## 2. Git as the only backend — branches & refs — SHIPPED (+ pair-branch idea)
clair **never writes to your working history**. It keeps its state on **orphan shadow
refs** that are never merged and are meant to be thrown away:

- **`clair/ready`** — the registry: who is available to pair, and on which branch.
- **`clair/<branch>`** (e.g. `clair/main`) — an append-only context log for that
  branch: `prompt`, `summary`, and `signal` (join) entries.

```mermaid
flowchart TB
  subgraph WORK["working history — normal git, clair never writes here"]
    direction LR
    main["main"] --> feat["feature/login"]
  end
  subgraph SHADOW["clair-owned orphan refs — never merged, ephemeral"]
    direction LR
    ready["clair/ready<br/>registry: who is available + their branch"]
    ctx["clair/main  (one per working branch)<br/>append-only: prompt · summary · signal"]
  end
  WORK -. "clair writes ALONGSIDE, never INTO working history" .-> SHADOW
```

- **Identity / cursor are local-only**, in `.git/clair/` — `alias` and
  `cursor-<branch>` — never pushed (see [ADR 0005](../decisions/0005-identity-alias-with-teams-deferred.md)).
- **Live code sync** via a pair branch was considered and **ruled out**
  ([why](../features/ideas/pair-branch.md)): git is a poor live-co-edit medium, it is
  not clair's differentiator (Live Share et al. own that space), and it fights the
  never-touch-uncommitted-work rule. clair shares *AI context*, not bytes.

---

## 3. Pairing flow & the two-pipe loop-guard — SHIPPED
A handshake (`ready` → `pair` → `with`) puts both devs on one branch; then context
flows over `clair/<branch>`. Today delivery is **prompt-gated**: a peer's activity
surfaces when *you* next submit a prompt.

```mermaid
sequenceDiagram
  participant JB as JB · Claude Code
  participant G as shared git remote
  participant RJ as Rajiv · Claude Code
  Note over JB,RJ: Handshake
  JB->>G: ready — announce on clair/ready
  RJ->>G: pair — list who is available
  G-->>RJ: JB is ready on feature/login
  RJ->>G: with JB — checkout branch, push join signal
  Note over JB,RJ: both on feature/login, paired
  Note over JB,RJ: Context flow (prompt-gated today)
  JB->>G: prompt hook shares JB's prompt
  RJ->>G: Rajiv's next prompt triggers inbound fetch
  G-->>RJ: JB asked ...
  Note over RJ: surfaced to the human — AI does NOT act
  JB->>G: stop hook shares JB's conclusion
  RJ->>G: Rajiv's next prompt triggers inbound fetch
  G-->>RJ: JB's AI concluded ...
```

**The two-pipe loop-guard** is what stops two AIs ping-ponging forever:

```mermaid
flowchart LR
  subgraph IN["INBOUND pipe"]
    i1["read peer deltas since local cursor"] --> i2["render: additionalContext + systemMessage"]
    i2 --> i3["advance LOCAL cursor only"]
  end
  subgraph OUT["OUTBOUND pipe"]
    o1["append MY prompt (UserPromptSubmit)"]
    o2["append MY summary (Stop)"]
  end
  rule["RULE: inbound writes NOTHING to the ref ·<br/>outbound fires ONLY on a human-started turn"]
  IN --- rule
  OUT --- rule
```

Inbound is read-only (cursor is local), and outbound only fires on the user's own
prompt/stop — so receiving a peer entry produces zero new entries.

---

## 4. Delivery: prompt-gated today → ambient via Channels — SHIPPED + TARGET
The render already produces both an AI view and a human banner. Only the **trigger**
changes: from "on your next prompt" to "live, while you're idle," using Claude Code
**Channels** ([design](../features/ideas/push-updates.md)).

```mermaid
flowchart TB
  subgraph NOW["SHIPPED — prompt-gated (you must type to pull)"]
    direction TB
    n1["Rajiv submits a prompt"] --> n2["UserPromptSubmit hook: fetch + read deltas"]
    n2 --> n3["inject additionalContext (AI) + systemMessage (human)"]
  end
  subgraph TGT["TARGET — ambient via Channels"]
    direction TB
    t1["clair serve declares claude/channel"] --> t2["background loop: git fetch shadow ref ~5s"]
    t2 --> t3["new entry → emit notifications/claude/channel"]
    t3 --> t4["lands LIVE in an idle session<br/>instructions: show to human, do NOT act"]
  end
  gate["Same loop-guard applies:<br/>channel-triggered turns are NOT human-started → never re-shared"]
  NOW --- gate
  TGT --- gate
```

**Status of the target:** Channels is live as a *research preview* (Claude Code ≥
v2.1.80) but idle-delivery has open bugs; gated build — see
[push-updates.md](../features/ideas/push-updates.md) for the full how-to, the
`rmcp`-can-emit-a-notification spike, and the launch-flag caveat.

---

## 5. Identity — SHIPPED
Identity is a chosen **alias**, stored per-clone in `.git/clair/alias` (never your git
config). Resolution: `--as` → alias file → legacy `clair.user` → `user.name` → OS.
The same git account under two aliases = two distinct identities that see each other
(solo review). See [ADR 0005](../decisions/0005-identity-alias-with-teams-deferred.md);
[teams](../features/ideas/teams.md) generalises an alias to span many accounts
(deferred).

Framing of shared entries is **intent-classified by the sender's AI**, not a fixed
verb — [ADR 0006](../decisions/0006-intent-classified-actor-framing.md).

---

## 6. Lifecycle & cleanup — SPECULATIVE
The **ephemeral** principle needs teeth: shadow refs must not accumulate forever.
Design in [lifecycle.md](../features/ideas/lifecycle.md) — split between a clean exit
and a lazy prune that the *next* person to touch clair inherits.

```mermaid
flowchart TB
  trigger["Stop hook fires, OR next clair init/ready/pair call"]
  trigger --> self["ALWAYS: remove self<br/>(append a 'left' tombstone to clair/ready)"]
  trigger --> prune["LAZY PRUNE pass"]
  prune --> p1["clair/ready entries older than ~30m → drop in the fold"]
  prune --> p2["clair/* context refs where ALL entries older than ~4h → delete ref"]
  p2 --> gc["git push --delete: pointer gone instantly;<br/>objects remain until remote GC (delete ≠ erase)"]
  gc --> priv["true privacy → never push shadow refs<br/>(local-only mode, same-machine pairing)"]
  classDef spec stroke-dasharray:6 4
  class trigger,self,prune,p1,p2,gc,priv spec
```

Open mechanics still to settle: "remove self" from an append-only registry means a
**tombstone**, not a delete; a pruned-then-recreated ref should also drop its stale
local cursor; TTLs are guesses.

---

## Components
- **`clair-core`** (Rust lib) — all git + local logic. The only place with brains.
  Unit + BDD tested with no harness involved.
- **`clair` binary** — the CLI; `clair serve` additionally runs an MCP server (`rmcp`).
  One artifact, several faces.
- **Agent Skill + slash commands** — portable `SKILL.md` driving the binary; the
  human UX (`/clair`, `/clair:with @rajiv`). A standard, not Claude-specific.
- **Two background hooks** — `UserPromptSubmit` (inbound + share-prompt) and `Stop`
  (share-summary), bundled in the plugin, auto-firing.

## Decisions
| # | Decision |
|---|----------|
| [0001](../decisions/0001-language-rust.md) | Build clair in Rust |
| [0002](../decisions/0002-git-via-shell-out.md) | Talk to Git by shelling out |
| [0003](../decisions/0003-dual-integration-mcp-and-skill.md) | Integrate via both MCP and Agent Skill |
| [0004](../decisions/0004-delivery-pluggable-live-via-watcher.md) | Pluggable delivery; live via watcher + Channels (proposed) |
| [0005](../decisions/0005-identity-alias-with-teams-deferred.md) | Identity is a chosen alias (teams deferred) |
| [0006](../decisions/0006-intent-classified-actor-framing.md) | Shared-entry framing is intent-classified |

## Idea backlog (`features/ideas/`)
[push-updates](../features/ideas/push-updates.md) (ambient delivery via Channels) ·
[lifecycle](../features/ideas/lifecycle.md) (cleanup) ·
[pair-branch](../features/ideas/pair-branch.md) (live code sync — RULED OUT) ·
[teams](../features/ideas/teams.md) · [chat](../features/ideas/chat.md) ·
[context-sync](../features/ideas/context-sync.md)
