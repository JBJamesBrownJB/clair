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
| 2 | Presence statusline | L0 | target | clair's own line in Claude Code: who's active, where. |
| 3 | Relevance escalation | L0→L1 | idea | The right blip rises out of the noise and surfaces to you. |
| 4 | The five clair kinds | L0/L1 | idea | What can surface: presence, collisions, decisions, incidents, findings. |
| 5 | Emitting a clair | L1 | idea | Your AI distils what you did and shares it, loop-safe. |

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

## 2. Presence statusline — the always-on L0 surface

clair renders its **own line in the Claude Code statusline**: a live, glanceable
headline of who else is in the repo and roughly where. This is **Tier 0** —
~free, always on, the cheapest grain of awareness.

```
◈ clair · 3 active · rajiv ✎ auth.rs · maya ✎ api/ · ⚠ 1 merge-risk
```

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

> **Status note.** Features 1–2 are concrete and feasible today; 3 is the open research
> problem; 4–5 depend on the emit/transport and escalation design still being settled.
> The detailed ref/transport layout is forward architecture work, tracked separately from
> this product-level list.
