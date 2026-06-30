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

describe("workspace provisioning", () => {
  let tmpDir: string;
  let workspaces: Workspace[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clair-bench-"));
    workspaces = [];
  });

  afterEach(async () => {
    if (workspaces.length > 0) {
      await teardown(workspaces).catch(e => console.error("[afterEach] teardown failed:", e));
      workspaces = [];
    }
  });

  it("provisioning standard-L1 yields 3 distinct dirs each on its own branch", async () => {
    const run = loadRun(runConfigPath);
    workspaces = await provision(run, { rootDir: tmpDir, install: false });

    expect(workspaces).toHaveLength(3);
    const dirs = new Set(workspaces.map((w) => w.dir));
    expect(dirs.size).toBe(3);

    for (const w of workspaces) {
      expect(fs.existsSync(w.dir)).toBe(true);
      expect(w.branch).toBe(`run/${run.id}/${w.sliceId}`);
    }
  });

  it("each worktree branch tip equals arena/base tip", async () => {
    const run = loadRun(runConfigPath);
    workspaces = await provision(run, { rootDir: tmpDir, install: false });

    const arenaBaseSha = gitExec("rev-parse", "arena/base");

    for (const w of workspaces) {
      const tipSha = gitExec("rev-parse", w.branch);
      expect(tipSha).toBe(arenaBaseSha);
    }
  });

  it("teardown removes all worktree dirs and they no longer appear in git worktree list", async () => {
    const run = loadRun(runConfigPath);
    workspaces = await provision(run, { rootDir: tmpDir, install: false });

    const savedDirs = workspaces.map((w) => w.dir).map(path.normalize);

    await teardown(workspaces);
    workspaces = []; // already torn down — afterEach will be a no-op

    const remaining = getWorktreePaths();
    for (const dir of savedDirs) {
      expect(fs.existsSync(dir)).toBe(false);
      expect(remaining.has(dir)).toBe(false);
    }
  });

  it("provision → teardown → provision with same runId is clean (idempotent)", async () => {
    const run = loadRun(runConfigPath);

    workspaces = await provision(run, { rootDir: tmpDir, install: false });
    await teardown(workspaces);
    workspaces = [];

    // Same runId → same branch names; teardown must have deleted branches for this to work
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "clair-bench2-"));
    try {
      workspaces = await provision(run, { rootDir: tmpDir2, install: false });

      expect(workspaces).toHaveLength(3);
      for (const w of workspaces) {
        expect(w.branch).toBe(`run/${run.id}/${w.sliceId}`);
        expect(fs.existsSync(w.dir)).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  it("provision cleans up worktrees and branches when install fails partway (all-or-nothing)", async () => {
    const run = loadRun(runConfigPath);

    let calls = 0;
    const failingInstall = () => {
      calls += 1;
      if (calls === 2) throw new Error("INSTALL_BOOM");
    };

    await expect(
      provision(run, { rootDir: tmpDir, install: true }, { install: failingInstall })
    ).rejects.toThrow("INSTALL_BOOM");

    // No worktree dirs for this run remain on disk or in git's worktree list.
    const worktrees = getWorktreePaths();
    for (const slice of run.slices) {
      const dir = path.normalize(path.join(tmpDir, `${run.id}-${slice.id}`));
      expect(fs.existsSync(dir)).toBe(false);
      expect(worktrees.has(dir)).toBe(false);
    }

    // No run/<runId>/* branches remain.
    const branches = execFileSync("git", ["branch", "--list", `run/${run.id}/*`], {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();
    expect(branches).toBe("");
  });

  it("teardown on already-removed workspaces does not throw", async () => {
    const run = loadRun(runConfigPath);
    workspaces = await provision(run, { rootDir: tmpDir, install: false });

    await teardown(workspaces);
    // Second teardown — must not throw
    await expect(teardown(workspaces)).resolves.toBeUndefined();
    workspaces = [];
  });
});
