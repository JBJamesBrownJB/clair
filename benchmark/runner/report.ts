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
import type { PrQueueResult } from "./prQueue.js";

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

/** Cost breakdown present only when reachedSuccess is true. */
export interface CostToSuccess {
  total: { tokens: number; turns: number; wallMs: number };
  build: { tokens: number; turns: number; wallMs: number };
  integration: { tokens: number; turns: number; wallMs: number };
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
  /** PR-queue outcomes — present when a PR-queue run was performed. */
  prQueue?: {
    prs: PrQueueResult["prs"];
    reachedSuccess: boolean;
    rounds: number;
    envError: boolean;
    didNotComplete: boolean;
    /** Sum of tokens/turns/wallMs consumed by all fix agents (the fix-loop total). */
    integrationCost: { tokens: number; turns: number; wallMs: number };
  };
  /** Cost-to-success breakdown — present only when prQueue.reachedSuccess is true. */
  costToSuccess?: CostToSuccess;
  /** Per-slice test-file discipline counters — passed in by the wiring layer. */
  testDiscipline?: Record<string, { testFilesAdded: number }>;
  /** Branches whose PR was flagged as test-tampered — absent when none. */
  tampering?: string[];
  /** True iff the PR-queue run reached visible-CI success but the hidden gate
   *  subsequently failed — the headline "shipped-but-wrong" case.
   *  Only present in pr-queue mode (omitted otherwise). */
  shippedButWrong?: boolean;
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
    merge?: MergeResult;
    gate: GateResult;
    wallMs: number;
    prQueue?: PrQueueResult;
    testDiscipline?: Record<string, { testFilesAdded: number }>;
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
  const mergeMap = new Map((parts.merge?.results ?? []).map((r) => [r.sliceId, r]));

  // Canonical slice-id set = union of all three sources, iterated in stable order.
  const allSliceIds = [
    ...new Set<string>([
      ...parts.agents.map((a) => a.sliceId),
      ...(parts.merge?.results ?? []).map((r) => r.sliceId),
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
  const semanticConflict = (parts.merge?.mergedCleanly ?? false) && !parts.gate.allPass;
  const outcome: "all-pass" | "fail" =
    parts.gate.allPass && parts.gate.tscClean && parts.gate.buildClean
      ? "all-pass"
      : "fail";

  // -------------------------------------------------------------------------
  // PR-queue derived fields (only when prQueue was provided)
  // -------------------------------------------------------------------------
  let prQueueField: RunReport["prQueue"] | undefined;
  let costToSuccess: RunReport["costToSuccess"] | undefined;
  let tampering: string[] | undefined;
  let shippedButWrong: boolean | undefined;

  if (parts.prQueue !== undefined) {
    // M-2: visible CI success but hidden gate failure — the core "shipped-but-wrong" case.
    shippedButWrong =
      parts.prQueue.reachedSuccess === true && parts.gate.allPass === false;
    const pq = parts.prQueue;

    prQueueField = {
      prs: pq.prs,
      reachedSuccess: pq.reachedSuccess,
      rounds: pq.rounds,
      envError: pq.envError,
      didNotComplete: pq.didNotComplete,
      integrationCost: pq.integrationCost,
    };

    // Tampering: branches whose PR entry has tampered=true
    const tamperedBranches = pq.prs
      .filter((p) => p.tampered === true)
      .map((p) => p.branch);
    if (tamperedBranches.length > 0) {
      tampering = tamperedBranches;
    }

    // costToSuccess only when the run succeeded
    if (pq.reachedSuccess) {
      const buildTokens = parts.agents.reduce((s, a) => s + a.tokens, 0);
      const buildTurns = parts.agents.reduce((s, a) => s + a.turns, 0);
      // build agents run concurrently → wall time is the max, not the sum (tokens/turns are summed)
      const buildWallMs = parts.agents.length > 0 ? Math.max(...parts.agents.map((a) => a.wallMs)) : 0;
      const ic = pq.integrationCost;
      costToSuccess = {
        build: { tokens: buildTokens, turns: buildTurns, wallMs: buildWallMs },
        integration: { tokens: ic.tokens, turns: ic.turns, wallMs: ic.wallMs },
        total: {
          tokens: buildTokens + ic.tokens,
          turns: buildTurns + ic.turns,
          wallMs: buildWallMs + ic.wallMs,
        },
      };
    }
  }

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
    ...(prQueueField !== undefined && { prQueue: prQueueField }),
    ...(costToSuccess !== undefined && { costToSuccess }),
    ...(parts.testDiscipline !== undefined && { testDiscipline: parts.testDiscipline }),
    ...(tampering !== undefined && { tampering }),
    ...(shippedButWrong !== undefined && { shippedButWrong }),
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

  // PR-queue summary lines (only when prQueue was provided)
  if (parts.prQueue !== undefined && prQueueField !== undefined) {
    const pq = parts.prQueue;

    // Per-PR outcome line
    const prLine = pq.prs
      .map((p) => {
        if (p.outcome === "merged") return `${p.branch}: merged`;
        const reasonPart = p.reason !== undefined ? ` (${p.reason})` : "";
        return `${p.branch}: blocked${reasonPart}`;
      })
      .join(" · ");
    lines.push(`PRs: ${prLine}`);

    // Reached success or DID NOT COMPLETE
    if (pq.reachedSuccess) {
      lines.push("Reached success: true");
    } else {
      const blockedCount = pq.prs.filter((p) => p.outcome === "blocked").length;
      lines.push(`DID NOT COMPLETE — ${blockedCount} ${blockedCount === 1 ? "PR" : "PRs"} blocked`);
    }

    // Per-PR fix-spend lines (for any PR that had a fix agent run — fixCost present)
    for (const p of pq.prs) {
      if (p.fixCost !== undefined) {
        const outcomeLabel = p.outcome === "blocked"
          ? `blocked${p.reason !== undefined ? ` (${p.reason})` : ""}`
          : "merged";
        lines.push(`${p.branch}: ${outcomeLabel} — fix spent ${p.fixCost.tokens} tok / ${p.fixCost.turns} turns`);
      }
    }

    // Integration (fix-loop) total cost — always shown when prQueue present
    const ic = pq.integrationCost;
    lines.push(`Integration (fix-loop) cost: ${ic.tokens} tok / ${ic.turns} turns / ${ic.wallMs}ms`);

    // M-2: shipped-but-wrong warning (visible CI passed but hidden gate failed)
    if (shippedButWrong === true) {
      lines.push("⚠ SHIPPED BUT WRONG: reached green but FAILED the hidden gate");
    }

    // Cost-to-success breakdown (only on success)
    if (costToSuccess !== undefined) {
      const cts = costToSuccess;
      lines.push(
        `Cost-to-success: total=${cts.total.tokens} tok / ${cts.total.turns} turns / ${cts.total.wallMs}ms` +
        `  (build=${cts.build.tokens} tok / ${cts.build.turns} turns / ${cts.build.wallMs}ms` +
        ` + integration=${cts.integration.tokens} tok / ${cts.integration.turns} turns / ${cts.integration.wallMs}ms)`
      );
    }

    // Tampering warning
    if (tampering !== undefined) {
      lines.push(`⚠ TEST TAMPERING: ${tampering.join(", ")}`);
    }

    // Test discipline
    if (parts.testDiscipline !== undefined) {
      const tdLine = Object.entries(parts.testDiscipline)
        .map(([id, v]) => `${id}=${v.testFilesAdded}`)
        .join(" ");
      lines.push(`Test files added: ${tdLine}`);
    }
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
