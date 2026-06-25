# Live pair branch — keep each other's CODE in sync (IDEA / speculative)

**Status:** idea · speculative · not built. Sibling to
[push-updates.md](push-updates.md): that keeps the *AI context* live; this keeps the
*code* live.

## The seed
When pairing, branch off the branch they are on to a dedicated **pair branch** that
pulls more aggressively, to keep each other's view of the **code** live.

So beyond seeing your teammate's prompts and conclusions (push-updates), you'd also
see their actual file changes land in your working copy as they make them.

## Open questions (resolve before building — the code layer is the hard one)
- **Aggressive auto-pull vs the dirty-tree guard.** `with` deliberately refuses to
  move a dirty tree (clair never touches the user's uncommitted work). Live-pulling
  into a working copy that has local edits is the same hazard, but continuous and
  larger. Is this *fetch-and-show only*, or does it mutate the working tree?
- **Conflicts.** Two people editing live on one branch will collide. Is this a
  read-only live view of the peer's diff, or genuine shared working state (much
  harder)?
- **Shared machinery.** The same poll / Channels delivery as push-updates could drive
  this — the "what changed" signal is just a git ref moving — so the two ideas likely
  share a transport even though the payloads differ (messages vs code).

Keep speculative until the AI-context live feed (push-updates) is settled — the code
layer is strictly harder (working-tree mutations and merge conflicts, not just
display).
