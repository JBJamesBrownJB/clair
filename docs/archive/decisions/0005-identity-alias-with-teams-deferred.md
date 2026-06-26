# 0005 — Identity is a chosen alias (teams deferred)

**Status:** accepted (alias) · teams **deferred** · 2026-06-25

## Context
A clair user needs an identity: the author of shared prompts/conclusions and the
handle peers see in the registry. Slice 1 read identity from `clair.user` / `user.name`
/ OS user — a git account, effectively. But a solo developer wants to *review the
pair-brain alone*: act as two different identities in two sessions on one machine /
one git account, and have them see each other. A git-account-keyed identity can't do
that. We also anticipated "teams" (a shared identity spanning several accounts), but
did not want its structure now.

## Decision (accepted — alias)
A clair user's identity is a chosen **alias** (a string), not their git account.

- `clair init <alias>` persists the alias to the LOCAL git config key `clair.alias`.
- `--as <alias>` (on `ready`/`pair`/`with`) overrides the identity for the
  invocation AND persists it to `clair.alias` (sticky for the session).
- Resolution priority (centralised in `cmd::identity`): `--as` → `clair.alias` →
  `clair.user` (LEGACY fallback, kept for back-compat) → `user.name` → OS username.
- Provenance compares the **resolved alias** (case-folded). Therefore the SAME git
  account under two aliases yields two DISTINCT identities that can see each other —
  the solo-review / "impersonation" case. Verified by a deterministic cucumber
  scenario (two clones sharing one `user.email`, aliases `JB` and `Rajiv`).
- `clair` with no subcommand runs the discovery listing (= `clair pair`) plus a
  hint about `clair with <name>`.

No new crate dependencies; TTY detection uses `std::io::IsTerminal`.

## Decision (deferred — teams)
We deliberately keep the **account / composite** dimension OUT of the code. "Teams"
— identity as `(account, alias)` where a shared alias resolves to MULTIPLE accounts
that share one brain — is documented as a speculative idea only. See
[features/ideas/teams.md](../features/ideas/teams.md). The alias-only path is
forward compatible: an alias is already the provenance key, so an account dimension
can be layered in additively when a concrete team scenario forces it.

## Consequences
- Identity resolution lives in one place (`cmd::identity`), unit-tested per level.
- `with` will not silently pair as the OS login: with no deliberately-chosen alias
  it prompts on a TTY, else exits non-zero with guidance (`clair init <alias>`).
- Open questions for teams (multi-writer provenance, "do I see my own teammates?",
  brain keyed by alias/session vs branch, registry fold) are parked in the idea doc.
