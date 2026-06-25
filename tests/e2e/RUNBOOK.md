# clair Tier-3 e2e — runbook

This is the real, headless end-to-end for slice 1: two actual `claude -p` sessions
paired through the clair Claude Code hooks, observed from outside, asserting that
**JB's prompt/conclusion reaches Rajiv's session as passive background context** and
**Rajiv's AI does not act on it**.

Everything below the hook shim is the production path — `clair hook prompt` /
`clair hook stop` call the same `clair-core::hooks::*` the Tier-2 harness drives, so
this proves the wire format and the real Claude Code integration, not a mock.

---

## 0. Prerequisites

- `git` on PATH.
- `claude` (Claude Code 2.1.x) on PATH and authenticated. Hooks fire in `-p` mode
  (only `--bare` skips them — verified).
- The `clair` binary built and reachable:
  ```
  cargo build --release -p clair
  export CLAIR_BIN="$PWD/target/release/clair"     # or put `clair` on PATH
  ```
- `bash` (Git Bash on Windows). Hook commands are invoked as `bash "<abs path>"`.
- `jq` is **not** required and must not be used — all stream parsing goes through
  `clair test-observe` (serde_json).

---

## 1. Automated run (the gated script)

The script is gated so it never runs in fast CI:

```bash
CLAIR_E2E=1 CLAIR_BIN="$PWD/target/release/clair" bash tests/e2e/run.sh
```

Without `CLAIR_E2E=1`, or without `claude` on PATH, it prints a SKIP notice and
exits 0.

Useful knobs:

| Env var               | Default                                  | Meaning                                    |
|-----------------------|------------------------------------------|--------------------------------------------|
| `CLAIR_E2E`           | `0`                                      | Must be `1` to run.                        |
| `CLAIR_BIN`           | `clair`                                  | Path to the clair binary.                  |
| `CLAIR_E2E_TIMEOUT`   | `180`                                    | Per-`claude` wall-clock timeout (seconds). |
| `CLAIR_E2E_SESSION`   | a fixed UUID                             | The PINNED first-session id (`--session-id`). |

What the script does:

1. `setup_remote` — builds a bare remote with `main` + `feature/login`.
2. Clones it twice (`jb`, `rajiv`), both on `feature/login`, each with its own
   `clair.user` identity.
3. `make_settings` — writes per-clone hook shims + a `--settings` merge file under
   `<clone>/.git/clair/`, with `--repo-root` and `--branch` baked in (the single
   branch source).
4. Runs JB's `claude -p "<prompt>"` with `--session-id <pinned uuid>`,
   `--settings <jb settings>`, and
   `--output-format stream-json --include-hook-events --verbose`. JB's
   UserPromptSubmit hook shares the prompt; the Stop hook shares the conclusion.
5. Runs Rajiv's `claude -p` turn with his own `--settings`. Rajiv's
   UserPromptSubmit hook fetches and injects JB's entries as `additionalContext`.
6. Asserts against Rajiv's stream, all via `clair test-observe`:
   - `assert-additional-context "<prompt>"` — JB's prompt arrived as framed
     background context.
   - `assert-no-tool Edit` — Rajiv's AI did **not** edit `auth.rs` (passivity:
     background, not a directive).

Every `claude` call is wrapped in `timeout` and uses
`--dangerously-skip-permissions` so hooks/tools run without prompts.

### Inspecting a failing run by hand

`clair test-observe` is also a diagnostic. Capture a stream and probe it:

```bash
claude -p "hello" --settings "$SETTINGS" \
  --output-format stream-json --include-hook-events --verbose \
  --dangerously-skip-permissions > stream.ndjson

clair test-observe hook-events    < stream.ndjson   # dump every injected additionalContext
clair test-observe session-id     < stream.ndjson   # print the first session_id
clair test-observe assert-no-tool Edit              < stream.ndjson
clair test-observe assert-additional-context "..."  < stream.ndjson
```

---

## 2. Manual two-terminal walkthrough (the PLUGIN flow)

Use this to *feel* the slice-1 moment live, with two real Claude sessions on two
clones of one remote. The hooks come from the clair **plugin** — there is no
`--settings` file and no generated shims. Below uses a local bare repo so it works
fully offline.

The clair binary used by the walkthrough's `clair init`/`ready`/`pair` calls is the
same one the plugin bundles; either put `target/release/clair` on PATH for these
shell calls, or run the bundled launcher
(`plugin/bin/clair-launch.sh`). Inside Claude, all clair calls go through the plugin
launcher automatically.

### One-time setup

```bash
# A throwaway shared remote + two clones.
WORK=$(mktemp -d)
git init --bare -b main "$WORK/remote"

git clone "$WORK/remote" "$WORK/jb"
clair init JB --repo-root "$WORK/jb"      # persists clair.alias=JB (your identity)
git -C "$WORK/jb" commit --allow-empty -m init
git -C "$WORK/jb" push -u origin main
git -C "$WORK/jb" checkout -b feature/login
git -C "$WORK/jb" push -u origin feature/login

git clone "$WORK/remote" "$WORK/rajiv"
clair init Rajiv --repo-root "$WORK/rajiv"  # persists clair.alias=Rajiv

# Solo review: the SAME machine / git account can act as two aliases. Both clones
# may even share one git account (same user.email) — provenance keys on the alias,
# so JB and Rajiv are two distinct identities that see each other. To make the two
# clones one account, give them the same email:
#   git -C "$WORK/jb"    config user.email solo@dev.local
#   git -C "$WORK/rajiv" config user.email solo@dev.local
```

> `clair init <alias>` writes the LOCAL `clair.alias` git config. You can override
> per-invocation with `--as <alias>` on `ready`/`pair`/`with` (it also persists),
> e.g. `clair with jb --as Rajiv`.

The plugin hooks self-resolve: each hook reads the repo root from
`$CLAUDE_PROJECT_DIR` (which Claude Code sets to the project you launched it in) and
the branch from the current checkout. Launch each `claude` from inside the relevant
clone so the hook scopes to that clone's branch.

### Either: install the plugin once, or point at the checkout

```bash
# Production install (inside any Claude session):
#   /plugin marketplace add JBJamesBrownJB/clair
#   /plugin install clair@clair
#
# Local dev — load the plugin straight from the checkout (commands AND hooks):
PLUGIN=/path/to/clair/plugin     # the repo's plugin/ dir
```

### Terminal A — JB (on `feature/login`)

```bash
cd "$WORK/jb"
clair ready                     # "✓ You're available to pair · repo: … · branch: feature/login"

claude --plugin-dir "$PLUGIN"   # (or, if installed, just: claude)
> refactor the auth guard to use the new middleware
```

### Terminal B — Rajiv (joins JB)

```bash
cd "$WORK/rajiv"
clair pair                      # lists JB → feature/login
clair with jb                   # fetch + checkout feature/login (refuses if dirty),
                                # appends a "Rajiv joined" signal entry
                                # (no settings/shims — the plugin owns the hooks)

claude --plugin-dir "$PLUGIN"   # (or, if installed, just: claude)
> what's the state of the auth work?
```

On Rajiv's **next interaction** his UserPromptSubmit hook injects, as background:

```
── shared pair context (background — your AI won't act on this) ──
↪ JB asked his AI: "refactor the auth guard to use the new middleware"
─────────────────────────────────────────────────────────────────
```

…and once JB's turn finishes (Stop hook distils the key points — the final
paragraph, or the trailing list of conclusions when the turn ends in several):

```
── shared pair context (background — your AI won't act on this) ──
✓ JB's AI concluded: "Moved the guard into AuthMiddleware; 1 test still failing
   on the expired-token case."
─────────────────────────────────────────────────────────────────
```

JB, on **his** next interaction, sees the `── clair ──` framed join signal and any
prompts/conclusions Rajiv shares — the reciprocal direction.

### Invariants you can observe by hand

- **Loop guard:** receiving/injecting a peer entry writes nothing back. Inspect the
  log after Rajiv's inject:
  ```bash
  git -C "$WORK/rajiv" fetch origin 'refs/heads/clair/feature/login:refs/heads/clair/feature/login'
  git -C "$WORK/rajiv" cat-file -p clair/feature/login:log.jsonl
  ```
  Rajiv injecting JB's entry adds zero JB-authored lines; only Rajiv's own prompt
  appears (authored by Rajiv).
- **Branch scope:** a clone on `main` never sees `feature/login` context — the read
  ref, write ref and cursor key all derive from the one baked `--branch`.

### Cleanup

```bash
rm -rf "$WORK"
```

---

## 3. Notes / gotchas

- **Windows:** hooks run via `bash "<abs path>"`; the generated shim paths are
  absolute and forward-slashed. Blob writes go through git plumbing, so stored
  JSONL stays LF (no worktree CRLF filter).
- **Session resume:** for a multi-turn observed run, the automated script pins the
  first session id with `--session-id <uuid>`; chain further turns with
  `claude -p next --resume <that-uuid>` (avoids the undocumented stream-json input
  schema).
- **Fail-open:** the prompt hook never blocks the turn. If the remote is slow or
  offline it degrades to no injection — so a network hiccup shows up as a missing
  `additionalContext`, not a hung session.
