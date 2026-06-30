/**
 * ci.ts — run the local CI gate (build + typecheck + visible test suite)
 * against a worktree directory.
 *
 * Used by the benchmark PR-queue integration to validate each branch before
 * and after merging. This is the VISIBLE suite (`pnpm test`), not the
 * held-out gate (that's gate.ts).
 *
 * Every shell invocation goes through the injectable RunCmdFn so tests
 * never need real pnpm processes.
 */
import { defaultRunCmd } from "./shell.js";
import type { RunCmdFn } from "./shell.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CIResult {
  /** True iff `pnpm build` exited 0. */
  buildClean: boolean;
  /** True iff `pnpm typecheck` exited 0. */
  tscClean: boolean;
  /** True iff `pnpm test` exited 0 AND no assertion failed. */
  testPass: boolean;
  /** Counts summed from vitest JSON across all testResults suites. */
  testTotals: { passed: number; failed: number };
  /** True iff buildClean && tscClean && testPass. */
  green: boolean;
}

// ---------------------------------------------------------------------------
// Vitest JSON reporter shape (subset we consume)
// ---------------------------------------------------------------------------

interface AssertionResult {
  status: string; // "passed" | "failed" | "pending"
  title: string;
  ancestorTitles: string[];
}

interface VitestJsonOutput {
  testResults: Array<{
    assertionResults: AssertionResult[];
    name?: string;
    status?: string;
  }>;
}

// ---------------------------------------------------------------------------
// runCI
// ---------------------------------------------------------------------------

/**
 * Run the visible CI suite (typecheck + build + test) in `dir`.
 *
 * @param dir   Absolute path to the worktree / project directory.
 * @param deps  Optional injectable deps; defaults to real child_process impl.
 */
export async function runCI(
  dir: string,
  deps?: { runCmd?: RunCmdFn }
): Promise<CIResult> {
  const runCmd = deps?.runCmd ?? defaultRunCmd;

  // Step 1: typecheck
  const { exit: tscExit } = await runCmd({
    argv: ["pnpm", "typecheck"],
    cwd: dir,
  });
  const tscClean = tscExit === 0;

  // Step 2: build
  const { exit: buildExit } = await runCmd({
    argv: ["pnpm", "build"],
    cwd: dir,
  });
  const buildClean = buildExit === 0;

  // Step 3: run the visible test suite with JSON reporter for totals
  const { stdout: testStdout, exit: testExit } = await runCmd({
    argv: ["pnpm", "test", "--reporter=json"],
    cwd: dir,
  });

  // ---------------------------------------------------------------------------
  // Parse vitest JSON output → testTotals
  //
  // Sum assertionResults[].status across all testResults suites.
  // A status of "passed" counts as passed; anything else (failed, pending, …)
  // counts as failed.
  // Defensive: never throw; unparseable → treat as failure with 0 totals.
  // ---------------------------------------------------------------------------
  let passed = 0;
  let failed = 0;
  let parseOk = false;

  try {
    const parsed = JSON.parse(testStdout) as VitestJsonOutput;
    for (const suite of parsed.testResults ?? []) {
      for (const assertion of suite.assertionResults ?? []) {
        if (assertion.status === "passed") {
          passed++;
        } else {
          failed++;
        }
      }
    }
    parseOk = true;
  } catch {
    // Unparseable vitest output — totals stay 0, testPass will be false.
  }

  // testPass requires: command exited 0, JSON parsed cleanly, no failures,
  // and at least one assertion actually ran (guards against zero-test false-green).
  const testPass = testExit === 0 && parseOk && failed === 0 && passed > 0;

  const green = buildClean && tscClean && testPass;

  return {
    buildClean,
    tscClean,
    testPass,
    testTotals: { passed, failed },
    green,
  };
}
