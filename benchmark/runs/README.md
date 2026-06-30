# Run-configs — the repeatable definition of a benchmark run

A `*.run.yaml` here pins **one run** so it reproduces. It is **runner-agnostic** — a declarative
description any harness can read and execute. Picking the three axes (arm × topology × level) plus the
reproducibility pins fully determines a run.

## The schema, in plain words

```yaml
id: standard-L1-armA            # unique run id
description: ...                # one line
status: ready | future          # 'future' = needs an arena artifact not built yet (e.g. extended reference)

base:                           # the app the agents start from
  branch: arena/base
  sha: 1a5cd3d                  # IMMUTABLE pin (tag arena-base-v1 once the env permits tag pushes)

gate:                           # the held-out judge — agents NEVER see this
  branch: arena/reference
  sha: bfa46b5
  command: pnpm test:gate       # plus: bash gate/run-gate.sh

arm: A                          # A=disciplined-isolation control · B-presence/B-beacon/B-context-swap=clair on · C=single-agent ceiling
topology: local-worktrees       # LOCKED to Scenario 2 (see ../../docs/architecture/benchmark-scenarios.md)
level: L1                       # which level (see ../levels.md) — resolves to the slices below

slices:                         # one agent per slice (1:1); each maps to backlog IDs
  - { id: S1, title: "Authz hardening + role-management", backlog: [F-08, F-10, F-09] }
  - { id: S2, title: "Saved views: search + filter",      backlog: [F-06, F-07, F-12, F-13, F-15] }
  - { id: S3, title: "Export (CSV + JSON)",               backlog: [F-17] }
agents: 3                       # = number of slices

information_asymmetry: true     # each agent sees ONLY its own slice spec (the realistic condition)

model: claude-opus-4-8          # pin model + exact version
temperature: 0                  # where settable

budget:                         # per-agent caps — a run that doesn't reach the gate by the cap = did-not-complete
  max_tokens_per_agent: 1500000 # starting points — calibrate from the first dry runs
  max_turns_per_agent: 120

integration:
  mode: mechanical-merge        # held FIXED + identical across arms (clair acts at build time, not as resolver)
  resolver: none                # first experiment: no resolver; a non-auto-merge or gate fail = did-not-complete

trials:
  k: 5                          # K trials per (arm × level); report medians + spread, not single runs

metrics:                        # what to capture (headline first)
  - all-pass-rate
  - semantic-conflict-rate
  - tsc-clean
  - build-clean
  - rcc
  - textual-conflicts          # captured but NOT a success signal (≈100% at L2+)
  - rework-tokens
  - wall-clock
```

## Rules that keep runs comparable

- **Pin by SHA**, not a moving branch — the tags `arena-base-v1` / `arena-reference-v1` map to the
  SHAs above; pin the SHA until tag pushes are permitted in the build env.
- **Integration is held fixed across arms.** clair's value must show as *outputs that collide less*,
  not as better conflict resolution — so the merge mechanism is identical and clair-off in every arm.
- **The gate is held out.** Agents never see `arena/reference` or `gate/`.
- **Arm is the only thing that differs between an A run and a B run** of the same level — same
  spin-up, prompts, containers; B just enables the clair plugin at the level under test.
- **`status: future`** marks a config whose level needs an arena artifact that doesn't exist yet
  (e.g. L3 needs an extended reference + gate). Don't launch a `future` run until its artifacts land.

## Integration modes

The `integration.mode` field controls how slice branches are combined after agents finish.

### `mechanical-merge` (baseline)
Slice branches are merged in sequence with no conflict resolution. If any merge produces
a textual conflict the merge is aborted and the trial is recorded as `did-not-complete`.
This is the fixed, identical mechanism used across all arms — clair's value must appear as
*fewer collisions*, not as better conflict resolution.

### `resolver`
Slice branches are merged with conflict markers left in place (`onConflict: leave`). A
headless integration agent then runs against the conflicted worktree and attempts to bring
the combined codebase to a green build/test state. On top of the mechanical metrics this
adds:

- **resolution-cost** — tokens + wall-clock the agent spent
- **resolution-success** — did it reach green within budget?
- **post-resolution gate** — does the resolved app pass the held-out gate?

The comparison `resolutionCost(Arm A) − resolutionCost(Arm B)` (same resolver, held fixed)
is clair's measurable dollar value: if clair-on agents collide less, the resolver finishes
cheaper.

## The files here

| File | Integration mode | Axis picks | Status |
|------|-----------------|-----------|--------|
| [`standard-L1.run.yaml`](standard-L1.run.yaml) | mechanical-merge | Arm A · worktrees · L1 | ready — first experiment |
| [`standard-L1-resolver.run.yaml`](standard-L1-resolver.run.yaml) | resolver | Arm A · worktrees · L1 | ready — cost-to-resolution variant |
| [`migration-L2.run.yaml`](migration-L2.run.yaml) | mechanical-merge | Arm A · worktrees · L2 | ready — the flagship |
| [`saturation-L3.run.yaml`](saturation-L3.run.yaml) | mechanical-merge | Arm A · worktrees · L3 | future — needs extended reference |

To run Arm B, copy a ready config and change `arm:` (and `id:`); everything else stays identical.
