---
description: List everyone ready to pair in this repo, with their branch.
---

# /clair:pair  (discovery)

List the people currently ready to pair in this repo — regardless of which branch
the user is on. Each row shows the peer's alias (handle) and their branch.

Call the clair **`pair`** MCP tool — it takes no arguments. Present
the result as a short, human-friendly list, e.g.:

```
People ready to pair on <repo>:
  • JB    →  feature/login
  • Sam   →  fix/cache-bug
Join with:  /clair:with jb
```

If the user passed a name in `$ARGUMENTS` (e.g. they typed `/clair:pair with JB`),
treat it as a request to pair: hand off to the `/clair:with` flow with that name
(call the `with` tool with `name="JB"`).

If no one is ready, say so and suggest the user run `/clair:ready` to make
themselves available.
