# clair — Docs & Structure (lean spec)

**Date:** 2026-06-25 · **Status:** Approved

## What clair is
An early, open-source tool for **pair-programming through your AI harness**. Two devs run
`clair with @rajiv` and share one synchronized AI conversation + a direct side-chat, scoped
to the branch/PR, with **Git as the only backend**. Claude first; harness-agnostic as a goal.

## Locked principles
- Fat client, dumb pipe — no servers; logic runs in the local harness.
- Git is the pipe — sync/storage via Git only.
- Branch/PR-scoped shared context.
- **Ephemeral** — live collaboration, not an audit log.
- Instant-wow first run.

## This pass = tidy-up only
- Reframe the old brief as **seed ideas** (`docs/seed-ideas.md`), explicitly speculative.
- Drop the brief's persistent-DAG / merge-driver / compaction machinery (contradicts ephemeral).
- Fix `clare` → `clair` everywhere.
- Stand up the open-source front door when we're ready: `README`, `CONTRIBUTING`, MIT `LICENSE`.
- Keep the `features/{ideas,doing,done}` kanban and the RGR/TDD operating model from `AGENTS.md`.

## Out of scope
Writing tool code; finalizing data formats, branch naming, or the sync algorithm.

## Next
Design the **first lean slice** — the smallest thing that delivers the wow and can be proven
with a test.
