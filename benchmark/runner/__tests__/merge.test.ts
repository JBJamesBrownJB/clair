import { describe, it, expect, afterEach, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergeSlices } from "../merge.js";
import { teardown } from "../workspace.js";
import type { Workspace } from "../workspace.js";
import type { RunConfig } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8", stdio: "pipe" }).trim();
}

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: "pipe" }).trim();
}

/** Minimal RunConfig for testing — only fields mergeSlices actually reads. */
function makeRun(id: string): RunConfig {
  return {
    id,
    base: { branch: "arena/base", sha: "" },
    gate: { branch: "", sha: "", command: "" },
    arm: "",
    topology: "",
    level: "",
    slices: [],
    agents: 0,
    model: "",
    budget: { max_tokens_per_agent: 0, max_turns_per_agent: 0 },
    integration: { mode: "", resolver: "" },
    trials: { k: 1 },
    metrics: [],
  };
}

/**
 * Creates a fixture branch off arena/base by spinning up a temporary worktree,
 * writing fileName with content, committing, and removing the worktree (keeps branch).
 */
function createFixtureBranch(branchName: string, fileName: string, content: string): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clair-fix-"));
  try {
    git("worktree", "add", "-b", branchName, tempDir, "arena/base");
    fs.writeFileSync(path.join(tempDir, fileName), content);
    gitIn(tempDir, "add", "--", fileName);
    gitIn(
      tempDir,
      "-c", "user.email=test@clair",
      "-c", "user.name=Test",
      "commit", "-m", `fixture: ${branchName}`
    );
    git("worktree", "remove", "--force", tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Returns true if there is an in-progress merge in the given worktree. */
function mergeInProgress(dir: string): boolean {
  try {
    gitIn(dir, "rev-parse", "--verify", "MERGE_HEAD");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------

describe("mergeSlices", () => {
  let tmpDir: string;
  let run: RunConfig;
  let runId: string;
  let fixtureBranches: string[];
  let integrationWorkspace: Workspace | null;

  beforeEach(() => {
    runId = `tmerge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    run = makeRun(runId);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clair-merge-"));
    fixtureBranches = [];
    integrationWorkspace = null;
  });

  afterEach(async () => {
    if (integrationWorkspace) {
      await teardown([integrationWorkspace]).catch((e) =>
        console.error("[afterEach] teardown failed:", e)
      );
      integrationWorkspace = null;
    }
    for (const branch of fixtureBranches) {
      try {
        git("branch", "-D", branch);
      } catch {
        // idempotent
      }
    }
    fixtureBranches = [];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("disjoint files: both slices merge cleanly, mergedCleanly=true, no conflictedFiles", async () => {
    const b1 = `fixture/${runId}/s1`;
    const b2 = `fixture/${runId}/s2`;
    createFixtureBranch(b1, "file-a.txt", "content from slice1\n");
    createFixtureBranch(b2, "file-b.txt", "content from slice2\n");
    fixtureBranches.push(b1, b2);

    const result = await mergeSlices(
      run,
      [
        { sliceId: "s1", branch: b1 },
        { sliceId: "s2", branch: b2 },
      ],
      { rootDir: tmpDir }
    );
    integrationWorkspace = result.integration;

    expect(result.mergedCleanly).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      sliceId: "s1",
      branch: b1,
      merged: true,
      conflictedFiles: [],
    });
    expect(result.results[1]).toMatchObject({
      sliceId: "s2",
      branch: b2,
      merged: true,
      conflictedFiles: [],
    });
  });

  it(
    "same-line conflict: second slice records conflict file, mergedCleanly=false, " +
      "integration worktree stays clean (no in-progress merge)",
    async () => {
      const b1 = `fixture/${runId}/c1`;
      const b2 = `fixture/${runId}/c2`;
      // Both branches add the same file with different content → add/add conflict
      createFixtureBranch(b1, "shared.txt", "version from slice1\n");
      createFixtureBranch(b2, "shared.txt", "version from slice2\n");
      fixtureBranches.push(b1, b2);

      const result = await mergeSlices(
        run,
        [
          { sliceId: "c1", branch: b1 },
          { sliceId: "c2", branch: b2 },
        ],
        { rootDir: tmpDir }
      );
      integrationWorkspace = result.integration;

      expect(result.mergedCleanly).toBe(false);

      // First slice (no conflict with arena/base)
      expect(result.results[0]).toMatchObject({ sliceId: "c1", merged: true, conflictedFiles: [] });

      // Second slice conflicts
      expect(result.results[1].sliceId).toBe("c2");
      expect(result.results[1].merged).toBe(false);
      expect(result.results[1].conflictedFiles).toContain("shared.txt");

      // Integration worktree must NOT have a merge in progress
      expect(mergeInProgress(result.integration.dir)).toBe(false);
    }
  );

  it("integration branch and worktree exist regardless of conflicts", async () => {
    const b1 = `fixture/${runId}/e1`;
    const b2 = `fixture/${runId}/e2`;
    // Trigger a conflict so we verify "regardless"
    createFixtureBranch(b1, "exist-shared.txt", "version A\n");
    createFixtureBranch(b2, "exist-shared.txt", "version B\n");
    fixtureBranches.push(b1, b2);

    const result = await mergeSlices(
      run,
      [
        { sliceId: "e1", branch: b1 },
        { sliceId: "e2", branch: b2 },
      ],
      { rootDir: tmpDir }
    );
    integrationWorkspace = result.integration;

    // Shape
    expect(result.integration.sliceId).toBe("integration");
    expect(result.integration.branch).toBe(`run/${runId}/integration`);
    expect(fs.existsSync(result.integration.dir)).toBe(true);

    // Branch exists in git
    const sha = git("rev-parse", result.integration.branch);
    expect(sha).toBeTruthy();
    expect(sha).toHaveLength(40);
  });
});
