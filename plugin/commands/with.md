---
description: Check out a ready peer's branch and start a paired session.
---

# /clair:with <handle>  (also: /clair:with <handle> as <alias>)

Pair with a teammate: resolve them in the registry, `git fetch` + check out their
branch (creating a tracking branch if needed), and start the pairing session. The
capture+inject hooks are already wired by the clair plugin — they auto-fire — so
`with` only switches your branch and signals the join.

The user typed: `/clair:with $ARGUMENTS`

Call the clair **`with`** MCP tool.

## Parse $ARGUMENTS into tool arguments

- `<handle>` alone  → `name=<handle>`
- `<handle> as <alias>`  → `name=<handle>`, `as_alias=<alias>`. (`as_alias` sets MY
  identity for this session AND persists it.)

Examples:
- `/clair:with JB`            → call `with` with `name="JB"`
- `/clair:with JB as Rajiv`   → call `with` with `name="JB"`, `as_alias="Rajiv"`

## If no alias is set yet

`with` needs to know MY alias so my prompts/conclusions are attributed correctly.
If the user did NOT pass `as <alias>` and the tool returns a "no clair alias is set"
error, ASK the user "what alias should I use?", then call `with` again with
`name=<handle>` and `as_alias=<their answer>`.

## Reporting

On success the tool returns, e.g.:

```
🤝 Pairing with <handle> on <branch>. Ephemeral — nothing is logged permanently.
```

Relay that to the user. They are now on the peer's branch and the clair hooks will
share/inject context on the next turns automatically.

## Failure modes (relay verbatim, do not work around)

- **Dirty working tree**: "working tree dirty — commit or stash; clair never moves
  your work". Do NOT stash or force-checkout on the user's behalf.
- **Unknown / ambiguous handle**: tell the user the handle could not be resolved and
  suggest `/clair:pair` to see exact handles.
