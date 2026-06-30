/**
 * Tests for run.ts — the end-to-end driver.
 *
 * All stage functions are injected as fakes so no git operations,
 * no claude processes, and no disk I/O happen during tests.
 * The only real I/O is loadRun + buildSliceSpecs (reads actual yaml + backlog).
 */
import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark } from "../run.js";
import type { RunBenchmarkDeps } from "../run.js";
import type { Workspace } from "../workspace.js";
import type { AgentResult } from "../agent.js";
import type { MergeResult } from "../merge.js";
import type { GateResult } from "../gate.js";
import type { RunReport } from "../report.js";
import type { ResolutionResult } from "../resolve.js";

// ---------------------------------------------------------------------------
// Path setup
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const runPath = path.join(repoRoot, "benchmark/runs/standard-L1.run.yaml");
const resolverRunPath = path.join(repoRoot, "benchmark/runs/standard-L1-resolver.run.yaml");

// ---------------------------------------------------------------------------
// Fixture data — never touch real git or the filesystem
// ---------------------------------------------------------------------------

const fakeWorkspaces: Workspace[] = [
  { sliceId: "S1", dir: "/fake/w/S1", branch: "run/test/S1" },
  { sliceId: "S2", dir: "/fake/w/S2", branch: "run/test/S2" },
  { sliceId: "S3", dir: "/fake/w/S3", branch: "run/test/S3" },
];

const integrationWs: Workspace = {
  sliceId: "integration",
  dir: "/fake/w/integration",
  branch: "run/test/integration",
};

const fakeAgents: AgentResult[] = [
  { sliceId: "S1", committed: true, tokens: 100, turns: 3, wallMs: 1000, exit: 0, didNotComplete: false },
  { sliceId: "S2", committed: true, tokens: 200, turns: 4, wallMs: 2000, exit: 0, didNotComplete: false },
  { sliceId: "S3", committed: true, tokens: 150, turns: 2, wallMs: 1500, exit: 0, didNotComplete: false },
];

const fakeMerge: MergeResult = {
  integration: integrationWs,
  mergedCleanly: true,
  results: [
    { sliceId: "S1", branch: "run/test/S1", merged: true, conflictedFiles: [] },
    { sliceId: "S2", branch: "run/test/S2", merged: true, conflictedFiles: [] },
    { sliceId: "S3", branch: "run/test/S3", merged: true, conflictedFiles: [] },
  ],
};

const fakeGate: GateResult = {
  perSlice: { S1: "pass", S2: "pass", S3: "pass" },
  allPass: true,
  tscClean: true,
  buildClean: true,
};

const fakeReportResult = {
  json: {
    runId: "standard-L1-armA",
    wallMs: 5000,
    perSlice: {},
    textualConflicts: { total: 0, perSlice: {} },
    gate: { allPass: true, tscClean: true, buildClean: true },
    totals: { tokens: 450, turns: 9, agentsDidNotComplete: 0 },
    semanticConflict: false,
    outcome: "all-pass" as const,
  } as RunReport,
  summary: "Run: standard-L1-armA\nOutcome: all-pass",
  path: "/fake/out/standard-L1-armA.json",
};

// ---------------------------------------------------------------------------
// Test 1: Dry-run — the key safety test
// No stage fn (provision/runAgents/mergeSlices/runGate/writeReport/teardown)
// may be called. Returns a structured plan.
// ---------------------------------------------------------------------------

describe("runBenchmark — dry-run", () => {
  it("returns plan with 3 slices, configured model, per-slice prompts; NO stage fn called", async () => {
    // Keep raw spy refs so we can call expect(...) on them after the cast
    const provisionSpy = vi.fn();
    const runAgentsSpy = vi.fn();
    const mergeSlicesSpy = vi.fn();
    const runGateSpy = vi.fn();
    const writeReportSpy = vi.fn();
    const teardownSpy = vi.fn();

    const deps = {
      provision: provisionSpy,
      runAgents: runAgentsSpy,
      mergeSlices: mergeSlicesSpy,
      runGate: runGateSpy,
      writeReport: writeReportSpy,
      teardown: teardownSpy,
    } as unknown as RunBenchmarkDeps;

    const result = await runBenchmark(runPath, { dryRun: true }, deps);

    // Shape
    expect(result.dryRun).toBe(true);
    if (!result.dryRun) throw new Error("expected dryRun=true result");
    const { plan } = result;

    // 3 slices matching the YAML
    expect(plan.slices).toHaveLength(3);

    // Run-config metadata
    expect(plan.runId).toBe("standard-L1-armA");
    expect(plan.level).toBe("L1");
    expect(plan.arm).toBe("A");
    expect(plan.topology).toBe("local-worktrees");
    expect(plan.model).toBe("claude-opus-4-8");
    expect(plan.budget.max_tokens_per_agent).toBe(1500000);
    expect(plan.budget.max_turns_per_agent).toBe(120);

    // Per-slice fields: ids, titles, non-trivial prompts
    const ids = plan.slices.map((s) => s.id);
    expect(ids).toEqual(["S1", "S2", "S3"]);
    for (const s of plan.slices) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.prompt.length).toBeGreaterThan(100);
    }

    // CRITICAL: none of the stage functions called
    expect(provisionSpy).not.toHaveBeenCalled();
    expect(runAgentsSpy).not.toHaveBeenCalled();
    expect(mergeSlicesSpy).not.toHaveBeenCalled();
    expect(runGateSpy).not.toHaveBeenCalled();
    expect(writeReportSpy).not.toHaveBeenCalled();
    expect(teardownSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 2: Live orchestration order
// All stage functions injected as fakes. Verify call sequence.
// ---------------------------------------------------------------------------

describe("runBenchmark — live orchestration order", () => {
  it("stages called provision → runAgents → mergeSlices → runGate → writeReport → teardown; teardown AFTER writeReport", async () => {
    const callOrder: string[] = [];

    const provisionSpy = vi.fn(async () => { callOrder.push("provision"); return fakeWorkspaces; });
    const runAgentsSpy = vi.fn(async () => { callOrder.push("runAgents"); return fakeAgents; });
    const mergeSlicesSpy = vi.fn(async () => { callOrder.push("mergeSlices"); return fakeMerge; });
    const runGateSpy = vi.fn(async () => { callOrder.push("runGate"); return fakeGate; });
    const writeReportSpy = vi.fn(() => { callOrder.push("writeReport"); return fakeReportResult; });
    const teardownSpy = vi.fn(async () => { callOrder.push("teardown"); });

    const deps = {
      provision: provisionSpy,
      runAgents: runAgentsSpy,
      mergeSlices: mergeSlicesSpy,
      runGate: runGateSpy,
      writeReport: writeReportSpy,
      teardown: teardownSpy,
    } as unknown as RunBenchmarkDeps;

    const result = await runBenchmark(runPath, { dryRun: false }, deps);

    // Exact order
    expect(callOrder).toEqual([
      "provision",
      "runAgents",
      "mergeSlices",
      "runGate",
      "writeReport",
      "teardown",
    ]);

    // teardown explicitly AFTER writeReport
    expect(callOrder.indexOf("writeReport")).toBeLessThan(callOrder.indexOf("teardown"));

    // Return value reflects the fakeReportResult
    expect(result.dryRun).toBe(false);
    if (result.dryRun) throw new Error("expected dryRun=false");
    expect(result.outcome).toBe("all-pass");
  });
});

// ---------------------------------------------------------------------------
// Test 3: finally cleanup — teardown called even on error
// ---------------------------------------------------------------------------

describe("runBenchmark — finally cleanup", () => {
  it("teardown is called even if runGate throws; receives provisioned workspaces + integration; writeReport NOT called", async () => {
    const teardownSpy = vi.fn(async () => {});
    const writeReportSpy = vi.fn(() => fakeReportResult);

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      mergeSlices: vi.fn(async () => fakeMerge),
      runGate: vi.fn(async () => { throw new Error("gate exploded"); }),
      writeReport: writeReportSpy,
      teardown: teardownSpy,
    } as unknown as RunBenchmarkDeps;

    await expect(runBenchmark(runPath, { dryRun: false }, deps))
      .rejects.toThrow("gate exploded");

    // teardown still called
    expect(teardownSpy).toHaveBeenCalledOnce();

    // teardown received all slice workspaces + integration workspace
    const arg = teardownSpy.mock.calls[0]![0] as Workspace[];
    const sliceIds = new Set(arg.map((w) => w.sliceId));
    expect(sliceIds).toContain("S1");
    expect(sliceIds).toContain("S2");
    expect(sliceIds).toContain("S3");
    expect(sliceIds).toContain("integration");

    // writeReport was NOT called (gate threw before reaching it)
    expect(writeReportSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4: teardown error does not mask original stage error
// ---------------------------------------------------------------------------

describe("runBenchmark — teardown error masked by finally", () => {
  it("rejects with original GATE_BOOM error even when teardown also throws; teardown is still called", async () => {
    const teardownSpy = vi.fn(async () => { throw new Error("TEARDOWN_BOOM"); });

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      mergeSlices: vi.fn(async () => fakeMerge),
      runGate: vi.fn(async () => { throw new Error("GATE_BOOM"); }),
      writeReport: vi.fn(() => fakeReportResult),
      teardown: teardownSpy,
    } as unknown as RunBenchmarkDeps;

    await expect(runBenchmark(runPath, { dryRun: false }, deps))
      .rejects.toThrow("GATE_BOOM");

    expect(teardownSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Resolver-mode fixtures
// ---------------------------------------------------------------------------

const fakeResolution: ResolutionResult = {
  ran: true,
  tokens: 500,
  turns: 5,
  wallMs: 3000,
  reachedGreen: true,
  didNotResolve: false,
};

const fakeReportResultWithResolution = {
  ...fakeReportResult,
  resultPath: "/fake/results/run.json",
};

// ---------------------------------------------------------------------------
// Test 5: Resolver mode — call order and arg assertions
// ---------------------------------------------------------------------------

describe("runBenchmark — resolver mode", () => {
  it("call order is provision → runAgents → mergeSlices → runResolver → runGate → writeReport → teardown; mergeSlices called with onConflict:'leave'; runResolver receives merge.integration + branch names + budget; writeReport receives resolution", async () => {
    const callOrder: string[] = [];

    const mergeSlicesSpy = vi.fn(async () => { callOrder.push("mergeSlices"); return fakeMerge; });
    const runResolverSpy = vi.fn(async () => { callOrder.push("runResolver"); return fakeResolution; });
    const writeReportSpy = vi.fn(() => { callOrder.push("writeReport"); return fakeReportResultWithResolution; });

    const deps = {
      provision: vi.fn(async () => { callOrder.push("provision"); return fakeWorkspaces; }),
      runAgents: vi.fn(async () => { callOrder.push("runAgents"); return fakeAgents; }),
      mergeSlices: mergeSlicesSpy,
      runResolver: runResolverSpy,
      runGate: vi.fn(async () => { callOrder.push("runGate"); return fakeGate; }),
      writeReport: writeReportSpy,
      teardown: vi.fn(async () => { callOrder.push("teardown"); }),
    } as unknown as RunBenchmarkDeps;

    await runBenchmark(resolverRunPath, { dryRun: false }, deps);

    // Exact call order including runResolver between mergeSlices and runGate
    expect(callOrder).toEqual([
      "provision",
      "runAgents",
      "mergeSlices",
      "runResolver",
      "runGate",
      "writeReport",
      "teardown",
    ]);

    // mergeSlices must have been called with onConflict:'leave'
    const mergeOpts = mergeSlicesSpy.mock.calls[0]![2] as { onConflict?: string } | undefined;
    expect(mergeOpts?.onConflict).toBe("leave");

    // runResolver received (run, sliceBranchNames[], merge.integration, budget)
    const resolverArgs = runResolverSpy.mock.calls[0]!;
    const resolverBranchNames = resolverArgs[1] as string[];
    const resolverIntegration = resolverArgs[2] as Workspace;
    const resolverBudget = resolverArgs[3] as Record<string, unknown>;

    expect(resolverIntegration).toEqual(integrationWs);
    expect(resolverBranchNames).toEqual(expect.arrayContaining([
      "run/test/S1", "run/test/S2", "run/test/S3",
    ]));
    expect(resolverBranchNames).toHaveLength(3);
    // Budget mapped from resolver_budget in YAML: max_tokens:2000000, max_turns:200, model:claude-opus-4-8
    expect(resolverBudget).toMatchObject({
      max_tokens_per_agent: 2000000,
      max_turns_per_agent: 200,
      model: "claude-opus-4-8",
    });

    // writeReport must have received the resolution result in parts
    const reportParts = writeReportSpy.mock.calls[0]![1] as { resolution?: ResolutionResult };
    expect(reportParts.resolution).toEqual(fakeResolution);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Mechanical mode — runResolver NOT called; mergeSlices NOT 'leave'
// ---------------------------------------------------------------------------

describe("runBenchmark — mechanical mode (default)", () => {
  it("runResolver is NOT called; mergeSlices is NOT called with onConflict:'leave'", async () => {
    const runResolverSpy = vi.fn(async () => fakeResolution);
    const mergeSlicesSpy = vi.fn(async () => fakeMerge);

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      mergeSlices: mergeSlicesSpy,
      runResolver: runResolverSpy,
      runGate: vi.fn(async () => fakeGate),
      writeReport: vi.fn(() => fakeReportResult),
      teardown: vi.fn(async () => {}),
    } as unknown as RunBenchmarkDeps;

    // standard-L1.run.yaml has integration.mode: mechanical-merge (not 'resolver')
    await runBenchmark(runPath, { dryRun: false }, deps);

    expect(runResolverSpy).not.toHaveBeenCalled();

    const mergeOpts = mergeSlicesSpy.mock.calls[0]![2] as { onConflict?: string } | undefined;
    expect(mergeOpts?.onConflict).not.toBe("leave");
  });
});

// ---------------------------------------------------------------------------
// Test 7: Resolver failure still calls teardown
// ---------------------------------------------------------------------------

describe("runBenchmark — resolver failure still calls teardown", () => {
  it("a throw in runResolver does not prevent teardown from running", async () => {
    const teardownSpy = vi.fn(async () => {});

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      mergeSlices: vi.fn(async () => fakeMerge),
      runResolver: vi.fn(async () => { throw new Error("resolver blew up"); }),
      runGate: vi.fn(async () => fakeGate),
      writeReport: vi.fn(() => fakeReportResult),
      teardown: teardownSpy,
    } as unknown as RunBenchmarkDeps;

    await expect(runBenchmark(resolverRunPath, { dryRun: false }, deps))
      .rejects.toThrow("resolver blew up");

    expect(teardownSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Test 8: Results wiring — writeReport called with opts.resultsDir set
// ---------------------------------------------------------------------------

describe("runBenchmark — results wiring", () => {
  it("writeReport is called with opts.resultsDir set (so kept-file would be written) and a stamp string", async () => {
    const writeReportSpy = vi.fn(() => fakeReportResult);

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      mergeSlices: vi.fn(async () => fakeMerge),
      runGate: vi.fn(async () => fakeGate),
      writeReport: writeReportSpy,
      teardown: vi.fn(async () => {}),
    } as unknown as RunBenchmarkDeps;

    await runBenchmark(runPath, { dryRun: false }, deps);

    const opts = writeReportSpy.mock.calls[0]![2] as { resultsDir?: string; stamp?: string } | undefined;
    expect(opts?.resultsDir).toBeDefined();
    expect(typeof opts?.resultsDir).toBe("string");
    expect(opts?.stamp).toBeDefined();
    expect(typeof opts?.stamp).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Test 9: Dry-run on resolver config — integrationMode and resolverBudget in plan
// ---------------------------------------------------------------------------

describe("runBenchmark — dry-run resolver config integration mode", () => {
  it("returns integrationMode:'resolver' and resolverBudget; NO stage fn called", async () => {
    const provisionSpy = vi.fn();
    const runAgentsSpy = vi.fn();
    const mergeSlicesSpy = vi.fn();
    const runResolverSpy = vi.fn();
    const runGateSpy = vi.fn();
    const writeReportSpy = vi.fn();
    const teardownSpy = vi.fn();

    const deps = {
      provision: provisionSpy,
      runAgents: runAgentsSpy,
      mergeSlices: mergeSlicesSpy,
      runResolver: runResolverSpy,
      runGate: runGateSpy,
      writeReport: writeReportSpy,
      teardown: teardownSpy,
    } as unknown as RunBenchmarkDeps;

    const result = await runBenchmark(resolverRunPath, { dryRun: true }, deps);

    expect(result.dryRun).toBe(true);
    if (!result.dryRun) throw new Error("expected dryRun=true result");
    const { plan } = result;

    // Integration mode surfaced in the plan
    expect(plan.integrationMode).toBe("resolver");
    expect(plan.resolverBudget).toEqual({ max_tokens: 2000000, max_turns: 200 });

    // CRITICAL: none of the stage functions called in dry-run
    expect(provisionSpy).not.toHaveBeenCalled();
    expect(runAgentsSpy).not.toHaveBeenCalled();
    expect(mergeSlicesSpy).not.toHaveBeenCalled();
    expect(runResolverSpy).not.toHaveBeenCalled();
    expect(runGateSpy).not.toHaveBeenCalled();
    expect(writeReportSpy).not.toHaveBeenCalled();
    expect(teardownSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 10: Dry-run on mechanical config — integrationMode:'mechanical'; no resolverBudget
// ---------------------------------------------------------------------------

describe("runBenchmark — dry-run mechanical config integration mode", () => {
  it("returns integrationMode:'mechanical' with no resolverBudget; NO stage fn called", async () => {
    const provisionSpy = vi.fn();
    const runAgentsSpy = vi.fn();
    const mergeSlicesSpy = vi.fn();
    const runResolverSpy = vi.fn();
    const runGateSpy = vi.fn();
    const writeReportSpy = vi.fn();
    const teardownSpy = vi.fn();

    const deps = {
      provision: provisionSpy,
      runAgents: runAgentsSpy,
      mergeSlices: mergeSlicesSpy,
      runResolver: runResolverSpy,
      runGate: runGateSpy,
      writeReport: writeReportSpy,
      teardown: teardownSpy,
    } as unknown as RunBenchmarkDeps;

    const result = await runBenchmark(runPath, { dryRun: true }, deps);

    expect(result.dryRun).toBe(true);
    if (!result.dryRun) throw new Error("expected dryRun=true result");
    const { plan } = result;

    // standard-L1.run.yaml uses mechanical-merge mode
    expect(plan.integrationMode).toBe("mechanical");
    expect(plan.resolverBudget).toBeUndefined();

    // CRITICAL: none of the stage functions called in dry-run
    expect(provisionSpy).not.toHaveBeenCalled();
    expect(runAgentsSpy).not.toHaveBeenCalled();
    expect(mergeSlicesSpy).not.toHaveBeenCalled();
    expect(runResolverSpy).not.toHaveBeenCalled();
    expect(runGateSpy).not.toHaveBeenCalled();
    expect(writeReportSpy).not.toHaveBeenCalled();
    expect(teardownSpy).not.toHaveBeenCalled();
  });
});
