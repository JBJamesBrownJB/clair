/**
 * resolve.ts — run a headless clair-OFF integration-engineer agent against the
 * conflicted integration worktree, then verify the visible test suite is green.
 *
 * Env setup sequence (before the agent):
 *   pnpm install → pnpm db:generate → pnpm db:reset
 *
 * Verify sequence (after the agent):
 *   pnpm typecheck → pnpm build → pnpm test
 *
 * Both sequences go through the injectable RunCmdFn so tests never need real pnpm.
 * The resolver agent is launched via the injectable runAgent so tests never need
 * a real claude process.
 *
 * CLAIR OFF: no clair plugin flags are passed to the agent.
 * GATE BLIND: the RESOLVER_PROMPT never references the gate or hidden tests.
 */
import { spawn } from "node:child_process";
import type { RunConfig } from "./types.js";
import type { SliceSpec } from "./types.js";
import type { Workspace } from "./workspace.js";
import type { Budget, AgentResult, AgentDeps } from "./agent.js";
import { runAgent as defaultRunAgent } from "./agent.js";
import type { RunCmdFn } from "./gate.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResolutionResult {
  /** Always true when runResolver was called (distinguishes "skipped" at the run level). */
  ran: boolean;
  /** Total tokens consumed by the resolver agent. */
  tokens: number;
  /** Number of turns the resolver agent used. */
  turns: number;
  /** Wall-clock milliseconds spent in the resolver agent. */
  wallMs: number;
  /** True iff pnpm typecheck + pnpm build + pnpm test all exited 0 after the agent ran. */
  reachedGreen: boolean;
  /** True iff the agent exceeded its budget OR the verify step did not go green. */
  didNotResolve: boolean;
}

/** Injectable type matching the real runAgent signature. */
type RunAgentFn = (
  workspace: Workspace,
  spec: SliceSpec,
  budget: Budget,
  deps?: AgentDeps
) => Promise<AgentResult>;

export interface ResolverDeps {
  /** Override the agent launcher in tests so no real claude process is spawned. */
  runAgent?: RunAgentFn;
  /** Override the shell-command runner in tests so no real pnpm is invoked. */
  runCmd?: RunCmdFn;
}

// ---------------------------------------------------------------------------
// Default (real) implementations
// ---------------------------------------------------------------------------

/** Mirrors gate.ts defaultRunCmd — spawns the command and captures stdout. */
const defaultRunCmd: RunCmdFn = ({ argv, cwd }) => {
  const [file, ...args] = argv;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // On Windows pnpm/git are .cmd wrappers; shell:true resolves them.
      ...(process.platform === "win32" ? { shell: true } : {}),
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.on("close", (code: number | null) => {
      resolve({ stdout, exit: code ?? 1 });
    });
    child.on("error", () => {
      resolve({ stdout, exit: 1 });
    });
  });
};

// ---------------------------------------------------------------------------
// Resolver prompt (fixed; clair-OFF; gate-blind)
// ---------------------------------------------------------------------------

/**
 * Build the resolver prompt interpolating the slice branch list.
 * INVARIANT: must not mention "gate", hidden tests, or clair.
 */
function buildResolverPrompt(sliceBranches: string[]): string {
  const branchList = sliceBranches.join(", ");
  return (
    `You are the integration engineer. Several feature branches were merged into this worktree ` +
    `and some have conflicts or failures. Branches to integrate: ${branchList}. ` +
    `Your job: resolve every git conflict marker, merge in any branch not yet merged, and make ` +
    `the application coherent and GREEN — \`pnpm typecheck\`, \`pnpm build\`, and \`pnpm test\` ` +
    `must all pass. Commit your integrated result when green. Work only in this worktree. ` +
    `Never block or wait for input — decide and continue.`
  );
}

// ---------------------------------------------------------------------------
// runResolver
// ---------------------------------------------------------------------------

/**
 * Run the full resolution cycle for a conflicted integration worktree:
 *
 * 1. Set up the environment (pnpm install / db:generate / db:reset).
 * 2. Launch a headless resolver agent (clair-OFF, gate-blind) via runAgent.
 * 3. Verify that the visible suite is green (typecheck + build + test).
 * 4. Return usage stats and pass/fail flags.
 *
 * @param _run          The RunConfig for this benchmark run (carried for callers; not used internally).
 * @param sliceBranches Branch names to reference in the resolver prompt (e.g. ["run/id/S1", ...]).
 * @param integration   The integration Workspace produced by mergeSlices('leave' mode).
 * @param budget        Token/turn/model budget for the resolver agent.
 * @param deps          Optional injectable deps (real implementations used by default).
 */
export async function runResolver(
  _run: RunConfig,
  sliceBranches: string[],
  integration: Workspace,
  budget: Budget,
  deps?: ResolverDeps
): Promise<ResolutionResult> {
  const runAgentFn = deps?.runAgent ?? defaultRunAgent;
  const runCmdFn = deps?.runCmd ?? defaultRunCmd;
  const dir = integration.dir;

  // Step 1: Set up the integration environment.
  // Mirrors the slice-worktree setup in workspace.ts: install → generate → reset.
  await runCmdFn({ argv: ["pnpm", "install"], cwd: dir });
  await runCmdFn({ argv: ["pnpm", "db:generate"], cwd: dir });
  await runCmdFn({ argv: ["pnpm", "db:reset"], cwd: dir });

  // Step 2: Launch the resolver agent (clair-OFF, gate-blind).
  const spec: SliceSpec = {
    id: "resolver",
    title: "integration resolver",
    prompt: buildResolverPrompt(sliceBranches),
  };
  const agentResult = await runAgentFn(integration, spec, budget);

  // Step 3: Verify the visible suite is green.
  const { exit: tscExit } = await runCmdFn({ argv: ["pnpm", "typecheck"], cwd: dir });
  const { exit: buildExit } = await runCmdFn({ argv: ["pnpm", "build"], cwd: dir });
  const { exit: testExit } = await runCmdFn({ argv: ["pnpm", "test"], cwd: dir });
  const reachedGreen = tscExit === 0 && buildExit === 0 && testExit === 0;

  // Step 4: Return the resolution result.
  return {
    ran: true,
    tokens: agentResult.tokens,
    turns: agentResult.turns,
    wallMs: agentResult.wallMs,
    reachedGreen,
    didNotResolve: agentResult.didNotComplete || !reachedGreen,
  };
}
