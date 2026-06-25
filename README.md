# clair — the shared pair brain

Pair with a teammate through your AI harness, over git, ephemeral, no server. clair
keeps two Claudes quietly aware of each other's prompts and conclusions on the same
branch — *"my Claude already knew what my pair just did."* Git is the only backend;
all state lives on orphan `clair/*` branches and is never merged, never an audit log.

## Install (one step — the plugin)

clair ships as a **self-contained Claude Code plugin**: it bundles the `clair`
binary, the capture/inject hooks, and the `/clair` slash commands. There is **one**
install and **nothing else to set up** — no separate binary, no `--settings` flags,
no per-session config files.

In Claude Code:

```
/plugin marketplace add JBJamesBrownJB/clair
/plugin install clair@clair
```

That's it. The hooks auto-fire while the plugin is enabled and the slash commands
become available immediately.

> **npm / cargo are OPTIONAL.** They are only for people who want a standalone
> `clair` CLI on their PATH. They are **not required** for the Claude Code
> experience — the plugin carries its own binary.

### Slash commands

Plugin commands are namespaced under the plugin, so you type the `clair:` prefix:

| You type | Effect |
|---|---|
| `/clair:init <alias>` | Choose & persist your clair alias (identity) for this repo. |
| `/clair:ready` | Announce you're available to pair, on your current branch. |
| `/clair:pair` | List everyone ready to pair in this repo, with their branch. |
| `/clair:with <name>` | Fetch + check out the peer's branch and start pairing. |
| `/clair:with <name> as <alias>` | Same, acting as `<alias>` (sets & persists it). |

If you have no alias set yet, `/clair:with <name>` will ask you for one, then pair.

### Local development / testing the plugin

To load the plugin straight from a checkout (commands **and** hooks), no install:

```
claude --plugin-dir /path/to/clair/plugin
```

The bundled binary is selected by platform at `plugin/bin/<platform>-<arch>/clair`
via `plugin/bin/clair-launch.sh`. The host platform (`win32-x64`) ships populated;
other platforms are added by CI/Releases.

## How it works

Two Claude Code hooks (bundled in the plugin, auto-firing):

- **`UserPromptSubmit`** → shares your prompt and injects your pair's *new* prompts
  and conclusions as **passive background context** (your AI does not act on them).
- **`Stop`** → distils your finished reply to one short paragraph and shares it.

The hook subcommands are self-sufficient: they resolve the repo root from
`$CLAUDE_PROJECT_DIR` (set by Claude Code) and the branch from your current git
checkout — so the bundled hooks need no baked paths.

## Building the CLI from source (optional)

```
cargo build --release -p clair    # target/release/clair[.exe]
cargo test --workspace            # the unit + integration + BDD suite
```

See `docs/features/doing/0001-shared-pair-brain.md` for the slice-1 design and
`tests/e2e/RUNBOOK.md` for the headless end-to-end.
