import { describe, it, expect } from "vitest";
import { runCI } from "../ci.js";
import type { CIResult } from "../ci.js";
import type { RunCmdFn } from "../shell.js";

// ---------------------------------------------------------------------------
// Vitest --reporter=json fixture helpers
// Real shape: { testResults: [ { assertionResults: [ { status, title, ... } ] } ] }
// ---------------------------------------------------------------------------

interface VitestAssertionResult {
  ancestorTitles: string[];
  title: string;
  status: "passed" | "failed" | "pending";
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
        name: "src/__tests__/app.test.ts",
        status: suiteStatus,
        assertionResults: assertions,
      },
    ],
  };
  return JSON.stringify(output);
}

/** All assertions pass, 3 passed, 0 failed. */
const ALL_PASS_JSON = makeVitestJson([
  {
    ancestorTitles: ["App"],
    title: "renders without crashing",
    status: "passed",
  },
  {
    ancestorTitles: ["App"],
    title: "handles user input",
    status: "passed",
  },
  {
    ancestorTitles: ["Utils"],
    title: "formatDate returns ISO string",
    status: "passed",
  },
]);

/** One failing assertion, 2 passed, 1 failed. */
const ONE_FAIL_JSON = makeVitestJson([
  {
    ancestorTitles: ["App"],
    title: "renders without crashing",
    status: "passed",
  },
  {
    ancestorTitles: ["App"],
    title: "handles user input",
    status: "failed",
  },
  {
    ancestorTitles: ["Utils"],
    title: "formatDate returns ISO string",
    status: "passed",
  },
]);

// ---------------------------------------------------------------------------
// Fake RunCmdFn builder
// ---------------------------------------------------------------------------

function makeFakeRunCmd(opts: {
  testOutput?: string;
  testExit?: number;
  tscExit?: number;
  buildExit?: number;
} = {}): RunCmdFn {
  return async ({ argv }) => {
    const [, sub] = argv;
    if (sub === "typecheck") {
      return { stdout: "", exit: opts.tscExit ?? 0 };
    }
    if (sub === "build") {
      return { stdout: "", exit: opts.buildExit ?? 0 };
    }
    if (sub === "test") {
      return {
        stdout: opts.testOutput ?? ALL_PASS_JSON,
        exit: opts.testExit ?? 0,
      };
    }
    return { stdout: "", exit: 0 };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCI", () => {
  // Test 1: all exit 0 + passing vitest JSON → green:true, correct totals
  it("all exit 0 + passing vitest JSON → green:true, tscClean/buildClean/testPass true, correct totals", async () => {
    const result: CIResult = await runCI("/fake/dir", {
      runCmd: makeFakeRunCmd({ testOutput: ALL_PASS_JSON }),
    });

    expect(result.green).toBe(true);
    expect(result.tscClean).toBe(true);
    expect(result.buildClean).toBe(true);
    expect(result.testPass).toBe(true);
    expect(result.testTotals.passed).toBe(3);
    expect(result.testTotals.failed).toBe(0);
  });

  // Test 2: failing test assertion → testPass:false, green:false
  it("vitest JSON has a failed assertion → testPass:false, green:false, totals reflect failure", async () => {
    const result: CIResult = await runCI("/fake/dir", {
      runCmd: makeFakeRunCmd({ testOutput: ONE_FAIL_JSON }),
    });

    expect(result.testPass).toBe(false);
    expect(result.green).toBe(false);
    expect(result.testTotals.passed).toBe(2);
    expect(result.testTotals.failed).toBe(1);
    // tsc/build still clean
    expect(result.tscClean).toBe(true);
    expect(result.buildClean).toBe(true);
  });

  // Test 2b: test command exit !== 0 → testPass:false even if JSON says passed
  it("test exit !== 0 → testPass:false, green:false", async () => {
    const result: CIResult = await runCI("/fake/dir", {
      runCmd: makeFakeRunCmd({ testOutput: ALL_PASS_JSON, testExit: 1 }),
    });

    expect(result.testPass).toBe(false);
    expect(result.green).toBe(false);
  });

  // Test 3: typecheck exit !== 0 → tscClean:false, green:false
  it("typecheck exit !== 0 → tscClean:false, green:false (even if tests pass)", async () => {
    const result: CIResult = await runCI("/fake/dir", {
      runCmd: makeFakeRunCmd({ tscExit: 1 }),
    });

    expect(result.tscClean).toBe(false);
    expect(result.green).toBe(false);
    // tests still pass in this scenario
    expect(result.testPass).toBe(true);
    expect(result.buildClean).toBe(true);
  });

  // Test 4: build exit !== 0 → buildClean:false, green:false
  it("build exit !== 0 → buildClean:false, green:false", async () => {
    const result: CIResult = await runCI("/fake/dir", {
      runCmd: makeFakeRunCmd({ buildExit: 1 }),
    });

    expect(result.buildClean).toBe(false);
    expect(result.green).toBe(false);
    expect(result.tscClean).toBe(true);
    expect(result.testPass).toBe(true);
  });

  // Test 5: unparseable test stdout → testPass:false, does not throw
  it("unparseable test stdout → testPass:false, totals 0, does not throw", async () => {
    const result: CIResult = await runCI("/fake/dir", {
      runCmd: makeFakeRunCmd({ testOutput: "not valid json {{{" }),
    });

    expect(result.testPass).toBe(false);
    expect(result.testTotals.passed).toBe(0);
    expect(result.testTotals.failed).toBe(0);
    expect(result.green).toBe(false);
  });

  // runCmd is called with correct cwd
  it("all three commands are invoked with the provided dir as cwd", async () => {
    const calls: Array<{ argv: string[]; cwd: string }> = [];
    const trackingRunCmd: RunCmdFn = async (cmd) => {
      calls.push(cmd);
      if (cmd.argv[1] === "test") return { stdout: ALL_PASS_JSON, exit: 0 };
      return { stdout: "", exit: 0 };
    };

    await runCI("/my/project", { runCmd: trackingRunCmd });

    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      expect(call.cwd).toBe("/my/project");
    }
  });

  // I-1: pnpm db:generate is called before pnpm typecheck (Prisma client regeneration)
  it("pnpm db:generate is called before pnpm typecheck", async () => {
    const calls: Array<{ argv: string[]; cwd: string }> = [];
    const trackingRunCmd: RunCmdFn = async (cmd) => {
      calls.push(cmd);
      if (cmd.argv[1] === "test") return { stdout: ALL_PASS_JSON, exit: 0 };
      return { stdout: "", exit: 0 };
    };

    await runCI("/my/project", { runCmd: trackingRunCmd });

    const dbGenIdx = calls.findIndex((c) => c.argv[1] === "db:generate");
    const typecheckIdx = calls.findIndex((c) => c.argv[1] === "typecheck");
    expect(dbGenIdx).toBeGreaterThanOrEqual(0); // must be called
    expect(typecheckIdx).toBeGreaterThanOrEqual(0);
    expect(dbGenIdx).toBeLessThan(typecheckIdx); // must come BEFORE typecheck
  });

  // pnpm test is called with --reporter=json
  it("pnpm test is invoked with --reporter=json", async () => {
    const calls: Array<{ argv: string[]; cwd: string }> = [];
    const trackingRunCmd: RunCmdFn = async (cmd) => {
      calls.push(cmd);
      if (cmd.argv[1] === "test") return { stdout: ALL_PASS_JSON, exit: 0 };
      return { stdout: "", exit: 0 };
    };

    await runCI("/my/project", { runCmd: trackingRunCmd });

    const testCall = calls.find((c) => c.argv[1] === "test");
    expect(testCall).toBeDefined();
    expect(testCall!.argv).toContain("--reporter=json");
  });

  // Zero-test false-green guard: exit 0 + valid JSON with no assertions must NOT be green
  it("exit 0 + valid JSON with zero assertions → testPass:false, green:false (no-tests false-green guard)", async () => {
    const emptyTestJson = JSON.stringify({ testResults: [] });
    const result: CIResult = await runCI("/fake/dir", {
      runCmd: makeFakeRunCmd({ testOutput: emptyTestJson, testExit: 0 }),
    });

    expect(result.testPass).toBe(false);
    expect(result.green).toBe(false);
    expect(result.testTotals.passed).toBe(0);
    expect(result.testTotals.failed).toBe(0);
  });

  // Multi-suite totals: assertions summed across multiple testResults entries
  it("sums assertionResults across multiple testResults suites", async () => {
    const multiSuiteJson = JSON.stringify({
      testResults: [
        {
          name: "suite-a.test.ts",
          status: "passed",
          assertionResults: [
            { ancestorTitles: [], title: "a1", status: "passed" },
            { ancestorTitles: [], title: "a2", status: "passed" },
          ],
        },
        {
          name: "suite-b.test.ts",
          status: "failed",
          assertionResults: [
            { ancestorTitles: [], title: "b1", status: "passed" },
            { ancestorTitles: [], title: "b2", status: "failed" },
          ],
        },
      ],
    });

    const result: CIResult = await runCI("/fake/dir", {
      runCmd: makeFakeRunCmd({ testOutput: multiSuiteJson }),
    });

    expect(result.testTotals.passed).toBe(3);
    expect(result.testTotals.failed).toBe(1);
    expect(result.testPass).toBe(false);
  });
});
