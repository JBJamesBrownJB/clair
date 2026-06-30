import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RunConfig } from "./types.js";

export interface Workspace {
  sliceId: string;
  dir: string;
  branch: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// NOTE: __dirname resolution assumes running from source via tsx; adjust paths if compiled to dist/.
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
 * Run `pnpm install` in a worktree. On Windows `pnpm` is a `.cmd` shim that
 * `execFileSync` cannot launch without a shell — mirror the win32 handling used
 * by agent.ts and gate.ts. (`git` is a real .exe and needs no shell.)
 */
function defaultInstall(dir: string): void {
  execFileSync("pnpm", ["install"], {
    cwd: dir,
    stdio: "inherit",
    ...(process.platform === "win32" ? { shell: true } : {}),
  });
}

/**
 * Provision one git worktree per slice, each on a fresh branch
 * `run/<runId>/<sliceId>` created from `arena/base`.
 *
 * All-or-nothing: if any step throws partway, the worktrees/branches created so
 * far are torn down before the error propagates, so a partial failure never
 * leaves dangling git state for the caller to clean up.
 */
export async function provision(
  run: RunConfig,
  opts?: { rootDir?: string; install?: boolean },
  deps?: { install?: (dir: string) => void }
): Promise<Workspace[]> {
  const rootDir = opts?.rootDir ?? DEFAULT_WORK_DIR;
  const install = opts?.install ?? true;
  const installFn = deps?.install ?? defaultInstall;

  const workspaces: Workspace[] = [];

  try {
    for (const slice of run.slices) {
      const branch = `run/${run.id}/${slice.id}`;
      const dir = path.join(rootDir, `${run.id}-${slice.id}`);

      git(["worktree", "add", "-b", branch, dir, "arena/base"]);
      // Register before install so a failing install still gets cleaned up.
      workspaces.push({ sliceId: slice.id, dir, branch });

      if (install) {
        installFn(dir);
      }
    }
  } catch (err) {
    // Partial provision: remove whatever we created, best-effort, then rethrow.
    try {
      await teardown(workspaces);
    } catch {
      // Cleanup is best-effort; surface the original error.
    }
    throw err;
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
