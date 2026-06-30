import { describe, it, expect } from "vitest";
import { runGate, LEVEL_GATE_FILES } from "../gate.js";
import type { GateResult, RunCmdFn } from "../gate.js";
import type { Workspace } from "../workspace.js";
import type { RunConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INTEGRATION: Workspace = {
  sliceId: "integration",
  dir: "/fake/integration",
  branch: "run/test/integration",
};

function makeRun(overrides?: Partial<RunConfig>): RunConfig {
  return {
    id: "test-run",
    base: { branch: "arena/base", sha: "" },
    gate: { branch: "arena/reference", sha: "", command: "" },
    arm: "",
    topology: "",
    level: "L1",
    slices: [
      { id: "S1", title: "Authz hardening", backlog: [] },
      { id: "S2", title: "Search", backlog: [] },
      { id: "S3", title: "Export", backlog: [] },
    ],
    agents: 3,
    model: "test-model",
    budget: { max_tokens_per_agent: 50_000, max_turns_per_agent: 10 },
    integration: { mode: "mechanical" },
    trials: { k: 1 },
    metrics: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Vitest JSON reporter fixture helpers
// Real vitest --reporter=json shape: testResults[].assertionResults[] with
// ancestorTitles, title, status.
// ---------------------------------------------------------------------------

interface VitestAssertionResult {
  ancestorTitles: string[];
  title: string;
  status: "passed" | "failed";
}

interface VitestJsonOutput {
  testResults: Array<{
    assertionResults: VitestAssertionResult[];
    name: string;
    status: string;
  }>;
}

function makeVitestJson(assertions: VitestAssertionResult[]): string {
  const suiteStatus = assertions.every((a) => a.status === "passed")
    ? "passed"
    : "failed";
  const output: VitestJsonOutput = {
    testResults: [
      {
        name: "gate/acceptance.test.ts",
        status: suiteStatus,
        assertionResults: assertions,
      },
    ],
  };
  return JSON.stringify(output);
}

/** All three slices pass. */
const ALL_PASS_JSON = makeVitestJson([
  {
    ancestorTitles: ["slice 1 — authz …"],
    title: "viewer-role receives 403 on POST /api/items",
    status: "passed",
  },
  {
    ancestorTitles: ["slice 1 — authz …"],
    title: "owner-role can POST /api/items",
    status: "passed",
  },
  {
    ancestorTitles: ["slice 2 — search …"],
    title: "full-text search returns matching items",
    status: "passed",
  },
  {
    ancestorTitles: ["slice 3 — export …"],
    title: "GET /api/items/export returns CSV",
    status: "passed",
  },
]);

/**
 * Slice 2 has NO assertions at all; slices 1 and 3 each have one passing assertion.
 * Used to verify that a slice with zero parsed assertions is NOT silently marked "pass".
 */
const SLICE2_MISSING_JSON = makeVitestJson([
  {
    ancestorTitles: ["slice 1 — authz …"],
    title: "viewer-role receives 403 on POST /api/items",
    status: "passed",
  },
  {
    ancestorTitles: ["slice 3 — export …"],
    title: "GET /api/items/export returns CSV",
    status: "passed",
  },
]);

/** Slice 2 has a failing assertion; slices 1 and 3 pass. */
const SLICE2_FAIL_JSON = makeVitestJson([
  {
    ancestorTitles: ["slice 1 — authz …"],
    title: "viewer-role receives 403 on POST /api/items",
    status: "passed",
  },
  {
    ancestorTitles: ["slice 2 — search …"],
    title: "full-text search returns matching items",
    status: "failed",
  },
  {
    ancestorTitles: ["slice 3 — export …"],
    title: "GET /api/items/export returns CSV",
    status: "passed",
  },
]);

// ---------------------------------------------------------------------------
// Fake RunCmdFn builder — dispatches by argv[0]/argv[1]
// ---------------------------------------------------------------------------

function makeFakeRunCmd(opts: {
  vitestOutput?: string;
  tscExit?: number;
  buildExit?: number;
} = {}): RunCmdFn {
  return async ({ argv }) => {
    const [cmd, sub] = argv;
    if (cmd === "git") return { stdout: "", exit: 0 };
    if (cmd === "pnpm" && sub === "install") return { stdout: "", exit: 0 };
    if (cmd === "pnpm" && sub === "vitest") {
      return { stdout: opts.vitestOutput ?? ALL_PASS_JSON, exit: 0 };
    }
    if (cmd === "pnpm" && sub === "typecheck") {
      return { stdout: "", exit: opts.tscExit ?? 0 };
    }
    if (cmd === "pnpm" && sub === "build") {
      return { stdout: "", exit: opts.buildExit ?? 0 };
    }
    return { stdout: "", exit: 0 };
  };
}

// ---------------------------------------------------------------------------
// Tests — required by spec
// ---------------------------------------------------------------------------

describe("runGate", () => {
  // Test 1: all slices pass, tsc/build clean
  it("all assertions pass, tsc exit 0, build exit 0 → allPass:true, all perSlice 'pass', tscClean/buildClean:true", async () => {
    const run = makeRun();
    const result: GateResult = await runGate(INTEGRATION, run, {
      runCmd: makeFakeRunCmd({ vitestOutput: ALL_PASS_JSON }),
    });

    expect(result.allPass).toBe(true);
    expect(result.perSlice["S1"]).toBe("pass");
    expect(result.perSlice["S2"]).toBe("pass");
    expect(result.perSlice["S3"]).toBe("pass");
    expect(result.tscClean).toBe(true);
    expect(result.buildClean).toBe(true);
  });

  // Test 2: slice-2 assertion fails
  it("slice-2 assertion fails → perSlice.S2='fail', allPass:false, S1/S3 still 'pass'", async () => {
    const run = makeRun();
    const result = await runGate(INTEGRATION, run, {
      runCmd: makeFakeRunCmd({ vitestOutput: SLICE2_FAIL_JSON }),
    });

    expect(result.perSlice["S1"]).toBe("pass");
    expect(result.perSlice["S2"]).toBe("fail");
    expect(result.perSlice["S3"]).toBe("pass");
    expect(result.allPass).toBe(false);
    // tsc/build still clean in this scenario
    expect(result.tscClean).toBe(true);
    expect(result.buildClean).toBe(true);
  });

  // Test 3: tsc exits non-zero (type-skew)
  it("tsc exit !== 0 → tscClean:false regardless of behavioral pass", async () => {
    const run = makeRun();
    const result = await runGate(INTEGRATION, run, {
      runCmd: makeFakeRunCmd({ vitestOutput: ALL_PASS_JSON, tscExit: 1 }),
    });

    expect(result.tscClean).toBe(false);
    // Behavioral pass is independent of tsc floor
    expect(result.allPass).toBe(true);
    expect(result.perSlice["S1"]).toBe("pass");
    expect(result.perSlice["S2"]).toBe("pass");
    expect(result.perSlice["S3"]).toBe("pass");
  });

  // ---------------------------------------------------------------------------
  // Additional coverage
  // ---------------------------------------------------------------------------

  it("build exit !== 0 → buildClean:false", async () => {
    const run = makeRun();
    const result = await runGate(INTEGRATION, run, {
      runCmd: makeFakeRunCmd({ vitestOutput: ALL_PASS_JSON, buildExit: 1 }),
    });

    expect(result.buildClean).toBe(false);
    expect(result.tscClean).toBe(true);
  });

  it("perSlice keys match exactly the run's slice ids", async () => {
    const run = makeRun();
    const result = await runGate(INTEGRATION, run, {
      runCmd: makeFakeRunCmd(),
    });

    expect(Object.keys(result.perSlice)).toEqual(["S1", "S2", "S3"]);
  });

  it("git checkout is called with cwd=integration.dir, correct ref and paths", async () => {
    const run = makeRun();
    const calls: Array<{ argv: string[]; cwd: string }> = [];
    const trackingRunCmd: RunCmdFn = async (cmd) => {
      calls.push(cmd);
      if (cmd.argv[0] === "pnpm" && cmd.argv[1] === "vitest") {
        return { stdout: ALL_PASS_JSON, exit: 0 };
      }
      return { stdout: "", exit: 0 };
    };

    await runGate(INTEGRATION, run, { runCmd: trackingRunCmd });

    const gitCall = calls.find((c) => c.argv[0] === "git");
    expect(gitCall).toBeDefined();
    expect(gitCall!.cwd).toBe(INTEGRATION.dir);
    expect(gitCall!.argv).toContain("origin/arena/reference");
    expect(gitCall!.argv).toContain("gate");
    expect(gitCall!.argv).toContain("vitest.gate.config.ts");
  });

  it("L1 level → vitest argv contains gate/acceptance.test.ts only (no upgrades)", async () => {
    const run = makeRun({ level: "L1" });
    const calls: Array<{ argv: string[]; cwd: string }> = [];
    const trackingRunCmd: RunCmdFn = async (cmd) => {
      calls.push(cmd);
      if (cmd.argv[0] === "pnpm" && cmd.argv[1] === "vitest") {
        return { stdout: ALL_PASS_JSON, exit: 0 };
      }
      return { stdout: "", exit: 0 };
    };

    await runGate(INTEGRATION, run, { runCmd: trackingRunCmd });

    const vitestCall = calls.find(
      (c) => c.argv[0] === "pnpm" && c.argv[1] === "vitest"
    );
    expect(vitestCall).toBeDefined();
    expect(vitestCall!.argv).toContain("gate/acceptance.test.ts");
    expect(vitestCall!.argv).not.toContain("gate/upgrades.test.ts");
    expect(vitestCall!.argv).toContain("--reporter=json");
    expect(vitestCall!.argv).toContain("vitest.gate.config.ts");
  });

  it("step order: git checkout → pnpm install → db:generate → vitest → typecheck → build", async () => {
    const run = makeRun();
    const order: string[] = [];
    const trackingRunCmd: RunCmdFn = async (cmd) => {
      const [c, sub] = cmd.argv;
      if (c === "git") order.push("git-checkout");
      else if (c === "pnpm" && sub === "install") order.push("pnpm-install");
      else if (c === "pnpm" && sub === "db:generate") order.push("pnpm-db:generate");
      else if (c === "pnpm" && sub === "vitest") {
        order.push("vitest");
        return { stdout: ALL_PASS_JSON, exit: 0 };
      } else if (c === "pnpm" && sub === "typecheck") order.push("typecheck");
      else if (c === "pnpm" && sub === "build") order.push("build");
      return { stdout: "", exit: 0 };
    };

    await runGate(INTEGRATION, run, { runCmd: trackingRunCmd });

    expect(order).toEqual([
      "git-checkout",
      "pnpm-install",
      "pnpm-db:generate",
      "vitest",
      "typecheck",
      "build",
    ]);
  });

  it("unparseable vitest stdout → all slices marked fail", async () => {
    const run = makeRun();
    const result = await runGate(INTEGRATION, run, {
      runCmd: makeFakeRunCmd({ vitestOutput: "not json at all" }),
    });

    expect(result.perSlice["S1"]).toBe("fail");
    expect(result.perSlice["S2"]).toBe("fail");
    expect(result.perSlice["S3"]).toBe("fail");
    expect(result.allPass).toBe(false);
  });

  // Fix 1: slice with zero parsed assertions must NOT default to 'pass'
  it("vitest JSON has slice-1 and slice-3 assertions but none for slice-2 → perSlice.S2='fail', allPass:false, S1/S3 pass", async () => {
    const run = makeRun();
    const result = await runGate(INTEGRATION, run, {
      runCmd: makeFakeRunCmd({ vitestOutput: SLICE2_MISSING_JSON }),
    });

    expect(result.perSlice["S1"]).toBe("pass");
    expect(result.perSlice["S2"]).toBe("fail");
    expect(result.perSlice["S3"]).toBe("pass");
    expect(result.allPass).toBe(false);
  });

  // Fix 2: unknown level must throw instead of silently falling back to L1
  it("level 'L99' → runGate rejects with an error message naming the level", async () => {
    const run = makeRun({ level: "L99" });
    await expect(
      runGate(INTEGRATION, run, { runCmd: makeFakeRunCmd() })
    ).rejects.toThrow("L99");
  });
});

// ---------------------------------------------------------------------------
// LEVEL_GATE_FILES mapping export
// ---------------------------------------------------------------------------

describe("LEVEL_GATE_FILES", () => {
  it("L1 maps to gate/acceptance.test.ts only", () => {
    expect(LEVEL_GATE_FILES["L1"]).toEqual(["gate/acceptance.test.ts"]);
  });

  it("L2 maps to acceptance + upgrades", () => {
    expect(LEVEL_GATE_FILES["L2"]).toEqual([
      "gate/acceptance.test.ts",
      "gate/upgrades.test.ts",
    ]);
  });
});
