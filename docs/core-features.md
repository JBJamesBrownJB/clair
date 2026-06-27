# clair — Core Features

> The concrete capabilities clair provides, derived from the vision in
> [product.md](product.md). product.md is the *why*; this is the *what*. Each feature
> notes its disclosure **grain** (L0 headline / L1 detail) and **status** (`idea` ·
> `target` = agreed, not built · `built`). All code today is a skeleton, so nothing is
> `built` yet — these are the things we build toward.

## At a glance

| # | Feature | Grain | Status | One-liner |
|---|---------|-------|--------|-----------|
| 1 | Zero-config enrollment | — | target | Installing the plugin enrolls you — no setup command; `clair:alias` optional. |
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

**Installing the plugin *is* the enrollment.** There is no `init`, no setup command,
nothing to run — the plugin ships the statusline, the hooks, and the MCP server, and the
first time any of them runs clair **self-initializes**: it derives your alias from
`git config user.name`, mints a session **instance** id, and starts syncing `refs/clair/*`
in the background. It never mutates your git config (it fetches/pushes those refs with
explicit refspecs), so there is nothing to undo.

From that point it's **hands-off**: clair fetches and emits over the git remote you already
have. "Hands-off" means *zero-config*, not autonomous — you stay the gate for what reaches
your agent (see product.md, *Human-first*).

**Two optional niceties — the only commands you ever need:**

```
clair:alias rajiv     # set your principal so peers see "rajiv", not "james-laptop"
clair:pause           # stop broadcasting for a bit; clair:resume turns it back on
```

`clair:alias` persists to `git config clair.alias` (with no argument it prints your current
alias and where it resolved from). Neither command is required — they exist so identity and
presence are *yours to adjust*, not *yours to configure*.

**Consent & visibility.** Because install = enrollment, the first run **also broadcasts**:
your blips (presence, branch, paths, emitted bodies) become visible to **anyone who can
`fetch` your remote** — the same audience as your branches, but finer-grained and
pre-commit; on a public origin, that's the world. To keep the trade honest without breaking
zero-config:

- A **one-time, non-blocking** first-run line states plainly *who can see your activity* and
  points to `clair:pause` / local-only. (Not a blocking gate — instant-wow is preserved; the
  cost is that you *are* visible until you opt out.)
- **Local-only is a first-class mode**: `clair --local` (or `clair:pause` left on) **reads
  peers but never emits** — full inbound awareness, zero outbound. Use it when sensitivity
  matters; see product.md, *Consent & visibility*.
- The *"what clair shares about me"* view lives in `/clair:status` (the **YOU** section).

**`clair:pause` / `clair:resume`, precisely.** Pause stops **all outbound** (presence refresh
+ emitted clairs) while fetch/read **continues** — you still receive, and resume is instant.
It does not retract already-pushed blips, but presence **self-evicts on its ~5-min TTL**, so
going quiet is bounded even without explicit retraction. (Clean-exit removal and a `withdraw`
that deletes your refs are transport-spec concerns.)

> The bare `clair` CLI still exists, but as the **standalone entrypoint** for non-plugin
> harnesses (the *harness-agnostic ambition*), not as an enrollment step. Inside Claude
> Code you never type it.

---

## 2. Proximity statusline — the always-on radar

clair renders its **own line in the Claude Code statusline**, and it is not a static
counter — it is a **proximity radar**. At rest it shows ambient presence (**Tier 0**:
~free, always on). As a peer's activity closes in on *your* work, the same line
**escalates** — adding specificity and color — until, at the threshold, it becomes the
**trigger** that fires the full L1 surfacing elsewhere.

```
◈ clair · 3 people                          (grey  — resting, pure L0 ambient)
◈ clair · rajiv ✎ auth.rs  ‹your file›      (amber — a standing overlap with your work)
⚠ clair · merge-risk · rajiv auth.rs:40     (red   — just crossed/worsened; the L1 trigger)
```

The bare line leads with **people** (not session count, which overstates a fleet of agents);
session/agent counts live on `/clair:status`. **Color is transition-aware**: a *standing*
overlap sits at **amber**; **red is reserved for a hit that just appeared or worsened** —
otherwise a red that means "still true" becomes wallpaper within a day (see stats-digest.md,
the render ladder).

**"Proximity" unifies both escalation triggers.** *Spatial* proximity — you're editing
in/near a file or hunk a peer is active in (cheap, local, deterministic) — and *semantic*
proximity — a peer's decision or finding bears on what you're doing (the hard relevance
problem of feature 3). The line visualizes **distance closing** in either sense, so one
surface serves the cheap triggers now and the hard one later without changing shape.

**The statusline spans L0 up to the L1 _trigger_, but not the L1 _body_.** A status row
is too small for a diff or a conclusion. It is the dial and the alarm; crossing the
threshold is what surfaces the detail.

> **Open: how the L1 _body_ reaches you.** A statusLine command can only print a line — it
> has **no API to raise a banner or notification**. So the auto-escalating red trigger is real
> push, but the *delivery channel for the body* is **not yet validated against Claude Code's
> docs** — candidates: a hook injecting `systemMessage`/`additionalContext` on the next
> session event, or the statusline process emitting an OS notification, to be confirmed
> exactly as the statusline itself was. Until then, the honest fallback is: **the red line
> surfaces automatically; you pull the detail** via `/clair:status` or a query. "Push is the
> magic" still holds — the *unprompted trigger* is the magic; only the final fetch may be a
> pull.

**Discipline — the radar must stay quiet.** Same failure mode as "a banner that's always
on is a banner nobody reads," applied to color: the line is grey and minimal almost
always, and earns a color change only when proximity genuinely rises. An ever-flashing
statusline is noise with extra steps.

**Why it's the right home for L0.** The statusline is local, costs no API tokens, and —
crucially — Claude Code's `refreshInterval` re-runs the command on a timer, so the line
can reflect repo activity that changes *outside your session*. That is exactly the
ambient-presence need: clair keeps a small local snapshot of the last-fetched shadow-ref
state, a fast `clair status` command reads it, and the statusline polls it every few
seconds. The line renders nothing it computes itself — it is a slice of a precomputed
**stats digest** (schema, storage, render ladder, and the `/clair:status` dashboard in
[architecture/stats-digest.md](architecture/stats-digest.md); the cost budget that keeps
it free is enforced by [architecture/benchmarking.md](architecture/benchmarking.md)).

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

**Two audiences, two interruption budgets.** The lesson from the prior-art lineage is that
*humans* switch off tools that nag — so the **human surface (the statusline) stays calm**,
amber-by-default, red only on change. But in an agent-majority repo the more important
consumer is the **agent**, and an agent's interruption cost is ≈zero: nobody minds their
*agent* being interrupted if it produces a better result. So the **agent-facing leg can
escalate far more aggressively** than the human one — a quadrant the human-only lineage never
had. Same relevance engine, two different thresholds. (See product.md, *Human-first* and the
agent-centric thesis.)

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

> **Collision is _computed_, not stored.** Of the five, only four are stored clairs
> (presence + the three highlights). A collision is a pure function of two instances'
> presence + their pushed diffs, so the consumer **derives** it locally as a `near_you` view
> rather than anyone writing/syncing a "collision" object — which also kills a peer-to-peer
> writer-election race. Self-collision (two of *your own* agents diverging) is the same
> computation (see data-model.md, *Two lifecycles*).

---

## 5. Emitting a clair (outbound)

The other half of awareness: your session contributes blips others receive. Your AI
distils what you just did into a headline + *about* key and emits it; it is
**intent-classified**, so the right things become highlights and the noise stays noise.

This rides the **two-pipe loop-safety** rule: receiving a clair never emits one, and
outbound only fires on your own turn — so two AIs can't ping-pong. Emission writes to the
orphan shadow ref (see product.md, *How it rides on git*); never to your working history.

**Emit safety — distillation is not redaction.** What you emit is visible to **anyone who
can fetch the remote** (emit exposure == remote read ACL). Classifying intent does *not* make
content safe: an API key in a prompt, a diff touching `.env`, a pre-disclosure vuln in a
`finding`, or PII in a stack trace would all leak. So two constraints: (1) emit must **never
publish content the author hasn't committed**; (2) bodies are **structured summaries of
intent**, not raw prompt/diff verbatim by default. Secret/PII scrubbing of
`headline`+`about`+`body` is a **named requirement** for the emit/transport spec; whether
high-sensitivity kinds (`incident`/`finding`) should be opt-in is an open question
(data-model.md).

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

- **Loop-safe ≠ content-trusted — two separate guarantees.** *Loop-safe* means a query
  **writes nothing** (inbound/read-only; never emits — the two-pipe rule), so the agent may
  call it mid-task. *Content-trust* is the other axis: results are **untrusted peer data**.
  Because `principal` is self-asserted and any push-capable peer can forge a blip, an inbound
  body could be hostile free text — textbook indirect prompt injection. **The invariant:
  inbound headlines/bodies enter agent context as quoted, attributed _data_, never as
  instructions; an agent-initiated pull may READ, never ACT.** Acting on what a peer shared
  stays a human-gated decision (see data-model.md, *Trust model*).
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
