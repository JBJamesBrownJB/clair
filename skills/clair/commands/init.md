---
name: clair init
description: Choose and persist this repo's clair alias (the user's identity).
---

# /clair init <alias>

Set the user's clair **alias** — their identity for pairing. The alias is persisted
to the LOCAL git config key `clair.alias` for this repo, so it sticks across later
clair calls. It is what peers see as the author of shared prompts/conclusions.

Run:

```
clair init <alias>
```

Then report the confirmation back, e.g.:

```
You are now 'JB' in this repo.
```

Notes:
- Phrasing "/clair init JB" → `clair init JB`.
- The same git account can hold a different alias in another clone/session (e.g.
  `JB` here, `Rajiv` there) — that is how a solo developer reviews the pair-brain.
  Provenance keys on the alias, so the two are distinct identities that see each
  other.
- If the user says "init" with no alias, ASK them which alias they want, then run
  `clair init <alias>` with their answer. (The binary will also prompt on a real
  TTY, but in the harness you should supply the alias explicitly.)
