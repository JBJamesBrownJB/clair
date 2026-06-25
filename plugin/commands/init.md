---
description: Choose and persist this repo's clair alias (your identity for pairing).
---

# /clair:init <alias>

Set the user's clair **alias** — their identity for pairing. The alias is persisted
to the LOCAL git config key `clair.alias` for this repo, so it sticks across later
clair calls. It is what peers see as the author of shared prompts/conclusions.

The user typed: `/clair:init $ARGUMENTS`

Run the bundled binary (via the plugin launcher) with the supplied alias:

```
bash "${CLAUDE_PLUGIN_ROOT}/bin/clair-launch.sh" init $ARGUMENTS
```

Then report the confirmation back, e.g. `You are now 'JB' in this repo.`

Notes:
- "/clair:init JB" → launcher `init JB`.
- If `$ARGUMENTS` is empty, ASK the user which alias they want, then run the
  launcher with `init <their answer>`.
- The same git account can hold a different alias in another clone/session (e.g.
  `JB` here, `Rajiv` there) — that is how a solo developer reviews the pair-brain.
  Provenance keys on the alias, so the two are distinct identities that see each
  other.
