# clair — Docs & Structure Design

**Date:** 2026-06-25
**Status:** Approved (design)
**Scope:** Documentation and repository structure only. Deep technical/architecture
decisions are explicitly *deferred* and captured as open ADRs, not resolved here.

---

## 1. Context

`clair` is an early, greenfield, open-source tool for a **collaborative AI harness
experience**: two (or more) developers pair through their local AI harness (Claude
first, harness-agnostic as a goal), with Git used behind the scenes to share a single
synchronized AI context and a direct developer-to-developer chat, scoped to the branch/PR
being worked on.

The headline experience is a single command:

```
clair with @rajiv
```

After which it looks like both developers are typing into — and sharing — the same
conversation with one Claude.

### Current repo state (before this work)

- `AGENTS.md` — the operating model (kanban lifecycle, strict Red-Green-Refactor TDD with
  a BDD/Cucumber lean, "no implementation without a failing test", "offload smarts to git
  + local Claude", instant-wow UX). Mixed audience: reads as both process doc and agent
  instructions.
- `docs/initial-brief-dump.md` — detailed architecture brief: fat-client/dumb-pipe, Git as
  transport, no central servers, dual shadow branches (`.ai-sync/*`, `.ai-pair-chat/*`),
  `/pair` chat, pre-flight-pull/post-flight-push hook pipeline, conversation DAG with custom
  merge driver, auto-compaction, idle file-watcher updates.
- `docs/features/ideas/context-sync.md` — the `clair with @rajiv` headline (written `clare`).
- `docs/features/ideas/scratch.md` — newer thinking: `clair init` registers you as an open
  pair via a contributor registry in a `.clair`/shadow branch; another user runs `clair init`
  (discovers available pairs) or `clair with @name` (fuzzy match to real username via the
  contributor list); **sessions are ephemeral — "we are not an audit log"**.
- `docs/current-architecture.md`, `docs/target-architecture.md`, `docs/features/ideas/chat.md`
  — empty stubs.
- `docs/features/{doing,done}/` — empty.
- **The repo is not a git repository yet** (notable, given the project's premise).

### Problems this design solves

1. No outward-facing front door (no README/CONTRIBUTING/LICENSE) for an open-source project.
2. Naming inconsistency: `clare` vs `clair`.
3. Empty architecture stubs; vision/principles not separated from settled vs. open decisions.
4. Operating model and agent-instructions tangled in one file.
5. No mechanism to record *why* decisions were (or weren't yet) made.
6. Not yet under version control.

---

## 2. Decisions driving this design

| # | Decision | Choice |
|---|----------|--------|
| 1 | Session scope | **Docs + structure only.** Deep technical design deferred to open ADRs. |
| 2 | Project name / command | **`clair`**, command `clair with @rajiv`. `clare` was a typo; fix everywhere. |
| 3 | Capturing deferred decisions | **ADR log** in `docs/decisions/` (status: accepted / proposed-open / superseded). |
| 4 | Public face | **Full contributor experience**: README + CONTRIBUTING + operating model + ADRs + issue/PR templates. |
| 5 | Repo layout | **Standard OSS layout** (human essentials at root, everything else under `docs/`). Harness-neutral. |
| 6 | License | **MIT.** |
| 7 | Original brief dump | **Preserve as historical** in `docs/archive/`; `architecture/target.md` becomes the living version. |

---

## 3. Target repository structure

```
clair/
├── README.md                 # Pitch, wow-moment, how-it-works-at-a-glance, status: early/WIP
├── CONTRIBUTING.md           # How to contribute + operating model in brief; links into docs/
├── LICENSE                   # MIT
├── AGENTS.md                 # Slim agent entry-point; links into docs (no duplicated process text)
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug.md
│   │   └── feature.md        # Feature requests map to the docs/features/ideas lifecycle
│   └── pull_request_template.md
└── docs/
    ├── vision.md             # North-star principles (see §4)
    ├── operating-model.md    # Canonical process (lifted/expanded from AGENTS.md) (see §5)
    ├── architecture/
    │   ├── current.md        # Honest "nothing built yet" baseline
    │   └── target.md         # Narrative target architecture; links to open ADRs for unsettled parts
    ├── decisions/
    │   ├── README.md         # What an ADR is + index of all ADRs
    │   ├── 0001-git-as-dumb-pipe.md            # accepted
    │   ├── 0002-harness-agnostic-design.md     # accepted
    │   ├── 0003-ephemeral-sessions.md          # accepted (from scratch.md)
    │   ├── 0004-conversation-model-dag-vs-linear.md   # proposed (open)
    │   ├── 0005-integration-mechanism-mcp-vs-hooks.md # proposed (open)
    │   └── 0006-merge-strategy-for-shadow-branches.md # proposed (open)
    ├── archive/
    │   └── initial-brief-dump.md  # Original raw vision dump, preserved untouched
    └── features/
        ├── README.md         # Explains the ideas → doing → done lifecycle
        ├── ideas/
        │   ├── context-sync.md   # cleaned (clare→clair)
        │   ├── chat.md           # written up from the brief's /pair section
        │   └── scratch.md        # cleaned; the clair init / registry / ephemeral idea
        ├── doing/
        │   └── .gitkeep
        └── done/
            └── .gitkeep
```

---

## 4. `docs/vision.md` — principles to elevate

A short, punchy north-star doc. The principles, each one line of "what" + "why":

- **Fat client, dumb pipe** — all logic runs in the user's local AI harness; no central servers.
- **Git as the transport** — Git is the robust, conflict-resolving storage/sync layer, nothing more.
- **Harness-agnostic** — Claude first, but the design must not depend on Claude-specific internals.
- **Ephemeral sessions** — live collaboration, not an audit log; archiving summaries is a *future* feature.
- **Instant wow** — the first run should feel like magic: "it works, and it's amazing."
- **Branch/PR-scoped context** — AI context is always relevant to the code being worked on.

These are stated as *principles*; their concrete mechanisms live in `architecture/target.md`
and the ADRs.

---

## 5. `docs/operating-model.md` — the process, made canonical

Lifts and clarifies what's currently terse in `AGENTS.md`:

- **Feature lifecycle (git-kanban):** ideas → doing → done. Anything landing in `done/`
  triggers a review + simplify + architecture-doc update.
- **Strict TDD:** Red → Green → Refactor. **No implementation without a failing test first**,
  including a test that proves the feature doesn't already exist.
- **BDD lean:** feature-level behavior expressed in natural language (Cucumber-style) where it
  adds clarity.
- **Simplicity bias:** offload "smarts" to Git and the user's local harness; resist building
  servers/daemons.

`AGENTS.md` is then slimmed to a brief entry point for AI agents that links here, rather than
duplicating the process.

---

## 6. ADR conventions

- Filename: `NNNN-kebab-title.md` (zero-padded sequence).
- Each ADR has: **Status** (proposed / accepted / superseded), **Context**, **Decision**
  (or "Open — options under consideration"), **Consequences**.
- Accepted ADRs (0001–0003) ratify principles already committed to in the docs.
- Open ADRs (0004–0006) record the deferred deep-design questions with their options laid out
  but **no decision made** — keeping this session honest about scope. Examples:
  - **0004** Conversation model: DAG (per brief) vs. simpler linear/append log. Tension with
    "ephemeral, not an audit log" (ADR 0003).
  - **0005** Integration mechanism: MCP server vs. harness hooks vs. plugin — and how that
    stays harness-agnostic (ADR 0002).
  - **0006** Merge strategy for shadow branches: custom Git merge driver vs. structured
    append-only files that avoid conflicts by construction.

---

## 7. Non-goals (explicitly out of scope for this session)

- Writing any application/tool code.
- Resolving ADRs 0004–0006.
- Defining the first implementation slice (a likely *next* session).
- Choosing exact data formats, branch-naming finalization, or compaction algorithms.

---

## 8. Acceptance criteria

- Repo is a git repository with an initial commit.
- All files in §3 exist and are non-empty (except intentional `.gitkeep`s).
- No remaining occurrence of `clare` as the project/command name.
- Empty stubs (`current-architecture.md`, `target-architecture.md`, `chat.md`) are removed or
  replaced by their new homes; no dangling empty docs.
- README communicates the pitch and the `clair with @rajiv` wow-moment, and honestly marks
  status as early/WIP.
- `docs/decisions/` clearly separates accepted principles from open questions.
- Original brief dump is preserved verbatim under `docs/archive/`.
