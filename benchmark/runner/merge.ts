import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RunConfig } from "./types.js";
import type { Workspace } from "./workspace.js";

export interface MergeSliceResult {
  sliceId: string;
  branch: string;
  merged: boolean;
  conflictedFiles: string[];
}

export interface MergeResult {
  integration: Workspace;
  mergedCleanly: boolean;
  results: MergeSliceResult[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the repo root (two levels up from benchmark/runner/). */
const REPO_ROOT = path.resolve(__dirname, "../..");

/** Default scratch directory for worktrees — git-ignored via benchmark/runner/.gitignore. */
const DEFAULT_WORK_DIR = path.join(__dirname, ".work");

function git(args: string[]): void {
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8", stdio: "pipe" });
}

function gitIn(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

/**
 * Extract filenames of all unmerged (conflicted) index entries in a worktree.
 * Works for all conflict types: modify/modify, add/add, delete/modify, etc.
 * `git ls-files --unmerged` outputs one line per stage; we deduplicate filenames.
 */
function conflictedFilesIn(dir: string): string[] {
  const raw = gitIn(dir, ["ls-files", "--unmerged"]);
  if (!raw) return [];
  const names = new Set<string>();
  for (const line of raw.split("\n")) {
    // Format: <mode> <sha> <stage>\t<filename>
    const tab = line.indexOf("\t");
    if (tab !== -1) names.add(line.slice(tab + 1).trim());
  }
  return [...names];
}

/**
 * Merge all slice branches into a single integration branch created from arena/base.
 *
 * For each slice branch, attempts `git merge --no-ff <branch>` inside the integration
 * worktree.  On conflict: records the conflicted file paths, aborts the merge (so the
 * worktree stays clean), and continues to the next slice.  NO conflict resolver.
 *
 * The integration worktree is NOT torn down here — the caller is responsible (pass
 * `result.integration` to `teardown`).
 */
export async function mergeSlices(
  run: RunConfig,
  slices: Array<{ sliceId: string; branch: string }>,
  opts?: { rootDir?: string }
): Promise<MergeResult> {
  const rootDir = opts?.rootDir ?? DEFAULT_WORK_DIR;
  const integrationDir = path.join(rootDir, `${run.id}-integration`);
  const integrationBranch = `run/${run.id}/integration`;

  // Create the integration worktree on a new branch from the configured base branch.
  git(["worktree", "add", "-b", integrationBranch, integrationDir, run.base.branch]);

  const integration: Workspace = {
    sliceId: "integration",
    dir: integrationDir,
    branch: integrationBranch,
  };

  const results: MergeSliceResult[] = [];

  for (const slice of slices) {
    try {
      // Merge commits need a user identity; fall back to no-op env values if not configured.
      gitIn(integrationDir, [
        "-c", "user.email=runner@clair",
        "-c", "user.name=Runner",
        "merge", "--no-ff", slice.branch,
      ]);
      results.push({
        sliceId: slice.sliceId,
        branch: slice.branch,
        merged: true,
        conflictedFiles: [],
      });
    } catch {
      // Merge left conflicts in the index — capture them, then abort.
      const conflictedFiles = conflictedFilesIn(integrationDir);

      try {
        gitIn(integrationDir, ["merge", "--abort"]);
      } catch (abortErr) {
        // Only suppress the benign "no merge in progress" case (MERGE_HEAD missing).
        // Real failures (disk full, lock contention, etc.) are re-thrown.
        const detail =
          (abortErr instanceof Error ? abortErr.message : String(abortErr)) +
          (typeof (abortErr as { stderr?: string }).stderr === "string"
            ? (abortErr as { stderr: string }).stderr
            : "");
        if (
          detail.includes("MERGE_HEAD missing") ||
          detail.includes("no merge in progress")
        ) {
          // Already clean — benign.
        } else {
          console.error("[merge] git merge --abort failed:", abortErr);
          throw abortErr;
        }
      }

      results.push({
        sliceId: slice.sliceId,
        branch: slice.branch,
        merged: false,
        conflictedFiles,
      });
    }
  }

  return {
    integration,
    mergedCleanly: results.every((r) => r.merged),
    results,
  };
}
