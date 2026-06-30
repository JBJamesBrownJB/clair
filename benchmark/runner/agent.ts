/**
 * agent.ts — headless claude agent launch + usage/commit capture
 *
 * Default real argv (prompt fed via stdin):
 *   claude -p --output-format json --dangerously-skip-permissions
 *          --model <model> --max-turns <maxTurns>
 *
 * CheckCommittedFn is injectable alongside RunClaudeFn so tests never need
 * real git worktrees or a real claude process.
 */
import { spawn, execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { SliceSpec } from "./types.js";
import type { Workspace } from "./workspace.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Budget envelope passed to each agent — extends RunConfig.budget with model. */
export interface Budget {
  max_tokens_per_agent: number;
  max_turns_per_agent: number;
  model: string;
}

/** What we get back from running one agent. */
export interface AgentResult {
  sliceId: string;
  committed: boolean;
  tokens: number;
  turns: number;
  wallMs: number;
  exit: number;
  didNotComplete: boolean;
  /** Set when the claude process failed to launch (e.g. ENOENT). Distinguishes env problems from agent failures. */
  error?: string;
}

/**
 * Injectable child-process abstraction.
 * The default impl spawns `claude -p …` and pipes `prompt` to stdin.
 */
export type RunClaudeFn = (args: {
  cwd: string;
  prompt: string;
  model: string;
  maxTurns: number;
}) => Promise<{ stdout: string; exit: number; error?: string }>;

/**
 * Injectable committed-check abstraction.
 * The default impl runs `git -C <dir> rev-parse HEAD` vs `git rev-parse arena/base`.
 */
export type CheckCommittedFn = (workspace: Workspace) => Promise<boolean>;

/** Deps bag — all optional; defaults are the real implementations. */
export interface AgentDeps {
  runClaude?: RunClaudeFn;
  checkCommitted?: CheckCommittedFn;
}

// ---------------------------------------------------------------------------
// Default (real) implementations
// ---------------------------------------------------------------------------

/**
 * Spawns `claude -p --output-format json --dangerously-skip-permissions
 *   --model <model> --max-turns <maxTurns>` in `cwd`,
 * writing `prompt` to the child's stdin.
 */
function defaultRunClaude(args: {
  cwd: string;
  prompt: string;
  model: string;
  maxTurns: number;
}): Promise<{ stdout: string; exit: number; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format", "json",
        "--dangerously-skip-permissions",
        "--model", args.model,
        "--max-turns", String(args.maxTurns),
      ],
      {
        cwd: args.cwd,
        stdio: ["pipe", "pipe", "ignore"],
        // On Windows, `claude` is a .cmd wrapper; spawn needs shell:true to resolve it.
        ...(process.platform === "win32" ? { shell: true } : {}),
      }
    );

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.stdin.write(args.prompt, "utf-8");
    child.stdin.end();

    child.on("close", (code: number | null) => {
      resolve({ stdout, exit: code ?? 1 });
    });
    child.on("error", (err: Error) => {
      resolve({ stdout: "", exit: 127, error: `claude launch failed: ${err.message}` });
    });
  });
}

/**
 * True iff the worktree HEAD has advanced past arena/base.
 * Uses synchronous execFileSync for simplicity; catches on any git error.
 */
async function defaultCheckCommitted(workspace: Workspace): Promise<boolean> {
  try {
    const headSha = execFileSync(
      "git", ["-C", workspace.dir, "rev-parse", "HEAD"],
      { encoding: "utf-8" }
    ).trim();
    const baseSha = execFileSync(
      "git", ["rev-parse", "arena/base"],
      { cwd: workspace.dir, encoding: "utf-8" }
    ).trim();
    return headSha !== baseSha;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Run one headless claude agent in the given worktree and return usage stats.
 */
export async function runAgent(
  workspace: Workspace,
  spec: SliceSpec,
  budget: Budget,
  deps?: AgentDeps
): Promise<AgentResult> {
  const runClaude = deps?.runClaude ?? defaultRunClaude;
  const checkCommitted = deps?.checkCommitted ?? defaultCheckCommitted;

  const t0 = performance.now();
  const { stdout, exit, error: launchError } = await runClaude({
    cwd: workspace.dir,
    prompt: spec.prompt,
    model: budget.model,
    maxTurns: budget.max_turns_per_agent,
  });
  const wallMs = performance.now() - t0;

  // Defensive JSON parse — never throw on missing or malformed fields
  let tokens = 0;
  let turns = 0;
  let isError = false;
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const usage = parsed?.usage as Record<string, unknown> | undefined;
    tokens =
      (typeof usage?.input_tokens === "number" ? usage.input_tokens : 0) +
      (typeof usage?.output_tokens === "number" ? usage.output_tokens : 0) +
      (typeof usage?.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0) +
      (typeof usage?.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0);
    turns = typeof parsed?.num_turns === "number" ? (parsed.num_turns as number) : 0;
    isError = parsed?.is_error === true;
  } catch {
    // stdout was not JSON — treat as error condition
    isError = true;
  }

  const committed = await checkCommitted(workspace);

  const didNotComplete =
    exit !== 0 ||
    isError ||
    turns >= budget.max_turns_per_agent ||
    tokens > budget.max_tokens_per_agent ||
    !committed;

  return {
    sliceId: workspace.sliceId,
    committed,
    tokens,
    turns,
    wallMs,
    exit,
    didNotComplete,
    ...(launchError !== undefined ? { error: launchError } : {}),
  };
}

/**
 * Run all agents concurrently (Promise.all) and return results in input order.
 */
export async function runAgents(
  items: Array<{ workspace: Workspace; spec: SliceSpec }>,
  budget: Budget,
  deps?: AgentDeps
): Promise<AgentResult[]> {
  return Promise.all(
    items.map(({ workspace, spec }) => runAgent(workspace, spec, budget, deps))
  );
}
