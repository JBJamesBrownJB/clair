import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeReport } from "../report.js";
import type { RunReport } from "../report.js";
import type { AgentResult } from "../agent.js";
import type { MergeResult } from "../merge.js";
import type { GateResult } from "../gate.js";

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
    expect(fs.existsSync(resultPath)).toBe(true);

    // Content is the full report
    const parsed: RunReport = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
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
    expect(fs.existsSync(rp1)).toBe(true);
    expect(fs.existsSync(rp2)).toBe(true);

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
    expect(fs.existsSync(resultPath)).toBe(true);
  });
});
