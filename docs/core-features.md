# clair — Core Features

> The concrete capabilities clair provides, derived from the vision in
> [product.md](product.md). product.md is the *why*; this is the *what*. Each feature
> notes its disclosure **grain** (L0 headline / L1 detail) and **status** (`idea` ·
> `target` = agreed, not built · `built`). All code today is a skeleton, so nothing is
> `built` yet — these are the things we build toward.

## At a glance

| # | Feature | Grain | Status | One-liner |
|---|---------|-------|--------|-----------|
| 1 | Zero-config enrollment | — | target | One command and you're in the ambient layer, forever. |
| 2 | Proximity statusline | L0 → L1 trigger | target | clair's own line in Claude Code: ambient presence that escalates as relevance closes in. |
| 3 | Relevance escalation | L0→L1 | idea | The right blip rises out of the noise and surfaces to you. |
| 4 | The five clair kinds | L0/L1 | idea | What can surface: presence, collisions, decisions, incidents, findings. |
| 5 | Emitting a clair | L1 | idea | Your AI distils what you did and shares it, loop-safe. |
| 6 | Ask clair (on-demand query) | L0→L2 pull | target | Ask in plain language: "who's in the repo?", "what's rajiv doing?" |

> **Two legs.** Features 2–4 are the **push** leg (clair surfaces what's relevant). Feature
> 6 is the **pull** leg (you or the agent ask on demand). Push is the magic; pull is the
> guarantee — it works even when the relevance engine doesn't.

---

## 1. Zero-config enrollment

Run one command and you're enrolled in the repo's ambient layer. No channels to join,
no config to tend, nothing to run.

```
clair
```

From that point it's **hands-off**: clair fetches and emits in the background over the
git remote you already have. "Hands-off" means *zero-config*, not autonomous — you stay
the gate for what reaches your agent (see product.md, *Human-first*).

---

## 2. Proximity statusline — the always-on radar

clair renders its **own line in the Claude Code statusline**, and it is not a static
counter — it is a **proximity radar**. At rest it shows ambient presence (**Tier 0**:
~free, always on). As a peer's activity closes in on *your* work, the same line
**escalates** — adding specificity and color — until, at the threshold, it becomes the
**trigger** that fires the full L1 surfacing elsewhere.

```
◈ clair · 3 active                          (grey  — resting, pure L0 ambient)
◈ clair · rajiv ✎ auth.rs  ‹your file›      (amber — warming, spatial proximity)
⚠ clair · merge-risk · rajiv auth.rs:40     (red   — hot; this IS the L1 trigger)
```

**"Proximity" unifies both escalation triggers.** *Spatial* proximity — you're editing
in/near a file or hunk a peer is active in (cheap, local, deterministic) — and *semantic*
proximity — a peer's decision or finding bears on what you're doing (the hard relevance
problem of feature 3). The line visualizes **distance closing** in either sense, so one
surface serves the cheap triggers now and the hard one later without changing shape.

**The statusline spans L0 up to the L1 _trigger_, but not the L1 _body_.** A status row
is too small for a diff or a conclusion. It is the dial and the alarm; crossing the
threshold fires a roomier surface (banner / notification) that carries the actual detail.

**Discipline — the radar must stay quiet.** Same failure mode as "a banner that's always
on is a banner nobody reads," applied to color: the line is grey and minimal almost
always, and earns a color change only when proximity genuinely rises. An ever-flashing
statusline is noise with extra steps.

**Why it's the right home for L0.** The statusline is local, costs no API tokens, and —
crucially — Claude Code's `refreshInterval` re-runs the command on a timer, so the line
can reflect repo activity that changes *outside your session*. That is exactly the
ambient-presence need: clair keeps a small local snapshot of the last-fetched shadow-ref
state, a fast `clair status` command reads it, and the statusline polls it every few
seconds.

**Feasibility (confirmed against Claude Code docs):**

- **Multi-line is supported** — each line the command prints is a separate statusline
  row, so clair gets its own row without disturbing the default info.
- **`refreshInterval` (min 1s)** drives the live updates; the docs explicitly support
  external/background data sources.
- The command receives session JSON on stdin (including `workspace.repo.*`), so it knows
  which repo to report on.
- The **plugin can ship default `statusLine` settings**, so installing clair wires the
  line up — preserving the one-install, instant-wow promise.

**Design caveat — composition.** The statusline is a *single* command, so clair cannot
simply append a row to a statusline you already run. It must either (a) own the whole
command, rendering the default model/dir/branch info *plus* its clair line, or (b) ship a
`clair statusline` snippet you compose into your own script. This is the one piece of UX
to get right; it is not a blocker.

---

## 3. Relevance escalation (L0 → L1)

The engine that lifts a blip from background noise (L0) to a surfaced detail (L1) when it
bears on *your* current work. Escalation is **human-first**: a relevant clair surfaces to
you (statusline → notification/banner); routing it into the agent is your deliberate act.

The **proximity statusline (feature 2) is the visible front of this engine** — the radar
*is* what escalation looks like to a human, graduating from grey ambient presence to a red
L1 trigger as distance closes.

Cheap, local triggers are tractable now (file overlap, merge-region divergence). The hard
part — relevance across a whole repo of solo agents (matching a clair's *about* against
what you're doing) — is the **open problem product.md names**, and the thing clair lives
or dies on. This feature is the reason the project exists; it is deliberately `idea` until
the engine is designed.

---

## 4. The five clair kinds — what can surface

A "clair" is one live event. Five kinds, cheapest/most-automatic first:

1. **Presence** — where everyone is. Free, derived, always-on (feeds feature 2).
2. **Merge-region collisions** — you and a peer have diverged in the same hunk; sync
   before it's a conflict. Cheap, local.
3. **Architectural decisions** — a large change or direction someone committed to.
4. **Incidents / P1s** — something is on fire and being acted on.
5. **Key findings / surprises** — what someone learned that you'd want to know.

The first two are cheap and local; the last three are **highlights** that rely on the
sender's AI classifying intent (feature 5).

---

## 5. Emitting a clair (outbound)

The other half of awareness: your session contributes blips others receive. Your AI
distils what you just did into a headline + *about* key and emits it; it is
**intent-classified**, so the right things become highlights and the noise stays noise.

This rides the **two-pipe loop-safety** rule: receiving a clair never emits one, and
outbound only fires on your own turn — so two AIs can't ping-pong. Emission writes to the
orphan shadow ref (see product.md, *How it rides on git*); never to your working history.

---

## 6. Ask clair — on-demand query (the pull leg)

Everything above is **push** — clair surfaces what's relevant. This is **pull**: you, or
your agent, ask clair directly, in plain language.

```
"who's in the repo?"            → the active peers and where they are (presence, listed)
"what's rajiv doing?"           → rajiv's recent activity: his shared prompts/conclusions
"has anyone touched auth.rs?"   → blips whose about-key matches that path
```

**It's the same data, accessed the other way.** A query reads the blip store you already
build for the push leg — "who's in the repo" lists presence (L0); "what's rajiv doing"
pulls one peer's L1 detail; "show me everything rajiv concluded today" is the explicit L2
deep pull. One store, queried at whatever grain the question demands.

**Why it matters — the reliable floor.** Relevance escalation (feature 3) is the open hard
problem and may stay imperfect for a long time. Pull always works: even when the radar
*doesn't* surface something, asking does. Push is the magic; **pull is the guarantee.**

**Agent-facing, and the one place the agent may initiate.** The push leg is human-first.
But *reading* writes nothing, so a query is loop-safe — which means the agent can call it
mid-task (*"before I edit auth.rs, what has rajiv concluded there?"*). Exposed as an MCP
tool, natural language maps straight onto it. This is clair as an agent-queryable awareness
layer — the agent-facing angle the landscape research flagged as a differentiator (see
[research/landscape.md](research/landscape.md)).

**Bounds to keep honest:**

- **Loop-safe by construction.** A query is inbound/read-only; asking "what's rajiv doing"
  must never emit a clair (the two-pipe rule, same as escalation).
- **A pull is a fetch.** Answering reads the latest shadow-ref state, so a query triggers a
  background fetch first; freshness is bounded by what peers have pushed.
- **Scope = what was emitted.** A query returns peers' *shared* activity (their blips,
  bounded by TTL), never their private session. "What's rajiv doing" answers from what rajiv
  chose to share, not his keystrokes.

---

> **Status note.** Features 1–2 and 6 are concrete and feasible today; 3 is the open research
> problem; 4–5 depend on the emit/transport and escalation design still being settled. The
> detailed ref/transport layout is forward architecture work, tracked separately from this
> product-level list.
