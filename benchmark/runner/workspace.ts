import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RunConfig } from "./types.js";

export interface Workspace {
  sliceId: string;
  dir: string;
  branch: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the repo root (two levels up from benchmark/runner/). */
const REPO_ROOT = path.resolve(__dirname, "../..");

/** Default scratch directory for worktrees — git-ignored via benchmark/runner/.gitignore. */
const DEFAULT_WORK_DIR = path.join(__dirname, ".work");

function git(args: string[]): void {
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" });
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  }).trim();
}

/**
 * Provision one git worktree per slice, each on a fresh branch
 * `run/<runId>/<sliceId>` created from `arena/base`.
 */
export async function provision(
  run: RunConfig,
  opts?: { rootDir?: string; install?: boolean }
): Promise<Workspace[]> {
  const rootDir = opts?.rootDir ?? DEFAULT_WORK_DIR;
  const install = opts?.install ?? true;

  const workspaces: Workspace[] = [];

  for (const slice of run.slices) {
    const branch = `run/${run.id}/${slice.id}`;
    const dir = path.join(rootDir, `${run.id}-${slice.id}`);

    git(["worktree", "add", "-b", branch, dir, "arena/base"]);

    if (install) {
      execSync("pnpm install", { cwd: dir, stdio: "inherit" });
    }

    workspaces.push({ sliceId: slice.id, dir, branch });
  }

  return workspaces;
}

/**
 * Remove all worktrees and delete their branches, then prune.
 * Idempotent: removing an already-gone worktree/branch does not throw.
 */
export async function teardown(workspaces: Workspace[]): Promise<void> {
  for (const w of workspaces) {
    try {
      git(["worktree", "remove", "--force", w.dir]);
    } catch {
      // Worktree already removed — idempotent
    }
    try {
      git(["branch", "-D", w.branch]);
    } catch {
      // Branch already deleted — idempotent
    }
  }
  try {
    git(["worktree", "prune"]);
  } catch {
    // Prune failure is non-fatal
  }
}
