# clair — Benchmark Arena: system-register

> **Status: draft for review.** The **concrete instantiation** of the
> [value benchmark](value-benchmark.md) against a real app: `system-register`. Defines the
> arena, the shared-substrate collision map, the 5 slice features grounded in real files, the
> deterministic seed data, and the hidden acceptance gate. The *methodology* lives in
> value-benchmark.md; this is *where it runs*.

## The app

[`JBJamesBrownJB/system-register`](https://github.com/JBJamesBrownJB/system-register) — a UK
Home Office internal **systems & risk registry** ("what systems exist, where's the risk, who
owns them"). Picked because it wins the two validity axes outright: **decontaminated** (private
team app, not in training data → measures capability, not recall) and **team-owned** (the hidden
gold-standard suite can actually be authored).

- **Stack:** Quarkus (Java 11) backend · React (CRA) frontend · Docker/compose. **Event-sourced
  CQRS.**
- **Domain:** `SR_System` (rich: criticality, portfolio, public-facing, sunset, ~7 owner roles,
  aliases), `SR_Risk`, `SR_Person`, aggregated in `SystemRegister`; ~20 commands
  (`AddSystemCommand`, `Update*Command`) → events → handlers → versioned event-store DAOs
  (`io/database/dao/v1`,`v2`).
- **Tests:** **163 backend test files** (TDD) + `TestDataUtil` helper; frontend tests too.
- **Already present (shapes the design):** an **`author` concept** on commands (`AuthorMapper`)
  → events natively record who-did-what-when (**audit log is native**); **Keycloak** in the
  compose (`compose/importdata/keycloak-export.json`) → **auth infra is partly scaffolded** (wire
  OIDC, don't greenfield); a `compose/importdata` seed mechanism.
- **The gift:** auth/authz is genuinely missing app behaviour (the `author` appears
  client-supplied, not authenticated) — and auth is the most cross-cutting thing there is, so it
  is the natural collision generator.

> **Watch-item:** Java/Quarkus is a slightly harder stack for agents than TS/Node → expect lower
> absolute success and more variance. It hits every arm equally (the A−B delta stays valid), but
> monitor early runs; if everything fails, signal is hard to read.

## Shared substrate — the contention map

Every slice must cut through these shared layers; that overlap *is* the collision surface:

| Layer | Real files | Why it's contended |
|-------|-----------|--------------------|
| **Domain aggregate** | `domain/SR_System`, `SystemData`, `SystemRegister`, `SR_Risk`, `SR_Person` | any feature adding a field/behaviour mutates the core model |
| **Command/event pipeline** | `messaging/commands/*`, `events/*`, `commandhandlers/*`, `eventhandlers/*` | new behaviour = new command+event+handler in shared packages |
| **API + DTO mapping** | `io/api/*Resource`, `io/api/dto/*`, `DtoMapper`, `AuthorMapper` | every feature adds endpoints/DTOs; `DtoMapper` is a shared chokepoint |
| **Event-store DAOs** | `io/database/dao/v1`,`v2`, `mappers` | schema/projection changes touch shared persistence |
| **Read-model / projections** | `application/eventsourcing/calculators` | both visualisations build projections here → duplication |
| **Frontend shell** | `frontend/src/services` (API client), `containers`, routing, `data`, `hooks` | every feature wires a page + API call into the shared shell |

## Seed data (your point — essential)

A **fixed, deterministic seed dataset** loaded before every run — extend the existing
`TestDataUtil` + `compose/importdata` into a known event stream (e.g. ~30 systems with realistic
risks, owners, criticalities). It does triple duty:

1. **Visualisations render real data**, not an empty screen.
2. **The hidden acceptance tests assert against known values** (e.g. "the heatmap shows N
   high-criticality systems").
3. **Reproducibility** — identical starting state every trial.

Same seed every run; it is part of arena prep, not something agents generate.

## The 5 slice features (grounded, full-stack, overlapping by design)

Each is **independently implementable on the current app** (passes its own tests solo) yet
**contends on the shared substrate** when run in parallel + blind.

| # | Slice | Real touch-points | Primary collision |
|---|-------|-------------------|-------------------|
| 1 | **Authn + authz + role-management page** | wire **Keycloak/OIDC**; map identity → `AuthorMapper`/author; gate `commandhandlers` by role; new role command/event/aggregate slice; API; frontend route guards + admin page | **substrate mutator** — restructures the request pipeline, author, command gating, frontend shell |
| 2 | **Per-system history / timeline view** | new projection over the **existing event stream** + API + a system-detail timeline page | divergent-architecture vs #1 (both read/extend the event+author pipeline) |
| 3 | **Risk heatmap dashboard** | new **calculator/projection** over `SR_Risk`×systems + aggregation API + dashboard page + charting | **duplication vs #4** (both add a projection + charts) |
| 4 | **Ownership / dependency graph** | new calculator/projection over the owner fields + aggregation API + graph page + charting | **duplication vs #3** (shared `calculators`, frontend chart libs) |
| 5 | **Search / filter across systems** | query layer over the read model + shared filter component + list page | textual vs all (shared list API, `services`, `DtoMapper`) |

### How they collide — mapped to the proven failure modes

- **#3 vs #4 → work-overlap/duplication (CooperBench 33%):** two blind agents each build a
  projection in `calculators` + a charting approach → duplicated aggregation util, divergent
  chart stacks.
- **#1 vs #2 → divergent-architecture (CooperBench 30%):** both extend the event/author pipeline
  with incompatible designs that clean-merge into incoherence.
- **The semantic security gap (headline instrument):** #2–#5 add endpoints *blind to #1's
  authz* → unprotected/ungated on merge. A **clean merge that's silently insecure** — exactly the
  "broken composition" failure isolation can't catch, and the cleanest demonstration of clair's
  value (an agent that *knew* auth landed would gate its endpoint).
- **Textual collisions** across `SR_System`/`SystemData`, `DtoMapper`, `services`, routing.

## The hidden acceptance gate

A **held-out** suite (agents never see it) that defines "all 5 features work + nothing
regressed," run by the harness after integration. Composed of:

- **Per-feature behavioural tests** (against the seed data) — does each slice actually work.
- **Cross-feature integration tests** — e.g. *every new endpoint is authz-gated*; the heatmap
  reflects seed risks; history shows the seed event stream; search returns seeded systems. This
  is the semantic-conflict / silent-deletion instrument.
- **Regression** — the existing **163 backend tests** (+ frontend) still green.

Per-feature pass + an all-pass gate (not pure binary); a budget cap bounds cost-to-completion;
non-completers count as failures.

## Open questions

1. **Inject tech debt?** The app is clean (TDD), i.e. the *disciplined* condition where the
   skeptic says isolation already wins. Options: (a) run clean = a fair, conservative test (if
   clair helps here, strong result); (b) inject a controlled, common debt (e.g. a bloated
   `DtoMapper` god-chokepoint) to represent realistic messiness and raise collision density.
   Likely run **both** as a variable.
2. **Auth injection** — lean on the scaffolded **Keycloak** (realistic, but heavier setup) vs a
   simpler stubbed identity for the benchmark. Keycloak is more credible; confirm.
3. **Slice balance** — slice #1 is heavier than #2–#5; rebalance, or accept (real features vary).
4. **Seed size** — how many systems/risks make the visualisations meaningful without bloating run
   cost.
5. **How clair attaches to the agents** in Arm B — *resolved:* the runner spins up **headless
   Claude Code** agents (one per slice, own worktree, own container), and **Arm B is just the
   same harness with the clair plugin/MCP enabled** — a one-flag toggle, no bespoke glue (see
   [value-benchmark.md](value-benchmark.md), *The runner*).
