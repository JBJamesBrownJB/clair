---
name: clair with
description: Check out a ready peer's branch and start a paired session with capture+inject hooks.
---

# /clair with <handle>

Pair with `<handle>`: resolve them in the registry, `git fetch` + check out their
branch (creating a tracking branch if needed), and start the pairing session.

Run:

```
clair with <handle> --json
```

## Identity / alias

`with` needs to know MY alias (so my prompts/conclusions are attributed correctly).
It resolves by priority: explicit `--as <alias>` → `clair.alias` → `clair.user`
(legacy) → `user.name`.

Phrasing maps:

- "/clair with JB" → `clair with JB`. **If no alias is set** (the binary exits
  non-zero asking for one), ASK the user "what alias should I use?", then re-run
  `clair with JB --as <answer>` (which also persists the alias for the session).
- "/clair with JB as Rajiv" → `clair with JB --as Rajiv`.
- "/clair pair with JB" → `clair with JB`.

Passing `--as <alias>` overrides MY identity for this invocation AND persists it as
`clair.alias`, so subsequent calls in the session keep it.

On success the JSON contains `{ paired_with, branch, settings }`. Tell the user
they are now on the peer's branch and pairing has started, e.g.:

```
↪ Switching you to <branch> (git fetch + checkout)…
🤝 Pairing with <handle> on <branch>. Ephemeral — nothing is logged permanently.
```

The `settings` path is the `--settings` merge file that wires the clair hooks for
the session. If the user is running their own Claude invocation manually, they can
pass it via `claude --settings "<settings>"`.

Important failure modes:
- **Dirty working tree** (exit 4): the command refuses and prints
  "working tree dirty — commit or stash; clair never moves your work". Relay this
  verbatim; do not attempt to stash or force-checkout on the user's behalf.
- **Unknown / ambiguous handle** (exit 3): tell the user the handle could not be
  resolved and suggest `/clair pair` to see exact handles.
