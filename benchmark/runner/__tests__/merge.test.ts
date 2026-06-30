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
  } finally {
    try {
      git("worktree", "remove", "--force", tempDir);
    } catch {
      // worktree may not have been registered (e.g. worktree add failed) — ignore
    }
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
    fixtureBranches.push(b1);
    createFixtureBranch(b2, "file-b.txt", "content from slice2\n");
    fixtureBranches.push(b2);

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
      fixtureBranches.push(b1);
      createFixtureBranch(b2, "shared.txt", "version from slice2\n");
      fixtureBranches.push(b2);

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

  // ---------------------------------------------------------------------------
  // 'leave' mode tests
  // ---------------------------------------------------------------------------

  it("leave mode, disjoint files: all merge cleanly, mergedCleanly=true, no markers, no merge in progress", async () => {
    const b1 = `fixture/${runId}/lv-s1`;
    const b2 = `fixture/${runId}/lv-s2`;
    createFixtureBranch(b1, "lv-file-a.txt", "content from slice1\n");
    fixtureBranches.push(b1);
    createFixtureBranch(b2, "lv-file-b.txt", "content from slice2\n");
    fixtureBranches.push(b2);

    const result = await mergeSlices(
      run,
      [
        { sliceId: "lv-s1", branch: b1 },
        { sliceId: "lv-s2", branch: b2 },
      ],
      { rootDir: tmpDir, onConflict: "leave" }
    );
    integrationWorkspace = result.integration;

    expect(result.mergedCleanly).toBe(true);
    expect(result.results[0]).toMatchObject({ sliceId: "lv-s1", merged: true, conflictedFiles: [] });
    expect(result.results[1]).toMatchObject({ sliceId: "lv-s2", merged: true, conflictedFiles: [] });
    // No merge in progress when everything was clean
    expect(mergeInProgress(result.integration.dir)).toBe(false);
  });

  it(
    "leave mode, same-line conflict: conflict markers left in file, merge in progress, " +
      "conflicting slice recorded, subsequent slice not attempted",
    async () => {
      const b1 = `fixture/${runId}/lv-c1`;
      const b2 = `fixture/${runId}/lv-c2`;
      const b3 = `fixture/${runId}/lv-c3`;
      // b1 and b2 both create shared.txt with different content → add/add conflict on merge
      createFixtureBranch(b1, "shared.txt", "version from slice1\n");
      fixtureBranches.push(b1);
      createFixtureBranch(b2, "shared.txt", "version from slice2\n");
      fixtureBranches.push(b2);
      // b3 is unrelated — but won't be attempted because b2 conflicts first
      createFixtureBranch(b3, "lv-other.txt", "unrelated slice3\n");
      fixtureBranches.push(b3);

      const result = await mergeSlices(
        run,
        [
          { sliceId: "lv-c1", branch: b1 },
          { sliceId: "lv-c2", branch: b2 },
          { sliceId: "lv-c3", branch: b3 },
        ],
        { rootDir: tmpDir, onConflict: "leave" }
      );
      integrationWorkspace = result.integration;

      expect(result.mergedCleanly).toBe(false);

      // First slice merged cleanly
      expect(result.results[0]).toMatchObject({ sliceId: "lv-c1", merged: true, conflictedFiles: [] });

      // Second slice conflicted — files recorded, marked not merged
      expect(result.results[1].sliceId).toBe("lv-c2");
      expect(result.results[1].merged).toBe(false);
      expect(result.results[1].conflictedFiles).toContain("shared.txt");

      // Conflict markers must be present in the working file
      const conflictedContent = fs.readFileSync(
        path.join(result.integration.dir, "shared.txt"),
        "utf-8"
      );
      expect(conflictedContent).toContain("<<<<<<<");

      // Integration worktree must have a merge in progress (NOT aborted)
      expect(mergeInProgress(result.integration.dir)).toBe(true);

      // Third slice was never attempted — recorded with empty conflictedFiles
      expect(result.results[2]).toMatchObject({
        sliceId: "lv-c3",
        merged: false,
        conflictedFiles: [],
      });
    }
  );

  it("integration branch and worktree exist regardless of conflicts", async () => {
    const b1 = `fixture/${runId}/e1`;
    const b2 = `fixture/${runId}/e2`;
    // Trigger a conflict so we verify "regardless"
    createFixtureBranch(b1, "exist-shared.txt", "version A\n");
    fixtureBranches.push(b1);
    createFixtureBranch(b2, "exist-shared.txt", "version B\n");
    fixtureBranches.push(b2);

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
