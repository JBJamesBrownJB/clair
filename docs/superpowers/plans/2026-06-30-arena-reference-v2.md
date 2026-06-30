# Arena Reference v2 + Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. **Each slice task below is itself a TDD execution unit** — its failing-test list
> is the backlog item's acceptance criteria (verbatim, behavioral); write those as gate/spec tests
> first, then implement until green. This plan is the *build order and decomposition*, not a
> keystroke script — the real per-slice code is produced at execution, driven by the ACs.

**Goal:** Extend the held-out `arena/reference` from 5 slices to the full L3 slice set (14 slices) and
grow the hidden acceptance gate to match, so L3 ("saturation") benchmark runs become runnable.

**Architecture:** Start from the existing coherent reference (`arena/reference` @ `bfa46b5`, which
already integrates slices S1–S5 on the upgraded Router v7 / Query v5 stack) and add the 9 saturation
slices **coherently, with full knowledge** (the reference is the gold solution, not a blind/parallel
build). Two foundational refactors land first (the `ApiResult` discriminated union and the shared
`ItemForm`) because every later slice builds on them; then the schema-touching features land as one
coherent migration; then read/UI slices; then the gate is extended from the backlog acceptance
criteria + cross-feature semantic assertions, and the branch is re-pinned.

**Tech Stack:** React 18 · TypeScript · Vite · React Router **v7** · TanStack Query **v5** · MUI v5 ·
Fastify · Prisma · SQLite · Zod · Vitest · Playwright · pnpm.

## Global Constraints

- **Orphan-branch isolation:** all work is on `arena/reference` (own root commit/tree). It contains
  **only the Larder app** — never clair source/docs. No `arena/*` ↔ clair merges (the co-location
  guardrail).
- **Held out:** `arena/reference` and `gate/` are never shown to benchmark agents. The gate tests
  **behavior, never structure** ("every new endpoint is authz-gated", not "matches reference's classes").
- **Green by construction:** every task ends green on `tsc --noEmit`, `eslint`, the **visible** Vitest
  suite, the client build, **and** the held-out gate (`pnpm test:gate` + `bash gate/run-gate.sh`).
- **Deterministic seed:** `prisma/seed.ts` stays deterministic (no wall-clock, no RNG). New fields get
  fixed seed values; gate expected-values are updated in lockstep.
- **Scope = the 14 L3 slices only.** Reference v2 implements exactly what the L3 run-config targets
  (S1–S5 already present + S6–S14 here). The other ~45 backlog items stay in the bank and enter the
  reference only when a future level pulls them into a slice.
- **Pinning:** tag pushes are 403 in the managed env → pin by **branch + immutable tip SHA**. After v2
  is green, record the new SHA as `arena-reference-v2` (re-cut the annotated tag where tag pushes work).
- **Backlog is the contract:** each slice's acceptance criteria in
  [`benchmark/backlog/backlog.md`](../../../benchmark/backlog/backlog.md) are the per-slice gate
  assertions. Do not invent new behavior; implement to the ACs.

---

## Starting point & what changes

Reference v1 (`bfa46b5`) already contains: **S1** authz + role-mgmt (`F-08`,`F-10`,`F-09`), **S2**
search/filter (`F-06`,`F-07`,`F-12`,`F-13`,`F-15`), **S3** export (`F-17`), **S4** Dependabot
(`M-02`,`M-03`,`M-04`), **S5** framework upgrade (`M-10`,`M-05`), + a 35-assertion gate. So authz and
the upgraded stack are **already in place** — new endpoints here must respect them, not re-create them.

Reference v2 adds these 9 slices (from [`benchmark/levels.md`](../../../benchmark/levels.md) L3):

| Slice | Backlog | Kind | Lands |
|-------|---------|------|-------|
| S13 | `D-01` | refactor | discriminated-union `ApiResult` (foundational) |
| S12 | `D-02` | refactor | shared `ItemForm` + create/edit parity (foundational) |
| S6  | `M-01` | feature | Category/Location/Unit controlled vocabularies |
| S7  | `F-01` | feature | soft-delete + restore (`deletedAt`) |
| S10 | `F-02` | feature | item authorship (`createdBy`/`updatedBy`) |
| S8  | `F-16` | feature | item change-history / audit log |
| S11 | `F-11` | feature | checkouts enrichment + filtering |
| S9  | `F-05` | feature | pagination + total count |
| S14 | `UX-01`| feature | inline form validation |

## File-structure impact (the contended substrate, by design)

- `src/shared/types.ts` — `ApiResult` union (S13); new fields on `Item`/`User` (S6,S7,S10); audit +
  paginated-list + enriched-checkout types (S8,S9,S11).
- `src/shared/serialize.ts` — the god-file chokepoint: envelope helpers (S13), soft-delete filtering
  (S7), author fields (S10), pagination envelope (S9), checkout enrichment (S11).
- `src/client/api.ts` — typed unwrap against the union (S13); new endpoints (S6,S7,S8,S9,S11).
- `src/client/components/ItemForm.tsx` — **new**, extracted from both pages (S12), then home for
  dropdowns (S6) and inline validation (S14).
- `src/client/containers/ItemsPage.tsx`, `ItemDetailPage.tsx` — consume `ItemForm`; soft-delete/restore
  UI; pagination control.
- `src/server/routes/items.ts`, `checkouts.ts`, `users.ts` — new/changed endpoints, all authz-gated.
- `src/server/queries/items.ts`, `checkouts.ts` — soft-delete filters, pagination, enrichment (no N+1).
- `prisma/schema.prisma` + a single new migration — `deletedAt`, `createdById`/`updatedById`,
  `ItemAudit` table, checkout `returnedAt` index.
- `prisma/seed.ts` — deterministic values for all new fields + a seeded audit/history baseline.
- `gate/` — new behavioral specs per slice + cross-feature semantic specs; `run-gate.sh` updated.

---

## Task 1: Foundational — `ApiResult<T>` discriminated union (S13 / `D-01`)

**Why first:** every other slice reads/writes the response envelope. Converting it first means S6–S14
(and the refactor of v1's existing slices) are written against the final shape. Doing it later forces a
second pass over everything.

**Files:** `src/shared/types.ts`, `src/shared/serialize.ts` (`ok()`/`fail()`), `src/client/api.ts`
(`apiFetch` unwrap), all of `src/server/routes/*`, plus any v1 slice code that builds envelopes inline.

**Test list (→ gate `gate/api-envelope.spec.ts`):** the four `D-01` ACs — success body is
`{ok:true,data}` with no `error`; 404 is `{ok:false,error}` with no `data`; invalid POST is
`{ok:false,error}`; client surfaces the server error string and treats missing `data` as an error.

**Done when:** union compiles (`tsc` is now a real semantic check), every route returns the union,
`apiFetch` discriminates on `ok`, visible suite + v1 gate still green.

## Task 2: Foundational — shared `ItemForm` + create/edit parity (S12 / `D-02`)

**Why second:** S6 (dropdowns) and S14 (validation) both edit the item form; collapse the duplicated
create/edit copies into one component first so those slices touch one file, not two.

**Files:** create `src/client/components/ItemForm.tsx`; refactor `ItemsPage.tsx` (create dialog) and
`ItemDetailPage.tsx` (edit card) to use it; `src/client/api.ts` types.

**Test list (→ gate `gate/item-form.spec.ts`):** the four `D-02` ACs — create dialog exposes Barcode +
Notes; empty barcode/notes persist as `null` not `""`; create field-set == edit field-set; editing only
Name leaves other fields unchanged. (Component-level via Playwright/RTL as the visible suite allows;
behavioral parity asserted in the gate.)

## Task 3: Schema + seed migration batch (S6, S7, S10, S8, S11 schema parts)

**Why batched:** `prisma/schema.prisma` is a single shared file; landing all additive columns/tables in
one coherent migration avoids self-inflicted churn. No behavior yet — just shape + deterministic seed.

**Files:** `prisma/schema.prisma` (+ one new `prisma/migrations/*`), `prisma/seed.ts`,
`src/shared/types.ts`.

**Adds:**
- `Item.deletedAt DateTime?` (S7), `Item.createdById/updatedById` FK→User (S10).
- Controlled-vocab enforcement target for `category`/`location`/`unit` (S6) — keep columns as strings
  (SQLite has no enums) but the allowed sets live in `src/shared/types.ts` as the single source.
- `ItemAudit` table (S8): `id, itemId, actorId, field, oldValue, newValue, changedAt`.
- `@@index([returnedAt])` on `CheckoutRecord` (S11).

**Seed (deterministic):** all existing 40 items get `deletedAt=null`, `createdById=user-admin`,
`updatedById=user-admin`; a small fixed `ItemAudit` baseline; counts that the gate already pins (40
items, 3 microscopes, 6 low-stock) **must stay true** — verify after seeding.

**Test list (→ extend `gate/seed-invariants.spec.ts`):** seeded counts unchanged; every item has a
non-null creator; audit baseline has the fixed N rows.

## Task 4: Controlled vocabularies — Category / Location / Unit (S6 / `M-01`)

**Depends on:** Task 2 (form), Task 3 (allowed-set source).
**Files:** `src/shared/types.ts` (allowed sets + guards), `src/server/routes/items.ts` (Zod refinement),
`src/client/components/ItemForm.tsx` (Select dropdowns preselected on edit), `src/client/api.ts`.
**Test list (→ gate `gate/vocab.spec.ts`):** the five `M-01` ACs — out-of-set category/location/unit
→ 400 (POST) / no-op (PATCH); omitting unit → 201 with `"units"`; forms render selections limited to the
seeded sets and cannot submit a typed value; valid selection persists and renders.

## Task 5: Soft-delete + restore (S7 / `F-01`)

**Depends on:** Tasks 1, 3.
**Files:** `src/server/queries/items.ts` (filter `deletedAt:null` on reads), `src/server/routes/items.ts`
(DELETE → soft; add restore endpoint, **authz-gated** per v1's `F-08`), `src/shared/serialize.ts`,
`src/client/api.ts`, `ItemsPage.tsx`/`ItemDetailPage.tsx`.
**Test list (→ gate `gate/soft-delete.spec.ts`):** the four `F-01` ACs — delete removes from list, count
40→39; restore returns it, 39→40; checkout of a soft-deleted item rejected; soft-deleted id is
distinguishable from a never-existing id (restorable vs 404).
**Cross-feature note:** pagination total (Task 8) counts non-deleted; audit (Task 7) records deletes.

## Task 6: Item authorship — createdBy / updatedBy (S10 / `F-02`)

**Depends on:** Tasks 1, 3. **Before** Task 7 (audit needs the actor).
**Files:** `src/server/routes/items.ts` (attribute from `req.user`, **never** the body),
`src/shared/serialize.ts`, `src/shared/types.ts`, `src/client/api.ts`.
**Test list (→ gate `gate/authorship.spec.ts`):** the four `F-02` ACs — creator is the caller even if the
body lies; a later PATCH by another user sets last-editor; creator unchanged on later edits; detail
returns creator + last-editor.

## Task 7: Item change-history / audit log (S8 / `F-16`)

**Depends on:** Tasks 1, 3, 6.
**Files:** `src/server/routes/items.ts` (write `ItemAudit` rows on create/update/delete using the Task 6
actor), `src/server/queries/items.ts` (read history, no N+1), new audit endpoint (authz-gated),
`src/shared/serialize.ts`, `src/shared/types.ts`, `src/client/api.ts`, `ItemDetailPage.tsx` (timeline).
**Test list (→ gate `gate/audit-log.spec.ts`):** `F-16` ACs — each create/update/delete appends an audit
row attributing the right actor and field old→new; history reads back in order; seeded baseline intact.

## Task 8: Pagination + total count (S9 / `F-05`)

**Depends on:** Tasks 1, 5 (count semantics = non-deleted).
**Files:** `src/server/routes/items.ts`, `src/server/queries/items.ts` (take/skip + count),
`src/shared/serialize.ts` (paginated envelope), `src/shared/types.ts`, `src/client/api.ts`,
`src/client/hooks/useItems.ts`, `ItemsPage.tsx` (pager).
**Test list (→ gate `gate/pagination.spec.ts`):** the four `F-05` ACs — `limit/offset` bounds the page;
`total` is 40 regardless of page; no params still 200 (back-compatible default); sequential paging
returns each item exactly once.

## Task 9: Checkouts enrichment + filtering (S11 / `F-11`)

**Depends on:** Tasks 1, 3.
**Files:** `src/server/routes/checkouts.ts`, `src/server/queries/checkouts.ts` (join item+user names, no
N+1; `active`/`itemId` filters), `src/shared/serialize.ts`, `src/shared/types.ts`, `src/client/api.ts`,
`useCheckouts.ts`, `CheckoutsPage.tsx`.
**Test list (→ gate `gate/checkouts.spec.ts`):** the four `F-11` ACs — `active=true` → exactly 3;
`itemId` filter; each row carries item+user names; returned ones drop from active; no-params → all 5
newest-first; no N+1.

## Task 10: Inline form validation (S14 / `UX-01`)

**Depends on:** Tasks 2, 4.
**Files:** `src/client/components/ItemForm.tsx`, `src/server/routes/items.ts` (structured field errors).
**Test list (→ gate `gate/form-validation.spec.ts`):** the `UX-01` ACs — required-field and numeric
constraints surface inline per-field; invalid submit blocked client-side and rejected server-side with a
field-addressable error; valid submit succeeds.

## Task 11: Cross-feature semantic gate + assembly

**Why:** per-slice green ≠ coherent whole. This task adds the **semantic** assertions (clair's instrument)
and wires the suite.

**Files:** `gate/cross-feature.spec.ts` (new), `gate/run-gate.sh`, `package.json` (`test:gate` globs new
specs).
**Assertions:**
- **Every new endpoint is authz-gated** (extend v1's check to soft-delete/restore, audit-read, vocab):
  viewer → 403, member/admin per matrix.
- Soft-delete × checkouts × audit compose: deleting an item blocks new checkouts **and** writes an audit
  row; restore re-enables.
- Pagination `total` reflects soft-delete (deleted items not counted).
- Authorship feeds audit (actor on each audit row == authenticated mutator).
- Envelope: every new endpoint returns the discriminated union (Task 1).
- **Floors:** `tsc --noEmit` clean + `pnpm build` clean as first-class gate steps.
- **Regression:** the full visible suite + all v1 gate assertions still green.

## Task 12: Verify, count, and pin

- [ ] Run the full ladder: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:gate && bash gate/run-gate.sh` — all green.
- [ ] Confirm the gate assertion count grew from 35 by the new per-slice + cross-feature specs; record the number.
- [ ] Record the new tip SHA; label it `arena-reference-v2` (re-cut the annotated tag where tag pushes are permitted).
- [ ] Update [`benchmark/runs/saturation-L3.run.yaml`](../../../benchmark/runs/saturation-L3.run.yaml):
      `status: ready`, `gate.sha: <new SHA>`.
- [ ] Update [`docs/architecture/benchmark-arena-ts.md`](../../../docs/architecture/benchmark-arena-ts.md)
      status block with the v2 SHA + new gate count.

---

## Sequencing summary (the critical path)

```
T1 ApiResult union ─┐
T2 shared ItemForm ─┤ (foundational refactors first)
                    ▼
T3 schema+seed batch ─► T4 vocab ─► T5 soft-delete ─► T6 authorship ─► T7 audit
                                         │                                  │
                                         ├─► T8 pagination ─────────────────┤
                                         └─► T9 checkouts                    │
T2,T4 ─► T10 validation                                                     │
                                                                            ▼
                                              T11 cross-feature gate ─► T12 verify+pin
```

## Risks & honest caveats

- **`ApiResult` ripple (T1):** refactors v1 slice code too. Largest blast radius; do it first and lean on
  `tsc` to find every consumer.
- **Schema/seed expected-values:** new fields must not break the gate's pinned counts (40/3/6). T3
  verifies before any feature lands.
- **Slice interactions in the reference:** soft-delete × pagination-total × audit × checkouts must compose
  — that's what T11 exists to prove. These are *designed* coherently here (full knowledge), unlike a run.
- **Scope creep:** resist implementing backlog items outside the 14 L3 slices; the bank holds them until a
  level needs them.
- **This plan is slice-altitude by design.** Per-slice keystroke-level TDD steps are produced at execution
  from each task's ACs (the failing-test list is already written, verbatim, in the backlog) — not
  pre-fabricated here, which would be implementing rather than scoping.

## Estimated shape

12 tasks; 2 foundational refactors + 1 schema/seed batch + 7 feature slices + gate + verify. Slices are
independently testable but **dependency-ordered** (not parallel — this is the coherent gold build). New
gate assertions ≈ 9 slices × ~4 ACs + ~6 cross-feature ≈ **~40 new**, taking the gate from 35 to ~75.
