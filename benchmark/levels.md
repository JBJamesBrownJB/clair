# Levels — how much work a run targets

A **level** sets the *workload size* of a run (the third axis, alongside arm and topology — see
[`README.md`](README.md)). Each level is a set of **slices**; **one agent per slice** (1:1), so the
agent count is the slice count. Each slice maps to one or more [backlog](backlog/backlog.md) IDs.

The slices `S1–S5` match the five canonical slices already specified and **already built into
`arena/reference`** (the held-out gold solution + 35-assertion gate) — see
[`../docs/architecture/benchmark-arena-ts.md`](../docs/architecture/benchmark-arena-ts.md). So **L1
and L2 are runnable today** against the existing reference. **L3 is a saturation tier that requires
extending the reference + gate** (a larger build, out of the current design+backlog effort's scope).

## L1 · Standard — 3 agents

The three vertical feature slices. The calibration / problem-in-vivo batch (mechanical merge, no
resolver). **Runnable against `arena/reference` today.**

| Slice | Title | Backlog IDs | Primary collision |
|-------|-------|-------------|--------------------|
| **S1** | Authz hardening + role-management | `F-08`, `F-10`, `F-09` | substrate mutator — gates every mutation route + FE shell (the collision generator) |
| **S2** | Saved views: multi-field search + filter | `F-06`, `F-07`, `F-12`, `F-13`, `F-15` | shared list API + `serialize.ts` + router |
| **S3** | Export (CSV + JSON) | `F-17` | duplication vs S2 (both extend list/serialization) |

The headline instrument lives here: S2/S3 add endpoints **blind to S1's authz** → unprotected on a
clean merge (the silent security gap).

## L2 · Migration-concurrent — 5 agents

L1 **plus** the two maintenance slices. The flagship — maximal cross-cutting churn while features
land underneath. **Runnable against `arena/reference` today.**

| Slice | Title | Backlog IDs | Primary collision |
|-------|-------|-------------|--------------------|
| S1–S3 | _(as L1)_ | | |
| **S4** | Dependabot remediation batch | `M-02`, `M-03`, `M-04` | dependency-graph + semantic — bumped lib APIs change under other agents |
| **S5** | Framework major upgrade | `M-05`, `M-10` | breaking-API skew vs S1–S3; divergent-arch vs S1 (both restructure routing) |

> **S5 scope:** the canonical upgrade is *Router v6→v7 **and** TanStack Query v4→v5* — now mapped by
> `M-10` (Router) + `M-05` (Query). The other migration items `M-06`/`M-07`/`M-08` (MUI/Fastify/Prisma)
> are extra migration ammo for L3, **not** part of the canonical S5.

> **Honesty caveat (inherited):** S4/S5 rewrite the lockfile → textual-conflict rate ≈100% in both
> arms and is **intentionally ignored**; value is read from rework tokens, cost-to-all-pass, the
> `tsc`/build gate, and the semantic gate.

## L3 · Saturation — 5 + N agents  *(requires extended reference — future)*

L2 **plus** a batch of additional slices drawn from the bank, to drive collision density to the max.
Slice membership is **configurable per run**; the recommended starter batch favours the
highest-collision items that share the known chokepoints:

| Slice | Title | Backlog IDs | Why in the batch |
|-------|-------|-------------|------------------|
| **S6** | Controlled vocabularies (Category/Location/Unit dropdowns) | `M-01` | the originating gripe; hits `types.ts` + `routes/items.ts` + both form copies |
| **S7** | Soft-delete + restore | `F-01` | top collision item; schema + serialize + both pages |
| **S8** | Item change-history / audit log | `F-16` | new projection over the shared substrate |
| **S9** | Pagination + total count | `F-05` | shared list API + serialize chokepoint |
| **S10** | Item authorship (createdBy/updatedBy) | `F-02` | schema + author pipeline (divergent-arch vs S1) |
| **S11** | Checkouts enrichment + filtering | `F-11` | shared serialize + types + checkouts route |
| **S12** | Shared `ItemForm` + create/edit parity | `D-02` | forces the duplicated-form chokepoint |
| **S13** | `ApiResult<T>` discriminated union | `D-01` | the fragile shared type every path unwraps |
| **S14** | Inline form validation | `UX-01` | the duplicated form + numeric constraints |

That's a 14-agent run. Drop or add slices to dial intensity. **Everything an L3 run targets must
first exist in an extended `arena/reference` (≥ v2) with gate assertions** — building that is the
next plan after this backlog is settled. Until then, L3 run-configs are marked `status: future`.

## Composition rules

- **One agent per slice**, information-asymmetric (each agent sees only its own slice spec).
- A slice's backlog IDs define its spec and its slice of the hidden gate.
- Don't put two slices that own the *same* backlog ID in one run (double-assignment).
- Agent count = slice count. Scale a level by adding/removing slices, not by resizing slices.
