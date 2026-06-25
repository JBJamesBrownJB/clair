---
description: Choose and persist this repo's clair alias (your identity for pairing).
---

# /clair:init <alias>

Set the user's clair **alias** — their identity for pairing. The alias is persisted
to this repo's LOCAL git config (`clair.alias`), so it sticks across later clair
calls. It is what peers see as the author of shared prompts/conclusions.

The user typed: `/clair:init $ARGUMENTS`

Call the clair **`init`** MCP tool with the supplied alias:

- `alias`: the value in `$ARGUMENTS`.

Then report the confirmation back, e.g. `You are now 'JB' in this repo.`

Notes:
- `/clair:init JB` → call `init` with `alias="JB"`.
- If `$ARGUMENTS` is empty, ASK the user which alias they want, then call `init`
  with their answer.
- The same git account can hold a different alias in another clone/session (e.g.
  `JB` here, `Rajiv` there) — that is how a solo developer reviews the pair-brain.
  Provenance keys on the alias, so the two are distinct identities that see each
  other.
