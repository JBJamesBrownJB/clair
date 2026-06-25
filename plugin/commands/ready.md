---
description: Register yourself as available to pair in this repo, on your current branch.
---

# /clair:ready

Announce that the user is available to pair. Writes their entry (including the
current branch) to the `clair/ready` registry and pushes.

Run the bundled binary via the plugin launcher:

```
bash "${CLAUDE_PLUGIN_ROOT}/bin/clair-launch.sh" ready
```

Then report the confirmation line back to the user, e.g.:

```
✓ You're available to pair  ·  repo: <repo>  ·  branch: <branch>
```

Notes:
- This is repo-wide and branch-aware: peers see the user with whatever branch they
  are currently on.
- It is safe to re-run; the registry keeps the latest entry per user.
