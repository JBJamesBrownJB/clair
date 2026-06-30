/**
 * prQueue.test.ts — hermetic tests for runPrQueue.
 *
 * All deps (runCmd, runCI, runAgent, countAssertions) are injected fakes.
 * No real git, pnpm, or claude process is ever spawned.
 */
import { describe, it, expect } from "vitest";
import { runPrQueue, FIX_PROMPT } from "../prQueue.js";
import type { PrQueueDeps, CountAssertionsFn } from "../prQueue.js";
import type { RunCmdFn } from "../shell.js";
import type { CIResult } from "../ci.js";
import type { Budget, AgentResult } from "../agent.js";
import type { Workspace } from "../workspace.js";
import type { SliceSpec, RunConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const INTEGRATION: Workspace = {
  sliceId: "integration",
  dir: "/fake/integration",
  branch: "run/test/integration",
};

const BRANCHES = ["run/test/S1", "run/test/S2", "run/test/S3"];

const BUDGET: Budget = {
  max_tokens_per_agent: 50_000,
  max_turns_per_agent: 10,
  model: "claude-opus-4-8",
};

function makeRun(): RunConfig {
  return {
    id: "test-run",
    base: { branch: "arena/base", sha: "" },
    gate: { branch: "arena/reference", sha: "", command: "" },
    arm: "",
    topology: "",
    level: "L1",
    slices: [
      { id: "S1", title: "Auth", backlog: [] },
      { id: "S2", title: "Search", backlog: [] },
      { id: "S3", title: "Export", backlog: [] },
    ],
    agents: 3,
    model: "test-model",
    budget: { max_tokens_per_agent: 50_000, max_turns_per_agent: 10 },
    integration: { mode: "pr-queue" },
    trials: { k: 1 },
    metrics: [],
  };
}

const GREEN_CI: CIResult = {
  buildClean: true,
  tscClean: true,
  testPass: true,
  testTotals: { passed: 10, failed: 0 },
  green: true,
};

const RED_CI: CIResult = {
  buildClean: false,
  tscClean: true,
  testPass: false,
  testTotals: { passed: 5, failed: 3 },
  green: false,
};

// ---------------------------------------------------------------------------
// Fake builders
// ---------------------------------------------------------------------------

/**
 * Fake RunCmdFn:
 * - pnpm commands → exit 0 (or envExit if set)
 * - git rev-parse HEAD → returns next SHA from headShas queue
 * - git merge --no-ff <branch> → exit from mergeExits[branch] (default 0)
 * - git reset --hard <sha> → exit 0
 * - all others → exit 0
 */
function makeFakeRunCmd(opts: {
  mergeExits?: Record<string, number>;
  headShas?: string[];
  envExit?: number;
} = {}): RunCmdFn {
  let revParseIdx = 0;
  const headShas = opts.headShas ?? ["sha-initial", "sha-1", "sha-2", "sha-3"];
  return async (cmd) => {
    const { argv } = cmd;
    if (argv[0] === "pnpm") {
      return { stdout: "", exit: opts.envExit ?? 0 };
    }
    if (argv[0] === "git") {
      if (argv.includes("rev-parse")) {
        const sha = headShas[revParseIdx] ?? headShas[headShas.length - 1];
        revParseIdx++;
        return { stdout: sha, exit: 0 };
      }
      if (argv.includes("merge") && argv.includes("--no-ff")) {
        const branch = argv[argv.length - 1];
        const exit = opts.mergeExits?.[branch] ?? 0;
        return { stdout: "", exit };
      }
      if (argv.includes("reset") && argv.includes("--hard")) {
        return { stdout: "", exit: 0 };
      }
    }
    return { stdout: "", exit: 0 };
  };
}

/**
 * Queued runCI fake — returns the next CIResult in the list.
 * When the queue is exhausted, repeats the last entry.
 */
function makeQueuedRunCI(
  results: CIResult[]
): (dir: string) => Promise<CIResult> {
  let idx = 0;
  return async (_dir) => {
    const r = results[idx] ?? results[results.length - 1];
    idx++;
    return r;
  };
}

/**
 * Queued runAgent fake — returns the next scripted AgentResult.
 * Optionally calls `onCall` with the SliceSpec so tests can inspect the prompt.
 */
function makeQueuedRunAgent(
  results: Array<Partial<AgentResult>>,
  onCall?: (spec: SliceSpec) => void
): (workspace: Workspace, spec: SliceSpec, budget: Budget) => Promise<AgentResult> {
  let idx = 0;
  return async (_workspace, spec, _budget) => {
    onCall?.(spec);
    const r = results[idx] ?? results[results.length - 1];
    idx++;
    return {
      sliceId: r.sliceId ?? "fix-agent",
      committed: r.committed ?? true,
      tokens: r.tokens ?? 500,
      turns: r.turns ?? 2,
      wallMs: r.wallMs ?? 100,
      exit: r.exit ?? 0,
      didNotComplete: r.didNotComplete ?? false,
    };
  };
}

/**
 * Queued countAssertions fake — returns the next scripted count.
 * When the queue is exhausted, repeats the last entry.
 */
function makeQueuedCountAssertions(counts: number[]): CountAssertionsFn {
  let idx = 0;
  return async (_dir) => {
    const count = counts[idx] ?? counts[counts.length - 1];
    idx++;
    return count;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPrQueue", () => {
  // -------------------------------------------------------------------------
  // Test 1: all branches merge clean + CI green → all merged, fix agent never called
  // -------------------------------------------------------------------------
  it("all branches merge clean + CI green → all merged, reachedSuccess:true, fix agent never called", async () => {
    const branches = BRANCHES.slice(0, 2); // S1, S2
    let agentCallCount = 0;

    const result = await runPrQueue(makeRun(), branches, INTEGRATION, BUDGET, {
      runCmd: makeFakeRunCmd(),
      runCI: makeQueuedRunCI([GREEN_CI, GREEN_CI]),
      runAgent: makeQueuedRunAgent([{ tokens: 0, turns: 0, wallMs: 0 }], () => {
        agentCallCount++;
      }),
      countAssertions: makeQueuedCountAssertions([10]),
    });

    expect(result.prs).toHaveLength(2);
    expect(result.prs[0]).toEqual({ branch: branches[0], outcome: "merged" });
    expect(result.prs[1]).toEqual({ branch: branches[1], outcome: "merged" });
    expect(result.reachedSuccess).toBe(true);
    expect(result.rounds).toBe(0);
    expect(result.integrationCost).toEqual({ tokens: 0, turns: 0, wallMs: 0 });
    expect(result.envError).toBe(false);
    expect(result.didNotComplete).toBe(false);
    // Fix agent must never be called when all merges are clean + green
    expect(agentCallCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: one branch CI-red on merge, fix agent makes CI green → merged, fixCost recorded
  // -------------------------------------------------------------------------
  it("one branch CI-red on merge, fix agent makes CI green → PR merged, reachedSuccess:true, fixCost recorded", async () => {
    const branches = ["run/test/S1"];
    let capturedSpec: SliceSpec | undefined;

    const result = await runPrQueue(makeRun(), branches, INTEGRATION, BUDGET, {
      runCmd: makeFakeRunCmd({ headShas: ["sha-initial", "sha-after-fix"] }),
      // First call: CI red (merge committed but CI fails); second call: green (post-fix)
      runCI: makeQueuedRunCI([RED_CI, GREEN_CI]),
      runAgent: makeQueuedRunAgent(
        [{ tokens: 500, turns: 2, wallMs: 100, didNotComplete: false }],
        (spec) => { capturedSpec = spec; }
      ),
      // snapshot=10, post=12 (not tampered: 12 >= 10)
      countAssertions: makeQueuedCountAssertions([10, 12]),
    });

    expect(result.prs).toHaveLength(1);
    expect(result.prs[0].branch).toBe(branches[0]);
    expect(result.prs[0].outcome).toBe("merged");
    expect(result.prs[0].fixCost).toEqual({ tokens: 500, turns: 2, wallMs: 100 });
    expect(result.prs[0].rounds).toBe(1);
    expect(result.reachedSuccess).toBe(true);
    expect(result.rounds).toBe(1);
    expect(result.integrationCost).toEqual({ tokens: 500, turns: 2, wallMs: 100 });
    expect(result.didNotComplete).toBe(false);
    // Fix agent was called with FIX_PROMPT
    expect(capturedSpec).toBeDefined();
    expect(capturedSpec!.prompt).toBe(FIX_PROMPT);
  });

  // -------------------------------------------------------------------------
  // Test 3: branch stays red after fix budget → blocked reason ci-fail, reachedSuccess:false
  // -------------------------------------------------------------------------
  it("branch stays red after fix budget → PR blocked reason ci-fail, reachedSuccess:false, didNotComplete:true", async () => {
    const branches = ["run/test/S1"];

    const result = await runPrQueue(makeRun(), branches, INTEGRATION, BUDGET, {
      runCmd: makeFakeRunCmd({ headShas: ["sha-initial"] }),
      // First call: CI red; second call (post-fix): still red
      runCI: makeQueuedRunCI([RED_CI, RED_CI]),
      runAgent: makeQueuedRunAgent([
        { tokens: 1000, turns: 10, wallMs: 500, didNotComplete: true },
      ]),
      // No tamper: counts unchanged (10 → 10)
      countAssertions: makeQueuedCountAssertions([10, 10]),
    });

    expect(result.prs).toHaveLength(1);
    expect(result.prs[0].branch).toBe(branches[0]);
    expect(result.prs[0].outcome).toBe("blocked");
    expect(result.prs[0].reason).toBe("ci-fail");
    expect(result.prs[0].tampered).toBeUndefined();
    expect(result.reachedSuccess).toBe(false);
    expect(result.didNotComplete).toBe(true);
    // I-2: fix agent launched = 1 round, even though PR stayed red
    expect(result.rounds).toBe(1);
    // I-1: failed agent's spend is still included in integrationCost
    expect(result.integrationCost).toEqual({ tokens: 1000, turns: 10, wallMs: 500 });
  });

  // -------------------------------------------------------------------------
  // Test 4: tamper — fix agent drops assertion count below post-merge snapshot
  // -------------------------------------------------------------------------
  it("fix agent drops assertion count below snapshot → PR blocked reason test-tampering, tampered:true, reachedSuccess:false", async () => {
    const branches = ["run/test/S1"];

    const result = await runPrQueue(makeRun(), branches, INTEGRATION, BUDGET, {
      runCmd: makeFakeRunCmd({ headShas: ["sha-initial"] }),
      // First call: CI red → blocked; tamper detected BEFORE second CI → second CI never called
      runCI: makeQueuedRunCI([RED_CI]),
      runAgent: makeQueuedRunAgent([
        { tokens: 500, turns: 2, wallMs: 100, didNotComplete: false },
      ]),
      // I-2: pre-merge=10, post-clean-merge snapshot=15 (incoming tests), post-fix=8 → TAMPERED (8 < 15)
      countAssertions: makeQueuedCountAssertions([10, 15, 8]),
    });

    expect(result.prs).toHaveLength(1);
    expect(result.prs[0].branch).toBe(branches[0]);
    expect(result.prs[0].outcome).toBe("blocked");
    expect(result.prs[0].reason).toBe("test-tampering");
    expect(result.prs[0].tampered).toBe(true);
    expect(result.reachedSuccess).toBe(false);
    expect(result.didNotComplete).toBe(true);
    // fix agent launched = 1 round even on tamper
    expect(result.rounds).toBe(1);
    // tampered agent's spend IS included in integrationCost (cost was really spent)
    expect(result.integrationCost).toEqual({ tokens: 500, turns: 2, wallMs: 100 });
  });

  // -------------------------------------------------------------------------
  // Test 4b (I-2): clean merge, fix reaches CI-green but drops below post-merge count
  // -------------------------------------------------------------------------
  it("I-2: clean merge whose fix agent reaches CI-green but drops assertion below post-merge count → tampered:true, PR blocked", async () => {
    // Scenario: incoming branch has tests. After clean merge the count grows.
    // Fix agent reaches green BUT deletes some of the incoming branch's own tests.
    // With pre-merge snapshot this would be undetected; with post-merge snapshot it is caught.
    const branches = ["run/test/S1"];

    const result = await runPrQueue(makeRun(), branches, INTEGRATION, BUDGET, {
      runCmd: makeFakeRunCmd({ headShas: ["sha-initial"] }),
      // Merge clean → CI red (needs fix); GREEN_CI is second in queue but tamper is caught first
      runCI: makeQueuedRunCI([RED_CI, GREEN_CI]),
      runAgent: makeQueuedRunAgent([
        { tokens: 500, turns: 2, wallMs: 100, didNotComplete: false },
      ]),
      // pre-merge=10, post-clean-merge=15 (incoming branch added tests), post-fix=12 (below 15 → tampered)
      countAssertions: makeQueuedCountAssertions([10, 15, 12]),
    });

    expect(result.prs).toHaveLength(1);
    expect(result.prs[0].branch).toBe(branches[0]);
    expect(result.prs[0].outcome).toBe("blocked");
    expect(result.prs[0].reason).toBe("test-tampering");
    expect(result.prs[0].tampered).toBe(true);
    expect(result.reachedSuccess).toBe(false);
    expect(result.didNotComplete).toBe(true);
    // cost still recorded even though tampered
    expect(result.rounds).toBe(1);
    expect(result.integrationCost).toEqual({ tokens: 500, turns: 2, wallMs: 100 });
  });

  // -------------------------------------------------------------------------
  // Test 5: 3-branch run with one permanently-blocked branch → prs.length === 3
  // -------------------------------------------------------------------------
  it("3-branch run with one permanently-blocked branch → prs.length===3, no branch omitted, reachedSuccess:false", async () => {
    // S1: merges clean + green → lands
    // S2: merges clean + CI red → fix fails (still red) → blocked, rolled back
    // S3: merges clean + green (onto sha-1, not onto S2's bad merge) → lands
    const branches = BRANCHES; // S1, S2, S3

    const result = await runPrQueue(makeRun(), branches, INTEGRATION, BUDGET, {
      runCmd: makeFakeRunCmd({ headShas: ["sha-initial", "sha-1", "sha-3"] }),
      // S1→green; S2→red (first CI); S2 post-fix→red (second CI); S3→green
      runCI: makeQueuedRunCI([GREEN_CI, RED_CI, RED_CI, GREEN_CI]),
      runAgent: makeQueuedRunAgent([
        { tokens: 100, turns: 1, wallMs: 50, didNotComplete: true },
      ]),
      // S2: snapshot=10, post=10 (not tampered — just can't fix it)
      countAssertions: makeQueuedCountAssertions([10, 10]),
    });

    // Critical invariant: no branch silently absent
    expect(result.prs).toHaveLength(3);
    expect(result.prs[0]).toEqual({ branch: BRANCHES[0], outcome: "merged" });
    expect(result.prs[1]).toMatchObject({ branch: BRANCHES[1], outcome: "blocked" });
    expect(result.prs[2]).toEqual({ branch: BRANCHES[2], outcome: "merged" });
    // S2 is blocked → reachedSuccess must be false
    expect(result.reachedSuccess).toBe(false);
    expect(result.didNotComplete).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test M-1: envError=true → reachedSuccess:false even when all PRs merged clean
  // -------------------------------------------------------------------------
  it("M-1: envError=true → reachedSuccess:false, didNotComplete:true even when all PRs merge green", async () => {
    const branches = BRANCHES.slice(0, 2); // S1, S2

    const result = await runPrQueue(makeRun(), branches, INTEGRATION, BUDGET, {
      runCmd: makeFakeRunCmd({ envExit: 1 }), // env setup exits non-zero → envError
      runCI: makeQueuedRunCI([GREEN_CI, GREEN_CI]),
      runAgent: makeQueuedRunAgent([{ tokens: 0, turns: 0, wallMs: 0 }]),
      countAssertions: makeQueuedCountAssertions([10]),
    });

    expect(result.envError).toBe(true);
    // Even though all PRs merged green, envError makes this untrustworthy
    expect(result.reachedSuccess).toBe(false);
    expect(result.didNotComplete).toBe(true);
    // Both PRs still recorded as merged
    expect(result.prs[0].outcome).toBe("merged");
    expect(result.prs[1].outcome).toBe("merged");
  });

  // -------------------------------------------------------------------------
  // Test 6: FIX_PROMPT has no "gate"; runAgent is called via the injected fn
  // -------------------------------------------------------------------------
  it("FIX_PROMPT contains no 'gate'; fix agent is called via injected runAgent with FIX_PROMPT", async () => {
    let capturedSpec: SliceSpec | undefined;
    let agentCallCount = 0;

    await runPrQueue(makeRun(), ["run/test/S1"], INTEGRATION, BUDGET, {
      runCmd: makeFakeRunCmd({ headShas: ["sha-initial", "sha-fixed"] }),
      runCI: makeQueuedRunCI([RED_CI, GREEN_CI]),
      runAgent: makeQueuedRunAgent(
        [{ tokens: 100, turns: 1, wallMs: 50, didNotComplete: false }],
        (spec) => {
          capturedSpec = spec;
          agentCallCount++;
        }
      ),
      countAssertions: makeQueuedCountAssertions([10, 12]),
    });

    // Gate-blind invariant: FIX_PROMPT must never mention the gate
    expect(FIX_PROMPT.toLowerCase()).not.toContain("gate");
    // The injected runAgent must have been called (not bypassed)
    expect(agentCallCount).toBe(1);
    // The agent received exactly the FIX_PROMPT
    expect(capturedSpec).toBeDefined();
    expect(capturedSpec!.prompt).toBe(FIX_PROMPT);
  });
});
