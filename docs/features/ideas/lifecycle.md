# Session lifecycle & shadow-ref cleanup (IDEA / speculative)

**Status:** idea · speculative · not built. Applies to all of clair, not just
push-updates. Cross-references [push-updates.md](push-updates.md) (which lists
Lifecycle as an open question).

## The gap

Shadow refs (`clair/<branch>`, `clair/ready`) currently accumulate forever — there
is no cleanup on session end, no stale detection, and no space recovery. This needs
to be built before clair is used on long-lived repos.

## Proposal: split cleanup responsibility

### Clean exit (stop hook fires)
1. Remove self from `clair/ready`.
2. Scan `clair/<branch>` — if no other alias has an entry newer than N minutes,
   delete the ref (`git push origin --delete clair/<branch>`).

### Crash recovery (stop hook never fires)
Entries already carry a `ts` timestamp — staleness is detectable without a separate
heartbeat. On every `clair init`, `clair ready`, or `clair pair` call, run a **lazy
prune pass**:
- `clair/ready` entries older than 30 min → remove from registry.
- `clair/<branch>` refs where **all** entries are older than 4 h → delete the ref.

This means cleanup is lazy but guaranteed: the *next* person to touch clair on the
repo inherits the cleanup duty. No orphaned refs survive past one fresh session.
The existing prompt/summary entries *are* the heartbeat — no separate ping needed.

## The "last person" problem

Knowing you are the last active session at stop time requires a round-trip check
(read `clair/ready`, compare timestamps). That check adds latency to every session
end and can race. The lazy-prune approach sidesteps this entirely: the stop hook
always cleans up *self*, and the 4 h TTL handles the rest.

## Does deleting the ref erase it from history on the remote?

**No — not immediately.** Deleting a ref (`git push origin --delete clair/main`)
removes the *pointer* instantly: the ref disappears from `git ls-remote` and is
unreachable via normal git operations. But the underlying commit objects remain in
the remote's object store until the remote runs garbage collection (`git gc`).

On GitHub that GC schedule is opaque — hours to days; you cannot trigger it. So:

| What you get immediately | What requires GC |
|---|---|
| Ref gone from `git ls-remote` | Actual bytes freed |
| Data unreachable via normal git | True erasure of content |
| Space not recovered yet | Space recovered |

**Privacy implication:** if pair context contains sensitive prompts/conclusions,
ref deletion makes them unreachable in practice but not cryptographically gone.
If sensitivity is a concern, the right fix is to **never push shadow refs to the
remote at all** — keep them local-only. This would change the push-updates
transport design (the shared medium would need to be local too), so it is a
meaningful architectural choice, not a small tweak.

## Open questions

- **TTL values:** 30 min for `clair/ready` and 4 h for context refs are guesses.
  Tune empirically once clair is used on real sessions.
- **Local-only mode:** if privacy concerns drive keeping shadow refs off the remote,
  how does push-updates work without a shared git remote? (Likely: the Channels
  watcher polls a local ref instead, limiting to same-machine pairing only.)
- **Pruning coordination:** two sessions running the prune pass simultaneously
  on the same ref is safe (deleting an already-deleted ref is a no-op), but worth
  testing.
- **`clair unpair` command:** should there be an explicit teardown command, or is
  lazy prune enough? An explicit command would give users a clear "I'm done pairing"
  gesture and could run the prune pass eagerly.
