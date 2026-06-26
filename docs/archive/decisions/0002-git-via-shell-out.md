# 0002 — Talk to Git by shelling out to `git`

**Status:** accepted · 2026-06-25

## Context
clair-core needs to fetch/merge/commit/push against shadow branches. Options: shell out to
the system `git`, the pure-Rust `gix`, or `git2` (libgit2 bindings).

## Decision
**Shell out to the user's `git` binary** via subprocess.

## Consequences
- **+** Inherits the user's auth, credentials, SSH, remotes and config exactly — truest "git as dumb pipe."
- **+** Trivial to implement and debug (the commands are visible/loggable).
- **+** Keeps the static-binary story clean (no C build dep like git2).
- **−** Requires `git` installed (always true for this audience).
- **−** We parse text output; mitigate with `--porcelain`/plumbing commands.
- Revisit only if a concrete operation can't be done well via the CLI.
