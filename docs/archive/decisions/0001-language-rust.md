# 0001 — Build clair in Rust

**Status:** accepted · 2026-06-25

## Context
clair must be trivially installable by any collaborator (instant-wow) and run identically
everywhere. The workload is I/O-bound git orchestration, not heavy compute.

## Decision
Write the core and binary in **Rust**.

## Consequences
- **+** Single static binary, zero runtime deps — `curl|sh` and go; no Node/toolchain on the user's machine.
- **+** Official MCP SDK (`rmcp`); strong testing story incl. cucumber-rs for BDD.
- **+** Fast and pleasant to maintain.
- **−** Cross-compilation + prebuilt-binary distribution is more work than `npm publish`.
- **−** npm reach needs a wrapper package that downloads the prebuilt binary.
- Raw speed was *not* the deciding factor — git is the bottleneck regardless.
