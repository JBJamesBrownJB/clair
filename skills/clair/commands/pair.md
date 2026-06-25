---
name: clair pair
description: List everyone ready to pair in this repo, with their branch.
---

# /clair pair

List the people currently ready to pair in this repo — regardless of which branch
the user is on. Each row shows the peer's handle and their branch.

Run:

```
clair pair --json
```

The JSON is an array of `{ user, repo, branch, ts, ago_secs }`. Present it as a
short, human-friendly list, e.g.:

```
People ready to pair on <repo>:
  • JB    →  feature/login     (ready 30s ago)
  • Sam   →  fix/cache-bug     (ready 2m ago)
Join with:  /clair with jb
```

If the list is empty, say no one is ready to pair right now and suggest the user
run `/clair ready` to make themselves available.
