import { describe, it, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { runAgent, runAgents } from "../agent.js";
import type { Budget, RunClaudeFn, CheckCommittedFn } from "../agent.js";
import type { Workspace } from "../workspace.js";
import type { SliceSpec } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const W1: Workspace = { sliceId: "S1", dir: "/fake/wt/S1", branch: "run/test/S1" };
const W2: Workspace = { sliceId: "S2", dir: "/fake/wt/S2", branch: "run/test/S2" };
const W3: Workspace = { sliceId: "S3", dir: "/fake/wt/S3", branch: "run/test/S3" };

const SP1: SliceSpec = { id: "S1", title: "Auth Hardening", prompt: "Implement auth hardening" };
const SP2: SliceSpec = { id: "S2", title: "Filtering", prompt: "Implement item filtering" };
const SP3: SliceSpec = { id: "S3", title: "Export", prompt: "Implement CSV/JSON export" };

const BUDGET: Budget = {
  max_tokens_per_agent: 50_000,
  max_turns_per_agent: 10,
  model: "claude-opus-4-8",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usageJson(opts: {
  num_turns?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  is_error?: boolean;
} = {}): string {
  const usage: Record<string, number> = {
    input_tokens: opts.input_tokens ?? 100,
    output_tokens: opts.output_tokens ?? 50,
  };
  if (opts.cache_creation_input_tokens !== undefined) {
    usage.cache_creation_input_tokens = opts.cache_creation_input_tokens;
  }
  if (opts.cache_read_input_tokens !== undefined) {
    usage.cache_read_input_tokens = opts.cache_read_input_tokens;
  }
  return JSON.stringify({
    num_turns: opts.num_turns ?? 1,
    total_cost_usd: 0.01,
    usage,
    is_error: opts.is_error ?? false,
    result: "ok",
  });
}

function fakeRun(
  stdout: string,
  exit = 0,
  onCall?: (args: { cwd: string; prompt: string; model: string; maxTurns: number }) => void
): RunClaudeFn {
  return async (args) => {
    onCall?.(args);
    return { stdout, exit };
  };
}

function fakeCommitted(committed: boolean): CheckCommittedFn {
  return async (_ws) => committed;
}

// ---------------------------------------------------------------------------
// runAgent
// ---------------------------------------------------------------------------

describe("runAgent", () => {
  it("returns committed:true, parsed tokens/turns, didNotComplete:false on a clean successful run", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      runClaude: fakeRun(usageJson({ num_turns: 3, input_tokens: 1000, output_tokens: 500 }), 0),
      checkCommitted: fakeCommitted(true),
    });

    expect(result.sliceId).toBe("S1");
    expect(result.committed).toBe(true);
    expect(result.tokens).toBe(1500);
    expect(result.turns).toBe(3);
    expect(result.exit).toBe(0);
    expect(result.didNotComplete).toBe(false);
    expect(result.wallMs).toBeGreaterThanOrEqual(0);
  });

  it("didNotComplete:true when exit !== 0", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      runClaude: fakeRun(usageJson({ num_turns: 2 }), 1),
      checkCommitted: fakeCommitted(false),
    });

    expect(result.exit).toBe(1);
    expect(result.didNotComplete).toBe(true);
  });

  it("didNotComplete:true when num_turns >= max_turns_per_agent (hit the cap)", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      // num_turns = 10, budget cap = 10 — equality triggers didNotComplete
      runClaude: fakeRun(usageJson({ num_turns: 10, input_tokens: 1000, output_tokens: 500 }), 0),
      checkCommitted: fakeCommitted(true),
    });

    expect(result.turns).toBe(10);
    expect(result.didNotComplete).toBe(true);
  });

  it("didNotComplete:true when tokens > max_tokens_per_agent", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      // 40 000 + 15 000 = 55 000 > 50 000
      runClaude: fakeRun(usageJson({ input_tokens: 40_000, output_tokens: 15_000 }), 0),
      checkCommitted: fakeCommitted(true),
    });

    expect(result.tokens).toBe(55_000);
    expect(result.didNotComplete).toBe(true);
  });

  it("sums cache_creation_input_tokens and cache_read_input_tokens into total tokens", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      runClaude: fakeRun(
        usageJson({
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 300,
        }),
        0
      ),
      checkCommitted: fakeCommitted(true),
    });

    // 1000 + 500 + 200 + 300 = 2000
    expect(result.tokens).toBe(2000);
  });

  it("didNotComplete:true when not committed (no commit made)", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      runClaude: fakeRun(usageJson({ num_turns: 3, input_tokens: 1000, output_tokens: 500 }), 0),
      checkCommitted: fakeCommitted(false),
    });

    expect(result.committed).toBe(false);
    expect(result.didNotComplete).toBe(true);
  });

  it("didNotComplete:true when is_error flag set in JSON", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      runClaude: fakeRun(
        usageJson({ num_turns: 2, input_tokens: 100, output_tokens: 50, is_error: true }),
        0
      ),
      checkCommitted: fakeCommitted(true),
    });

    expect(result.didNotComplete).toBe(true);
  });

  it("handles non-JSON stdout defensively: tokens/turns=0, didNotComplete:true", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      runClaude: fakeRun("this is not json", 0),
      checkCommitted: fakeCommitted(false),
    });

    expect(result.tokens).toBe(0);
    expect(result.turns).toBe(0);
    expect(result.didNotComplete).toBe(true);
  });

  it("handles empty JSON object defensively: tokens/turns=0, didNotComplete:false when otherwise clean", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      runClaude: fakeRun("{}", 0),
      checkCommitted: fakeCommitted(true),
    });

    // exit:0, no is_error, turns:0 < 10, tokens:0 <= 50000, committed:true → all clean
    expect(result.tokens).toBe(0);
    expect(result.turns).toBe(0);
    expect(result.didNotComplete).toBe(false);
  });

  it("passes correct cwd, prompt, model, and maxTurns to runClaude", async () => {
    const calls: Array<{ cwd: string; prompt: string; model: string; maxTurns: number }> = [];
    let checkCommittedWorkspace: Workspace | undefined;

    await runAgent(W1, SP1, BUDGET, {
      runClaude: fakeRun(usageJson(), 0, (args) => calls.push(args)),
      checkCommitted: async (ws) => {
        checkCommittedWorkspace = ws;
        return true;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].cwd).toBe(W1.dir);
    expect(calls[0].prompt).toBe(SP1.prompt);
    expect(calls[0].model).toBe(BUDGET.model);
    expect(calls[0].maxTurns).toBe(BUDGET.max_turns_per_agent);
    // Fix #4: workspace passed to checkCommitted is the slice's own workspace (no cross-contamination)
    expect(checkCommittedWorkspace).toBe(W1);
  });

  it("launch failure: didNotComplete:true and non-empty error when runClaude returns exit:127 with error", async () => {
    const result = await runAgent(W1, SP1, BUDGET, {
      runClaude: async () => ({
        stdout: "",
        exit: 127,
        error: "claude launch failed: spawn claude ENOENT",
      }),
      checkCommitted: fakeCommitted(false),
    });

    expect(result.didNotComplete).toBe(true);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("launch failed");
  });
});

// ---------------------------------------------------------------------------
// runAgents
// ---------------------------------------------------------------------------

describe("runAgents", () => {
  it("invokes runClaude 3 times and returns 3 results in input order", async () => {
    const items = [
      { workspace: W1, spec: SP1 },
      { workspace: W2, spec: SP2 },
      { workspace: W3, spec: SP3 },
    ];

    let callCount = 0;
    const sharedRunClaude: RunClaudeFn = async () => {
      callCount++;
      return { stdout: usageJson({ num_turns: 1 }), exit: 0 };
    };

    const results = await runAgents(items, BUDGET, {
      runClaude: sharedRunClaude,
      checkCommitted: fakeCommitted(true),
    });

    expect(callCount).toBe(3);
    expect(results).toHaveLength(3);
    expect(results[0].sliceId).toBe("S1");
    expect(results[1].sliceId).toBe("S2");
    expect(results[2].sliceId).toBe("S3");
    expect(results.every((r) => r.didNotComplete === false)).toBe(true);
  });

  it("runs agents concurrently: all 3 start before any resolves", async () => {
    const items = [
      { workspace: W1, spec: SP1 },
      { workspace: W2, spec: SP2 },
      { workspace: W3, spec: SP3 },
    ];

    // Each fake yields once (setImmediate) before resolving.
    // With Promise.all all 3 are started before any yield completes,
    // so all 3 `starts` entries are recorded before any `resolves` entry.
    const starts: number[] = [];
    const resolves: number[] = [];

    const concurrentRunClaude: RunClaudeFn = async () => {
      starts.push(performance.now());
      await new Promise<void>((r) => setImmediate(r));
      resolves.push(performance.now());
      return { stdout: usageJson(), exit: 0 };
    };

    const results = await runAgents(items, BUDGET, {
      runClaude: concurrentRunClaude,
      checkCommitted: fakeCommitted(true),
    });

    expect(results).toHaveLength(3);
    expect(starts).toHaveLength(3);
    // All 3 start times should be before the first resolve time
    // (because setImmediate yields, and all 3 were scheduled before any setImmediate fires)
    expect(Math.max(...starts)).toBeLessThanOrEqual(resolves[0]);
  });

  it("returns independent results even when some agents fail", async () => {
    const items = [
      { workspace: W1, spec: SP1 },
      { workspace: W2, spec: SP2 },
    ];

    let callIndex = 0;
    const runClaude: RunClaudeFn = async () => {
      const i = callIndex++;
      return i === 0
        ? { stdout: usageJson({ num_turns: 2 }), exit: 0 }
        : { stdout: "", exit: 1 };
    };

    const results = await runAgents(items, BUDGET, {
      runClaude,
      checkCommitted: fakeCommitted(true),
    });

    expect(results).toHaveLength(2);
    expect(results[0].didNotComplete).toBe(false);
    expect(results[1].didNotComplete).toBe(true);
    expect(results[1].exit).toBe(1);
  });
});
