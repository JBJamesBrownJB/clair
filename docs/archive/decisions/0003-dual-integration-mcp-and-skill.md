# 0003 — Integrate via both MCP and Agent Skill

**Status:** accepted · 2026-06-25

## Context
clair must hook into AI harnesses without becoming Claude-specific. Two portable standards
exist: **MCP** (typed tool calls) and **Agent Skills** (`SKILL.md` instructions + slash
commands), both supported across major harnesses.

## Decision
Ship **both**, as thin layers over the same `clair` binary:
- **Agent Skill** — the human-facing UX (`clair with @rajiv`, `/pair`, slash commands).
- **MCP server** (`clair serve`) — the programmatic typed-tool surface for agents.

## Consequences
- **+** Harness-agnostic by construction; neither surface is Claude-only.
- **+** The brains stay in `clair-core`; both surfaces are thin and replaceable.
- **+** Humans get native-feeling invocation; agents get clean tool calls.
- **−** Two surfaces to keep in sync — kept cheap by routing both through one binary.
