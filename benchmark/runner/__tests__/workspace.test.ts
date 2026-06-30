import { describe, it, expect, afterEach, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadRun } from "../loadRun.js";
import { provision, teardown } from "../workspace.js";
import type { Workspace } from "../workspace.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const runConfigPath = path.join(repoRoot, "benchmark/runs/standard-L1.run.yaml");

// ---------------------------------------------------------------------------
// Unique runId generator
// Each test gets a distinct runId so leftover branches from prior runs (or
// concurrent test processes) cannot cause false failures. The stamp is fixed at
// module load + a per-call counter so it stays deterministic within a session
// while being unique across sessions.
// ---------------------------------------------------------------------------

const RUN_STAMP = Date.now();
let _counter = 0;

function uniqueRunId(): string {
  return `test-ws-${RUN_STAMP}-${++_counter}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitExec(...args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" }).trim();
}

function getWorktreePaths(): Set<string> {
  const raw = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  const paths = new Set<string>();
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.add(path.normalize(line.slice("worktree ".length).trim()));
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("workspace provisioning", () => {
  let tmpDir: string;
  let workspaces: Workspace[] = [];
  // Branches created during this test — deleted in afterEach because teardown
  // no longer deletes branches (they survive for post-hoc inspection).
  let branchesToCleanup: string[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clair-bench-"));
    workspaces = [];
    branchesToCleanup = [];
  });

  afterEach(async () => {
    // Remove worktrees first
    if (workspaces.length > 0) {
      await teardown(workspaces, { retryDelayMs: 0 }).catch((e) =>
        console.error("[afterEach] teardown failed:", e)
      );
      workspaces = [];
    }
    // Delete test branches (teardown no longer does this — tests own their branches)
    for (const branch of branchesToCleanup) {
      try {
        execFileSync("git", ["branch", "-D", branch], {
          cwd: repoRoot,
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch {
        // Already deleted or never created — idempotent
      }
    }
    branchesToCleanup = [];
    // Clean up the temp dir — but only if none of its worktree dirs are still
    // registered with git. Deleting a registered worktree dir out from under git
    // is exactly the corruption teardown prevents; don't replicate it in tests.
    const registeredPaths = getWorktreePaths();
    const hasDanglingWorktree = [...registeredPaths].some((p) =>
      p.startsWith(path.normalize(tmpDir))
    );
    if (hasDanglingWorktree) {
      console.warn(
        `[afterEach] Skipping rmSync of "${tmpDir}" — it still contains registered worktree paths. ` +
          `This indicates a teardown failure; leaving the dir intact to avoid git corruption.`
      );
    } else {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: Basic provision shape
  // -------------------------------------------------------------------------

  it("provisioning standard-L1 yields 3 distinct dirs each on its own branch", async () => {
    const run = loadRun(runConfigPath);
    run.id = uniqueRunId();
    workspaces = await provision(run, { rootDir: tmpDir, install: false });
    branchesToCleanup.push(...workspaces.map((w) => w.branch));

    expect(workspaces).toHaveLength(3);
    const dirs = new Set(workspaces.map((w) => w.dir));
    expect(dirs.size).toBe(3);

    for (const w of workspaces) {
      expect(fs.existsSync(w.dir)).toBe(true);
      expect(w.branch).toBe(`run/${run.id}/${w.sliceId}`);
    }
  });

  // -------------------------------------------------------------------------
  // Test 2: Branch tips match arena/base
  // -------------------------------------------------------------------------

  it("each worktree branch tip equals arena/base tip", async () => {
    const run = loadRun(runConfigPath);
    run.id = uniqueRunId();
    workspaces = await provision(run, { rootDir: tmpDir, install: false });
    branchesToCleanup.push(...workspaces.map((w) => w.branch));

    const arenaBaseSha = gitExec("rev-parse", "arena/base");

    for (const w of workspaces) {
      const tipSha = gitExec("rev-parse", w.branch);
      expect(tipSha).toBe(arenaBaseSha);
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: Teardown removes worktree dirs; branches survive (not deleted)
  // -------------------------------------------------------------------------

  it("teardown removes worktree dirs and git entries; branches still resolve after teardown", async () => {
    const run = loadRun(runConfigPath);
    run.id = uniqueRunId();
    workspaces = await provision(run, { rootDir: tmpDir, install: false });
    branchesToCleanup.push(...workspaces.map((w) => w.branch));

    const savedDirs = workspaces.map((w) => w.dir).map(path.normalize);
    const savedBranches = workspaces.map((w) => w.branch);

    await teardown(workspaces, { retryDelayMs: 0 });
    workspaces = []; // already torn down — afterEach teardown will be a no-op

    // Dirs gone from disk and from git's worktree registry
    const remaining = getWorktreePaths();
    for (const dir of savedDirs) {
      expect(fs.existsSync(dir)).toBe(false);
      expect(remaining.has(dir)).toBe(false);
    }

    // Branches survive — teardown does NOT delete them (evidence-preserving)
    for (const branch of savedBranches) {
      const sha = gitExec("rev-parse", branch);
      expect(sha.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Test 4: Branches survive, second provision with a new runId works cleanly
  // -------------------------------------------------------------------------

  it("branches survive teardown; a second provision with a distinct runId succeeds without conflict", async () => {
    const run1 = loadRun(runConfigPath);
    run1.id = uniqueRunId();

    workspaces = await provision(run1, { rootDir: tmpDir, install: false });
    const branches1 = workspaces.map((w) => w.branch);
    branchesToCleanup.push(...branches1);

    await teardown(workspaces, { retryDelayMs: 0 });
    workspaces = [];

    // Branches from first run still resolve after teardown
    for (const b of branches1) {
      const sha = gitExec("rev-parse", b);
      expect(sha.length).toBeGreaterThan(0);
    }

    // Second provision with a DIFFERENT runId succeeds without any branch collision
    const run2 = loadRun(runConfigPath);
    run2.id = uniqueRunId();
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "clair-bench2-"));
    try {
      workspaces = await provision(run2, { rootDir: tmpDir2, install: false });
      branchesToCleanup.push(...workspaces.map((w) => w.branch));

      expect(workspaces).toHaveLength(3);
      for (const w of workspaces) {
        expect(w.branch).toBe(`run/${run2.id}/${w.sliceId}`);
        expect(fs.existsSync(w.dir)).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: All-or-nothing provision — partial failure cleans up worktrees
  // -------------------------------------------------------------------------

  it("provision cleans up worktrees when install fails partway (all-or-nothing)", async () => {
    const run = loadRun(runConfigPath);
    run.id = uniqueRunId();
    // Register all potential branches for afterEach cleanup (teardown no longer deletes them)
    branchesToCleanup.push(...run.slices.map((s) => `run/${run.id}/${s.id}`));

    let calls = 0;
    const failingInstall = () => {
      calls += 1;
      if (calls === 2) throw new Error("INSTALL_BOOM");
    };

    await expect(
      provision(run, { rootDir: tmpDir, install: true }, { install: failingInstall })
    ).rejects.toThrow("INSTALL_BOOM");

    // Worktree dirs are cleaned up (provision's own all-or-nothing teardown)
    const worktrees = getWorktreePaths();
    for (const slice of run.slices) {
      const dir = path.normalize(path.join(tmpDir, `${run.id}-${slice.id}`));
      expect(fs.existsSync(dir)).toBe(false);
      expect(worktrees.has(dir)).toBe(false);
    }
    // Note: branches may survive (teardown no longer deletes them) — cleaned up in afterEach.
  });

  // -------------------------------------------------------------------------
  // Test 6: Teardown idempotency — already-removed worktrees do not throw
  // -------------------------------------------------------------------------

  it("teardown on already-removed workspaces does not throw", async () => {
    const run = loadRun(runConfigPath);
    run.id = uniqueRunId();
    workspaces = await provision(run, { rootDir: tmpDir, install: false });
    branchesToCleanup.push(...workspaces.map((w) => w.branch));

    await teardown(workspaces, { retryDelayMs: 0 });
    // Second teardown — must not throw even though worktrees are already gone
    await expect(teardown(workspaces, { retryDelayMs: 0 })).resolves.toBeUndefined();
    workspaces = [];
  });

  // -------------------------------------------------------------------------
  // Test 7: Teardown failure path — worktree remove fails both attempts
  // Invariants:
  //   • teardown must NOT throw (resolves)
  //   • prune must still be called
  //   • the worktree DIRECTORY must NOT be deleted (anti-corruption guarantee)
  // -------------------------------------------------------------------------

  it("teardown does not throw and preserves the dir when worktree remove fails both attempts", async () => {
    // Create a real temp dir that represents the worktree directory.
    // We do NOT actually create a git worktree here — the injected runGit
    // intercepts all git calls, so no real git state is involved.
    const fakeWorktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "clair-bench-fail-"));

    const fakeWorkspace: Workspace = {
      sliceId: "fail-slice",
      dir: fakeWorktreeDir,
      branch: "run/test-fail/fail-slice",
    };

    const called: string[][] = [];

    const failingRunGit = (args: string[]): void => {
      called.push(args);
      if (args[0] === "worktree" && args[1] === "remove") {
        throw new Error("SIMULATED_LOCK: cannot remove worktree");
      }
      // prune and any other calls succeed (return void)
    };

    // teardown must resolve (not throw)
    await expect(
      teardown([fakeWorkspace], { retryDelayMs: 0, runGit: failingRunGit })
    ).resolves.toBeUndefined();

    // prune must have been called
    const pruneCall = called.find((a) => a[0] === "worktree" && a[1] === "prune");
    expect(pruneCall).toBeDefined();

    // worktree remove must have been attempted (both the first try and the retry)
    const removeCalls = called.filter((a) => a[0] === "worktree" && a[1] === "remove");
    expect(removeCalls.length).toBe(2);

    // CRITICAL: the directory must NOT have been deleted by teardown
    expect(fs.existsSync(fakeWorktreeDir)).toBe(true);

    // Cleanup the temp dir ourselves (teardown correctly left it alone)
    fs.rmSync(fakeWorktreeDir, { recursive: true, force: true });
  });
});
