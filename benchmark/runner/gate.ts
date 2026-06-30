/**
 * gate.ts — run the held-out acceptance gate against the integration worktree.
 *
 * Default argv sequence (per step):
 *  1. git checkout origin/arena/reference -- gate vitest.gate.config.ts
 *  2. pnpm install
 *  3. pnpm vitest run --config vitest.gate.config.ts <level-gate-files> --reporter=json
 *  4. pnpm typecheck   (tsc --noEmit)
 *  5. pnpm build
 *
 * Every shell invocation goes through the injectable RunCmdFn so tests
 * never need real git, pnpm, or vitest processes.
 */
import { spawn } from "node:child_process";
import type { RunConfig } from "./types.js";
import type { Workspace } from "./workspace.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GateResult {
  /** Pass/fail keyed by the run's slice ids (e.g. "S1", "S2", "S3"). */
  perSlice: Record<string, "pass" | "fail">;
  /** True iff every slice in the run passed the gate. */
  allPass: boolean;
  /** True iff `pnpm typecheck` exited 0. */
  tscClean: boolean;
  /** True iff `pnpm build` exited 0. */
  buildClean: boolean;
}

/**
 * Injectable shell-command abstraction.
 * argv[0] is the executable; rest are arguments.
 * The default implementation spawns the process and captures stdout.
 */
export type RunCmdFn = (cmd: {
  argv: string[];
  cwd: string;
}) => Promise<{ stdout: string; exit: number }>;

// ---------------------------------------------------------------------------
// Level → gate test files mapping
// L1 = base acceptance suite (slices 1-3).
// L2 = acceptance + upgrades (slices 4-5 added in the upgrades suite).
// ---------------------------------------------------------------------------
export const LEVEL_GATE_FILES: Record<string, string[]> = {
  L1: ["gate/acceptance.test.ts"],
  L2: ["gate/acceptance.test.ts", "gate/upgrades.test.ts"],
};

// ---------------------------------------------------------------------------
// Vitest JSON reporter shape (subset we consume)
// Standard shape: { testResults: [ { assertionResults: [ { ancestorTitles, title, status } ] } ] }
// ---------------------------------------------------------------------------
interface AssertionResult {
  ancestorTitles: string[];
  status: string; // "passed" | "failed" | "pending"
  title: string;
}

interface VitestJsonOutput {
  testResults: Array<{
    assertionResults: AssertionResult[];
    name?: string;
    status?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Default (real) implementation
// ---------------------------------------------------------------------------
function defaultRunCmd(cmd: {
  argv: string[];
  cwd: string;
}): Promise<{ stdout: string; exit: number }> {
  const [file, ...args] = cmd.argv;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: cmd.cwd,
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the 1-based slice ordinal from an assertion's ancestor titles.
 * Matches "slice 1", "slice 2 — search …", "Slice 3", etc.
 * Returns null when no match is found.
 */
function sliceOrdinal(ancestorTitles: string[]): number | null {
  for (const t of ancestorTitles) {
    const m = t.match(/slice\s+(\d+)/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// ---------------------------------------------------------------------------
// runGate
// ---------------------------------------------------------------------------

/**
 * Run the held-out acceptance gate against the merged integration worktree.
 *
 * @param integration  The integration worktree produced by Task 4 (mergeSlices).
 * @param run          The current RunConfig (provides level, slice ids).
 * @param deps         Optional injectable deps; defaults to real child_process impl.
 */
export async function runGate(
  integration: Workspace,
  run: RunConfig,
  deps?: { runCmd?: RunCmdFn }
): Promise<GateResult> {
  const runCmd = deps?.runCmd ?? defaultRunCmd;
  const dir = integration.dir;

  // Step 1: bring gate files into the integration worktree from origin/arena/reference.
  // We check out the gate/ directory and vitest.gate.config.ts from the reference branch
  // directly into the worktree — no extra worktree needed.
  await runCmd({
    argv: [
      "git", "checkout", "origin/arena/reference",
      "--", "gate", "vitest.gate.config.ts",
    ],
    cwd: dir,
  });

  // Step 2: install dependencies (the gate may have additional deps).
  await runCmd({ argv: ["pnpm", "install"], cwd: dir });

  // Step 3: run the gate test subset for this level with vitest JSON reporter.
  const gateFiles = LEVEL_GATE_FILES[run.level];
  if (!gateFiles) {
    throw new Error(
      `Unknown level: "${run.level}" — add it to LEVEL_GATE_FILES`
    );
  }
  const { stdout: vitestStdout } = await runCmd({
    argv: [
      "pnpm", "vitest", "run",
      "--config", "vitest.gate.config.ts",
      ...gateFiles,
      "--reporter=json",
    ],
    cwd: dir,
  });

  // Step 4: typecheck floor — non-zero exit means type-skew.
  const { exit: tscExit } = await runCmd({ argv: ["pnpm", "typecheck"], cwd: dir });
  const tscClean = tscExit === 0;

  // Step 5: build floor.
  const { exit: buildExit } = await runCmd({ argv: ["pnpm", "build"], cwd: dir });
  const buildClean = buildExit === 0;

  // ---------------------------------------------------------------------------
  // Parse vitest JSON output → per-slice pass/fail
  //
  // Each assertion's ancestorTitles contains "slice N" (e.g. "slice 2 — search …").
  // Ordinal N maps to run.slices[N-1].id.
  // A slice passes iff ALL its assertions have status === "passed".
  // ---------------------------------------------------------------------------
  const perSlice: Record<string, "pass" | "fail"> = {};
  for (const s of run.slices) perSlice[s.id] = "pass";

  try {
    const parsed = JSON.parse(vitestStdout) as VitestJsonOutput;
    const failedOrdinals = new Set<number>();
    const slicesSeen = new Set<number>();

    for (const suite of parsed.testResults ?? []) {
      for (const assertion of suite.assertionResults ?? []) {
        const ord = sliceOrdinal(assertion.ancestorTitles);
        if (ord !== null) {
          slicesSeen.add(ord);
          if (assertion.status !== "passed") {
            failedOrdinals.add(ord);
          }
        }
      }
    }

    for (const ord of failedOrdinals) {
      const slice = run.slices[ord - 1];
      if (slice) perSlice[slice.id] = "fail";
    }

    // A run slice whose ordinal never appeared in the parsed JSON is untested —
    // treat it as a failure (not a silent pass).
    for (let i = 0; i < run.slices.length; i++) {
      const ord = i + 1;
      if (!slicesSeen.has(ord)) {
        perSlice[run.slices[i].id] = "fail";
      }
    }
  } catch {
    // Unparseable vitest output — safest to mark all slices failed.
    for (const s of run.slices) perSlice[s.id] = "fail";
  }

  const allPass = run.slices.every((s) => perSlice[s.id] === "pass");

  return { perSlice, allPass, tscClean, buildClean };
}
