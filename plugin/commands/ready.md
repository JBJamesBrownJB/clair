---
description: Register yourself as available to pair in this repo, on your current branch.
---

# /clair:ready

Announce that the user is available to pair. This writes their entry (including the
current branch) to the `clair/ready` registry and pushes.

Call the clair **`ready`** MCP tool — it takes no arguments.

Then report the confirmation line back to the user, e.g.:

```
✓ You're available to pair · repo: <repo> · branch: <branch>
```

Notes:
- This is repo-wide and branch-aware: peers see the user with whatever branch they
  are currently on.
- It is safe to re-run; the registry keeps the latest entry per user.
