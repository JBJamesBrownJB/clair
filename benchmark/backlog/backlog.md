# Larder backlog — the work bank

> **Generated** from the multi-agent design review of `arena/base` (run `larder-backlog-review`),
> plus hand-added items. Each item is grounded in real arena files; the collision graph is computed
> from touch-set intersection. Edit by hand freely; this is the source of truth.
> Field spec and how levels consume these IDs: [`README.md`](README.md) and [`../levels.md`](../levels.md).

## Summary

`59` items (`58` from the review of `79` candidates + `1` hand-added: `M-10`).

| Type | Count |
|------|-------|
| Features | 22 |
| UX fixes | 9 |
| Debt (curated obstacles) | 7 |
| Migration / maintenance | 10 |
| Improvements | 11 |
| **Total** | **59** |

Size mix: `S` 12 · `M` 39 · `L` 8.

## Highest-collision items (most shared-substrate overlap)

The headline collision generators — touch the most other items. Good candidates to seed a high-density run.

| ID | Collides with N | Title |
|----|-----------------|-------|
| `F-05` | 52 | Paginate GET /api/items with a total count |
| `F-06` | 52 | Server-side item search and filtering pushed to the database (with indexes) |
| `F-01` | 51 | Soft-delete items with restore (deletedAt) instead of hard delete |
| `F-03` | 50 | Add expiry date with expired / perishable surfacing |
| `F-17` | 50 | CSV export of the item register |
| `M-01` | 49 | Constrain Category, Location and Unit to their seeded vocabularies (schema/server/forms) |
| `F-19` | 47 | Bulk select and bulk delete / relocate items |
| `UX-01` | 47 | Inline form validation with surfaced field errors and numeric constraints |
| `F-21` | 46 | Barcode lookup / quick-find |
| `IMP-01` | 46 | Barcode format and uniqueness validation |
| `F-16` | 45 | Item change-history / audit log |
| `F-18` | 45 | Low-stock reorder report |

## Overlap notes (from synthesis)

> 79 raw candidates consolidated to 58 by merging true duplicates (the 8-way Category/Location/Unit cluster into M-01; ApiResult x2 into D-01; soft-delete x2 into F-01; audit/authorship x2 into F-02; server pagination x2 into F-05; server search/filter x2 into F-06; the 3-way authz cluster into F-08; the 3-way checkouts-enrichment cluster into F-11; JWT-hardening + jsonwebtoken-bump into M-02; field-parity + shared-form into D-02; double-sort x2 into D-03; Users-empty + list-states into D-04; checkout name+filter UI x2 into UX-04). Collisions were recomputed purely from shared files. The dominant high-collision chokepoint is src/shared/serialize.ts (the documented magnet): the envelope/ordering/low-stock/format debt items (D-01, D-03, D-05, D-06, IMP-04, IMP-08) plus nearly every server read/write feature (F-01..F-07, F-11, F-16, F-17, F-18, F-20) and the lodash bump (M-03) all edit it. src/shared/types.ts and src/client/api.ts form the same shared spine across full-stack features, ApiResult (D-01) and the apiFetch test (D-07). src/server/routes/items.ts is the server hub where validation (M-01, M-09, IMP-01, IMP-02), authz (F-08), ordering (D-03), and every item endpoint (F-01..F-07, F-16, F-17, F-18, F-19, F-21) contend. On the client, the duplicated item form across src/client/containers/ItemsPage.tsx + ItemDetailPage.tsx is the worst UI cluster: the form-extraction debt (D-02), controlled-vocab dropdowns (M-01), inline validation (UX-01), low-stock SSOT/non-color (D-05/UX-06), dialog/keyboard/table a11y (UX-05/UX-07/UX-08), the four client items-table features (F-12..F-15) and the MUI v6 sweep (M-06) all collide there. prisma/schema.prisma is the migration battleground (F-01, F-02, F-03, F-04, F-11, F-16, F-20, M-08, M-09 plus M-01), and package.json forces all seven dependency migrations (M-02..M-08) into mutual conflict. Lowest-collision/most-isolated items are UX-09 (Layout only, 4), M-04 (semver/minimist, 6), IMP-11 and IMP-10 (narrow user/checkout test files, 7-8).

---

## Features (22)

### `F-01` — Soft-delete items with restore (deletedAt) instead of hard delete

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** DELETE /api/items/:id is a hard prisma.item.delete and the UI warns 'cannot be undone', destroying history and the @unique barcode irrecoverably. A deletedAt column with filtered reads plus a restore path makes deletion safe and reversible. Merges two reviewer candidates (soft-delete and soft-delete-with-restore).
- **Touch-set:** `prisma/schema.prisma`, `src/shared/types.ts`, `src/server/queries/items.ts`, `src/server/routes/items.ts`, `src/shared/serialize.ts`, `src/client/api.ts`, `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-06`, `M-07`, `M-08`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - After DELETE /api/items/<id> the item no longer appears in GET /api/items and the default count drops by exactly one (40 -> 39)
  - A soft-deleted item can be restored, after which GET /api/items includes it again and the count returns to 40
  - After a soft-delete, POST /api/checkouts for that item is rejected (not 201)
  - GET /api/items/<id> for a soft-deleted item is distinguishable from a never-existing id (still fetchable/restorable, while a bogus id 404s)

### `F-02` — Attribute item authorship (createdBy/updatedBy) to the authenticated user

- **Type:** feature · **Size:** L · **Independently implementable:** yes
- **Rationale:** Item carries createdAt/updatedAt timestamps but no actor; checkouts already derive userId from req.user.sub but items record neither creator nor last editor. Attribution columns sourced from req.user (immune to body spoofing) make edits accountable. Merges the audit-attribution feature with the body-spoofing-safe authorship migration.
- **Touch-set:** `prisma/schema.prisma`, `src/shared/types.ts`, `src/shared/serialize.ts`, `src/server/routes/items.ts`, `src/client/api.ts`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-05`, `D-06`, `D-07`, `F-01`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `M-01`, `M-03`, `M-07`, `M-08`, `M-09`, `UX-01`, `UX-03`, `UX-04`, `UX-06`
- **Acceptance criteria (behavioral — gate material):**
  - An item created via POST /api/items records the authenticated caller as creator even if the body supplies a different user id
  - After a different authenticated user PATCHes the item, it reports that second user as last editor
  - The creator attribution does not change when the item is later edited by another user (author ignored from body on update)
  - GET /api/items/<id> includes the creator and last-editor identifiers

### `F-03` — Add expiry date with expired / perishable surfacing

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** The model tracks quantity and lowStockThreshold but has no shelf-life data; reagents and consumables in the seed have no expiry. An optional expiryDate plus a derived expired flag lets the register flag perishables.
- **Touch-set:** `prisma/schema.prisma`, `src/shared/types.ts`, `src/shared/serialize.ts`, `src/server/routes/items.ts`, `src/client/api.ts`, `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-06`, `M-07`, `M-08`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - POST /api/items accepts an optional expiry date and GET /api/items/<id> returns the same value
  - POST /api/items without an expiry date succeeds and the item reads back with a null expiry
  - An item whose expiry date is in the past is reported as expired on read; one with a future date is not
  - POST /api/items with a malformed expiry date value is rejected with 400

### `F-04` — Record lastLoginAt on the User model

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** User has createdAt but nothing tracks activity; login succeeds in routes/auth.ts without recording when. A lastLoginAt timestamp updated on successful login gives an auditable signal of account use.
- **Touch-set:** `prisma/schema.prisma`, `src/shared/types.ts`, `src/shared/serialize.ts`, `src/server/routes/auth.ts`, `src/server/routes/users.ts`
- **Collides with:** `D-01`, `D-03`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-05`, `F-06`, `F-07`, `F-08`, `F-09`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-20`, `IMP-01`, `IMP-02`, `IMP-04`, `IMP-06`, `IMP-08`, `IMP-11`, `M-01`, `M-02`, `M-03`, `M-07`, `M-08`, `M-09`, `UX-04`, `UX-06`
- **Acceptance criteria (behavioral — gate material):**
  - A freshly seeded user reports a null lastLoginAt before any login
  - After a successful POST /api/auth/login, that user's lastLoginAt is non-null on GET /api/users
  - A failed login (wrong password) does not set or change lastLoginAt
  - A second successful login produces a lastLoginAt at or after the first

### `F-05` — Paginate GET /api/items with a total count

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** listItems() does an unbounded findMany with no take/skip and serializeItemList returns the whole table on every request; with 40 seeded items there is no limit/offset and no total, so the client and DOM grow unbounded. Merges two reviewer candidates (route-level and full-stack pagination).
- **Touch-set:** `src/server/routes/items.ts`, `src/server/queries/items.ts`, `src/shared/serialize.ts`, `src/client/api.ts`, `src/shared/types.ts`, `src/client/hooks/useItems.ts`, `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-05`, `M-06`, `M-07`, `M-08`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - GET /api/items?limit=10&offset=0 returns at most 10 items; offset=10 returns a non-overlapping page
  - The list response exposes a total of 40 for the unfiltered seeded dataset, independent of limit/offset
  - GET /api/items with no pagination params still returns a successful 200 (back-compatible default page)
  - Paging sequentially through offsets returns every item exactly once with no duplicates or omissions

### `F-06` — Server-side item search and filtering pushed to the database (with indexes)

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** listItems ignores query params entirely, forcing the client to fetch all 40 and filter locally; Item has no index on category/location/name so even DB-side filters are unindexed scans. Add q/category/lowStock filtering in the query layer plus supporting indexes. Merges two reviewer candidates.
- **Touch-set:** `src/server/routes/items.ts`, `src/server/queries/items.ts`, `src/shared/serialize.ts`, `src/client/api.ts`, `prisma/schema.prisma`, `src/client/hooks/useItems.ts`, `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-05`, `M-06`, `M-07`, `M-08`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - GET /api/items?q=microscope returns exactly 3 items (case-insensitive name match)
  - GET /api/items?category=Glassware returns only Glassware items
  - GET /api/items?lowStock=true returns exactly 6 items (quantity <= lowStockThreshold)
  - Combining filters narrows with AND semantics; GET /api/items with no filter params returns all 40 items unchanged

### `F-07` — Server-side item sorting via query params

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** Sort order is hard-coded to name-asc in both listItems (Prisma orderBy) and serializeItemList (lodash orderBy); callers cannot request any other ordering.
- **Touch-set:** `src/server/routes/items.ts`, `src/server/queries/items.ts`, `src/shared/serialize.ts`, `src/client/api.ts`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-08`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `M-01`, `M-03`, `M-07`, `M-08`, `M-09`, `UX-01`, `UX-03`, `UX-04`, `UX-06`
- **Acceptance criteria (behavioral — gate material):**
  - GET /api/items?sort=quantity&order=desc returns items ordered by descending quantity
  - GET /api/items?sort=name&order=asc returns ascending name order
  - GET /api/items with no sort params returns ascending name order (current default preserved)
  - An invalid sort field (e.g. ?sort=bogus) returns 400 rather than 500

### `F-08` — Enforce role-based authorization on all mutating endpoints

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** All mutations are gated by authenticate only; requireRole exists in middleware but is unused, so a viewer JWT can create/update/delete items, post checkouts and returns, and read the full user directory. Merges the umbrella authz item with the item-write and checkout-write sub-items.
- **Touch-set:** `src/server/routes/items.ts`, `src/server/routes/checkouts.ts`, `src/server/routes/users.ts`, `src/server/auth/middleware.ts`
- **Collides with:** `D-01`, `D-03`, `D-06`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-09`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-07`, `IMP-10`, `IMP-11`, `M-01`, `M-02`, `M-07`, `M-09`, `UX-01`
- **Acceptance criteria (behavioral — gate material):**
  - A viewer-role JWT calling POST/PATCH/DELETE /api/items receives 403 and the item set is unchanged
  - A viewer-role JWT calling POST /api/checkouts or POST /api/checkouts/:id/return receives 403 and item quantity is unchanged
  - A member-role JWT calling POST /api/items receives 201; admin/member writes still succeed
  - An admin-role JWT calling GET /api/users receives 200 while a viewer receives 403; all GET item reads still succeed for a viewer (200)

### `F-09` — Restrict the Users directory to admins on the client (route guard + nav)

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** The client /users route and nav link are visible to everyone even once the server is hardened; listing should be admin-only on the client too. Server-side gating lives in F-08.
- **Touch-set:** `src/server/routes/users.ts`, `src/client/routes.tsx`, `src/client/containers/Layout.tsx`, `src/client/containers/UsersPage.tsx`
- **Collides with:** `D-04`, `D-06`, `F-04`, `F-08`, `F-10`, `F-18`, `F-22`, `IMP-11`, `M-06`, `M-07`, `M-10`, `UX-03`, `UX-08`, `UX-09`
- **Acceptance criteria (behavioral — gate material):**
  - A logged-in viewer or member who navigates to /users does not see the user table (redirected or shown a forbidden state)
  - The Users nav link is not rendered for non-admin users
  - An admin sees the Users nav link and the populated table
  - GET /api/users with a member or viewer token returns 403 while an admin gets 200 with the seeded 4 users

### `F-10` — Admin-only role-management endpoint

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** There is no way to change a user's role; the Users page is read-only and no mutation route exists. Role changes must be admin-gated and must not let a caller escalate themselves via the body.
- **Touch-set:** `src/server/routes/users.ts`, `src/client/api.ts`, `src/shared/types.ts`, `src/client/containers/UsersPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-04`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-09`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-06`, `IMP-11`, `M-01`, `M-06`, `M-07`, `UX-01`, `UX-03`, `UX-04`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - An admin can change another user's role to a value in {admin,member,viewer} and a subsequent read reflects it
  - A member or viewer attempting the role change returns 403 and no role changes
  - A request body supplying an invalid role string is rejected (400) with no change
  - A non-admin cannot escalate their own role by calling the endpoint

### `F-11` — Server-side checkouts filtering + item/user name enrichment (no N+1, with index)

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** GET /api/checkouts returns every record with no filtering; listActiveCheckouts exists but is never wired to a route, CheckoutRecord has no returnedAt index, and serializeCheckout emits only raw itemId/userId so the client cannot show names without N extra lookups. Merges three reviewer candidates (filter+enrich, name-enrichment-no-N+1, active-only-filter-with-index).
- **Touch-set:** `src/server/routes/checkouts.ts`, `src/server/queries/checkouts.ts`, `src/shared/serialize.ts`, `src/shared/types.ts`, `src/client/api.ts`, `prisma/schema.prisma`, `src/client/hooks/useCheckouts.ts`, `src/client/containers/CheckoutsPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-10`, `M-01`, `M-03`, `M-05`, `M-06`, `M-07`, `M-08`, `M-09`, `UX-01`, `UX-03`, `UX-04`, `UX-06`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - GET /api/checkouts?active=true returns exactly the 3 records whose returnedAt is null; ?itemId=<id> returns only that item's records
  - Each returned checkout carries the related item's name and the related user's name (itemName equals the item's current name)
  - After a checkout is returned it no longer appears in the active=true result; GET /api/checkouts with no params returns all 5 seeded records newest-first
  - Names are served correctly for N records without per-row lookups (no N+1)

### `F-12` — Add a search box to the Items table (client)

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** ItemsPage renders all 40 seeded items with no way to find anything; the seed fixes 3 'microscope' rows specifically to gate search, yet no search input exists.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`, `src/client/hooks/useItems.ts`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-21`, `F-22`, `IMP-01`, `IMP-05`, `IMP-06`, `IMP-09`, `M-01`, `M-05`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Typing 'microscope' into the search field narrows the table to exactly 3 rows
  - Search matches case-insensitively (typing 'MICROSCOPE' yields the same 3 rows)
  - Clearing the search field restores all 40 rows
  - A string present in no item name shows zero data rows and a no-results message rather than the full table

### `F-13` — Sortable columns on the Items table (client)

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** The Items table headers (Name, Category, Location, Quantity, Status) are static; there is no way to order 40 rows, e.g. to surface highest/lowest quantity.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-12`, `F-14`, `F-15`, `F-17`, `F-19`, `F-21`, `F-22`, `IMP-01`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Clicking the Quantity header orders visible rows by quantity ascending; clicking again orders descending
  - Clicking the Name header orders visible rows alphabetically by name
  - The currently-sorted column shows a visible sort-direction indicator
  - Sorting does not change the number of rows shown

### `F-14` — Paginate the Items table (client)

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** All 40 items render in a single unbounded table; there is no pagination control, so the list grows without limit and is hard to scan.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-12`, `F-13`, `F-15`, `F-17`, `F-19`, `F-21`, `F-22`, `IMP-01`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - On initial load the Items table shows at most one page of rows (a fixed page size < 40), not all 40 at once
  - A pagination control advances to the next page and shows the remaining items
  - The control reports the total item count (e.g. shows 40 total) regardless of current page
  - Navigating to the last page and back returns to the original first-page rows

### `F-15` — Low-stock filter toggle with count summary on Items (client)

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** Low-stock rows are only flagged inline (pink row + 'Low' chip); there is no way to filter to just the low-stock items or see how many there are, despite the seed fixing exactly 6 low-stock items.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-12`, `F-13`, `F-14`, `F-17`, `F-19`, `F-21`, `F-22`, `IMP-01`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Activating the low-stock filter reduces the table to exactly the 6 items whose quantity is at or below their lowStockThreshold
  - The page displays a low-stock count of 6 when all items are shown
  - Every row shown while the filter is active carries the 'Low' status indicator
  - Deactivating the filter restores the full set of rows

### `F-16` — Item change-history / audit log

- **Type:** feature · **Size:** L · **Independently implementable:** yes
- **Rationale:** Items mutate via PATCH/DELETE with no record of who changed what (createdAt/updatedAt are the only temporal fields and updatedAt is overwritten on every edit). A lab register needs an auditable per-item history so quantity corrections and deletions are traceable.
- **Touch-set:** `prisma/schema.prisma`, `src/server/routes/items.ts`, `src/server/queries/items.ts`, `src/shared/types.ts`, `src/shared/serialize.ts`, `src/client/api.ts`, `src/client/hooks/useItems.ts`, `src/client/containers/ItemDetailPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-05`, `M-06`, `M-07`, `M-08`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-06`, `UX-07`
- **Acceptance criteria (behavioral — gate material):**
  - After PATCHing an item's quantity, fetching its history returns at least one entry recording the change (old vs new value)
  - Creating a new item via POST /api/items produces a 'created' history entry
  - History entries for an item are returned newest-first
  - Editing an item then opening its detail page shows a visible history/timeline section listing the change

### `F-17` — CSV export of the item register

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** There is no way to get items out of the system for ordering or audit. listItems already funnels through serialize.ts; an export endpoint plus a download button is a natural read-path extension a real lab needs.
- **Touch-set:** `src/server/routes/items.ts`, `src/server/queries/items.ts`, `src/shared/serialize.ts`, `src/client/api.ts`, `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-06`, `M-07`, `M-08`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - The export endpoint returns a CSV body whose Content-Type is a CSV media type (e.g. text/csv)
  - The CSV has a header row plus exactly 40 data rows for the seeded dataset, ordered by item name ascending
  - The CSV includes at least item name, category, quantity and unit for each item
  - An 'Export' control on the Items page triggers the download

### `F-18` — Low-stock reorder report

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** Low-stock status is recomputed ad hoc in every view but there is no dedicated reorder view; a consolidated low-stock report is what drives purchasing.
- **Touch-set:** `src/server/routes/items.ts`, `src/server/queries/items.ts`, `src/shared/serialize.ts`, `src/client/api.ts`, `src/client/hooks/useItems.ts`, `src/client/containers/Layout.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-09`, `F-10`, `F-11`, `F-12`, `F-16`, `F-17`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-07`, `IMP-08`, `M-01`, `M-03`, `M-05`, `M-06`, `M-07`, `M-08`, `M-09`, `M-10`, `UX-01`, `UX-03`, `UX-04`, `UX-06`, `UX-09`
- **Acceptance criteria (behavioral — gate material):**
  - The low-stock report endpoint returns exactly the 6 seeded low-stock items (quantity <= lowStockThreshold)
  - Every item returned satisfies quantity <= lowStockThreshold
  - An item that is not low-stock is absent from the report
  - The report is reachable from the app navigation and renders those items

### `F-19` — Bulk select and bulk delete / relocate items

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** Every mutation is single-item; relocating a shelf's worth of items or clearing duplicates means N round-trips. Row multi-select plus a bulk endpoint is standard for an inventory table.
- **Touch-set:** `src/server/routes/items.ts`, `src/client/api.ts`, `src/client/hooks/useItems.ts`, `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-05`, `IMP-06`, `IMP-07`, `IMP-09`, `M-01`, `M-05`, `M-06`, `M-07`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Selecting multiple item rows and invoking bulk delete removes all selected items from the list in a single user action
  - The bulk endpoint accepts an array of item ids and reports the number affected
  - After a bulk delete of K selected items, GET /api/items returns 40 minus K items
  - Submitting a bulk operation with an empty selection performs no change

### `F-20` — Checkout due date with overdue flagging

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** CheckoutRecord tracks checkedOutAt/returnedAt but has no due date, so nothing is ever 'overdue'; the Checkouts page only shows Active vs Returned. Lab equipment loans need a due date and overdue visibility.
- **Touch-set:** `prisma/schema.prisma`, `src/shared/types.ts`, `src/shared/serialize.ts`, `src/server/routes/checkouts.ts`, `src/client/api.ts`, `src/client/containers/CheckoutsPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-21`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-10`, `M-01`, `M-03`, `M-06`, `M-07`, `M-08`, `M-09`, `UX-01`, `UX-03`, `UX-04`, `UX-06`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Creating a checkout with a due date persists it and the returned record includes it
  - An active checkout whose due date is in the past is reported/marked overdue
  - An active checkout with a future due date, and any returned checkout, is not marked overdue
  - The Checkouts page visibly distinguishes overdue active checkouts from on-time ones

### `F-21` — Barcode lookup / quick-find

- **Type:** feature · **Size:** M · **Independently implementable:** yes
- **Rationale:** Items carry a unique barcode (seeded as LARD-NN-XXX) but there is no way to look an item up by it; you must scroll the table. A barcode lookup endpoint plus a quick-find box is the core scan workflow for a physical register.
- **Touch-set:** `src/server/routes/items.ts`, `src/server/queries/items.ts`, `src/client/api.ts`, `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-06`, `IMP-07`, `IMP-09`, `M-01`, `M-06`, `M-07`, `M-08`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Looking up a known seeded barcode (e.g. LARD-01-INS) returns the matching item
  - Looking up an unknown barcode returns a 404 / not-found result
  - Entering a known barcode in the quick-find control navigates to or surfaces that item's detail
  - Barcode lookup matches on the exact barcode, not on item name

### `F-22` — Add locale switching and externalize UI strings (i18n)

- **Type:** feature · **Size:** L · **Independently implementable:** yes
- **Rationale:** All UI copy (nav labels, table headers, button text, form labels) is hard-coded English inline across containers and there is no i18n layer or runtime locale; the app cannot present in another language and the document lang never changes.
- **Touch-set:** `src/client/App.tsx`, `src/client/containers/Layout.tsx`, `src/client/containers/ItemsPage.tsx`, `index.html`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-09`, `F-12`, `F-13`, `F-14`, `F-15`, `F-17`, `F-18`, `F-19`, `F-21`, `IMP-01`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-05`, `UX-06`, `UX-07`, `UX-08`, `UX-09`
- **Acceptance criteria (behavioral — gate material):**
  - A visible locale control lets the user switch the active UI language at runtime
  - Selecting a non-English locale changes at least the nav labels and the items table column headers to that locale's strings
  - Switching locale updates the document <html lang> attribute to the selected locale code
  - Switching back to English restores the original English strings and lang=en

---

## UX fixes (9)

### `UX-01` — Inline form validation with surfaced field errors and numeric constraints

- **Type:** ux-fix · **Size:** M · **Independently implementable:** yes
- **Rationale:** The forms rely only on the browser's required attribute and inputProps min, and the server returns a single generic 'invalid item payload' string for any Zod failure. Quantity/threshold accept non-integers via Number() coercion, empty numeric inputs coerce to 0/NaN, and the user gets no field-level feedback.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`, `src/server/routes/items.ts`, `src/client/api.ts`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-07`, `IMP-09`, `M-01`, `M-06`, `M-07`, `M-09`, `M-10`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Submitting the New item dialog with an empty Name shows an inline validation error and issues no POST request
  - Entering a negative or non-integer Quantity (or Low stock threshold) prevents submission and shows a field-level error
  - When the server rejects a payload, the specific offending field/reason is conveyed rather than a generic 'Failed to create item' message
  - A fully valid form submits successfully and closes the dialog

### `UX-02` — Hide and disable write actions in the UI for read-only roles

- **Type:** ux-fix · **Size:** M · **Independently implementable:** yes
- **Rationale:** The frontend exposes create/edit/delete controls to all authenticated users; a viewer sees buttons the server (once hardened) will reject. The UI should reflect role so viewers get a read-only experience.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`, `src/client/lib/auth-context.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-19`, `F-21`, `F-22`, `IMP-01`, `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-03`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - When logged in as a viewer, no create-item control is rendered on the items list page
  - When logged in as a viewer, no edit or delete control is rendered on the item detail page
  - When logged in as admin or member, create/edit/delete controls are rendered and functional
  - The role used for gating is derived from the authenticated user, not from a prop or hardcoded value

### `UX-03` — Auto-logout the client on 401 (session-expiry handling)

- **Type:** ux-fix · **Size:** M · **Independently implementable:** yes
- **Rationale:** apiFetch throws ApiError(401) but nothing clears stored auth or redirects; an expired 8h token leaves the user on broken authenticated pages with error alerts instead of being sent to login.
- **Touch-set:** `src/client/api.ts`, `src/client/lib/auth-context.tsx`, `src/client/routes.tsx`
- **Collides with:** `D-01`, `D-02`, `D-07`, `F-01`, `F-02`, `F-03`, `F-05`, `F-06`, `F-07`, `F-09`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-03`, `M-01`, `M-10`, `UX-01`, `UX-02`, `UX-04`
- **Acceptance criteria (behavioral — gate material):**
  - When an authenticated API request returns 401, the stored auth in localStorage is cleared
  - After such a 401, the app navigates to /login without a manual logout click
  - A successful request with a valid token does not trigger logout
  - After auto-logout, isAuthenticated is false so protected routes redirect to /login

### `UX-04` — Checkouts table: show item name (not raw ID) and an active/returned filter (client)

- **Type:** ux-fix · **Size:** M · **Independently implementable:** yes
- **Rationale:** CheckoutsPage renders the bare itemId in monospace and lists every record with no way to focus on still-out checkouts; the seed fixes 3 active and 2 returned records. Consumes the server enrichment/filter in F-11. Merges two reviewer candidates (name display, active/returned filter).
- **Touch-set:** `src/client/containers/CheckoutsPage.tsx`, `src/client/hooks/useCheckouts.ts`, `src/client/api.ts`, `src/shared/types.ts`
- **Collides with:** `D-01`, `D-02`, `D-04`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-06`, `M-01`, `M-05`, `M-06`, `UX-01`, `UX-03`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Each checkout row displays the human-readable name of its referenced item rather than the raw id
  - An 'active only' filter reduces the table to exactly the 3 records with no returnedAt value; each shown row has an 'Active' indicator and a Return action
  - A 'returned only' view shows exactly the 2 records that have a returnedAt value
  - Clearing the filter restores all 5 records

### `UX-05` — Make item rows keyboard-operable

- **Type:** ux-fix · **Size:** S · **Independently implementable:** yes
- **Rationale:** In ItemsPage the whole TableRow is clickable (cursor:pointer, onClick->navigate) but is a plain <tr> with no tabindex, role, or key handler, so keyboard and screen-reader users cannot open an item detail at all.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-12`, `F-13`, `F-14`, `F-15`, `F-17`, `F-19`, `F-21`, `F-22`, `IMP-01`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Tabbing through the items table moves focus onto each data row (each row is in the tab order)
  - Pressing Enter on a focused item row navigates to /items/<that item id>
  - Pressing Space on a focused item row navigates to that item's detail page
  - A focused row exposes an interactive role/accessible name (button/link semantics) rather than presenting as a static cell

### `UX-06` — Signal low stock without relying on color alone

- **Type:** ux-fix · **Size:** M · **Independently implementable:** yes
- **Rationale:** Low stock is conveyed by a bare red row background (#fdecea) in the list and a color=error Chip on the detail header; with color removed (color-blindness / high-contrast) the low state is indistinguishable.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`, `src/shared/serialize.ts`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-05`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Each low-stock row exposes a textual or aria label identifying it as low stock, present independent of background color (assertable from the accessibility tree)
  - The detail-page low-stock indicator carries an accessible name containing the low-stock meaning even when color is ignored
  - A non-low item does NOT carry the low-stock label
  - Low-stock classification still matches quantity <= lowStockThreshold for boundary values (equal, one below, one above)

### `UX-07` — Give dialogs accessible names and restore focus on close

- **Type:** ux-fix · **Size:** M · **Independently implementable:** yes
- **Rationale:** The New item, Delete and Check out dialogs render a DialogTitle but the Dialog has no aria-labelledby wiring, so the modal has no programmatic accessible name; focus return to the triggering control on close is also not guaranteed.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-19`, `F-21`, `F-22`, `IMP-01`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-05`, `UX-06`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Each dialog exposes an accessible name equal to its visible title (e.g. 'New item', 'Delete item?', 'Check out <name>')
  - Opening a dialog moves focus inside it and focus is trapped while open
  - Closing a dialog (Cancel, Escape, or successful submit) returns focus to the control that opened it
  - Pressing Escape closes the open dialog

### `UX-08` — Add accessible names to the data tables

- **Type:** ux-fix · **Size:** S · **Independently implementable:** yes
- **Rationale:** The Items, Checkouts and Users tables render as anonymous <table> elements with no caption or aria-label, so assistive tech announces an unnamed table; header cells also lack explicit column-scope semantics for the empty-state colSpan row.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`, `src/client/containers/CheckoutsPage.tsx`, `src/client/containers/UsersPage.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-09`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-17`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-04`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-04`, `UX-05`, `UX-06`, `UX-07`
- **Acceptance criteria (behavioral — gate material):**
  - The items table exposes an accessible name describing it as the items list
  - The checkouts and users tables each expose a distinct accessible name describing their contents
  - Each table's column header cells are programmatically associated as column headers for the data rows
  - The empty-state row remains announced as a single spanning cell without breaking the header/column association

### `UX-09` — Expose active navigation state programmatically (aria-current)

- **Type:** ux-fix · **Size:** S · **Independently implementable:** yes
- **Rationale:** The top nav marks the current page using only bold weight and a white bottom border; there is no aria-current, so screen-reader users get no indication of which section they are in.
- **Touch-set:** `src/client/containers/Layout.tsx`
- **Collides with:** `F-09`, `F-18`, `F-22`, `M-06`, `M-10`
- **Acceptance criteria (behavioral — gate material):**
  - The nav link matching the current route exposes aria-current=page
  - Exactly one nav link is marked current at a time for a given route
  - Navigating to /checkouts marks the Checkouts link current and clears it from Items
  - The root route '/' marks only the Items link current

---

## Debt (curated obstacles) (7)

### `D-01` — Make ApiResult<T> a discriminated union and tighten envelope unwrapping

- **Type:** debt · **Size:** L · **Independently implementable:** yes
- **Rationale:** ApiResult<T> has both data? and error? optional with ok the only signal; serialize.ts ok()/fail() and every route build envelopes inline, and apiFetch casts data through unknown, so success and error shapes drift. Converting to {ok:true,data}|{ok:false,error} forces every read/write path through these shared files. Merges two reviewer candidates.
- **Touch-set:** `src/shared/types.ts`, `src/shared/serialize.ts`, `src/client/api.ts`, `src/server/routes/items.ts`, `src/server/routes/checkouts.ts`, `src/server/routes/auth.ts`
- **Collides with:** `D-02`, `D-03`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-10`, `M-01`, `M-02`, `M-03`, `M-07`, `M-09`, `UX-01`, `UX-03`, `UX-04`, `UX-06`
- **Acceptance criteria (behavioral — gate material):**
  - A successful GET /api/items body contains ok:true and a data array and no error key
  - A 404 GET /api/items/<missing> body contains ok:false and an error string and no data key
  - A 400 POST /api/items with an invalid payload returns ok:false with an error string and no data key
  - The client surfaces the server-provided error string (not a generic message) when a request fails, and a response with missing data is treated as an error rather than rendered as undefined

### `D-02` — Extract a shared ItemForm and reach create/edit field parity (Barcode + Notes on create)

- **Type:** debt · **Size:** M · **Independently implementable:** yes
- **Rationale:** The item form is hand-duplicated across ItemsPage.tsx (create Dialog) and ItemDetailPage.tsx (edit Card) with no shared component, and the copies have drifted: the create form omits Barcode and Notes that the edit form exposes even though the API and schema support both. Any field-level feature must edit both copies, making this a guaranteed collision magnet. Merges the field-parity feature with the shared-form extraction.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`, `src/client/api.ts`
- **Collides with:** `D-01`, `D-04`, `D-05`, `D-07`, `F-01`, `F-02`, `F-03`, `F-05`, `F-06`, `F-07`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - The New item dialog exposes Barcode and Notes inputs; creating an item with both persists them and they appear on its detail page
  - Creating an item while leaving barcode and notes empty still succeeds and stores them as null (not empty string)
  - The set of labeled fields offered on create matches the set offered on edit (Name, Category, Location, Quantity, Unit, Low stock threshold, Barcode, Notes)
  - Opening edit, changing only Name and saving leaves all other fields unchanged

### `D-03` — Consolidate item ordering into one shared, case-insensitive read path

- **Type:** debt · **Size:** S · **Independently implementable:** yes
- **Rationale:** Item ordering is defined twice and divergently: queries/items.ts does prisma orderBy name:'asc' (case-sensitive SQLite) while serialize.ts serializeItemList re-sorts case-insensitively with lodash.orderBy lowercased. This is duplicated O(n log n) work on every list call and the two sorts disagree for mixed-case names. Merges two reviewer candidates.
- **Touch-set:** `src/server/queries/items.ts`, `src/shared/serialize.ts`, `src/server/routes/items.ts`
- **Collides with:** `D-01`, `D-05`, `D-06`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `M-01`, `M-03`, `M-07`, `M-08`, `M-09`, `UX-01`, `UX-06`
- **Acceptance criteria (behavioral — gate material):**
  - GET /api/items returns items in case-insensitive ascending name order (e.g. 'acetone' before 'Beaker' before 'cherry')
  - The returned order is identical whether or not the serialize re-sort step runs, and identical across successive identical requests
  - Sorting is applied exactly once with no observable reordering between repeated calls

### `D-04` — Consistent empty / loading / error / retry states across all list pages

- **Type:** debt · **Size:** M · **Independently implementable:** yes
- **Rationale:** Each list page hand-rolls its own CircularProgress + Alert + ad-hoc empty row; the states diverge (UsersPage has no users.length===0 branch, unlike Items and Checkouts) and errors offer no retry beyond a full reload. Merges the Users-empty-state fix with the cross-page consistency item.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`, `src/client/containers/CheckoutsPage.tsx`, `src/client/containers/UsersPage.tsx`
- **Collides with:** `D-02`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-09`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-17`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-04`, `IMP-06`, `IMP-09`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - While a list query is loading, each of the three pages shows a loading indicator and no table rows
  - On a list query error, each page shows an error message plus a retry control that re-issues the request without a full page reload
  - On a successful empty result, each of the three pages (including Users) shows an explanatory empty-state message instead of header-only
  - On a non-empty result every record renders as a row and no empty-state message is shown

### `D-05` — Single source of truth for low-stock determination

- **Type:** debt · **Size:** S · **Independently implementable:** yes
- **Rationale:** serialize.ts exports isLowStock(), but both ItemsPage.tsx and ItemDetailPage.tsx recompute item.quantity <= item.lowStockThreshold inline; divergent thresholds will appear the moment one consumer changes the rule. Routing both components through the shared helper concentrates edits on serialize.ts plus both pages.
- **Touch-set:** `src/shared/serialize.ts`, `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-06`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - An item whose quantity exactly equals its lowStockThreshold is flagged Low in both the items table and the detail header
  - An item whose quantity is one above its threshold is not flagged Low in either place
  - Changing the low-stock rule in one location changes the flag consistently in both list and detail views

### `D-06` — Standardize HTTP status codes across server routes

- **Type:** debt · **Size:** M · **Independently implementable:** yes
- **Rationale:** Error handling is inconsistent: most routes set reply.code before returning fail(), but GET /api/auth/me returns fail('not found') with no status, yielding a 200 that carries ok:false. Normalizing status semantics forces edits across every route file plus the shared fail() helper.
- **Touch-set:** `src/server/routes/auth.ts`, `src/server/routes/items.ts`, `src/server/routes/checkouts.ts`, `src/server/routes/users.ts`, `src/shared/serialize.ts`
- **Collides with:** `D-01`, `D-03`, `D-05`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-09`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-10`, `IMP-11`, `M-01`, `M-02`, `M-03`, `M-07`, `M-09`, `UX-01`, `UX-06`
- **Acceptance criteria (behavioral — gate material):**
  - GET /api/auth/me for a token whose user no longer exists responds with HTTP 404, not 200
  - Every not-found condition across item, checkout and user routes responds with HTTP 404
  - Every invalid-payload condition responds with HTTP 400 and a non-ok envelope

### `D-07` — Unit tests for the apiFetch envelope-unwrap on the client

- **Type:** debt · **Size:** M · **Independently implementable:** yes
- **Rationale:** vitest.config.ts is node-only with include: ['tests/**/*.test.ts'], so api.ts has zero coverage. apiFetch unwraps the deliberately fragile non-discriminated ApiResult (!res.ok || !payload || payload.ok===false) and throws ApiError; any agent reshaping the envelope or the unwrap logic regresses every client call path undetected.
- **Touch-set:** `src/client/api.ts`, `vitest.config.ts`, `src/shared/types.ts`
- **Collides with:** `D-01`, `D-02`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-06`, `M-01`, `UX-01`, `UX-03`, `UX-04`
- **Acceptance criteria (behavioral — gate material):**
  - apiFetch resolves to data when the response is 200 with {ok:true,data}
  - apiFetch throws ApiError carrying the server error string when the body is {ok:false,error}
  - apiFetch throws ApiError whose status equals the HTTP status on a non-2xx response
  - apiFetch attaches an Authorization: Bearer header when a token is in storage and omits it when auth:false

---

## Migration / maintenance (10)

### `M-01` — Constrain Category, Location and Unit to their seeded vocabularies (schema/server/forms)

- **Type:** migration · **Size:** L · **Independently implementable:** yes
- **Rationale:** Category, Location and Unit are free-text z.string() fields on the create/update Zod schema and plain TextFields on both forms, while prisma/seed.ts defines fixed sets (6 categories, 6 locations, a small unit set) and Unit silently defaults to the string 'units'. Free text lets typos fragment the taxonomy and defeat grouping/filtering; promoting all three to validated controlled vocabularies (optionally sourced from the server) closes the garbage-data seam across types, the items route schema and both duplicated form copies. Merges 8 reviewer candidates.
- **Touch-set:** `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`, `src/shared/types.ts`, `src/server/routes/items.ts`, `prisma/schema.prisma`, `prisma/seed.ts`, `src/client/api.ts`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-07`, `IMP-09`, `M-06`, `M-07`, `M-08`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-03`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - POST /api/items with a category outside {Glassware,Reagents,Instruments,Consumables,PPE,Electronics} returns 400 and creates no item
  - POST /api/items with an out-of-set location or unit (e.g. 'widgets') returns 400; PATCH with an out-of-set value leaves the item unchanged
  - POST /api/items omitting unit succeeds (201) and stores unit 'units'
  - On both create and edit, Category/Location/Unit are rendered as selections limited to the seeded sets (preselected to the item's current value on edit) and cannot submit an arbitrary typed value
  - A valid selected category/location/unit is persisted and rendered in the items table

### `M-02` — Remediate jsonwebtoken 8.5.1 -> 9.x and pin the verify algorithm (reject 'none')

- **Type:** migration · **Size:** M · **Independently implementable:** yes
- **Rationale:** verifyToken calls jwt.verify with no algorithms option on jsonwebtoken 8.5.1 (a version carrying known advisories), accepting whatever the token header claims including the alg-confusion/'none' family; the secret also defaults to a known dev string. The 9.x bump is a breaking change that forces an explicit algorithm allow-list and lands directly in the auth signing/verification path. Merges the JWT-hardening debt item with the dependency-bump migration.
- **Touch-set:** `package.json`, `src/server/auth/jwt.ts`, `src/server/auth/middleware.ts`, `src/server/routes/auth.ts`
- **Collides with:** `D-01`, `D-06`, `F-04`, `F-08`, `M-03`, `M-04`, `M-05`, `M-06`, `M-07`, `M-08`, `M-10`
- **Acceptance criteria (behavioral — gate material):**
  - A token with header alg 'none' (no signature) is rejected and protected routes return 401
  - A token signed with an algorithm other than the server's configured one is rejected with 401
  - Tampering with a valid token's payload causes verification to fail (401)
  - A legitimately HS256-signed token from POST /api/auth/login still authenticates on GET /api/auth/me (200)

### `M-03` — Remediate lodash 4.17.20 prototype-pollution advisory

- **Type:** migration · **Size:** S · **Independently implementable:** yes
- **Rationale:** lodash is pinned at 4.17.20 (prototype-pollution CVEs) and is consumed in the shared serialize chokepoint via _.omit and _.orderBy; remediating forces a change in the one file every read/export path funnels through.
- **Touch-set:** `package.json`, `src/shared/serialize.ts`
- **Collides with:** `D-01`, `D-03`, `D-05`, `D-06`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-11`, `F-16`, `F-17`, `F-18`, `F-20`, `IMP-02`, `IMP-04`, `IMP-06`, `IMP-08`, `M-02`, `M-04`, `M-05`, `M-06`, `M-07`, `M-08`, `M-10`, `UX-06`
- **Acceptance criteria (behavioral — gate material):**
  - serializeUser output never contains a passwordHash or checkouts field
  - serializeItemList returns items ordered ascending by case-insensitive name
  - An item with quantity at or below its lowStockThreshold is still reported as low stock

### `M-04` — Remediate semver 6.3.0 and minimist 1.2.5 advisories

- **Type:** migration · **Size:** S · **Independently implementable:** yes
- **Rationale:** Both semver (6.3.0) and minimist (1.2.5) are pinned at advisory-bearing versions and used in real code (version-compat check and the db-reset CLI flag parser), so the bump touches code, not just the lockfile.
- **Touch-set:** `package.json`, `src/shared/version.ts`, `scripts/reset-db.ts`
- **Collides with:** `M-02`, `M-03`, `M-05`, `M-06`, `M-07`, `M-08`, `M-10`
- **Acceptance criteria (behavioral — gate material):**
  - isClientCompatible returns false for an undefined or non-semver client version
  - isClientCompatible returns true for a client version >= MIN_CLIENT_VERSION and false for a lower one
  - reset-db still resolves the default file:./dev.db database path when no --db flag is passed

### `M-05` — Upgrade TanStack Query v4 -> v5 (object-form query API)

- **Type:** migration · **Size:** M · **Independently implementable:** yes
- **Rationale:** The client is on @tanstack/react-query v4 and hooks still call invalidateQueries with the deprecated positional-array signature; v5 requires the object form and renames cacheTime to gcTime, churning every hook and the shared query client.
- **Touch-set:** `package.json`, `src/client/queryClient.ts`, `src/client/hooks/useItems.ts`, `src/client/hooks/useCheckouts.ts`, `src/client/hooks/useUsers.ts`, `src/client/main.tsx`
- **Collides with:** `F-05`, `F-06`, `F-11`, `F-12`, `F-16`, `F-18`, `F-19`, `IMP-05`, `M-02`, `M-03`, `M-04`, `M-06`, `M-07`, `M-08`, `M-10`, `UX-04`
- **Acceptance criteria (behavioral — gate material):**
  - After creating an item the items list re-renders to include it without a manual reload
  - After creating a checkout both the checkouts list and the affected item's quantity reflect the change
  - Configured retry and staleTime caching behavior is preserved (a focus event does not trigger a refetch)

### `M-06` — Upgrade MUI v5 -> v6 across all screens

- **Type:** migration · **Size:** L · **Independently implementable:** yes
- **Rationale:** @mui/material is on v5 and every container plus the app shell imports from it; the v6 major (Grid/Pagination/theme changes) forces a cross-cutting sweep through all client pages including the duplicated item form.
- **Touch-set:** `package.json`, `src/client/main.tsx`, `src/client/containers/Layout.tsx`, `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`, `src/client/containers/CheckoutsPage.tsx`, `src/client/containers/LoginPage.tsx`, `src/client/containers/UsersPage.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-09`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-09`, `M-01`, `M-02`, `M-03`, `M-04`, `M-05`, `M-07`, `M-08`, `M-10`, `UX-01`, `UX-02`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`, `UX-09`
- **Acceptance criteria (behavioral — gate material):**
  - The items page renders the item table/list and its create control without a runtime error
  - Submitting the create-item form persists a new item and it appears in the list
  - The login form submits and an authenticated user is routed past the login screen

### `M-07` — Upgrade Fastify 4 -> 5 on the server

- **Type:** migration · **Size:** L · **Independently implementable:** yes
- **Rationale:** The server runs Fastify 4 with @fastify/cors 9; the Fastify 5 major changes route/plugin and reply semantics, churning the app bootstrap, every route module, and the auth middleware that calls reply.send.
- **Touch-set:** `package.json`, `src/server/app.ts`, `src/server/index.ts`, `src/server/routes/auth.ts`, `src/server/routes/items.ts`, `src/server/routes/checkouts.ts`, `src/server/routes/users.ts`, `src/server/auth/middleware.ts`
- **Collides with:** `D-01`, `D-03`, `D-06`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-09`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-07`, `IMP-10`, `IMP-11`, `M-01`, `M-02`, `M-03`, `M-04`, `M-05`, `M-06`, `M-08`, `M-09`, `M-10`, `UX-01`
- **Acceptance criteria (behavioral — gate material):**
  - GET /api/items returns the seeded items for an authenticated request
  - An unauthenticated request to a protected route returns 401
  - POST /api/auth/login returns 401 for bad credentials and 200 with a token for valid ones

### `M-08` — Upgrade Prisma 5 -> 6 (client + schema engine)

- **Type:** migration · **Size:** M · **Independently implementable:** yes
- **Rationale:** prisma and @prisma/client are on v5; the v6 major changes client generation/engine and schema defaults, touching the schema, the shared client wrapper, and every query module that reads/writes through it.
- **Touch-set:** `package.json`, `prisma/schema.prisma`, `src/server/prisma.ts`, `src/server/queries/items.ts`, `src/server/queries/checkouts.ts`
- **Collides with:** `D-03`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-11`, `F-16`, `F-17`, `F-18`, `F-20`, `F-21`, `IMP-06`, `M-01`, `M-02`, `M-03`, `M-04`, `M-05`, `M-06`, `M-07`, `M-09`, `M-10`
- **Acceptance criteria (behavioral — gate material):**
  - The items query returns the full set of seeded items after db push and seed
  - Creating a checkout decrements the source item's available quantity
  - Returning a checkout restores the previously checked-out quantity

### `M-09` — Characterization tests pinning the Category/Location/Unit validation contract

- **Type:** migration · **Size:** M · **Independently implementable:** yes
- **Rationale:** Category/Location/Unit are free-text z.string().min(1) though seed.ts defines finite sets; the create test only uses valid seeded values and the invalid-payload test trips on name/quantity, so nothing pins whether an arbitrary category is accepted. A migration to enums (M-01) would silently change the contract with no failing test.
- **Touch-set:** `tests/server/items.test.ts`, `src/server/routes/items.ts`, `prisma/schema.prisma`
- **Collides with:** `D-01`, `D-03`, `D-06`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-07`, `M-01`, `M-07`, `M-08`, `UX-01`
- **Acceptance criteria (behavioral — gate material):**
  - POST /api/items with a category outside the 6 seeded categories returns 400
  - POST /api/items with a location outside the 6 seeded locations returns 400
  - POST /api/items with a valid seeded category and location returns 201
  - POST /api/items omitting unit returns 201 with unit equal to 'units'

### `M-10` — Upgrade React Router v6 -> v7 (route objects + data APIs)

- **Type:** migration · **Size:** M · **Independently implementable:** yes
- **Rationale:** The client is pinned on React Router v6 (v7 exists); every route definition, the router setup, and the nav shell import from react-router-dom, so the v7 major (route objects, data router, import-path changes) churns routing across the app. Paired with M-05 (TanStack Query v4->v5) this is the canonical framework-major-upgrade slice (S5). Added by hand to close the backlog gap noted in ../levels.md.
- **Touch-set:** `package.json`, `src/client/main.tsx`, `src/client/routes.tsx`, `src/client/containers/Layout.tsx`, `src/client/containers/LoginPage.tsx`, `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-09`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-21`, `F-22`, `IMP-01`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-09`, `M-01`, `M-02`, `M-03`, `M-04`, `M-05`, `M-06`, `M-07`, `M-08`, `UX-01`, `UX-02`, `UX-03`, `UX-05`, `UX-06`, `UX-07`, `UX-08`, `UX-09`
- **Acceptance criteria (behavioral — gate material):**
  - After login the app routes to the items list and the URL reflects the active route
  - Navigating to /items/<id> renders that item's detail via the route param
  - The nav links (Items/Checkouts/Users) navigate without a full page reload and mark the active route
  - No react-router-dom v6-only API remains; the app builds and runs on v7

---

## Improvements (11)

### `IMP-01` — Barcode format and uniqueness validation

- **Type:** improvement · **Size:** M · **Independently implementable:** yes
- **Rationale:** Barcode is a free-text field with no format check, yet seeded barcodes follow a fixed 'LARD-NN-CAT' pattern and schema.prisma declares barcode @unique. Submitting a duplicate barcode currently surfaces as an unhandled Prisma error rather than a clean validation message, and any string is accepted.
- **Touch-set:** `src/server/routes/items.ts`, `src/client/containers/ItemDetailPage.tsx`, `src/client/containers/ItemsPage.tsx`, `src/shared/types.ts`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-02`, `IMP-04`, `IMP-05`, `IMP-06`, `IMP-07`, `IMP-09`, `M-01`, `M-06`, `M-07`, `M-09`, `M-10`, `UX-01`, `UX-02`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Submitting a barcode that does not match the expected LARD-NN-XXX format is rejected with a 4xx and a human-readable message, and no item is created/updated
  - Creating an item with a barcode already used by another item is rejected with a 4xx message rather than a 5xx/unhandled error
  - A barcode left blank is accepted and stored as null
  - A correctly formatted, unique barcode is accepted and persisted

### `IMP-02` — Structured validation errors and a global error handler

- **Type:** improvement · **Size:** M · **Independently implementable:** yes
- **Rationale:** On Zod failure routes return a flat fail('invalid item payload') with no field detail, and app.ts registers no error handler, so an unexpected throw escapes the ApiResult envelope instead of becoming a shaped 500.
- **Touch-set:** `src/server/routes/items.ts`, `src/server/routes/checkouts.ts`, `src/server/app.ts`, `src/shared/serialize.ts`, `src/shared/types.ts`
- **Collides with:** `D-01`, `D-03`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-08`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-04`, `IMP-06`, `IMP-07`, `IMP-08`, `IMP-10`, `M-01`, `M-03`, `M-07`, `M-09`, `UX-01`, `UX-04`, `UX-06`
- **Acceptance criteria (behavioral — gate material):**
  - POST /api/items with a missing name returns 400 and the body identifies 'name' as the offending field
  - POST /api/items with a negative quantity returns 400 naming 'quantity'
  - A request that triggers an unhandled server error returns a 500 whose body is a fail-shaped envelope (ok:false with an error string), not a raw stack or dropped connection
  - A valid POST /api/items still returns 201 with the created item

### `IMP-03` — Validate the stored session against /api/auth/me on load

- **Type:** improvement · **Size:** M · **Independently implementable:** yes
- **Rationale:** AuthProvider trusts the localStorage blob verbatim and never verifies the token; a tampered or expired token leaves the app believing it is logged in until a request happens to fail. getMe exists but is unused.
- **Touch-set:** `src/client/lib/auth-context.tsx`, `src/client/api.ts`
- **Collides with:** `D-01`, `D-02`, `D-07`, `F-01`, `F-02`, `F-03`, `F-05`, `F-06`, `F-07`, `F-10`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `M-01`, `UX-01`, `UX-02`, `UX-03`, `UX-04`
- **Acceptance criteria (behavioral — gate material):**
  - On app load with an invalid or expired stored token, the user ends up logged out (redirected to /login)
  - On app load with a valid stored token, the user stays authenticated and the current user is reflected in the UI
  - The displayed user identity after load reflects the server response, not just the cached localStorage copy

### `IMP-04` — Locale-aware, consistent date and number formatting

- **Type:** improvement · **Size:** M · **Independently implementable:** yes
- **Rationale:** Dates are rendered three different ways: serialize.formatDate emits raw ISO-8601, CheckoutsPage has its own formatDate using toLocaleString, and ItemDetail prints quantities with no grouping. There is no shared, locale-aware Intl-based formatter.
- **Touch-set:** `src/shared/serialize.ts`, `src/client/containers/CheckoutsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-11`, `F-16`, `F-17`, `F-18`, `F-20`, `IMP-01`, `IMP-02`, `IMP-05`, `IMP-06`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-04`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - Timestamps in the Checkouts table render as human-readable localized date/time, not raw ISO-8601
  - A null/absent returned-date renders as a stable placeholder rather than empty or 'Invalid Date'
  - Numeric quantities render through a locale number formatter so a 4+ digit quantity includes the locale's grouping separator
  - The same date value renders identically wherever it appears across pages

### `IMP-05` — Seed the item-detail query cache from the list to avoid a blocking refetch

- **Type:** improvement · **Size:** S · **Independently implementable:** yes
- **Rationale:** Clicking a row navigates to ItemDetailPage, whose useItem(id) fires a fresh GET /api/items/:id and shows a spinner even though useItems already holds that exact item in the ['items'] cache. The detail fetch is redundant on the happy path.
- **Touch-set:** `src/client/hooks/useItems.ts`, `src/client/containers/ItemDetailPage.tsx`, `src/client/queryClient.ts`
- **Collides with:** `D-02`, `D-05`, `F-01`, `F-05`, `F-06`, `F-12`, `F-16`, `F-18`, `F-19`, `IMP-01`, `IMP-04`, `IMP-06`, `IMP-09`, `M-01`, `M-05`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-06`, `UX-07`
- **Acceptance criteria (behavioral — gate material):**
  - Navigating from the items list to an item's detail page renders its name and quantity immediately without showing the loading spinner
  - Opening an item detail by direct URL (cold cache, no prior list) still loads the item correctly
  - Edits saved on the detail page remain reflected after the underlying item query refreshes

### `IMP-06` — Trim over-fetched columns from the items list payload

- **Type:** improvement · **Size:** S · **Independently implementable:** yes
- **Rationale:** The list endpoint serializes full items including notes (free-text, potentially large) and barcode that ItemsPage never displays, inflating every list response. Because serializeItem is shared by list and detail, slimming the list without breaking detail forces splitting the shared serializer.
- **Touch-set:** `src/server/queries/items.ts`, `src/shared/serialize.ts`, `src/shared/types.ts`, `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`
- **Collides with:** `D-01`, `D-02`, `D-03`, `D-04`, `D-05`, `D-06`, `D-07`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-10`, `F-11`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `F-22`, `IMP-01`, `IMP-02`, `IMP-04`, `IMP-05`, `IMP-08`, `IMP-09`, `M-01`, `M-03`, `M-06`, `M-08`, `M-10`, `UX-01`, `UX-02`, `UX-04`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - GET /api/items list entries no longer include the notes field
  - GET /api/items/:id still returns the item's notes value
  - ItemsPage still renders name, category, location, quantity, unit and low/OK status for each row
  - ItemDetailPage still displays the item's saved notes

### `IMP-07` — Role-authorization matrix tests for item and checkout mutations

- **Type:** improvement · **Size:** M · **Independently implementable:** yes
- **Rationale:** Item/checkout/user routes are gated by authenticate only (the comment in items.ts even flags the intentional authz gap), yet every mutation test uses the member token. No test exercises viewer or admin against POST/PATCH/DELETE, so an agent adding or removing a role check ships a silent regression.
- **Touch-set:** `tests/server/items.test.ts`, `tests/server/checkouts.test.ts`, `src/server/routes/items.ts`, `src/server/routes/checkouts.ts`, `tests/helpers.ts`
- **Collides with:** `D-01`, `D-03`, `D-06`, `F-01`, `F-02`, `F-03`, `F-05`, `F-06`, `F-07`, `F-08`, `F-11`, `F-16`, `F-17`, `F-18`, `F-19`, `F-20`, `F-21`, `IMP-01`, `IMP-02`, `IMP-10`, `IMP-11`, `M-01`, `M-07`, `M-09`, `UX-01`
- **Acceptance criteria (behavioral — gate material):**
  - A viewer-token POST /api/items returns 403
  - A viewer-token PATCH and DELETE /api/items/:id each return 403; a viewer-token POST /api/checkouts returns 403
  - A member-token and admin-token POST /api/items still return 201
  - An unauthenticated POST /api/items still returns 401

### `IMP-08` — Cover serializeItemList sorting, serializeCheckout and the ok/fail helpers

- **Type:** improvement · **Size:** S · **Independently implementable:** yes
- **Rationale:** serialize.test.ts covers serializeUser, serializeItem, isLowStock and formatDate, but the chokepoint's sort path (serializeItemList case-insensitive name order), serializeCheckout (returnedAt null-vs-ISO) and the ok()/fail() envelope helpers are untested. serialize.ts is the documented collision magnet.
- **Touch-set:** `tests/server/serialize.test.ts`, `src/shared/serialize.ts`
- **Collides with:** `D-01`, `D-03`, `D-05`, `D-06`, `F-01`, `F-02`, `F-03`, `F-04`, `F-05`, `F-06`, `F-07`, `F-11`, `F-16`, `F-17`, `F-18`, `F-20`, `IMP-02`, `IMP-04`, `IMP-06`, `M-03`, `UX-06`
- **Acceptance criteria (behavioral — gate material):**
  - serializeItemList returns items ordered case-insensitively ascending by name
  - serializeCheckout maps a null returnedAt to null and a Date returnedAt to an ISO-8601 string
  - ok(x) returns {ok:true,data:x} and fail(m) returns {ok:false,error:m}
  - serializeUser omits passwordHash and a checkouts relation when present on the input

### `IMP-09` — End-to-end coverage for create, edit and checkout flows

- **Type:** improvement · **Size:** L · **Independently implementable:** yes
- **Rationale:** e2e/larder.spec.ts is a single login-and-render smoke; its own comment says the bulk of behaviour is covered by Vitest. The item form is duplicated across ItemsPage and ItemDetailPage with no shared component, so an agent editing one form (or extracting a shared one) can break create or edit in the browser with no e2e to catch it.
- **Touch-set:** `e2e/larder.spec.ts`, `src/client/containers/ItemsPage.tsx`, `src/client/containers/ItemDetailPage.tsx`
- **Collides with:** `D-02`, `D-04`, `D-05`, `F-01`, `F-03`, `F-05`, `F-06`, `F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-19`, `F-21`, `F-22`, `IMP-01`, `IMP-04`, `IMP-05`, `IMP-06`, `M-01`, `M-06`, `M-10`, `UX-01`, `UX-02`, `UX-05`, `UX-06`, `UX-07`, `UX-08`
- **Acceptance criteria (behavioral — gate material):**
  - A logged-in member creates an item through the create form and then sees that item's name in the register list
  - Editing that item's quantity on its detail page persists and the new value is shown after reload
  - Checking out an item via the UI decrements the displayed quantity for that item

### `IMP-10` — Checkout endpoint edge-case coverage (double-return, missing resource, bad quantity)

- **Type:** improvement · **Size:** S · **Independently implementable:** yes
- **Rationale:** checkouts.test.ts covers the happy path plus a single over-stock 409, but the route also returns 404 for a missing item, 404 for a missing checkout, 409 for an already-returned checkout and 400 for a non-positive quantity, all untested. Any agent reworking the checkout transaction can drop a guard silently.
- **Touch-set:** `tests/server/checkouts.test.ts`, `src/server/routes/checkouts.ts`
- **Collides with:** `D-01`, `D-06`, `F-08`, `F-11`, `F-20`, `IMP-02`, `IMP-07`, `M-07`
- **Acceptance criteria (behavioral — gate material):**
  - POST /api/checkouts for a non-existent itemId returns 404
  - POST /api/checkouts with quantity 0 or negative returns 400
  - POST /api/checkouts/:id/return on an already-returned checkout returns 409 and does not further change item quantity
  - POST /api/checkouts/:id/return for a non-existent checkout id returns 404

### `IMP-11` — Coverage for GET /api/users directory exposure and password redaction

- **Type:** improvement · **Size:** S · **Independently implementable:** yes
- **Rationale:** GET /api/users has no test at all and is gated by authenticate only, exposing the full directory to any logged-in role; serializeUser redaction on the list path is unverified. An agent adding admin-only listing or a user field could leak passwordHash or change access with nothing to catch it.
- **Touch-set:** `src/server/routes/users.ts`, `tests/server/auth.test.ts`, `tests/helpers.ts`
- **Collides with:** `D-06`, `F-04`, `F-08`, `F-09`, `F-10`, `IMP-07`, `M-07`
- **Acceptance criteria (behavioral — gate material):**
  - GET /api/users without a token returns 401
  - GET /api/users with a valid token returns the 4 seeded users
  - No object in the GET /api/users response contains a passwordHash property
  - The returned users are ordered ascending by name

---
