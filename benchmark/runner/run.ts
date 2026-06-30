/**
 * run.ts — end-to-end benchmark driver
 *
 * Wires Tasks 1–6 into a single pipeline:
 *   loadRun → buildSliceSpecs
 *   provision → runAgents → mergeSlices → runGate → writeReport → teardown
 *
 * CLI usage (safe — no agents spawned):
 *   pnpm exec tsx run.ts ../runs/standard-L1.run.yaml --dry-run
 *
 * Live usage (spawns unsandboxed claude -p agents — gate on a human):
 *   pnpm exec tsx run.ts ../runs/standard-L1.run.yaml
 *
 * All stage functions are injectable via the `deps` argument so tests can
 * drive orchestration without real git or real agent processes.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { loadRun } from "./loadRun.js";
import { buildSliceSpecs } from "./sliceSpec.js";
import { provision, teardown } from "./workspace.js";
import type { Workspace } from "./workspace.js";
import { runAgents } from "./agent.js";
import type { Budget } from "./agent.js";
import { mergeSlices } from "./merge.js";
import { runGate } from "./gate.js";
import { writeReport } from "./report.js";
import { runResolver } from "./resolve.js";
import type { RunConfig, SliceSpec } from "./types.js";
import type { AgentResult } from "./agent.js";
import type { MergeResult } from "./merge.js";
import type { GateResult } from "./gate.js";
import type { RunReport } from "./report.js";
import type { ResolutionResult } from "./resolve.js";

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the repo root (two levels up from benchmark/runner/). */
const REPO_ROOT = path.resolve(__dirname, "../..");

/** Path to the shared backlog used by buildSliceSpecs. */
const BACKLOG_PATH = path.join(REPO_ROOT, "benchmark/backlog/backlog.md");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DryRunPlan {
  runId: string;
  level: string;
  arm: string;
  topology: string;
  model: string;
  budget: { max_tokens_per_agent: number; max_turns_per_agent: number };
  slices: Array<{ id: string; title: string; prompt: string }>;
}

export type BenchmarkResult =
  | { dryRun: true; plan: DryRunPlan }
  | {
      dryRun: false;
      outcome: "all-pass" | "fail";
      report: { json: RunReport; summary: string; path: string; resultPath: string | null };
    };

/**
 * Injectable stage functions — each defaults to the real module export.
 * Pass fakes in tests to exercise orchestration logic without git or agents.
 */
export interface RunBenchmarkDeps {
  provision?: (
    run: RunConfig,
    opts?: { rootDir?: string; install?: boolean }
  ) => Promise<Workspace[]>;
  runAgents?: (
    items: Array<{ workspace: Workspace; spec: SliceSpec }>,
    budget: Budget
  ) => Promise<AgentResult[]>;
  mergeSlices?: (
    run: RunConfig,
    slices: Array<{ sliceId: string; branch: string }>,
    opts?: { onConflict?: "abort" | "leave"; rootDir?: string }
  ) => Promise<MergeResult>;
  runResolver?: (
    run: RunConfig,
    sliceBranches: string[],
    integration: Workspace,
    budget: Budget
  ) => Promise<ResolutionResult>;
  runGate?: (integration: Workspace, run: RunConfig) => Promise<GateResult>;
  writeReport?: (
    runId: string,
    parts: {
      agents: AgentResult[];
      merge: MergeResult;
      gate: GateResult;
      wallMs: number;
      resolution?: ResolutionResult;
    },
    opts?: { outDir?: string; resultsDir?: string; stamp?: string }
  ) => { json: RunReport; summary: string; path: string; resultPath: string | null };
  teardown?: (workspaces: Workspace[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Run or plan the benchmark described by `runPath`.
 *
 * @param runPath  Absolute (or cwd-relative) path to a .run.yaml file.
 * @param opts     `{ dryRun: true }` prints the plan and returns it — zero
 *                 git side-effects. `{ dryRun: false }` runs the full pipeline.
 * @param deps     Injectable stage functions for testing; real impls are used
 *                 when any are omitted.
 */
export async function runBenchmark(
  runPath: string,
  opts: { dryRun: boolean },
  deps: RunBenchmarkDeps = {}
): Promise<BenchmarkResult> {
  // Wire real implementations as defaults
  const _provision = deps.provision ?? provision;
  const _runAgents = deps.runAgents ?? runAgents;
  const _mergeSlices = deps.mergeSlices ?? mergeSlices;
  const _runResolver = deps.runResolver ?? runResolver;
  const _runGate = deps.runGate ?? runGate;
  const _writeReport = deps.writeReport ?? writeReport;
  const _teardown = deps.teardown ?? teardown;

  // Resolve + build specs (these are pure file reads — safe in both paths)
  const run = loadRun(runPath);
  const specs = buildSliceSpecs(run, BACKLOG_PATH);

  // ------------------------------------------------------------------
  // Dry-run path — print the plan, return it, no git side-effects
  // ------------------------------------------------------------------
  if (opts.dryRun) {
    const plan: DryRunPlan = {
      runId: run.id,
      level: run.level,
      arm: run.arm,
      topology: run.topology,
      model: run.model,
      budget: {
        max_tokens_per_agent: run.budget.max_tokens_per_agent,
        max_turns_per_agent: run.budget.max_turns_per_agent,
      },
      slices: specs.map((s) => ({ id: s.id, title: s.title, prompt: s.prompt })),
    };

    printDryRunPlan(plan);
    return { dryRun: true, plan };
  }

  // ------------------------------------------------------------------
  // Live path — provision → agents → merge → gate → report → teardown
  // teardown runs in finally so it executes even on error.
  // ------------------------------------------------------------------
  const budget: Budget = {
    max_tokens_per_agent: run.budget.max_tokens_per_agent,
    max_turns_per_agent: run.budget.max_turns_per_agent,
    model: run.model,
  };

  const wallStart = performance.now();
  let workspaces: Workspace[] = [];
  let merge: MergeResult | undefined;

  // Determine integration mode — only 'resolver' activates the resolver path.
  const integrationMode = run.integration?.mode;
  const isResolverMode = integrationMode === "resolver";

  // Build resolver budget from YAML's integration.resolver_budget, falling back
  // to the run's main budget if resolver_budget is absent.
  const resolverBudget: Budget = {
    max_tokens_per_agent:
      run.integration?.resolver_budget?.max_tokens ?? run.budget.max_tokens_per_agent,
    max_turns_per_agent:
      run.integration?.resolver_budget?.max_turns ?? run.budget.max_turns_per_agent,
    model: run.model,
  };

  try {
    // 1. Provision one worktree per slice
    workspaces = await _provision(run, { install: true });

    // 2. Run all agents concurrently (one per slice)
    const items = workspaces.map((w) => {
      const spec = specs.find((s) => s.id === w.sliceId);
      if (!spec) throw new Error(`No spec found for sliceId "${w.sliceId}"`);
      return { workspace: w, spec };
    });
    const agents = await _runAgents(items, budget);

    // 3. Merge all slice branches into an integration branch.
    //    MUST be before teardown (teardown deletes the slice branches).
    //    Resolver mode: leave conflict markers for the resolver agent.
    //    Mechanical mode (default): abort on conflict (clean worktree).
    const sliceBranches = workspaces.map((w) => ({
      sliceId: w.sliceId,
      branch: w.branch,
    }));
    merge = await _mergeSlices(
      run,
      sliceBranches,
      isResolverMode ? { onConflict: "leave" } : undefined
    );

    // 3b. [Resolver mode only] Run a headless resolver agent against the
    //     conflicted integration worktree, then hand off to the gate.
    let resolution: ResolutionResult | undefined;
    if (isResolverMode) {
      const branchNames = sliceBranches.map((s) => s.branch);
      resolution = await _runResolver(run, branchNames, merge.integration, resolverBudget);
    }

    // 4. Run the held-out gate against the integration worktree
    const gate = await _runGate(merge.integration, run);

    // 5. Assemble + write the report (sync — does its own console.log).
    //    Pass resultsDir so each real run is persisted in benchmark/results/.
    //    Tests inject a fake writeReport, so the real Date call here is fine.
    const wallMs = performance.now() - wallStart;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const resultsDir = path.join(REPO_ROOT, "benchmark/results");
    const reportResult = _writeReport(
      run.id,
      { agents, merge, gate, wallMs, ...(resolution !== undefined ? { resolution } : {}) },
      { resultsDir, stamp }
    );

    return {
      dryRun: false,
      outcome: reportResult.json.outcome,
      report: reportResult,
    };
  } finally {
    // 6. Clean up ALL worktrees: per-slice + integration (if created).
    //    Runs after report on the happy path; runs on any error too.
    //    Teardown is wrapped so that if it throws, the teardown error is
    //    logged but NOT propagated — the original stage error (if any)
    //    is always the one that surfaces from runBenchmark.
    const toClean: Workspace[] = [
      ...workspaces,
      ...(merge?.integration ? [merge.integration] : []),
    ];
    try {
      await _teardown(toClean);
    } catch (teardownErr) {
      console.error("[runBenchmark] teardown failed:", teardownErr);
    }
  }
}

// ---------------------------------------------------------------------------
// Dry-run print helper
// ---------------------------------------------------------------------------

function printDryRunPlan(plan: DryRunPlan): void {
  const hr = "─".repeat(60);
  console.log(`\n${"=".repeat(60)}`);
  console.log("  DRY RUN PLAN — no agents will be spawned");
  console.log(`${"=".repeat(60)}\n`);
  console.log(`Run ID:   ${plan.runId}`);
  console.log(`Level:    ${plan.level}`);
  console.log(`Arm:      ${plan.arm}`);
  console.log(`Topology: ${plan.topology}`);
  console.log(`Model:    ${plan.model}`);
  console.log(
    `Budget:   max_tokens=${plan.budget.max_tokens_per_agent}  max_turns=${plan.budget.max_turns_per_agent}`
  );
  console.log(`Slices:   ${plan.slices.length}\n`);

  for (const slice of plan.slices) {
    console.log(hr);
    console.log(`Slice ${slice.id}: ${slice.title}`);
    console.log(hr);
    console.log(slice.prompt);
    console.log();
  }

  console.log(`${"=".repeat(60)}`);
  console.log(
    `  ${plan.slices.length} slices shown above — no git side-effects`
  );
  console.log(`${"=".repeat(60)}\n`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// ESM "is this the main module?" check — resolves correctly on Windows + Unix.
const _cliFile = path.resolve(fileURLToPath(import.meta.url));
const _argvFile = path.resolve(process.argv[1] ?? "");
const _isMain = _cliFile === _argvFile;

if (_isMain) {
  const rawArgs = process.argv.slice(2);
  const dryRun = rawArgs.includes("--dry-run");
  const positional = rawArgs.filter((a) => !a.startsWith("--"));
  const runYaml = positional[0];

  if (!runYaml) {
    console.error(
      "Usage: pnpm exec tsx run.ts <run.yaml> [--dry-run]\n" +
        "  --dry-run  Print the plan; no git side-effects, safe to run anytime."
    );
    process.exit(1);
  }

  runBenchmark(path.resolve(runYaml), { dryRun })
    .then((result) => {
      if (!result.dryRun && result.outcome !== "all-pass") {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("\n[runner] Fatal error:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
