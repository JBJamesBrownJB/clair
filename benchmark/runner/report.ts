/**
 * report.ts — assemble agent/merge/gate results into a metrics JSON + human summary.
 *
 * The headline instrument: `semanticConflict = mergedCleanly && !gate.allPass`
 * — branches merged clean by git, but the app is broken/wrong.  This is the
 * silent failure that clair exists to surface.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentResult } from "./agent.js";
import type { MergeResult } from "./merge.js";
import type { GateResult } from "./gate.js";
import type { ResolutionResult } from "./resolve.js";

// ---------------------------------------------------------------------------
// Resolve __dirname in ESM
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Default output directory — git-ignored. */
const DEFAULT_OUT_DIR = path.join(__dirname, "out");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PerSliceReport {
  committed: boolean;
  tokens: number;
  turns: number;
  didNotComplete: boolean;
  error?: string;
  merged: boolean;
  conflictedFiles: string[];
  gate: "pass" | "fail";
}

export interface RunReport {
  runId: string;
  wallMs: number;
  perSlice: Record<string, PerSliceReport>;
  textualConflicts: {
    total: number;
    perSlice: Record<string, string[]>;
  };
  gate: {
    allPass: boolean;
    tscClean: boolean;
    buildClean: boolean;
  };
  totals: {
    tokens: number;
    turns: number;
    agentsDidNotComplete: number;
  };
  /** True iff branches merged cleanly by git, but the gate subsequently failed.
   *  The core signal: a silent semantic conflict that only the acceptance gate reveals. */
  semanticConflict: boolean;
  outcome: "all-pass" | "fail";
  /** Full resolution result when a resolver agent was run; absent for mechanical runs. */
  resolution?: ResolutionResult;
  /** Convenience summary of resolver cost; absent for mechanical runs. */
  resolutionCost?: { tokens: number; turns: number; wallMs: number };
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Assemble agent/merge/gate results into a RunReport, write it as JSON, and
 * return the object + a human summary string (also printed to stdout).
 */
export function writeReport(
  runId: string,
  parts: {
    agents: AgentResult[];
    merge: MergeResult;
    gate: GateResult;
    wallMs: number;
    resolution?: ResolutionResult;
  },
  opts?: { outDir?: string; resultsDir?: string; stamp?: string }
): { json: RunReport; summary: string; path: string; resultPath: string | null } {
  const outDir = opts?.outDir ?? DEFAULT_OUT_DIR;
  const stamp = opts?.stamp ?? "latest";

  // -------------------------------------------------------------------------
  // Build per-slice join over the UNION of all three slice-id sets.
  // Iterating only agents (old approach) silently dropped gate verdicts for
  // slices whose agent record was missing.
  // -------------------------------------------------------------------------
  const agentMap = new Map(parts.agents.map((a) => [a.sliceId, a]));
  const mergeMap = new Map(parts.merge.results.map((r) => [r.sliceId, r]));

  // Canonical slice-id set = union of all three sources, iterated in stable order.
  const allSliceIds = [
    ...new Set<string>([
      ...parts.agents.map((a) => a.sliceId),
      ...parts.merge.results.map((r) => r.sliceId),
      ...Object.keys(parts.gate.perSlice),
    ]),
  ].sort();

  const perSlice: Record<string, PerSliceReport> = {};
  const conflictPerSlice: Record<string, string[]> = {};
  let conflictTotal = 0;

  for (const sliceId of allSliceIds) {
    const agent = agentMap.get(sliceId);
    const mr = mergeMap.get(sliceId);
    const gateVerdict = parts.gate.perSlice[sliceId] ?? "fail";
    const conflictedFiles = mr?.conflictedFiles ?? [];

    conflictPerSlice[sliceId] = conflictedFiles;
    conflictTotal += conflictedFiles.length;

    const entry: PerSliceReport = {
      committed: agent?.committed ?? false,
      tokens: agent?.tokens ?? 0,
      turns: agent?.turns ?? 0,
      didNotComplete: agent?.didNotComplete ?? true,
      merged: mr?.merged ?? false,
      conflictedFiles,
      gate: gateVerdict,
    };
    if (agent?.error !== undefined) {
      entry.error = agent.error;
    }
    perSlice[sliceId] = entry;
  }

  // -------------------------------------------------------------------------
  // Totals
  // -------------------------------------------------------------------------
  const tokens = parts.agents.reduce((sum, a) => sum + a.tokens, 0);
  const turns = parts.agents.reduce((sum, a) => sum + a.turns, 0);
  const agentsDidNotComplete = parts.agents.filter((a) => a.didNotComplete).length;

  // -------------------------------------------------------------------------
  // Headline flags
  // -------------------------------------------------------------------------
  const semanticConflict = parts.merge.mergedCleanly && !parts.gate.allPass;
  const outcome: "all-pass" | "fail" =
    parts.gate.allPass && parts.gate.tscClean && parts.gate.buildClean
      ? "all-pass"
      : "fail";

  // -------------------------------------------------------------------------
  // Assemble report
  // -------------------------------------------------------------------------
  const json: RunReport = {
    runId,
    wallMs: parts.wallMs,
    perSlice,
    textualConflicts: { total: conflictTotal, perSlice: conflictPerSlice },
    gate: {
      allPass: parts.gate.allPass,
      tscClean: parts.gate.tscClean,
      buildClean: parts.gate.buildClean,
    },
    totals: { tokens, turns, agentsDidNotComplete },
    semanticConflict,
    outcome,
    ...(parts.resolution !== undefined && {
      resolution: parts.resolution,
      resolutionCost: {
        tokens: parts.resolution.tokens,
        turns: parts.resolution.turns,
        wallMs: parts.resolution.wallMs,
      },
    }),
  };

  // -------------------------------------------------------------------------
  // Human summary
  // -------------------------------------------------------------------------
  const outcomeLabel = outcome === "all-pass" ? "all-pass ✓" : "FAIL ✗";
  const lines: string[] = [
    `Run:      ${runId}`,
    `Outcome:  ${outcomeLabel}`,
  ];
  if (semanticConflict) {
    lines.push("⚠ SEMANTIC CONFLICT: merged clean but gate failed");
  }
  lines.push(`Textual conflicts: ${conflictTotal}`);
  lines.push(`Agents did-not-complete: ${agentsDidNotComplete}`);
  lines.push(`Totals: tokens=${tokens}, turns=${turns}, wall=${Math.round(parts.wallMs)}ms`);
  if (parts.resolution !== undefined) {
    const r = parts.resolution;
    lines.push(
      `Resolution: reached-green=${r.reachedGreen}  cost=${r.tokens} tokens / ${r.turns} turns / ${r.wallMs}ms  (didNotResolve=${r.didNotResolve})`
    );
  }

  const summary = lines.join("\n");
  console.log(summary);

  // -------------------------------------------------------------------------
  // Write JSON files
  // -------------------------------------------------------------------------
  // 1. "Latest" file — overwritten on each run (git-ignored out/ dir).
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${runId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2), "utf-8");

  // 2. Kept per-run record — written ONLY when the caller explicitly supplies
  //    opts.resultsDir. Omitting resultsDir skips the write and returns null.
  //    This prevents tests from polluting the git-tracked benchmark/results/ dir.
  let resultPath: string | null = null;
  if (opts?.resultsDir !== undefined) {
    fs.mkdirSync(opts.resultsDir, { recursive: true });
    resultPath = path.join(opts.resultsDir, `${runId}__${stamp}.json`);
    fs.writeFileSync(resultPath, JSON.stringify(json, null, 2), "utf-8");
  }

  return { json, summary, path: filePath, resultPath };
}
