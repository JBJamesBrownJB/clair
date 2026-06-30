/**
 * run.ts — end-to-end benchmark driver
 *
 * Wires Tasks 1–6 into a single pipeline:
 *   loadRun → buildSliceSpecs
 *   provision → runAgents → [merge | pr-queue] → runGate → writeReport → teardown
 *
 * Integration modes:
 *   mechanical (default): mergeSlices → runGate → writeReport
 *   pr-queue:             create integration worktree → runPrQueue → runGate →
 *                         compute testDiscipline → writeReport
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
import { runPrQueue } from "./prQueue.js";
import type { PrQueueResult } from "./prQueue.js";
import { defaultRunCmd } from "./shell.js";
import type { RunCmdFn } from "./shell.js";
import type { RunConfig, SliceSpec } from "./types.js";
import type { AgentResult } from "./agent.js";
import type { MergeResult } from "./merge.js";
import type { GateResult } from "./gate.js";
import type { RunReport } from "./report.js";

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the repo root (two levels up from benchmark/runner/). */
const REPO_ROOT = path.resolve(__dirname, "../..");

/** Path to the shared backlog used by buildSliceSpecs. */
const BACKLOG_PATH = path.join(REPO_ROOT, "benchmark/backlog/backlog.md");

/** Default scratch directory for worktrees — git-ignored. */
const DEFAULT_WORK_DIR = path.join(__dirname, ".work");

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
  integrationMode: "mechanical" | "pr-queue";
  queueBudget?: { max_tokens: number; max_turns: number };
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
  runPrQueue?: (
    run: RunConfig,
    branches: string[],
    integration: Workspace,
    budget: Budget
  ) => Promise<PrQueueResult>;
  runGate?: (integration: Workspace, run: RunConfig) => Promise<GateResult>;
  writeReport?: (
    runId: string,
    parts: {
      agents: AgentResult[];
      merge?: MergeResult;
      gate: GateResult;
      wallMs: number;
      prQueue?: PrQueueResult;
      testDiscipline?: Record<string, { testFilesAdded: number }>;
    },
    opts?: { outDir?: string; resultsDir?: string; stamp?: string }
  ) => { json: RunReport; summary: string; path: string; resultPath: string | null };
  teardown?: (workspaces: Workspace[]) => Promise<void>;
  /** Shell runner used for integration-worktree creation and testDiscipline diffs.
   *  Defaults to defaultRunCmd. Inject a fake in tests to avoid real git calls. */
  runCmd?: RunCmdFn;
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
  const _runPrQueue = deps.runPrQueue ?? runPrQueue;
  const _runGate = deps.runGate ?? runGate;
  const _writeReport = deps.writeReport ?? writeReport;
  const _teardown = deps.teardown ?? teardown;
  const _runCmd = deps.runCmd ?? defaultRunCmd;

  // Resolve + build specs (these are pure file reads — safe in both paths)
  const run = loadRun(runPath);
  const specs = buildSliceSpecs(run, BACKLOG_PATH);

  // Determine integration mode once — only 'pr-queue' activates the pr-queue path.
  // Any other value (including the legacy 'resolver', unknown strings, undefined)
  // falls through to mechanical (safe default).
  const rawMode = run.integration?.mode;
  const isPrQueueMode = rawMode === "pr-queue";
  const integrationMode: "mechanical" | "pr-queue" = isPrQueueMode ? "pr-queue" : "mechanical";

  // ------------------------------------------------------------------
  // Dry-run path — print the plan, return it, no git side-effects
  // ------------------------------------------------------------------
  if (opts.dryRun) {
    const queueBudget =
      integrationMode === "pr-queue" && run.integration?.queue_budget
        ? run.integration.queue_budget
        : undefined;

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
      integrationMode,
      ...(queueBudget ? { queueBudget } : {}),
      slices: specs.map((s) => ({ id: s.id, title: s.title, prompt: s.prompt })),
    };

    printDryRunPlan(plan);
    return { dryRun: true, plan };
  }

  // ------------------------------------------------------------------
  // Live path — teardown runs in finally so it executes even on error.
  // ------------------------------------------------------------------
  const budget: Budget = {
    max_tokens_per_agent: run.budget.max_tokens_per_agent,
    max_turns_per_agent: run.budget.max_turns_per_agent,
    model: run.model,
  };

  const wallStart = performance.now();
  let workspaces: Workspace[] = [];
  let merge: MergeResult | undefined;
  let integrationWs: Workspace | undefined; // only set in pr-queue mode

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

    const sliceBranches = workspaces.map((w) => ({
      sliceId: w.sliceId,
      branch: w.branch,
    }));

    // ------------------------------------------------------------------
    // Integration: PR-queue mode
    // ------------------------------------------------------------------
    if (isPrQueueMode) {
      // 3. Create a clean integration worktree off arena/base.
      //    The pr-queue does its own merges into this worktree.
      const integrationBranch = `run/${run.id}/integration`;
      const integrationDir = path.join(DEFAULT_WORK_DIR, `${run.id}-integration`);
      const { exit: wtExit } = await _runCmd({
        argv: ["git", "worktree", "add", "-b", integrationBranch, integrationDir, "arena/base"],
        cwd: REPO_ROOT,
      });
      if (wtExit !== 0) {
        throw new Error(`Failed to create integration worktree for run ${run.id}`);
      }
      integrationWs = { sliceId: "integration", dir: integrationDir, branch: integrationBranch };

      // 4. Map queue_budget → Budget for the fix-loop agents.
      const queueBudget: Budget = {
        max_tokens_per_agent:
          run.integration?.queue_budget?.max_tokens ?? run.budget.max_tokens_per_agent,
        max_turns_per_agent:
          run.integration?.queue_budget?.max_turns ?? run.budget.max_turns_per_agent,
        model: run.model,
      };

      // 5. Run the PR queue (merge + CI + fix-loop per branch).
      const prQueueResult = await _runPrQueue(
        run,
        sliceBranches.map((s) => s.branch),
        integrationWs,
        queueBudget
      );

      // 6. Run the held-out gate against the final integration worktree.
      const gate = await _runGate(integrationWs, run);

      // 7. Compute test discipline: count test files ADDED on each slice branch
      //    vs arena/base. Best-effort — on git error → 0.
      const testDiscipline: Record<string, { testFilesAdded: number }> = {};
      for (const ws of workspaces) {
        const { stdout, exit } = await _runCmd({
          argv: [
            "git", "diff", "--name-only", "--diff-filter=A",
            "arena/base", ws.branch,
          ],
          cwd: REPO_ROOT,
        });
        testDiscipline[ws.sliceId] = {
          testFilesAdded:
            exit === 0
              ? stdout.split("\n").filter((l) => /\.(test|spec)\.ts$/.test(l.trim())).length
              : 0,
        };
      }

      // 8. Write the report.
      const wallMs = performance.now() - wallStart;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const resultsDir = path.join(REPO_ROOT, "benchmark/results");
      const reportResult = _writeReport(
        run.id,
        { agents, gate, wallMs, prQueue: prQueueResult, testDiscipline },
        { resultsDir, stamp }
      );

      return {
        dryRun: false,
        outcome: reportResult.json.outcome,
        report: reportResult,
      };
    }

    // ------------------------------------------------------------------
    // Integration: Mechanical mode (default)
    // Merge all slice branches into an integration branch, abort on conflict.
    // ------------------------------------------------------------------

    // 3. Merge all slice branches into an integration branch.
    //    MUST be before teardown (teardown deletes the slice branches).
    merge = await _mergeSlices(run, sliceBranches);

    // 4. Run the held-out gate against the integration worktree.
    const gate = await _runGate(merge.integration, run);

    // 5. Assemble + write the report (sync — does its own console.log).
    //    Pass resultsDir so each real run is persisted in benchmark/results/.
    //    Tests inject a fake writeReport, so the real Date call here is fine.
    const wallMs = performance.now() - wallStart;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const resultsDir = path.join(REPO_ROOT, "benchmark/results");
    const reportResult = _writeReport(
      run.id,
      { agents, merge, gate, wallMs },
      { resultsDir, stamp }
    );

    return {
      dryRun: false,
      outcome: reportResult.json.outcome,
      report: reportResult,
    };
  } finally {
    // 6 / 9. Clean up ALL worktrees: per-slice + integration (if created).
    //    Runs after report on the happy path; runs on any error too.
    //    Teardown is wrapped so that if it throws, the teardown error is
    //    logged but NOT propagated — the original stage error (if any)
    //    is always the one that surfaces from runBenchmark.
    const toClean: Workspace[] = [
      ...workspaces,
      ...(merge?.integration ? [merge.integration] : []),
      ...(integrationWs ? [integrationWs] : []),
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
  console.log(
    plan.integrationMode === "pr-queue"
      ? `Integration: pr-queue${plan.queueBudget ? `  (queue budget: max_tokens=${plan.queueBudget.max_tokens} max_turns=${plan.queueBudget.max_turns})` : ""}`
      : `Integration: mechanical`
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
