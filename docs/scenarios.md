# Identity scenarios (resolved → see data-model.md)

- Two humans in the repo
- One human with multiple context / agent sessions (claudes etc..): Is this just two agents?

SO it feels like every active human/agent should get an alias, so I could have 3 claude sessions running and it should be registered as 3 distinct identities active.

- what if they are using worktrees?

---

## Resolved

Two-level identity — **principal** (the human) + **instance** (one running session) —
settled in [architecture/data-model.md, *Identity*](architecture/data-model.md#identity--principal-and-instance):

- **Two humans** → two principals. Clear.
- **One human, 3 sessions** → 3 **instances** (`jb.a3f`, `jb.7c1`, `jb.e90`), keyed by
  harness session id. Counted as **3 sessions** / **1 person** — the statusline leads with
  *people*; sessions show on `/clair:status` and drill-downs ("jb: 3 agents"). They can even
  collide with each other (self-collision is first-class).
- **Worktrees** → the common case of a distinct instance. Shared `refs/clair/*` in the common
  git dir means your own worktrees see each other with **no fetch**; per-worktree `cursor` /
  `work.json` keep "what I've seen / what I'm editing" separate.

**Open seam (not solved):** two sessions sharing *one* worktree/HEAD make per-session
`cursor`/`work.json` attribution non-trivial. v1 keys instance per session; splitting that
view state is an implementation question for the transport spec.