---
description: Check out a ready peer's branch and start a paired session.
---

# /clair:with <handle>  (also: /clair:with <handle> as <alias>)

Pair with a teammate: resolve them in the registry, `git fetch` + check out their
branch (creating a tracking branch if needed), and start the pairing session. The
capture+inject hooks are already wired by the clair plugin — they auto-fire — so
`with` only switches your branch and signals the join.

The user typed: `/clair:with $ARGUMENTS`

All clair calls go through the bundled binary via the plugin launcher:
`bash "${CLAUDE_PLUGIN_ROOT}/bin/clair-launch.sh" <args>`.

## Parse $ARGUMENTS

- `<handle>` alone  → launcher `with <handle>`
- `<handle> as <alias>`  → translate the trailing `as <alias>` into `--as <alias>`:
  launcher `with <handle> --as <alias>`. (`--as` sets MY identity for this
  invocation AND persists it as `clair.alias`.)

Examples:
- `/clair:with JB`            → `bash "${CLAUDE_PLUGIN_ROOT}/bin/clair-launch.sh" with JB`
- `/clair:with JB as Rajiv`   → `bash "${CLAUDE_PLUGIN_ROOT}/bin/clair-launch.sh" with JB --as Rajiv`

## If no alias is set yet

`with` needs to know MY alias so my prompts/conclusions are attributed correctly.
If the user did NOT pass `as <alias>` and the command exits non-zero asking for an
alias (exit code 5: "no alias set"), ASK the user "what alias should I use?", then
re-run the launcher with `with <handle> --as <their answer>`.

## Reporting

On success the human output is:

```
↪ Switching you to <branch> (git fetch + checkout)…
🤝 Pairing with <handle> on <branch>. Ephemeral — nothing is logged permanently.
```

Relay that to the user. They are now on the peer's branch and the clair hooks will
share/inject context on the next turns automatically.

## Failure modes (relay verbatim, do not work around)

- **Dirty working tree** (exit 4): "working tree dirty — commit or stash; clair
  never moves your work". Do NOT stash or force-checkout on the user's behalf.
- **Unknown / ambiguous handle** (exit 3): tell the user the handle could not be
  resolved and suggest `/clair:pair` to see exact handles.
