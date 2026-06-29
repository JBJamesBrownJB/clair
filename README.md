# clair

> **Agent proximity awareness through progressive disclosure of live context.**

clair gives you and your agents repo-level **ambient awareness** of everyone else's
activity, surfaced by **proximity** via **progressive disclosure**: *a clair discloses a
live event the way a skill discloses pre-defined context.* The full vision and its single
source of truth live in [docs/product.md](docs/product.md).

## Status: reset to a clean skeleton

This repo has been reset to a clean "hello world" skeleton. The previous
same-branch-pairing implementation (init/ready/pair/with commands, an MCP server, and
capture/inject hooks over `clair/<branch>` refs) has been archived. **Nothing is wired
up yet** — the plugin and skills are minimal stubs and none of the awareness features
described in the vision are implemented.

## Build

```
cargo build --workspace
```

This produces a hello-world `clair` binary.
