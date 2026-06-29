# Hidden acceptance gate (held out)

This directory is the **held-out acceptance gate** for the Larder benchmark arena.
It lives only on `arena/reference` and is **never shown to the slice agents** — they
work from `arena/base` and write their own tests; this suite is the impartial
ground-truth arbiter the harness runs *after* integrating their branches.

Per the value-benchmark guardrail it tests **behaviour, never structure** — "every
mutation requires the right role", "search returns the seeded items", "no seeded
advisory remains", "no pre-upgrade API is left" — so it scores capability, not
conformance to the reference's internal shape.

## What it checks

- **Deterministic floors:** `tsc --noEmit` clean + client build clean (catch a large
  share of version-skew semantics for free).
- **Slice 1 — authz hardening / silent-security-gap instrument:** every mutating
  endpoint rejects unauthenticated (401) and viewer (403) callers; the role matrix
  (member writes but cannot delete or administer; admin can); `passwordHash` never
  leaks.
- **Slice 2 — search/filter:** `q=microscope` → the 3 seeded microscopes (case-
  insensitive, multi-field); `lowStock` → the 6 seeded low-stock items; category
  filter; empty result for a no-match query.
- **Slice 3 — export:** CSV has the canonical header + 40 rows; JSON returns 40
  items; export honours the active filter and requires auth.
- **Slice 4 — Dependabot remediation:** `jsonwebtoken`, `lodash`, `semver`,
  `minimist` are at/after their patched versions and no longer pinned vulnerable.
- **Slice 5 — framework upgrade:** `react-router` ≥ 7 (react-router-dom gone),
  `@tanstack/react-query` ≥ 5, and no source still imports `react-router-dom` or
  uses the v4 array-form `invalidateQueries([...])`.
- **Regression:** the visible suite (`tests/`) still passes.

## Running

```bash
pnpm test:gate        # the held-out behavioural + upgrade assertions
bash gate/run-gate.sh # full gate: floors + regression + acceptance + audit
```
