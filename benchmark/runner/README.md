# benchmark/runner

End-to-end driver for the clair benchmark arena.

## What this does

Wires six build tasks into a single pipeline:

```
loadRun → buildSliceSpecs
  → provision (one worktree per slice)
  → runAgents (headless claude -p, parallel)
  → mergeSlices (mechanical merge into integration branch)
  → runGate (held-out acceptance suite against integration)
  → writeReport (metrics JSON + human summary)
  → teardown (clean all worktrees even on error)
```

The key measurement is `semanticConflict`: branches that merged cleanly by git
but whose combined behaviour broke the gate — silent failures that clair exists
to surface.

## Dry-run (safe — no agents, no git side-effects)

Prints the run plan (id, level, arm, model, budget) and each slice's full
prompt so you can eyeball information asymmetry before committing to a live run.

```
cd benchmark/runner
pnpm exec tsx run.ts ../runs/standard-L1.run.yaml --dry-run
```

Exit code is always 0 on dry-run.

## Live run

```
cd benchmark/runner
pnpm exec tsx run.ts ../runs/standard-L1.run.yaml
```

Exits 0 if the gate result is `all-pass`, non-zero otherwise.

**CAVEAT — unsandboxed agents.** The live run spawns one `claude -p
--dangerously-skip-permissions` process per slice directly on the host machine.
This is intentional for a throwaway arena to get a first signal quickly, but it
is not hardened. Agents can read and write anywhere on the host, and API calls
bill to your Anthropic account. Containers (one disposable sandbox per agent)
are the first hardening step once the pipeline is validated.

## Injectable deps / testing

Every stage function (provision, runAgents, mergeSlices, runGate, writeReport,
teardown) is injectable via the `RunBenchmarkDeps` argument. The test suite in
`__tests__/run.test.ts` drives the full orchestration with fakes — no real git
or agent processes.

```ts
import { runBenchmark } from './run.js'
const result = await runBenchmark(runPath, { dryRun: true })
// result.plan.slices[0].prompt — inspect without side-effects
```

## Output

Reports are written to `benchmark/runner/out/<runId>.json`.  The `outcome`
field is `"all-pass"` or `"fail"`; `semanticConflict: true` flags the
interesting case where git reported a clean merge but the gate subsequently
failed.
