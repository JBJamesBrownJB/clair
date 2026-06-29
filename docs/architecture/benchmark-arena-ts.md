# clair — Benchmark Arena: a purpose-built TypeScript arena (with maintenance slices)

> **Status: draft for review.** A **second, greenfield instantiation** of the
> [value benchmark](value-benchmark.md), built to replace
> [`system-register`](benchmark-arena.md) as the primary arena. Same methodology, different
> fixture: a **purpose-built, decontaminated-by-construction TypeScript/React app** on an
> agent-friendly stack, whose 5 slices include two **maintenance slices** — a **Dependabot
> remediation batch** and a **framework major-version upgrade**. The *methodology* lives in
> [value-benchmark.md](value-benchmark.md); this is *where it runs* and *why this fixture*.

> **New to the terms?** *Arm, slice, semantic vs textual conflict, shared substrate, the hidden
> gate* — all in plain English in the
> [glossary at the top of value-benchmark.md](value-benchmark.md#plain-english-glossary-read-this-first).

## Why a new arena (and why this shape)

`system-register` wins the two **validity axes** outright — *decontaminated* (private, not in
training data) and *team-owned* (the hidden gate is authorable). It loses on two things the
[arena doc](benchmark-arena.md) itself flags and the build-environment recon confirmed:

1. **Agent-competence / readable signal.** Java/Quarkus is a harder stack for agents → *"lower
   absolute success and more variance… if everything fails, signal is hard to read."* The whole
   benchmark output is a **B−A delta**; if Arm A can't ship features reliably, there's no signal
   to measure.
2. **Revive + run tax.** Before trial one: Quarkus 1.7→3, `javax`→`jakarta`, MUI v4→v5, CRA→Vite,
   Keycloak re-export — plus JDK-21 tooling breakage, a Docker daemon requirement, and
   testcontainers pulling images from a registry the build env blocks. Expensive to even stand up,
   every trial.

This arena keeps **both validity axes** (we author it fresh and hold it private) while fixing the
ergonomics: an **all-TypeScript stack** (highest agent baseline success → readable signal), **green
from day one** (no revive), and **zero external services at run time** (SQLite in-process → a trial
container is `pnpm i && pnpm test`, no Docker-Hub pull).

### The bonus: TypeScript makes the headline failure cheaper to detect

clair's reason to exist is the **semantic conflict** — code merges clean, app is silently broken.
On the JVM arena that only surfaces at test run (needs Docker). Here, **`tsc --noEmit` is a free,
deterministic semantic-conflict detector**: the most common multi-agent failure this arena induces
— a feature written against an *old* API after another agent upgraded it (version skew) — usually
surfaces as a **type error**, caught in seconds with no model and no container. The arena's design
turns the headline metric into something the typechecker can partly adjudicate. That is a real
reason this fixture is *better* for measuring clair, not merely cheaper.

## The app

An invented, decontaminated internal-tools domain — **deliberately not a blog/Conduit shape and not
a reskin of `system-register`**. Working name **`Larder`**: an internal **lab equipment &
consumables register** — *"what kit do we have, where is it, who has it checked out, what's running
low."* Boring CRUD-with-auth with a rich core aggregate, which is exactly the realistic **shared
substrate** the value benchmark wants.

- **Frontend:** React 18 · TypeScript · **Vite** · **React Router v6** · **TanStack Query v4** ·
  a thin MUI v5 shell.
- **Backend:** Node · TypeScript · **Fastify** · **Prisma** ORM · **SQLite** · **Zod** validation.
- **Auth:** JWT sessions, roles `admin | member | viewer`. *Author is authenticated*, unlike
  system-register's client-supplied author — but authz on mutations is **deliberately incomplete**
  (the collision gift, below).
- **Migrations:** Prisma Migrate — real migration files are part of the contended substrate.
- **Tests:** **Vitest** (unit/integration) + **Playwright** (e2e). Coverage **good-but-incomplete**
  by design: breakage is detectable, regressions can still ship.
- **Tooling:** **pnpm** (one lockfile = a shared collision surface), shared `tsconfig`, ESLint.

> **Decontamination is a process, not a property.** Author fresh; invented domain + unusual naming;
> **never push to a public index** before/around benchmarking; hold the repo **private** and treat
> the whole arena like `reference` — held out. Contamination silently biases Arm A *upward* and
> masks clair's value, so this discipline is load-bearing, not hygiene.

## Curated debt — fixed across all runs (and it's where two slices come from)

The value benchmark calls for **deliberate, commonly-found, fixed** tech debt that funnels agents
through the *same* files to amplify collisions. Here the debt does double duty — it also **creates
the maintenance slices**:

| Debt (intentional, frozen) | Why it's there |
|---|---|
| **Key libs pinned one major behind** — React Router **v6** (v7 exists), TanStack Query **v4** (v5 exists) | the raw material for **Slice 5** (framework upgrade); breaking-change ripples into every page/hook |
| **3–4 known-vulnerable dependency versions** (real OSV/GitHub advisories — e.g. an old `jsonwebtoken`, a transitive `semver`/`tar`/`ws` advisory) | the raw material for **Slice 4** (Dependabot remediation); bumps touch the lockfile + real code |
| **A serialization god-file** `src/shared/serialize.ts` every read/export path must edit | the `DtoMapper` analog — a shared chokepoint that forces duplication/divergence |
| **Inconsistent error handling + one fragile shared type** (`ApiResult<T>`) | invites copy-paste and incompatible assumptions across slices |

Pinning real libs one major behind and seeding real advisories means the maintenance slices are
**grounded in real breaking changes**, not synthetic busywork — the CooperBench "anchor from a real
change + plausible adjacent work" method, applied to maintenance.

## The 5 slices (3 vertical features + 2 maintenance)

Each is **independently implementable** on the base (passes its own tests solo) yet **contends on
the shared substrate** when run in parallel + blind (information asymmetry: each agent sees only its
own spec).

| # | Slice | Kind | Real touch-points | Primary collision |
|---|-------|------|-------------------|--------------------|
| 1 | **Authz hardening + role-management admin page** | vertical | gate every mutation route by role; identity→author; new role endpoints; FE route guards + admin page | **substrate mutator** — restructures the request pipeline + frontend shell (the collision generator) |
| 2 | **Saved views: multi-field search + filter** | vertical | query layer over the read model; shared list API; shared filter component; routing | textual+semantic vs all (shared list API, router, `ApiResult`) |
| 3 | **Export (CSV + JSON)** | vertical | new endpoint(s) through the **`serialize.ts` god-file**; download UI | **duplication vs #2** (both extend list/serialization) |
| 4 | **Dependabot remediation batch** | **maintenance** | apply ~4 security/patch/minor **bumps** (the seeded advisories); fix resulting breakage across server + client; update **lockfile** | **dependency-graph + semantic** — bumped lib APIs change under code other agents are writing |
| 5 | **Framework major upgrade** | **maintenance** | **React Router v6→v7** + **TanStack Query v4→v5**; migrate every route definition + every data hook; update **lockfile** | **breaking-API skew vs #1–#3** + **divergent-arch vs #1** (both restructure routing) |

### How they collide — mapped to the proven failure modes

- **#5 (and #4) vs #1–#3 → version-skew semantic conflict (the headline instrument).** The upgrade
  agent changes the Router/Query API; the feature agents, blind to it, write new routes and hooks
  against the **v6/v4** API. Git merges clean; the app breaks (or `tsc` fails). This is *the* silent
  semantic conflict clair exists to surface — here generated by the single most common real-world
  multi-agent maintenance scenario: **someone upgrades the framework while others build on it.**
- **#4 vs #5 → un-co-resolvable dependency graph.** Two agents both editing `package.json` +
  lockfile toward **incompatible target versions** (a security bump that pins a range the major
  upgrade moves past) → the classic "two bumps that don't co-resolve" — a semantic lockfile
  conflict, not just a textual one.
- **#1 vs #5 → divergent-architecture (CooperBench 30%).** Both restructure routing (auth guards vs
  the v7 route objects) with incompatible designs that clean-merge into incoherence.
- **#2 vs #3 → work-overlap/duplication (CooperBench 33%).** Both extend the list/serialization path
  through `serialize.ts` → duplicated aggregation, divergent shapes.
- **The silent security gap.** #2–#5 add/restructure endpoints **blind to #1's authz** → unprotected
  on merge. A clean merge that's silently insecure — the failure isolation can't catch.

> **Honesty caveat (inherited from the migration-concurrent flagship).** Slices 4 & 5 rewrite the
> lockfile, so **raw textual-conflict rate is ≈100% in both arms and is intentionally ignored
> here.** Value is read from **rework tokens, cost-to-all-pass, the typecheck/build gate, and the
> semantic acceptance suite** — never conflict count. These two slices live in the **churn /
> migration-concurrent family**; keep that framing or the numbers lie.

## Shared substrate — the contention map

| Layer | Real files | Why it's contended |
|-------|-----------|--------------------|
| **Domain model** | `prisma/schema.prisma`, `src/shared/types.ts` (`Item`, `CheckoutRecord`, `User`, `ApiResult<T>`) | any feature adding a field/behaviour mutates the core model + migrations |
| **API routes** | `src/server/routes/*`, `src/server/auth/*` | new behaviour = new route in shared packages; #1 gates them all |
| **Serialization** | `src/shared/serialize.ts` (god-file) | every read/export path funnels here — the chokepoint |
| **Read/query layer** | `src/server/queries/*` | #2 and #3 both build queries/projections here |
| **Frontend shell** | `src/client/api.ts` (shared client), `src/client/routes.tsx`, hooks, `containers` | every feature wires a page + data hook; **#5 rewrites routing + every hook** |
| **Dependency graph** | `package.json`, `pnpm-lock.yaml`, `tsconfig.json` | **#4 and #5 both edit it** — the maintenance-slice collision surface |

## Seed data

A **fixed, deterministic** seed (no wall-clock, no RNG) loaded before every run — e.g. ~40 items
across categories/locations, a handful of users per role, a known checkout-event history. Triple
duty, exactly as in the system-register arena: visualisations/lists render real data; the hidden
gate asserts against known values ("export contains 40 rows", "search `microscope` returns 3");
identical starting state every trial. Seed is **arena prep**, never agent-generated.

## The hidden acceptance gate (held out)

A held-out suite the slice agents never see, run by the harness after integration. Behavioral, never
structural (per the value-benchmark guardrail — test *behavior*, not "matches reference's classes").

- **Per-slice behavioral** (against seed): #1 every mutation requires the right role; #2 search/filter
  returns seeded results; #3 export reflects seed rows/shape; **#4** — `pnpm audit` / OSV scan shows
  **zero of the seeded advisories remain**; **#5** — **no v6/v4 API remains** (grep gate + e2e) and
  the app builds/runs on the new majors.
- **Cross-feature / semantic** (the instrument): **every new endpoint is authz-gated** (the silent
  security gap); **features authored during the upgrade run on the upgraded framework** (the
  version-skew instrument — the combination, not the parts); export/search agree with auth visibility.
- **Cheap deterministic floors:** **`tsc --noEmit` clean** + **`pnpm build` clean** as first-class
  gate steps — they catch a large share of version-skew semantics for ~free.
- **Regression:** the existing visible suite still green.

Scoring stays per-feature pass + an all-pass gate, budget-capped, non-completers counted as failures
— unchanged from [value-benchmark.md](value-benchmark.md).

## Branches, tags & build order

Mirrors the arena layout (external repo, pinned by annotated tag → immutable SHA; cloned fresh per
trial). The **migration-concurrent flagship is native here** — slices 4 & 5 *are* migrations — so no
separate `legacy` branch is needed; the standard and flagship scenarios differ only in which slices
run.

1. **Author the base** — `Larder` green on the modern-minus-one stack, with the curated debt (libs
   one major behind, seeded advisories, god-file), the seed data, and the *visible* test suite.
   Tag **`arena-base-v1`**.
2. **Build `reference`** — base + all 5 slices integrated (upgrades applied, deps remediated, 3
   features added) + the hidden gate passing. Tag **`arena-reference-v1`**. Held out from agents.

`reference` earns its keep the usual three ways: proves a coherent all-5 solution exists (failures
are attributable to *coordination*, not impossibility); is the source of the hidden gate + seed
expected-values; and is a "built-as-intended" quality oracle.

## Why this beats `system-register` for our purpose

| Axis | `system-register` | `Larder` (this arena) |
|---|---|---|
| Decontaminated | ✅ private | ✅ authored fresh, held private |
| Team-owned (gate authorable) | ✅ | ✅ (we author it) |
| Agent baseline success (readable signal) | ⚠️ Java/Quarkus — flagged low/variance | ✅ all-TypeScript |
| Revive tax before trial 1 | ❌ large (1.7→3, javax→jakarta, MUI, CRA, Keycloak) | ✅ none — green by construction |
| Run cost per trial | ❌ Docker + blocked image pulls | ✅ SQLite in-process, `pnpm test` |
| Semantic-conflict detection | test-run only (needs Docker) | ✅ also `tsc`/build — cheap & deterministic |
| Maintenance-collision realism | side "migration agent" only | ✅ **first-class slices 4 & 5** |

## Open questions

1. **Upgrade target choice** — Router **and** Query (two skews, richer) vs one (cleaner attribution).
   Likely both, with a single-lib ablation to isolate.
2. **Dependabot batch size** — how many seeded advisories (3–4?) maximizes collision without making
   #4 dominate the others' effort.
3. **`tsc` as gate vs as metric** — counting it as a hard floor may over-credit TS; consider also
   reporting "passed types but failed e2e" as the pure-semantic residue.
4. **Slice balance** — #1 and #5 are heavier than #2–#4; rebalance or accept (real work varies).
5. **Do we still want a Postgres variant** for realism, accepting the Docker cost on a nightly lane?
6. **Standard vs flagship split** — run #1–#3 as the "standard" scenario and add #4–#5 for the
   "migration-concurrent flagship", or always run all five? (Affects how the textual-conflict caveat
   is applied.)
