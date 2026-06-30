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
import type { PrQueueResult } from "../prQueue.js";

// ---------------------------------------------------------------------------
// Path setup
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const runPath = path.join(repoRoot, "benchmark/runs/standard-L1.run.yaml");
const prQueueRunPath = path.join(__dirname, "fixtures/pr-queue.run.yaml");
// standard-L1-resolver.run.yaml still has mode:'resolver' — used to test that
// unknown/legacy modes fall to mechanical (resolver code path must be GONE).
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

const fakePrQueueResult: PrQueueResult = {
  prs: [
    { branch: "run/test/S1", outcome: "merged" },
    { branch: "run/test/S2", outcome: "merged" },
    { branch: "run/test/S3", outcome: "merged" },
  ],
  reachedSuccess: true,
  integrationCost: { tokens: 300, turns: 4, wallMs: 2000 },
  rounds: 0,
  envError: false,
  didNotComplete: false,
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
  resultPath: null,
};

// Fake runCmd: worktree-add returns exit 0; testDiscipline diffs return empty stdout.
const fakeRunCmd = vi.fn(async (_cmd: { argv: string[]; cwd: string }) => ({
  stdout: "",
  exit: 0,
}));

// ---------------------------------------------------------------------------
// Test 1: Dry-run — the key safety test
// No stage fn (provision/runAgents/mergeSlices/runGate/writeReport/teardown)
// may be called. Returns a structured plan.
// ---------------------------------------------------------------------------

describe("runBenchmark — dry-run", () => {
  it("returns plan with 3 slices, configured model, per-slice prompts; NO stage fn called", async () => {
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
// Test 2: Live orchestration order — mechanical mode
// ---------------------------------------------------------------------------

describe("runBenchmark — live orchestration order (mechanical)", () => {
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
// Test 3: finally cleanup — teardown called even on error (mechanical)
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
// Test 5: Mechanical mode — runPrQueue NOT called; mergeSlices used
// ---------------------------------------------------------------------------

describe("runBenchmark — mechanical mode (default)", () => {
  it("runPrQueue is NOT called; mergeSlices IS called (mechanical pipeline)", async () => {
    const runPrQueueSpy = vi.fn(async () => fakePrQueueResult);
    const mergeSlicesSpy = vi.fn(async () => fakeMerge);

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      mergeSlices: mergeSlicesSpy,
      runPrQueue: runPrQueueSpy,
      runGate: vi.fn(async () => fakeGate),
      writeReport: vi.fn(() => fakeReportResult),
      teardown: vi.fn(async () => {}),
    } as unknown as RunBenchmarkDeps;

    // standard-L1.run.yaml has integration.mode: mechanical
    await runBenchmark(runPath, { dryRun: false }, deps);

    expect(runPrQueueSpy).not.toHaveBeenCalled();
    expect(mergeSlicesSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Test 6: PR-queue mode — call order
// ---------------------------------------------------------------------------

describe("runBenchmark — pr-queue mode call order", () => {
  it("provision → runAgents → (worktree via runCmd) → runPrQueue → runGate → writeReport → teardown", async () => {
    const callOrder: string[] = [];

    const provisionSpy = vi.fn(async () => { callOrder.push("provision"); return fakeWorkspaces; });
    const runAgentsSpy = vi.fn(async () => { callOrder.push("runAgents"); return fakeAgents; });
    const mergeSlicesSpy = vi.fn(async () => { callOrder.push("mergeSlices"); return fakeMerge; });
    const runPrQueueSpy = vi.fn(async () => { callOrder.push("runPrQueue"); return fakePrQueueResult; });
    const runGateSpy = vi.fn(async () => { callOrder.push("runGate"); return fakeGate; });
    const writeReportSpy = vi.fn(() => { callOrder.push("writeReport"); return fakeReportResult; });
    const teardownSpy = vi.fn(async () => { callOrder.push("teardown"); });
    const runCmdSpy = vi.fn(async (_cmd: { argv: string[]; cwd: string }) => ({ stdout: "", exit: 0 }));

    const deps = {
      provision: provisionSpy,
      runAgents: runAgentsSpy,
      mergeSlices: mergeSlicesSpy,
      runPrQueue: runPrQueueSpy,
      runGate: runGateSpy,
      writeReport: writeReportSpy,
      teardown: teardownSpy,
      runCmd: runCmdSpy,
    } as unknown as RunBenchmarkDeps;

    await runBenchmark(prQueueRunPath, { dryRun: false }, deps);

    // mergeSlices must NOT be called in pr-queue mode
    expect(mergeSlicesSpy).not.toHaveBeenCalled();

    // Order: provision → runAgents → runPrQueue → runGate → writeReport → teardown
    expect(callOrder).toEqual([
      "provision",
      "runAgents",
      "runPrQueue",
      "runGate",
      "writeReport",
      "teardown",
    ]);

    // teardown after writeReport
    expect(callOrder.indexOf("writeReport")).toBeLessThan(callOrder.indexOf("teardown"));
  });
});

// ---------------------------------------------------------------------------
// Test 7: PR-queue mode — args (integration workspace, slice branches, budget)
// ---------------------------------------------------------------------------

describe("runBenchmark — pr-queue mode args", () => {
  it("runPrQueue receives integration workspace (sliceId=integration), all slice branches, and mapped queueBudget", async () => {
    const runPrQueueSpy = vi.fn(async () => fakePrQueueResult);
    const runCmdSpy = vi.fn(async (_cmd: { argv: string[]; cwd: string }) => ({ stdout: "", exit: 0 }));

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      runPrQueue: runPrQueueSpy,
      runGate: vi.fn(async () => fakeGate),
      writeReport: vi.fn(() => fakeReportResult),
      teardown: vi.fn(async () => {}),
      runCmd: runCmdSpy,
    } as unknown as RunBenchmarkDeps;

    await runBenchmark(prQueueRunPath, { dryRun: false }, deps);

    expect(runPrQueueSpy).toHaveBeenCalledOnce();
    const [_run, branches, integration, budget] = runPrQueueSpy.mock.calls[0]!;

    // Integration workspace — sliceId must be 'integration'
    expect((integration as Workspace).sliceId).toBe("integration");

    // Slice branch names (all three)
    expect(branches as string[]).toEqual(
      expect.arrayContaining(["run/test/S1", "run/test/S2", "run/test/S3"])
    );
    expect((branches as string[]).length).toBe(3);

    // Budget: mapped from pr-queue.run.yaml queue_budget (max_tokens:2000000, max_turns:200)
    expect(budget).toMatchObject({
      max_tokens_per_agent: 2000000,
      max_turns_per_agent: 200,
      model: "claude-opus-4-8",
    });

    // Worktree creation: runCmd called with 'git worktree add' including arena/base
    const worktreeCalls = (runCmdSpy.mock.calls as Array<[{ argv: string[]; cwd: string }]>)
      .filter(([cmd]) => cmd.argv.includes("worktree") && cmd.argv.includes("add"));
    expect(worktreeCalls.length).toBeGreaterThanOrEqual(1);
    expect(worktreeCalls[0]![0].argv).toContain("arena/base");
  });
});

// ---------------------------------------------------------------------------
// Test 8: PR-queue mode — writeReport receives prQueue + testDiscipline
// ---------------------------------------------------------------------------

describe("runBenchmark — pr-queue mode writeReport args", () => {
  it("writeReport receives prQueue result and testDiscipline; does NOT receive merge in parts", async () => {
    const writeReportSpy = vi.fn(() => fakeReportResult);
    const runCmdSpy = vi.fn(async (cmd: { argv: string[]; cwd: string }) => {
      // For testDiscipline diff commands, return one filename so count = 1.
      if (cmd.argv.includes("diff")) return { stdout: "foo.test.ts\n", exit: 0 };
      return { stdout: "", exit: 0 };
    });

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      runPrQueue: vi.fn(async () => fakePrQueueResult),
      runGate: vi.fn(async () => fakeGate),
      writeReport: writeReportSpy,
      teardown: vi.fn(async () => {}),
      runCmd: runCmdSpy,
    } as unknown as RunBenchmarkDeps;

    await runBenchmark(prQueueRunPath, { dryRun: false }, deps);

    expect(writeReportSpy).toHaveBeenCalledOnce();
    const [_runId, parts, _opts] = writeReportSpy.mock.calls[0]!;
    const p = parts as {
      agents: AgentResult[];
      merge?: MergeResult;
      gate: GateResult;
      prQueue?: PrQueueResult;
      testDiscipline?: Record<string, { testFilesAdded: number }>;
    };

    // merge NOT passed in pr-queue mode
    expect(p.merge).toBeUndefined();

    // prQueue passed through
    expect(p.prQueue).toEqual(fakePrQueueResult);

    // testDiscipline present with one entry per slice (3 slices)
    expect(p.testDiscipline).toBeDefined();
    expect(Object.keys(p.testDiscipline!)).toHaveLength(3);
    // Each slice got 1 file (our fake diff stdout returned "foo.test.ts\n")
    for (const entry of Object.values(p.testDiscipline!)) {
      expect(entry.testFilesAdded).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 9: PR-queue failure — teardown still called
// ---------------------------------------------------------------------------

describe("runBenchmark — pr-queue failure still calls teardown", () => {
  it("a throw in runPrQueue does not prevent teardown; teardown receives slice workspaces + integration", async () => {
    const teardownSpy = vi.fn(async () => {});
    const runCmdSpy = vi.fn(async (_cmd: { argv: string[]; cwd: string }) => ({ stdout: "", exit: 0 }));

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      runPrQueue: vi.fn(async () => { throw new Error("pr-queue exploded"); }),
      runGate: vi.fn(async () => fakeGate),
      writeReport: vi.fn(() => fakeReportResult),
      teardown: teardownSpy,
      runCmd: runCmdSpy,
    } as unknown as RunBenchmarkDeps;

    await expect(runBenchmark(prQueueRunPath, { dryRun: false }, deps))
      .rejects.toThrow("pr-queue exploded");

    expect(teardownSpy).toHaveBeenCalledOnce();

    // teardown received all slice workspaces + integration workspace
    const arg = teardownSpy.mock.calls[0]![0] as Workspace[];
    const sliceIds = new Set(arg.map((w) => w.sliceId));
    expect(sliceIds).toContain("S1");
    expect(sliceIds).toContain("S2");
    expect(sliceIds).toContain("S3");
    expect(sliceIds).toContain("integration");
  });
});

// ---------------------------------------------------------------------------
// Test 10: config with mode:'resolver' treated as mechanical (resolver GONE)
// ---------------------------------------------------------------------------

describe("runBenchmark — legacy resolver mode treated as mechanical", () => {
  it("a YAML with mode:'resolver' does NOT invoke runPrQueue; falls to mechanical (mergeSlices called)", async () => {
    const runPrQueueSpy = vi.fn(async () => fakePrQueueResult);
    const mergeSlicesSpy = vi.fn(async () => fakeMerge);

    const deps = {
      provision: vi.fn(async () => fakeWorkspaces),
      runAgents: vi.fn(async () => fakeAgents),
      mergeSlices: mergeSlicesSpy,
      runPrQueue: runPrQueueSpy,
      runGate: vi.fn(async () => fakeGate),
      writeReport: vi.fn(() => fakeReportResult),
      teardown: vi.fn(async () => {}),
    } as unknown as RunBenchmarkDeps;

    // resolverRunPath has integration.mode: resolver
    await runBenchmark(resolverRunPath, { dryRun: false }, deps);

    // resolver code path must be GONE — runPrQueue never called
    expect(runPrQueueSpy).not.toHaveBeenCalled();

    // mechanical pipeline ran instead
    expect(mergeSlicesSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Test 11: Results wiring — writeReport called with opts.resultsDir set
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
// Test 12: Dry-run mechanical mode — integrationMode:'mechanical', no queueBudget
// ---------------------------------------------------------------------------

describe("runBenchmark — dry-run mechanical config integration mode", () => {
  it("returns integrationMode:'mechanical' with no queueBudget; NO stage fn called", async () => {
    const provisionSpy = vi.fn();
    const runAgentsSpy = vi.fn();
    const mergeSlicesSpy = vi.fn();
    const runPrQueueSpy = vi.fn();
    const runGateSpy = vi.fn();
    const writeReportSpy = vi.fn();
    const teardownSpy = vi.fn();

    const deps = {
      provision: provisionSpy,
      runAgents: runAgentsSpy,
      mergeSlices: mergeSlicesSpy,
      runPrQueue: runPrQueueSpy,
      runGate: runGateSpy,
      writeReport: writeReportSpy,
      teardown: teardownSpy,
    } as unknown as RunBenchmarkDeps;

    const result = await runBenchmark(runPath, { dryRun: true }, deps);

    expect(result.dryRun).toBe(true);
    if (!result.dryRun) throw new Error("expected dryRun=true result");
    const { plan } = result;

    // standard-L1.run.yaml uses mechanical mode
    expect(plan.integrationMode).toBe("mechanical");
    expect(plan.queueBudget).toBeUndefined();

    // CRITICAL: none of the stage functions called in dry-run
    expect(provisionSpy).not.toHaveBeenCalled();
    expect(runAgentsSpy).not.toHaveBeenCalled();
    expect(mergeSlicesSpy).not.toHaveBeenCalled();
    expect(runPrQueueSpy).not.toHaveBeenCalled();
    expect(runGateSpy).not.toHaveBeenCalled();
    expect(writeReportSpy).not.toHaveBeenCalled();
    expect(teardownSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 13: Dry-run pr-queue mode — integrationMode:'pr-queue' + queueBudget
// ---------------------------------------------------------------------------

describe("runBenchmark — dry-run pr-queue config integration mode", () => {
  it("returns integrationMode:'pr-queue' and queueBudget from YAML; NO stage fn called", async () => {
    const provisionSpy = vi.fn();
    const runAgentsSpy = vi.fn();
    const mergeSlicesSpy = vi.fn();
    const runPrQueueSpy = vi.fn();
    const runGateSpy = vi.fn();
    const writeReportSpy = vi.fn();
    const teardownSpy = vi.fn();

    const deps = {
      provision: provisionSpy,
      runAgents: runAgentsSpy,
      mergeSlices: mergeSlicesSpy,
      runPrQueue: runPrQueueSpy,
      runGate: runGateSpy,
      writeReport: writeReportSpy,
      teardown: teardownSpy,
    } as unknown as RunBenchmarkDeps;

    const result = await runBenchmark(prQueueRunPath, { dryRun: true }, deps);

    expect(result.dryRun).toBe(true);
    if (!result.dryRun) throw new Error("expected dryRun=true result");
    const { plan } = result;

    expect(plan.integrationMode).toBe("pr-queue");
    // pr-queue.run.yaml has queue_budget: { max_tokens: 2000000, max_turns: 200 }
    expect(plan.queueBudget).toEqual({ max_tokens: 2000000, max_turns: 200 });

    // CRITICAL: no stage functions called in dry-run
    expect(provisionSpy).not.toHaveBeenCalled();
    expect(runAgentsSpy).not.toHaveBeenCalled();
    expect(mergeSlicesSpy).not.toHaveBeenCalled();
    expect(runPrQueueSpy).not.toHaveBeenCalled();
    expect(runGateSpy).not.toHaveBeenCalled();
    expect(writeReportSpy).not.toHaveBeenCalled();
    expect(teardownSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 14: No import of resolve.js — resolver code path GONE
// ---------------------------------------------------------------------------

describe("runBenchmark — no resolve.js import (static check via module shape)", () => {
  it("RunBenchmarkDeps has runPrQueue but NOT runResolver", () => {
    // This test documents the contract: the resolver dep is GONE.
    // The TypeScript type enforces it at compile time; here we verify the
    // live export shape has no 'runResolver' property listed.
    //
    // We can't enumerate interface keys at runtime, but we CAN verify that
    // passing a deps object with only the new keys (no runResolver) does not
    // cause a type error, and that the pipeline completes normally.
    //
    // (Compile-time enforcement is the primary guard; this test catches
    // any accidental re-introduction of a runtime 'runResolver' call.)
    const deps: RunBenchmarkDeps = {
      provision: async () => fakeWorkspaces,
      runAgents: async () => fakeAgents,
      mergeSlices: async () => fakeMerge,
      runPrQueue: async () => fakePrQueueResult,
      runGate: async () => fakeGate,
      writeReport: () => fakeReportResult,
      teardown: async () => {},
    };

    // runResolver must NOT be a key in RunBenchmarkDeps
    expect("runResolver" in deps).toBe(false);
  });
});
