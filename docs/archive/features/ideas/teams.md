# Teams — a shared alias as a team (DEFERRED / speculative)

**Status:** idea · speculative · not built. See
[ADR 0005](../../decisions/0005-identity-alias-with-teams-deferred.md).

The alias feature gives each clair user one **alias** as their identity, and lets a
single git account act as several aliases (solo impersonation). "Teams" is the
deferred generalisation: identity as a **composite** `(gh account + alias)`, where a
**shared alias resolving to MULTIPLE accounts** = a team that shares one brain.

## The idea in one picture

```
today (shipped):   identity := alias                 (one alias = one identity)
deferred (teams):  identity := (account, alias)       (alias may span many accounts)
                   shared alias "backend"  ──┬── alice@acme   ┐
                                             ├── bob@acme     ├─ one team, one brain
                                             └── carol@acme   ┘
```

A team would share a single pair-brain keyed by the team alias: any member's
prompts/conclusions flow into the shared context, and the team appears as one
pairable handle in the registry.

## Why deferred

The single-alias model is enough for the felt slice-1 moment (and for solo review).
Teams add a real dimension — the account/composite — that we deliberately keep OUT
of the code for now to avoid premature structure. The alias-only path is forward
compatible: an alias is already the provenance key, so layering an account dimension
later is additive.

## Open questions (resolve before building)

- **Multi-writer provenance.** When three accounts share alias `backend`, what does
  "✓ backend's AI concluded …" mean? Do we keep the underlying account for
  attribution (`backend (alice)`), or is the team genuinely anonymous-internally?
- **"Do I see my own teammates?"** Today provenance hides *your own* entries. On a
  team, are a teammate's entries "yours" (hidden) or "theirs" (shown)? Both are
  defensible; they imply different filters.
- **Brain keying.** Is the shared brain keyed by **alias**, by **session**, or by
  **branch**? Slice-1 keys context by branch. A team alias might want an
  alias-scoped brain that spans branches — a different store shape.
- **Registry semantics.** Latest-per-*user* fold assumes one row per identity. A
  team alias with N accounts needs a fold that does not collapse the members, or a
  separate team registry.
- **Membership + trust.** How does an account join/leave a team alias, and who may?
  (Out of scope for a first cut, but it gates anything real.)

Keep this short and speculative until a concrete team scenario forces the design.
