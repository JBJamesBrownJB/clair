import { describe, it, expect } from "vitest";
import { runResolver } from "../resolve.js";
import type { ResolutionResult } from "../resolve.js";
import type { ResolverDeps } from "../resolve.js";
import type { RunCmdFn } from "../gate.js";
import type { Budget, AgentResult } from "../agent.js";
import type { Workspace } from "../workspace.js";
import type { RunConfig } from "../types.js";
import type { SliceSpec } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INTEGRATION: Workspace = {
  sliceId: "integration",
  dir: "/fake/integration",
  branch: "run/test/integration",
};

const SLICE_BRANCHES = ["run/test/S1", "run/test/S2", "run/test/S3"];

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
    integration: { mode: "merge", resolver: "agent" },
    trials: { k: 1 },
    metrics: [],
  };
}

function makeAgentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    sliceId: "integration",
    committed: true,
    tokens: 1500,
    turns: 3,
    wallMs: 100,
    exit: 0,
    didNotComplete: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers for injecting fakes
// ---------------------------------------------------------------------------

type RunAgentFn = (
  workspace: Workspace,
  spec: SliceSpec,
  budget: Budget,
  deps?: unknown
) => Promise<AgentResult>;

/** Returns a fake runAgent that resolves to `result`, calling `onCall` if provided. */
function fakeRunAgent(
  result: AgentResult,
  onCall?: (spec: SliceSpec) => void
): RunAgentFn {
  return async (_workspace, spec, _budget, _deps) => {
    onCall?.(spec);
    return result;
  };
}

/** Returns a fake runCmd. exitMap keys are the argv joined by space; default exit is 0. */
function fakeRunCmd(
  exitMap: Record<string, number> = {},
  onCall?: (cmd: { argv: string[]; cwd: string }) => void
): RunCmdFn {
  return async (cmd) => {
    onCall?.(cmd);
    const key = cmd.argv.join(" ");
    const exit = key in exitMap ? exitMap[key] : 0;
    return { stdout: "", exit };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runResolver", () => {
  // Test 1: happy path
  it("reachedGreen:true, didNotResolve:false, tokens/turns/wallMs propagated from agentResult", async () => {
    const agentResult = makeAgentResult({ tokens: 2000, turns: 5, wallMs: 250 });
    const result = await runResolver(makeRun(), SLICE_BRANCHES, INTEGRATION, BUDGET, {
      runAgent: fakeRunAgent(agentResult) as ResolverDeps["runAgent"],
      runCmd: fakeRunCmd(),
    });

    expect(result.ran).toBe(true);
    expect(result.reachedGreen).toBe(true);
    expect(result.didNotResolve).toBe(false);
    expect(result.tokens).toBe(2000);
    expect(result.turns).toBe(5);
    expect(result.wallMs).toBe(250);
  });

  // Test 2: budget blown
  it("didNotResolve:true when agent didNotComplete (budget blown), regardless of verify", async () => {
    const agentResult = makeAgentResult({ didNotComplete: true });
    const result = await runResolver(makeRun(), SLICE_BRANCHES, INTEGRATION, BUDGET, {
      runAgent: fakeRunAgent(agentResult) as ResolverDeps["runAgent"],
      runCmd: fakeRunCmd(), // all verify cmds exit 0 — but didNotResolve should still be true
    });

    expect(result.didNotResolve).toBe(true);
  });

  // Test 3: typecheck fails
  it("reachedGreen:false, didNotResolve:true when pnpm typecheck exits non-zero", async () => {
    const agentResult = makeAgentResult(); // didNotComplete: false
    const result = await runResolver(makeRun(), SLICE_BRANCHES, INTEGRATION, BUDGET, {
      runAgent: fakeRunAgent(agentResult) as ResolverDeps["runAgent"],
      runCmd: fakeRunCmd({ "pnpm typecheck": 1 }),
    });

    expect(result.reachedGreen).toBe(false);
    expect(result.didNotResolve).toBe(true);
  });

  // Test 4: RESOLVER_PROMPT content
  it("RESOLVER_PROMPT passed to runAgent contains all branch names and does NOT contain 'gate'", async () => {
    let capturedSpec: SliceSpec | undefined;

    await runResolver(makeRun(), SLICE_BRANCHES, INTEGRATION, BUDGET, {
      runAgent: fakeRunAgent(
        makeAgentResult(),
        (spec) => { capturedSpec = spec; }
      ) as ResolverDeps["runAgent"],
      runCmd: fakeRunCmd(),
    });

    expect(capturedSpec).toBeDefined();
    for (const branch of SLICE_BRANCHES) {
      expect(capturedSpec!.prompt).toContain(branch);
    }
    // Gate-blind: the word "gate" must not appear anywhere in the prompt
    expect(capturedSpec!.prompt.toLowerCase()).not.toContain("gate");
  });

  // Test 5: call order — env setup before verify
  it("env setup (pnpm install, pnpm db:generate) runs before verify (pnpm typecheck, pnpm build, pnpm test)", async () => {
    const callLog: string[] = [];

    await runResolver(makeRun(), SLICE_BRANCHES, INTEGRATION, BUDGET, {
      runAgent: fakeRunAgent(makeAgentResult()) as ResolverDeps["runAgent"],
      runCmd: fakeRunCmd({}, (cmd) => { callLog.push(cmd.argv.join(" ")); }),
    });

    const installIdx = callLog.indexOf("pnpm install");
    const dbGenerateIdx = callLog.indexOf("pnpm db:generate");
    const dbResetIdx = callLog.indexOf("pnpm db:reset");
    const typecheckIdx = callLog.indexOf("pnpm typecheck");
    const buildIdx = callLog.indexOf("pnpm build");
    const testIdx = callLog.indexOf("pnpm test");

    // All commands must be present
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(dbGenerateIdx).toBeGreaterThanOrEqual(0);
    expect(dbResetIdx).toBeGreaterThanOrEqual(0);
    expect(typecheckIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(testIdx).toBeGreaterThanOrEqual(0);

    // Env setup before verify
    expect(installIdx).toBeLessThan(typecheckIdx);
    expect(installIdx).toBeLessThan(buildIdx);
    expect(installIdx).toBeLessThan(testIdx);
    expect(dbGenerateIdx).toBeLessThan(typecheckIdx);
    expect(dbGenerateIdx).toBeLessThan(buildIdx);
    expect(dbGenerateIdx).toBeLessThan(testIdx);
    // db:reset also before verify
    expect(dbResetIdx).toBeLessThan(typecheckIdx);
  });
});
