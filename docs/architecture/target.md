# clair — Target Architecture

> Status: foundational. High-level and intentionally light. Deep mechanics (sync
> algorithm, data formats, branch naming) are still open and will be settled slice by slice.

## Thesis
clair lets developers pair through their AI harness. The **smarts live in one local binary**;
**Git is the only backend**; harnesses plug in through **two portable, standard surfaces**.

## The one diagram
```
   Agent Skill  ─┐                        ┌─  any skills-capable harness
 (clair with @x, │   ┌────────────────┐   │
  /pair, slash)  ├──▶│   clair binary  │  │
                 │   │  CLI + `serve`  │  │
   MCP client   ─┘   └───────┬────────┘   ┘  any MCP-capable harness
                             │
                     ┌───────▼────────┐
                     │  clair-core     │  git (shell-out) + local logic
                     │  = the smarts   │  = the one place with brains
                     └────────────────┘
```

## Components
- **`clair-core`** (Rust lib) — all git + local logic. The only place with brains. Unit + BDD tested with no harness involved.
- **`clair` binary** — the CLI; `clair serve` additionally runs an MCP server (`rmcp`). One artifact, two faces.
- **Agent Skill** — portable `SKILL.md` + slash commands driving the binary; the human-facing UX (`clair with @rajiv`, `/pair`). A standard, not Claude-specific.
- **MCP server** — typed-tool surface for agents that integrate programmatically.

## Decisions
- Language: **Rust** — [ADR 0001](../decisions/0001-language-rust.md)
- Git access: **shell out to `git`** — [ADR 0002](../decisions/0002-git-via-shell-out.md)
- Integration: **MCP + Agent Skill, both standard, both thin** — [ADR 0003](../decisions/0003-dual-integration-mcp-and-skill.md)

## Locked principles (see [vision](../seed-ideas.md))
Fat client / dumb pipe · Git is the pipe · branch/PR-scoped · **ephemeral, not an audit log** · instant-wow.

## Tooling
BDD via **cucumber-rs** (`.feature` files) + unit tests. Distribution: GitHub Releases +
`curl|sh`, `cargo install`, and an npm wrapper that fetches the prebuilt binary.

## Still open
Conversation/data model · sync algorithm · shadow-branch naming · how shared *AI context*
(vs. human chat) is assembled. These get resolved feature-by-feature, ephemeral-first.
