import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeReport } from "../report.js";
import type { RunReport } from "../report.js";
import type { AgentResult } from "../agent.js";
import type { MergeResult } from "../merge.js";
import type { GateResult } from "../gate.js";
import type { ResolutionResult } from "../resolve.js";
import type { PrQueueResult } from "../prQueue.js";

// Real benchmark/results/ path — used to assert no test pollution.
const REAL_RESULTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../results"
);

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeAgents(overrides?: Partial<AgentResult>[]): AgentResult[] {
  const defaults: AgentResult[] = [
    {
      sliceId: "S1",
      committed: true,
      tokens: 1000,
      turns: 3,
      wallMs: 4000,
      exit: 0,
      didNotComplete: false,
    },
    {
      sliceId: "S2",
      committed: true,
      tokens: 2000,
      turns: 5,
      wallMs: 6000,
      exit: 0,
      didNotComplete: false,
    },
    {
      sliceId: "S3",
      committed: true,
      tokens: 500,
      turns: 2,
      wallMs: 3000,
      exit: 0,
      didNotComplete: false,
    },
  ];
  if (!overrides) return defaults;
  return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
}

function makeAllPassMerge(): MergeResult {
  return {
    integration: { sliceId: "integration", dir: "/fake/integration", branch: "run/test/integration" },
    mergedCleanly: true,
    results: [
      { sliceId: "S1", branch: "run/test/S1", merged: true, conflictedFiles: [] },
      { sliceId: "S2", branch: "run/test/S2", merged: true, conflictedFiles: [] },
      { sliceId: "S3", branch: "run/test/S3", merged: true, conflictedFiles: [] },
    ],
  };
}

function makeAllPassGate(): GateResult {
  return {
    perSlice: { S1: "pass", S2: "pass", S3: "pass" },
    allPass: true,
    tscClean: true,
    buildClean: true,
  };
}

// ---------------------------------------------------------------------------
// Temp-dir management
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "report-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// ---------------------------------------------------------------------------
// Test 1: all-pass scenario — JSON shape, file written
// ---------------------------------------------------------------------------

describe("writeReport — all-pass scenario", () => {
  it("outcome=all-pass, semanticConflict=false, perSlice joined, totals correct, file written", () => {
    const outDir = makeTempDir();
    const agents = makeAgents();
    const merge = makeAllPassMerge();
    const gate = makeAllPassGate();

    const { json, path: filePath } = writeReport(
      "run-001",
      { agents, merge, gate, wallMs: 15000 },
      { outDir }
    );

    // Headline fields
    expect(json.outcome).toBe("all-pass");
    expect(json.semanticConflict).toBe(false);
    expect(json.runId).toBe("run-001");
    expect(json.wallMs).toBe(15000);

    // Gate block
    expect(json.gate.allPass).toBe(true);
    expect(json.gate.tscClean).toBe(true);
    expect(json.gate.buildClean).toBe(true);

    // perSlice — all three slices joined
    expect(Object.keys(json.perSlice)).toEqual(["S1", "S2", "S3"]);
    const s1 = json.perSlice["S1"]!;
    expect(s1.committed).toBe(true);
    expect(s1.tokens).toBe(1000);
    expect(s1.turns).toBe(3);
    expect(s1.didNotComplete).toBe(false);
    expect(s1.merged).toBe(true);
    expect(s1.conflictedFiles).toEqual([]);
    expect(s1.gate).toBe("pass");

    // Totals
    expect(json.totals.tokens).toBe(1000 + 2000 + 500);  // 3500
    expect(json.totals.turns).toBe(3 + 5 + 2);            // 10
    expect(json.totals.agentsDidNotComplete).toBe(0);

    // textualConflicts
    expect(json.textualConflicts.total).toBe(0);

    // File written and parseable
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toBe(path.join(outDir, "run-001.json"));
    const parsed: RunReport = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(parsed.outcome).toBe("all-pass");
    expect(parsed.totals.tokens).toBe(3500);
  });
});

// ---------------------------------------------------------------------------
// Test 2: SEMANTIC CONFLICT — the core instrument
// ---------------------------------------------------------------------------

describe("writeReport — semantic conflict (THE important test)", () => {
  it("mergedCleanly=true && gate.allPass=false → semanticConflict=true and summary contains the marker", () => {
    const outDir = makeTempDir();
    const agents = makeAgents();

    // Merge succeeded cleanly (no textual conflicts)
    const merge = makeAllPassMerge();  // mergedCleanly: true

    // But the gate found a failure
    const gate: GateResult = {
      perSlice: { S1: "pass", S2: "fail", S3: "pass" },
      allPass: false,          // <-- gate failed
      tscClean: true,
      buildClean: true,
    };

    const { json, summary } = writeReport(
      "run-002",
      { agents, merge, gate, wallMs: 12000 },
      { outDir }
    );

    // The headline instrument
    expect(json.semanticConflict).toBe(true);

    // outcome must reflect gate failure
    expect(json.outcome).toBe("fail");

    // The summary MUST carry the explicit human-readable marker
    expect(summary).toContain("SEMANTIC CONFLICT");
    expect(summary).toContain("merged clean but gate failed");

    // per-slice gate verdict is joined correctly
    expect(json.perSlice["S2"]!.gate).toBe("fail");
    expect(json.perSlice["S1"]!.gate).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Test 3: textual conflict — conflictedFiles counted
// ---------------------------------------------------------------------------

describe("writeReport — textual conflict", () => {
  it("slice with non-empty conflictedFiles is reflected in textualConflicts", () => {
    const outDir = makeTempDir();
    const agents = makeAgents();

    const merge: MergeResult = {
      integration: { sliceId: "integration", dir: "/fake/int", branch: "run/t/integration" },
      mergedCleanly: false,    // textual conflict prevented a clean merge
      results: [
        { sliceId: "S1", branch: "run/t/S1", merged: true, conflictedFiles: [] },
        { sliceId: "S2", branch: "run/t/S2", merged: false, conflictedFiles: ["src/foo.ts", "src/bar.ts"] },
        { sliceId: "S3", branch: "run/t/S3", merged: true, conflictedFiles: [] },
      ],
    };

    const gate: GateResult = {
      perSlice: { S1: "pass", S2: "fail", S3: "pass" },
      allPass: false,
      tscClean: true,
      buildClean: true,
    };

    const { json } = writeReport(
      "run-003",
      { agents, merge, gate, wallMs: 9000 },
      { outDir }
    );

    // Textual conflict count
    expect(json.textualConflicts.total).toBe(2);
    expect(json.textualConflicts.perSlice["S2"]).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(json.textualConflicts.perSlice["S1"]).toEqual([]);
    expect(json.textualConflicts.perSlice["S3"]).toEqual([]);

    // mergedCleanly=false means no semantic conflict (git didn't merge cleanly)
    expect(json.semanticConflict).toBe(false);

    // S2 was not merged
    expect(json.perSlice["S2"]!.merged).toBe(false);
    expect(json.perSlice["S2"]!.conflictedFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
  });
});

// ---------------------------------------------------------------------------
// Test 4: did-not-complete counting
// ---------------------------------------------------------------------------

describe("writeReport — agentsDidNotComplete", () => {
  it("agents with didNotComplete=true are counted in totals.agentsDidNotComplete", () => {
    const outDir = makeTempDir();

    const agents: AgentResult[] = [
      { sliceId: "S1", committed: true,  tokens: 1000, turns: 3, wallMs: 4000, exit: 0,   didNotComplete: false },
      { sliceId: "S2", committed: false, tokens: 500,  turns: 10, wallMs: 8000, exit: 1,  didNotComplete: true  },
      { sliceId: "S3", committed: false, tokens: 200,  turns: 10, wallMs: 7000, exit: 1,  didNotComplete: true  },
    ];

    const merge = makeAllPassMerge();
    const gate = makeAllPassGate();

    const { json } = writeReport(
      "run-004",
      { agents, merge, gate, wallMs: 20000 },
      { outDir }
    );

    expect(json.totals.agentsDidNotComplete).toBe(2);
    expect(json.totals.tokens).toBe(1000 + 500 + 200);
    expect(json.totals.turns).toBe(3 + 10 + 10);

    // perSlice reflects individual agent fields
    expect(json.perSlice["S2"]!.didNotComplete).toBe(true);
    expect(json.perSlice["S3"]!.didNotComplete).toBe(true);
    expect(json.perSlice["S1"]!.didNotComplete).toBe(false);
  });

  it("agent with error field propagates error into perSlice", () => {
    const outDir = makeTempDir();

    const agents: AgentResult[] = [
      {
        sliceId: "S1",
        committed: false,
        tokens: 0,
        turns: 0,
        wallMs: 100,
        exit: 127,
        didNotComplete: true,
        error: "claude launch failed: ENOENT",
      },
      { sliceId: "S2", committed: true, tokens: 800, turns: 4, wallMs: 5000, exit: 0, didNotComplete: false },
      { sliceId: "S3", committed: true, tokens: 600, turns: 3, wallMs: 4000, exit: 0, didNotComplete: false },
    ];

    const merge = makeAllPassMerge();
    const gate = makeAllPassGate();

    const { json } = writeReport(
      "run-005",
      { agents, merge, gate, wallMs: 5100 },
      { outDir }
    );

    expect(json.perSlice["S1"]!.error).toBe("claude launch failed: ENOENT");
    expect(json.perSlice["S2"]!.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 5: asymmetric inputs — slice only in gate.perSlice (the bug target)
// ---------------------------------------------------------------------------

describe("writeReport — asymmetric inputs (union join)", () => {
  it("slice only in gate.perSlice gets a complete row with safe fallbacks", () => {
    const outDir = makeTempDir();

    // Only S1 and S2 have agents and merge entries; S9 exists only in gate
    const agents: AgentResult[] = [
      { sliceId: "S1", committed: true,  tokens: 1000, turns: 3, wallMs: 4000, exit: 0, didNotComplete: false },
      { sliceId: "S2", committed: true,  tokens: 2000, turns: 5, wallMs: 6000, exit: 0, didNotComplete: false },
    ];

    const merge: MergeResult = {
      integration: { sliceId: "integration", dir: "/fake/int", branch: "run/t/integration" },
      mergedCleanly: false,
      results: [
        { sliceId: "S1", branch: "run/t/S1", merged: true, conflictedFiles: [] },
        { sliceId: "S2", branch: "run/t/S2", merged: true, conflictedFiles: [] },
      ],
    };

    // S9 appears only in gate.perSlice — no agent record, no merge entry
    const gate: GateResult = {
      perSlice: { S1: "pass", S2: "pass", S9: "fail" },
      allPass: false,
      tscClean: true,
      buildClean: true,
    };

    const { json } = writeReport(
      "run-asym",
      { agents, merge, gate, wallMs: 5000 },
      { outDir }
    );

    // S9 must appear in perSlice despite having no agent or merge entry
    expect(json.perSlice["S9"]).toBeDefined();
    const s9 = json.perSlice["S9"]!;

    // Gate verdict must be preserved
    expect(s9.gate).toBe("fail");

    // Safe fallbacks for missing agent record
    expect(s9.committed).toBe(false);
    expect(s9.tokens).toBe(0);
    expect(s9.turns).toBe(0);
    expect(s9.didNotComplete).toBe(true);
    expect(s9.error).toBeUndefined();

    // Safe fallbacks for missing merge entry
    expect(s9.merged).toBe(false);
    expect(s9.conflictedFiles).toEqual([]);

    // Existing slices still joined correctly
    expect(json.perSlice["S1"]!.gate).toBe("pass");
    expect(json.perSlice["S1"]!.committed).toBe(true);
    expect(json.perSlice["S2"]!.gate).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Summary content tests
// ---------------------------------------------------------------------------

describe("writeReport — summary content", () => {
  it("all-pass summary contains outcome, textual conflict count, did-not-complete, and totals", () => {
    const outDir = makeTempDir();
    const { summary } = writeReport(
      "run-sum",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 8000,
      },
      { outDir }
    );

    // Outcome
    expect(summary).toContain("all-pass");
    // Textual conflict count
    expect(summary).toContain("Textual conflicts: 0");
    // Did-not-complete
    expect(summary).toContain("Agents did-not-complete: 0");
    // Tokens and wall clock in totals line
    expect(summary).toContain("tokens=3500");
    expect(summary).toContain("wall=8000ms");
    // No false alarm on semantic conflict line
    expect(summary).not.toContain("SEMANTIC CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// Test 6: resultsDir / stamp — kept per-run record
// ---------------------------------------------------------------------------

describe("writeReport — kept results store", () => {
  it("writes <resultsDir>/<runId>__<stamp>.json AND <outDir>/<runId>.json; returns resultPath", () => {
    const outDir = makeTempDir();
    const resultsDir = path.join(makeTempDir(), "results"); // does not exist yet

    const { json, path: filePath, resultPath } = writeReport(
      "run-kept-001",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 7000,
      },
      { outDir, resultsDir, stamp: "20260101-000000" }
    );

    // "latest" file still written
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toBe(path.join(outDir, "run-kept-001.json"));

    // Kept record written to resultsDir (created if absent)
    const expectedResultPath = path.join(resultsDir, "run-kept-001__20260101-000000.json");
    expect(resultPath).toBe(expectedResultPath);
    expect(fs.existsSync(resultPath!)).toBe(true);

    // Content is the full report
    const parsed: RunReport = JSON.parse(fs.readFileSync(resultPath!, "utf-8"));
    expect(parsed.runId).toBe("run-kept-001");
    expect(parsed.outcome).toBe("all-pass");
    expect(parsed.totals.tokens).toBe(json.totals.tokens);
  });

  it("two writes with different stamps produce two distinct result files (no overwrite)", () => {
    const outDir = makeTempDir();
    const resultsDir = path.join(makeTempDir(), "results");

    const agents = makeAgents();
    const merge = makeAllPassMerge();
    const gate = makeAllPassGate();

    const { resultPath: rp1 } = writeReport(
      "run-kept-002",
      { agents, merge, gate, wallMs: 1000 },
      { outDir, resultsDir, stamp: "20260101-080000" }
    );
    const { resultPath: rp2 } = writeReport(
      "run-kept-002",
      { agents, merge, gate, wallMs: 2000 },
      { outDir, resultsDir, stamp: "20260101-090000" }
    );

    // Paths are distinct
    expect(rp1).not.toBe(rp2);

    // Both files exist
    expect(fs.existsSync(rp1!)).toBe(true);
    expect(fs.existsSync(rp2!)).toBe(true);

    // Paths contain the respective stamps
    expect(rp1).toContain("20260101-080000");
    expect(rp2).toContain("20260101-090000");
  });

  it("stamp defaults to 'latest' when omitted — result file is still written", () => {
    const outDir = makeTempDir();
    const resultsDir = path.join(makeTempDir(), "results");

    const { resultPath } = writeReport(
      "run-kept-003",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 5000,
      },
      { outDir, resultsDir }
    );

    // Without stamp, falls back to "latest"
    expect(resultPath).toContain("run-kept-003__latest.json");
    expect(fs.existsSync(resultPath!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 7: no resultsDir → resultPath=null, benchmark/results/ untouched
// ---------------------------------------------------------------------------

describe("writeReport — no resultsDir → no kept file (opt-in guard)", () => {
  it("returns resultPath=null and writes nothing to benchmark/results/ when resultsDir is omitted", () => {
    const outDir = makeTempDir();

    const { resultPath } = writeReport(
      "run-no-kept-dir",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 1000,
      },
      { outDir }  // explicitly NO resultsDir
    );

    // resultPath must be null — no kept file written
    expect(resultPath).toBeNull();

    // No file created under the real benchmark/results/ dir
    const wouldBeFile = path.join(REAL_RESULTS_DIR, "run-no-kept-dir__latest.json");
    expect(fs.existsSync(wouldBeFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 8: resolution metrics in report
// ---------------------------------------------------------------------------

function makeResolution(overrides?: Partial<ResolutionResult>): ResolutionResult {
  return {
    ran: true,
    tokens: 4200,
    turns: 7,
    wallMs: 12500,
    reachedGreen: true,
    didNotResolve: false,
    ...overrides,
  };
}

describe("writeReport — resolution present (reachedGreen=true)", () => {
  it("json carries resolution block, resolutionCost matches, summary has Resolution line with reached-green=true", () => {
    const outDir = makeTempDir();
    const resolution = makeResolution();

    const { json, summary } = writeReport(
      "run-res-001",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 20000,
        resolution,
      },
      { outDir }
    );

    // json.resolution carries the full ResolutionResult
    expect(json.resolution).toEqual(resolution);

    // resolutionCost is derived from resolution
    expect(json.resolutionCost).toBeDefined();
    expect(json.resolutionCost!.tokens).toBe(4200);
    expect(json.resolutionCost!.turns).toBe(7);
    expect(json.resolutionCost!.wallMs).toBe(12500);

    // summary contains a Resolution line
    expect(summary).toContain("Resolution:");
    expect(summary).toContain("reached-green=true");
  });
});

describe("writeReport — resolution present (didNotResolve=true)", () => {
  it("summary shows didNotResolve=true", () => {
    const outDir = makeTempDir();
    const resolution = makeResolution({ reachedGreen: false, didNotResolve: true });

    const { summary } = writeReport(
      "run-res-002",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 20000,
        resolution,
      },
      { outDir }
    );

    expect(summary).toContain("Resolution:");
    expect(summary).toContain("didNotResolve=true");
  });
});

describe("writeReport — no resolution (mechanical run)", () => {
  it("json.resolution is absent, resolutionCost is absent, summary has no Resolution line", () => {
    const outDir = makeTempDir();

    const { json, summary } = writeReport(
      "run-mech-001",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 10000,
        // no resolution
      },
      { outDir }
    );

    // resolution and resolutionCost must be absent
    expect(json.resolution).toBeUndefined();
    expect(json.resolutionCost).toBeUndefined();

    // summary must have NO Resolution line
    expect(summary).not.toContain("Resolution:");
  });
});

// ---------------------------------------------------------------------------
// Fixture factory for PrQueueResult
// ---------------------------------------------------------------------------

function makePrQueueSuccess(): PrQueueResult {
  return {
    prs: [
      { branch: "S1", outcome: "merged" },
      { branch: "S2", outcome: "merged" },
      { branch: "S3", outcome: "merged" },
    ],
    reachedSuccess: true,
    integrationCost: { tokens: 300, turns: 4, wallMs: 2000 },
    rounds: 0,
    envError: false,
    didNotComplete: false,
  };
}

function makePrQueueBlocked(): PrQueueResult {
  return {
    prs: [
      { branch: "S1", outcome: "merged" },
      { branch: "S2", outcome: "blocked", reason: "ci-fail" },
      { branch: "S3", outcome: "merged" },
    ],
    reachedSuccess: false,
    integrationCost: { tokens: 150, turns: 2, wallMs: 1000 },
    rounds: 1,
    envError: false,
    didNotComplete: true,
  };
}

function makePrQueueTampered(): PrQueueResult {
  return {
    prs: [
      { branch: "S1", outcome: "blocked", reason: "test-tampering", tampered: true },
      { branch: "S2", outcome: "merged" },
    ],
    reachedSuccess: false,
    integrationCost: { tokens: 100, turns: 1, wallMs: 500 },
    rounds: 1,
    envError: false,
    didNotComplete: true,
  };
}

// ---------------------------------------------------------------------------
// Task-4 Test 1: prQueue present, reachedSuccess=true — costToSuccess computed
// ---------------------------------------------------------------------------

describe("writeReport — prQueue present, reachedSuccess=true", () => {
  it("costToSuccess present with correct build/integration/total sums; summary shows per-PR outcomes and cost breakdown", () => {
    const outDir = makeTempDir();
    const agents = makeAgents(); // tokens: 1000+2000+500=3500, turns: 3+5+2=10, wallMs: 4000+6000+3000=13000
    const prQueue = makePrQueueSuccess(); // integrationCost: tokens=300, turns=4, wallMs=2000

    const { json, summary } = writeReport(
      "run-pq-success",
      {
        agents,
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 15000,
        prQueue,
      },
      { outDir }
    );

    // costToSuccess present because reachedSuccess=true
    expect(json.costToSuccess).toBeDefined();
    const cts = json.costToSuccess!;

    // build = sum of agent costs
    expect(cts.build.tokens).toBe(3500);
    expect(cts.build.turns).toBe(10);
    expect(cts.build.wallMs).toBe(13000);

    // integration = prQueue.integrationCost
    expect(cts.integration.tokens).toBe(300);
    expect(cts.integration.turns).toBe(4);
    expect(cts.integration.wallMs).toBe(2000);

    // total = build + integration
    expect(cts.total.tokens).toBe(3800);
    expect(cts.total.turns).toBe(14);
    expect(cts.total.wallMs).toBe(15000);

    // prQueue field is present in JSON
    expect(json.prQueue).toBeDefined();
    expect(json.prQueue!.reachedSuccess).toBe(true);
    expect(json.prQueue!.prs).toHaveLength(3);

    // summary shows per-PR outcomes
    expect(summary).toContain("S1: merged");
    expect(summary).toContain("S2: merged");
    expect(summary).toContain("S3: merged");

    // summary shows reached-success
    expect(summary).toContain("Reached success: true");

    // summary shows cost-to-success breakdown
    expect(summary).toContain("Cost-to-success:");
    expect(summary).toContain("total=3800");
    expect(summary).toContain("build=3500");
    expect(summary).toContain("integration=300");

    // no DID NOT COMPLETE line
    expect(summary).not.toContain("DID NOT COMPLETE");

    // no tampering line
    expect(summary).not.toContain("TEST TAMPERING");
  });
});

// ---------------------------------------------------------------------------
// Task-4 Test 2: prQueue present, reachedSuccess=false (blocked PR)
// ---------------------------------------------------------------------------

describe("writeReport — prQueue present, reachedSuccess=false", () => {
  it("costToSuccess absent; summary shows DID NOT COMPLETE and blocked PR", () => {
    const outDir = makeTempDir();
    const prQueue = makePrQueueBlocked();

    const { json, summary } = writeReport(
      "run-pq-blocked",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 12000,
        prQueue,
      },
      { outDir }
    );

    // costToSuccess absent when reachedSuccess=false
    expect(json.costToSuccess).toBeUndefined();

    // prQueue still present in JSON
    expect(json.prQueue).toBeDefined();
    expect(json.prQueue!.reachedSuccess).toBe(false);
    expect(json.prQueue!.didNotComplete).toBe(true);

    // summary shows per-PR outcomes including blocked
    expect(summary).toContain("S1: merged");
    expect(summary).toContain("S2: blocked");
    expect(summary).toContain("ci-fail");

    // summary shows DID NOT COMPLETE
    expect(summary).toContain("DID NOT COMPLETE");

    // no cost-to-success breakdown when not succeeded
    expect(summary).not.toContain("Cost-to-success:");
  });
});

// ---------------------------------------------------------------------------
// Task-4 Test 3: PR with tampered=true
// ---------------------------------------------------------------------------

describe("writeReport — PR with tampered=true", () => {
  it("tampering lists the branch; summary has ⚠ TEST TAMPERING line; reachedSuccess=false", () => {
    const outDir = makeTempDir();
    const prQueue = makePrQueueTampered();

    const { json, summary } = writeReport(
      "run-pq-tampered",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 10000,
        prQueue,
      },
      { outDir }
    );

    // tampering field lists the tampered branch
    expect(json.tampering).toBeDefined();
    expect(json.tampering).toContain("S1");

    // reachedSuccess=false → costToSuccess absent
    expect(json.costToSuccess).toBeUndefined();

    // summary has the TEST TAMPERING warning line
    expect(summary).toContain("TEST TAMPERING");
    expect(summary).toContain("S1");

    // summary shows DID NOT COMPLETE
    expect(summary).toContain("DID NOT COMPLETE");
  });
});

// ---------------------------------------------------------------------------
// Task-4 Test 4: testDiscipline present
// ---------------------------------------------------------------------------

describe("writeReport — testDiscipline present", () => {
  it("counts surface in JSON and summary", () => {
    const outDir = makeTempDir();
    const testDiscipline = {
      S1: { testFilesAdded: 2 },
      S2: { testFilesAdded: 0 },
      S3: { testFilesAdded: 1 },
    };

    const { json, summary } = writeReport(
      "run-pq-td",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 10000,
        prQueue: makePrQueueSuccess(),
        testDiscipline,
      },
      { outDir }
    );

    // JSON carries testDiscipline through
    expect(json.testDiscipline).toEqual(testDiscipline);
    expect(json.testDiscipline!["S1"]!.testFilesAdded).toBe(2);
    expect(json.testDiscipline!["S2"]!.testFilesAdded).toBe(0);

    // summary shows Test files added line
    expect(summary).toContain("Test files added:");
    expect(summary).toContain("S1=2");
    expect(summary).toContain("S2=0");
    expect(summary).toContain("S3=1");
  });
});

// ---------------------------------------------------------------------------
// Task-4 Test 5: NO prQueue (mechanical run) — report unchanged
// ---------------------------------------------------------------------------

describe("writeReport — no prQueue (mechanical run)", () => {
  it("prQueue, costToSuccess, testDiscipline, tampering all absent; summary has no pr-queue/cost lines", () => {
    const outDir = makeTempDir();

    const { json, summary } = writeReport(
      "run-mech-pq",
      {
        agents: makeAgents(),
        merge: makeAllPassMerge(),
        gate: makeAllPassGate(),
        wallMs: 10000,
        // no prQueue, no testDiscipline
      },
      { outDir }
    );

    // New fields absent
    expect(json.prQueue).toBeUndefined();
    expect(json.costToSuccess).toBeUndefined();
    expect(json.testDiscipline).toBeUndefined();
    expect(json.tampering).toBeUndefined();

    // Summary has none of the new pr-queue lines
    expect(summary).not.toContain("PRs:");
    expect(summary).not.toContain("Reached success:");
    expect(summary).not.toContain("Cost-to-success:");
    expect(summary).not.toContain("TEST TAMPERING");
    expect(summary).not.toContain("Test files added:");
    expect(summary).not.toContain("DID NOT COMPLETE");

    // Existing summary content still present
    expect(summary).toContain("all-pass");
    expect(summary).toContain("tokens=3500");
  });
});
