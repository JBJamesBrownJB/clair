/**
 * prQueue.ts — PR-queue core + fix-loop
 *
 * Process every slice branch as a pull request (git merge --no-ff), gate each
 * one on the local CI (runCI), and run a clair-OFF gate-blind fix agent on any
 * blocked PR. Enforce test integrity via assertion-count snapshot before/after
 * each fix. Roll back non-landing PRs so the integration always stays at the
 * last green state.
 *
 * CLAIR OFF: the fix agent is launched with a plain runAgent call — no clair
 * plugin flags.
 * GATE BLIND: FIX_PROMPT never references the held-out gate or hidden tests.
 */
import { defaultRunCmd } from "./shell.js";
import type { RunCmdFn } from "./shell.js";
import { runCI as defaultRunCI } from "./ci.js";
import type { CIResult } from "./ci.js";
import { runAgent as defaultRunAgent } from "./agent.js";
import type { Budget, AgentResult, AgentDeps } from "./agent.js";
import type { RunConfig, SliceSpec } from "./types.js";
import type { Workspace } from "./workspace.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PrEntry {
  branch: string;
  outcome: "merged" | "blocked";
  /** Present on blocked PRs. Values: "ci-fail" | "conflict" | "test-tampering" */
  reason?: string;
  /** Present on PRs that landed via the fix agent. */
  fixCost?: { tokens: number; turns: number; wallMs: number };
  /** Number of fix rounds that ran (1 when the fix agent resolved it). */
  rounds?: number;
  /** True when the fix agent dropped assertion count below the pre-fix snapshot. */
  tampered?: boolean;
}

export interface PrQueueResult {
  /** One entry per branch, in input order. Length always equals branches.length. */
  prs: PrEntry[];
  /** True iff every branch merged green AND no tampered entry. */
  reachedSuccess: boolean;
  /** Sum of tokens/turns/wallMs consumed by all fix agents. */
  integrationCost: { tokens: number; turns: number; wallMs: number };
  /** Total fix rounds that ran across all PRs. */
  rounds: number;
  /** True when any env-setup command (install/db:generate/db:reset) exited non-zero. */
  envError: boolean;
  /** True iff !reachedSuccess. */
  didNotComplete: boolean;
}

// ---------------------------------------------------------------------------
// Injectable types
// ---------------------------------------------------------------------------

export type CountAssertionsFn = (dir: string) => Promise<number>;

type RunCIFn = (dir: string, deps?: { runCmd?: RunCmdFn }) => Promise<CIResult>;

type RunAgentFn = (
  workspace: Workspace,
  spec: SliceSpec,
  budget: Budget,
  deps?: AgentDeps
) => Promise<AgentResult>;

export interface PrQueueDeps {
  runCmd?: RunCmdFn;
  runCI?: RunCIFn;
  runAgent?: RunAgentFn;
  countAssertions?: CountAssertionsFn;
}

// ---------------------------------------------------------------------------
// FIX_PROMPT (clair-OFF, gate-blind — no mention of "gate" or hidden tests)
// ---------------------------------------------------------------------------

export const FIX_PROMPT =
  "You are the integration engineer. Branches were merged into this worktree and " +
  "some conflicts or failures remain. Resolve every git conflict marker and make the " +
  "application pass: `pnpm typecheck`, `pnpm build`, and `pnpm test` must all succeed. " +
  "You may add tests and edit source code, but you must NOT delete or weaken existing " +
  "test assertions. Commit your work when everything passes. Work only in this worktree. " +
  "Never block or wait for input — decide and continue.";

// ---------------------------------------------------------------------------
// Default countAssertions (real implementation)
// ---------------------------------------------------------------------------

/**
 * Build the real countAssertions fn closing over the resolved runCmd.
 * Counts lines matching `expect(`, `it(`, or `test(` across *.test.ts / *.spec.ts.
 * If git grep exits non-zero (no matches), returns 0 — never throws.
 */
function makeDefaultCountAssertions(runCmd: RunCmdFn): CountAssertionsFn {
  return async (dir: string): Promise<number> => {
    const { stdout } = await runCmd({
      argv: [
        "git",
        "grep",
        "-hE",
        "expect\\(|\\bit\\(|\\btest\\(",
        "--",
        "*.test.ts",
        "*.spec.ts",
      ],
      cwd: dir,
    });
    // Each matching line is one assertion reference; count non-empty lines.
    return stdout.split("\n").filter((l) => l.trim().length > 0).length;
  };
}

// ---------------------------------------------------------------------------
// runPrQueue
// ---------------------------------------------------------------------------

/**
 * Process each slice branch as a pull request into the integration worktree.
 *
 * Algorithm:
 * 1. Env setup: pnpm install → pnpm db:generate → pnpm db:reset. Non-zero
 *    exit sets envError:true but continues best-effort.
 * 2. Record lastGreen = current integration HEAD sha.
 * 3. For each branch:
 *    a. git merge --no-ff <branch>
 *    b. If merge clean: run CI. Green → PR LANDS (lastGreen updated). Red → blocked.
 *       If merge conflict (exit≠0): blocked (markers left in tree).
 *    c. Blocked → fix sub-loop:
 *       - snapshot assertion count
 *       - run fix agent (clair-OFF, gate-blind)
 *       - re-count assertions; run CI
 *       - postAssertions < snapshot → TAMPERED; roll back to lastGreen; blocked.
 *       - CI green → PR LANDS (lastGreen updated); record fixCost, rounds:1.
 *       - Still red → roll back to lastGreen; blocked reason "ci-fail"|"conflict".
 * 4. reachedSuccess = all PRs merged AND none tampered.
 *
 * CRITICAL: prs.length === branches.length (no branch ever silently omitted).
 *
 * @param _run        RunConfig (carried for callers; not used internally).
 * @param branches    Ordered list of slice branch names to process as PRs.
 * @param integration The integration Workspace (fresh worktree off arena/base; caller created it).
 * @param budget      Token/turn/model budget for each fix agent.
 * @param deps        Optional injectable deps; defaults to real implementations.
 */
export async function runPrQueue(
  _run: RunConfig,
  branches: string[],
  integration: Workspace,
  budget: Budget,
  deps?: PrQueueDeps
): Promise<PrQueueResult> {
  const runCmd = deps?.runCmd ?? defaultRunCmd;
  const runCIFn = deps?.runCI ?? defaultRunCI;
  const runAgentFn = deps?.runAgent ?? defaultRunAgent;
  const countAssertions =
    deps?.countAssertions ?? makeDefaultCountAssertions(runCmd);

  const dir = integration.dir;
  const prs: PrEntry[] = [];

  // -------------------------------------------------------------------------
  // Step 1: Env setup (best-effort; envError surfaced but not fatal)
  // -------------------------------------------------------------------------
  let envError = false;
  for (const argv of [
    ["pnpm", "install"],
    ["pnpm", "db:generate"],
    ["pnpm", "db:reset"],
  ]) {
    const { exit } = await runCmd({ argv, cwd: dir });
    if (exit !== 0) envError = true;
  }

  // -------------------------------------------------------------------------
  // Step 2: Record lastGreen as the current integration HEAD sha
  // -------------------------------------------------------------------------
  const { stdout: initialHead } = await runCmd({
    argv: ["git", "rev-parse", "HEAD"],
    cwd: dir,
  });
  let lastGreen = initialHead.trim();

  // Accumulators for integrationCost
  let totalTokens = 0;
  let totalTurns = 0;
  let totalWallMs = 0;
  let totalRounds = 0;

  // -------------------------------------------------------------------------
  // Step 3: Process each branch as a PR (no branch is ever skipped)
  // -------------------------------------------------------------------------
  for (const branch of branches) {
    // Step 3a: Attempt git merge --no-ff <branch>
    const { exit: mergeExit } = await runCmd({
      argv: [
        "git",
        "-c",
        "user.email=runner@clair",
        "-c",
        "user.name=Runner",
        "merge",
        "--no-ff",
        branch,
      ],
      cwd: dir,
    });

    if (mergeExit === 0) {
      // Merge committed cleanly — check CI
      const ci = await runCIFn(dir);
      if (ci.green) {
        // PR LANDS on first try — advance lastGreen
        const { stdout: newHead } = await runCmd({
          argv: ["git", "rev-parse", "HEAD"],
          cwd: dir,
        });
        lastGreen = newHead.trim();
        prs.push({ branch, outcome: "merged" });
        continue;
      }
      // Semantic failure: merge committed but CI red → blocked
    }

    // Blocked — either conflict (mergeExit !== 0) or semantic fail (mergeExit === 0, CI red)
    const blockReason: string = mergeExit !== 0 ? "conflict" : "ci-fail";

    // -----------------------------------------------------------------------
    // Step 3c: Fix sub-loop (single round; budget enforced inside runAgent)
    // -----------------------------------------------------------------------

    // Snapshot assertion count BEFORE the fix agent touches the tree
    const snapshotAssertions = await countAssertions(dir);

    const fixSpec: SliceSpec = {
      id: "fix-agent",
      title: "integration fix agent",
      prompt: FIX_PROMPT,
    };
    const agentResult = await runAgentFn(integration, fixSpec, budget);

    // Re-count and re-gate after the agent
    const postAssertions = await countAssertions(dir);
    const ci = await runCIFn(dir);

    // Tamper check: agent must not delete or weaken test assertions
    if (postAssertions < snapshotAssertions) {
      // TAMPERED — veto the landing, roll back, continue to next branch
      await runCmd({ argv: ["git", "reset", "--hard", lastGreen], cwd: dir });
      prs.push({ branch, outcome: "blocked", reason: "test-tampering", tampered: true });
      continue;
    }

    if (ci.green) {
      // PR LANDS via fix — advance lastGreen
      const { stdout: newHead } = await runCmd({
        argv: ["git", "rev-parse", "HEAD"],
        cwd: dir,
      });
      lastGreen = newHead.trim();

      totalTokens += agentResult.tokens;
      totalTurns += agentResult.turns;
      totalWallMs += agentResult.wallMs;
      totalRounds += 1;

      prs.push({
        branch,
        outcome: "merged",
        fixCost: {
          tokens: agentResult.tokens,
          turns: agentResult.turns,
          wallMs: agentResult.wallMs,
        },
        rounds: 1,
      });
      continue;
    }

    // Still not green — roll back to lastGreen so the next PR merges onto clean state
    await runCmd({ argv: ["git", "reset", "--hard", lastGreen], cwd: dir });
    prs.push({ branch, outcome: "blocked", reason: blockReason });
  }

  // -------------------------------------------------------------------------
  // Steps 4-5: Final state computation
  // -------------------------------------------------------------------------
  const anyTampered = prs.some((p) => p.tampered === true);
  const reachedSuccess = prs.every((p) => p.outcome === "merged") && !anyTampered;
  const didNotComplete = !reachedSuccess;

  return {
    prs,
    reachedSuccess,
    integrationCost: {
      tokens: totalTokens,
      turns: totalTurns,
      wallMs: totalWallMs,
    },
    rounds: totalRounds,
    envError,
    didNotComplete,
  };
}
