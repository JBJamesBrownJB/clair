# Live pair branch / live code sync — RULED OUT

**Status:** ruled out · 2026-06-25. Kept as a record so it isn't re-proposed from
scratch. Sibling in theme to [push-updates.md](push-updates.md) (which is *not* ruled
out — sharing AI context is clair's actual job).

## The seed
When pairing, branch off the branch they are on to a dedicated **ephemeral pair
branch** that pulls aggressively, so both developers' codebases stay up to date with
each other — leaving the pair in control of what and when things make it to the
branch they actually started on.

## Why it's ruled out
1. **Git is a poor medium for live co-editing.** Two people auto-committing WIP to one
   branch means constant conflicts and half-finished code stepping on each other. Git
   is snapshot+merge, not real-time — which is exactly why Live Share and CRDT tools
   exist. The best this gets you is "fetch your pair's current snapshot," not smooth
   shared editing.
2. **It is not clair's differentiator, and the space is crowded and hard.** VS Code
   Live Share, JetBrains Code With Me, and Tuple already do live code well. clair's
   novel value is the **shared AI brain** — nobody else does that. Live code sync
   would pour effort into a commoditized problem and dilute the unique part.
3. **It fights clair's own safety rule.** clair deliberately never touches uncommitted
   work (the `with` dirty-tree guard). Aggressively *pulling* a pair branch into
   someone's working tree is that same violation, made continuous. So it could only
   ever be "show me their diff," never "shared working tree."
4. **The AI-context layer already delivers the awareness that matters.** When a peer
   reads *"JB's AI concluded: moved the guard into AuthMiddleware,"* they usually need
   to *know* what changed, not to receive JB's exact bytes live. The shared brain
   gives that without moving code.

## The one instinct that was right (keep it)
Doing sync on a **throwaway, never-auto-merged branch** so the real branch stays clean
and the pair controls what graduates — that philosophy is correct, and clair already
applies it to its shadow refs. The principle survives; the live-codebase feature does
not.

## If ever revisited, the only defensible shape
Not a live shared editor, but **read-only WIP awareness**: a peer pushes WIP to an
ephemeral branch and you (or your AI) can see their **diff on demand**, never merged
into your tree. The value would be *grounding the shared conclusions in the real code*
(so a pair's AI can see the diff behind "JB concluded X") — composing with the brain,
not competing with Live Share. Even then: weigh it against just running Live Share
alongside clair. Until that bar is cleared, this stays ruled out.
