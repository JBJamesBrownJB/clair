# clair — Landscape & Prior Art

> Competitive and academic landscape for clair: ambient, repo-level awareness for
> developers and AI agents, via progressive disclosure, over ephemeral git refs.
> Companion to [../product.md](../product.md) (the vision) and
> [../core-features.md](../core-features.md) (the capabilities). This is forward-looking
> positioning intel, not pre-reset research.
>
> **Provenance.** Produced by a multi-agent deep-research sweep (5 search angles → 25
> primary/secondary sources → claim extraction → adversarial verification). The
> academic-lineage and ambient-awareness claims were adversarially vote-verified; the
> git-transport, AI-agent, live-collaboration and presence claims were extracted from
> primary/secondary sources but the verification pass ran out of budget before voting on
> them. Confidence is tagged per claim:
> **[V]** vote-verified · **[T]** established/textbook · **[E]** extracted, not yet vote-verified.

## The one-sentence finding

Every *ingredient* of clair has strong prior art — but the **combination** (ambient
peripheral awareness · over **ephemeral** git refs · for independently-driven **AI
agents** · escalating in the **editor statusline**) sits in a gap **nobody currently
occupies**. The closest things either need a server, need everyone to install the same
client, or coordinate agents by *isolation/orchestration* rather than *awareness*.

---

## 1. The academic lineage — closest ancestors, and a sharp warning  [V]

A 20-year CSCW thread did almost exactly clair's *concept*, pre-AI:

- **Palantír** (Sarma & van der Hoek, ICSE 2003) — the direct ancestor. Continuously
  **pushes** "who is changing which artifact" *before* integration, and computes a
  **severity metric** (lines changed ÷ total) to escalate a bare change-indicator into a
  conflict warning. That is clair's push-transport + proximity-escalation, in 2003.  **[V]**
- **FASTDash** (Microsoft Research, CHI 2007) — dashboard flagging two people editing the
  same file. Spatial proximity.  **[V]**
- **Syde / Scamp** (Lanza et al., CSMR 2010) — color-by-author concurrent-edit awareness,
  but **client–server, central broadcast**. Exactly the dependency clair removes.  **[V]**
- **Crystal** (Brun & Holmes, FSE 2011) — carries **the lesson to heed**: it rejected pure
  awareness tools because **"who's editing what" produces false positives from exploratory
  edits**, and only reports conflicts **after code is committed**. It also shipped clair's
  exact UX — a system-tray severity icon → mouse-over for detail = **progressive disclosure
  in a 2011 dev tool**.  **[V]**
- **Cassandra** (Kasi & Sarma, ICSE 2013) — frames the whole lineage as "reactive" and goes
  further (constraint-solves to reschedule tasks). clair deliberately stays in the
  *awareness* camp, not the *prescribe-task-order* camp.  **[V]**
- **CollabVS** — direct **and** indirect (dependency) conflict detection.  **[V]**

**Why they never went mainstream** (synthesis): heavyweight (central servers,
language-specific AST/build analysis, IDE plugins), noisy (false positives), high-friction.
One field study noted a co-located pair **turned the views off as useless** — awareness pays
mostly when participants are *distributed*.

**Lessons for clair:**
1. **Gate escalation on committed/pushed intent, not keystrokes** (Crystal's finding) —
   conveniently what the shadow-ref transport already does: clair shares committed/concluded
   state, not live bytes.
2. Stay genuinely **low-interruption** or it gets switched off.
3. The **"solo agents on separate branches"** premise is exactly the *distributed* condition
   where this lineage showed the most value.

## 2. Ambient-awareness theory — the vocabulary already exists  [V/T]

- **Social Translucence** (Erickson & Kellogg, TOCHI 2000): *visibility, awareness,
  accountability* let people self-coordinate without explicit rules. Their **"social
  proxy"** in Babble (marbles in a circle showing who's present / active / arriving) is a
  **literal 1999 precedent for the proximity radar**.  **[V]**
- **McCrickard et al. IRC framework** (TOCHI 2003): notification design = balancing
  **Interruption / Reaction / Comprehension**; the **"Ambient Media" class** (low-interrupt,
  low-reaction, high-comprehension) precisely describes clair's L0 line.  **[V]** This is the
  rigorous backbone for "stay quiet, escalate only when relevant" — and a concrete design
  target: clair must live in that quadrant.
- **Gutwin & Greenberg workspace awareness** (2002): the *Who / What / Where* framework maps
  onto clair's spatial ("where / what artifact") vs semantic ("intention / action") axes.  **[T]**
- **Nielsen progressive disclosure** (NN/g): defer secondary options; show the cheap headline
  first. clair's borrowed core.  **[T]**

→ Real theory backs every design choice — credibility, and a sharper target (the IRC
"Ambient Media" quadrant).

## 3. Git-as-transport — the moat is *half* precedented  [E]

Serverless metadata-in-git is **well established**, which *validates* "no server, git is the
pipe":

- **git-bug** — issues / comments / metadata as native git objects under their own ref
  namespace, push/pull to any remote, **no server**, concurrent-edit resolution. The
  strongest precedent.  **[E]**
- **git-appraise** (Google) — code-review metadata as **git-notes**, zero server-side setup,
  any host.  **[E]**
- **Radicle** — collaboration objects as **CRDTs stored in git** ("collaborative objects").  **[E]**

**But** every one stores **durable** data (issues, reviews). **None uses ephemeral / orphan
refs with a TTL as a throwaway message bus.** So clair's moat is not "metadata in git"
(taken) — it is **"ephemeral *awareness* over git, designed to be discarded."** That is the
defensible, un-precedented slice; the IP claim should say so.

## 4. Multi-agent AI coordination — the gap is real and current  [E]

The most important angle, and the finding is strong: **the entire 2025–26 field coordinates
by isolation or orchestration — not awareness.**

- **Claude Code "agent teams"** (experimental, ~v2.1.178): shared task list +
  **mailbox / SendMessage**. The *closest competitor* — but **centrally orchestrated within
  one team**, not ambient awareness across independently-driven agents, and not
  git-transported.  **[E]**
- **Claude Code subagents**: fire-and-forget, **cannot talk to each other**, only report to
  parent.  **[E]**
- **GitHub Agent HQ**: **branch-level isolation** — each agent sandboxed to its own branch,
  **explicitly no cross-agent awareness**.  **[E]**
- **Worktree isolation** (Conductor et al.): each agent its own worktree, "no merge
  conflicts" — isolation *as the whole strategy*.  **[E]**
- **Agent Swarm**: coordinates via **shared-memory files** (SOUL.md / IDENTITY.md), not git
  awareness.  **[E]**

→ **Nobody is building an ambient, peer-to-peer, repo-level awareness layer for solo agents
over git.** The field's answer to "agents colliding" is *wall them off*. clair's bet — *let
them stay isolated but loosely aware* — is genuinely open ground.

**The risk to validate:** if "isolation is enough" becomes consensus, clair must prove
awareness adds value *over* clean worktree isolation. That is the thesis.

## 5. Live collaboration — correctly ruled out, with fresh evidence  [E]

- **VS Code Live Share** (live bytes, follow/focus) and **GitHub RTGH** (branch-as-room
  multiplayer) — what clair is deliberately *not*.
- **JetBrains Code With Me is being sunset** (~March 2026)  **[E]** — concrete evidence that
  even vendor-backed *live pairing* struggles to persist. Validates not competing there.

## 6. Closest commercial analogs — watch these  [E]

- **GitLive** — real-time merge-conflict detection across branches *and teammates' uncommitted
  local changes*. The nearest shipping spatial-proximity tool — but **requires every teammate
  to install the extension** (the "needs both sides" tax) and runs a central backend.  **[E]**
- **GitKraken Team View** — teammates' active branches / changed files to avoid collisions —
  but GUI client + remote polling, not ambient-in-editor.  **[E]**

→ clair's "needs every peer running clair" is the **same adoption tax GitLive pays** — an
honest caveat. Differentiator vs both: ambient **in the statusline**, **serverless over git**,
and **agent-facing**, not just a human GUI.

---

## Bottom line

- **Strongest precedents:** Palantír (concept) · Crystal (progressive-disclosure UX + the
  false-positive lesson) · Social Translucence / Babble (the radar metaphor) · git-bug
  (serverless git store).
- **Strongest current competitor:** Claude Code **agent teams** — but it is orchestration,
  not ambient awareness, and that distinction is clair's wedge.
- **Genuinely novel:** ambient progressive-disclosure awareness · over **ephemeral** git refs
  · for **solo AI agents** · in the statusline. No single tool occupies that intersection.
- **Three lessons to carry into the design:**
  1. **Gate escalation on committed intent**, not keystrokes (Crystal).
  2. **Stay in the "Ambient Media" low-interruption quadrant** (McCrickard) or it gets
     switched off.
  3. **Isolation-vs-awareness is the thesis to prove** — awareness must beat clean worktree
     isolation, and it pays most for the distributed / solo condition that is clair's premise.

---

## Sources

**Academic lineage (vote-verified):**
- Palantír — Sarma, Noroozi, van der Hoek, ICSE 2003 — https://web.engr.oregonstate.edu/~sarmaa/wp-content/uploads/2020/08/01201222.pdf
- Crystal — Brun, Holmes, Notkin, Ernst, FSE 2011 — https://cs.uwaterloo.ca/~rtholmes/papers/fse_2011_brun.pdf
- FASTDash — Biehl et al., Microsoft Research, CHI 2007 — https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/chi2007-fastdash.pdf
- Cassandra — Kasi & Sarma, ICSE 2013 — https://epiclab.github.io/publications/icse13-kasi.pdf
- Syde — Hattori & Lanza, CSMR 2010 — https://www.inf.usi.ch/lanza/Downloads/Lanz2010a.pdf

**Ambient-awareness theory (vote-verified / textbook):**
- Social Translucence — Erickson & Kellogg, TOCHI 2000 — https://tomeri.org/TOCHI2000_SocialTranslucence.pdf
- IRC notification framework — McCrickard et al., TOCHI 2003 — https://interruptions.net/literature/McCrickard-TOCHI03.pdf · https://www.sciencedirect.com/science/article/abs/pii/S1071581903000223
- Workspace awareness — Gutwin & Greenberg, 2002 — https://link.springer.com/article/10.1023/A:1021271517844
- Progressive disclosure — Nielsen Norman Group — https://www.nngroup.com/videos/progressive-disclosure/

**Git-as-transport (extracted):**
- git-bug — https://github.com/git-bug/git-bug
- git-appraise (Google) — https://github.com/google/git-appraise
- Radicle collaborative objects — https://lwn.net/Articles/966869/

**Multi-agent AI coding (extracted):**
- Claude Code Agent Teams — https://code.claude.com/docs/en/agent-teams
- Agent teams / swarms write-up — https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/
- Multi-agent orchestration 2026 — https://scopir.com/posts/multi-agent-orchestration-parallel-coding-2026/
- Code agent orchestra — https://addyosmani.com/blog/code-agent-orchestra/
- Long-running coding agents (2026) — https://o-mega.ai/articles/long-running-coding-agents-the-2026-guide
- Agent Swarm — https://www.agent-swarm.dev/

**Live collaboration & presence (extracted):**
- VS Code Live Share — https://visualstudio.microsoft.com/services/live-share/
- JetBrains Code With Me — https://plugins.jetbrains.com/plugin/14896-code-with-me
- GitHub Next RTGH — https://githubnext.com/projects/rtgh/
- GitLive real-time conflict detection — https://dev.to/gitlive/how-to-enable-real-time-merge-conflict-detection-in-vs-code-l2e
- GitKraken merge/Team View — https://www.gitkraken.com/features/merge-conflict-resolution-tool
- Remote pair-programming IDEs overview — https://www.gethopp.app/blog/ides-for-remote-pair-programming
