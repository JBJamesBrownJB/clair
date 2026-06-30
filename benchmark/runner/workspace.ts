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
 * Run a pnpm script in a worktree. On Windows `pnpm` is a `.cmd` shim that
 * `execFileSync` cannot launch without a shell — mirror the win32 handling used
 * by agent.ts and gate.ts. (`git` is a real .exe and needs no shell.)
 */
function pnpm(dir: string, args: string[]): void {
  execFileSync("pnpm", args, {
    cwd: dir,
    stdio: "inherit",
    ...(process.platform === "win32" ? { shell: true } : {}),
  });
}

/**
 * Full dev setup for a slice worktree, mirroring the arena's getting-started:
 * install deps, GENERATE the Prisma client (install alone does not), and create
 * + seed the SQLite db. Without db:generate the app does not typecheck or run, so
 * an agent would be building blind against a broken toolchain.
 */
function defaultInstall(dir: string): void {
  pnpm(dir, ["install"]);
  pnpm(dir, ["db:generate"]);
  pnpm(dir, ["db:reset"]);
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
 * Remove all worktrees (but NOT their branches), then prune.
 *
 * Evidence-preserving: branches are intentionally kept for post-hoc inspection.
 * Unique runIds (stamped in run.ts before provisioning) ensure branches from
 * different runs never collide.
 *
 * Worktree removal is retried once after a short delay to handle Windows file
 * locks or "directory not empty" errors. If removal still fails after the retry,
 * the worktree is left REGISTERED AND INTACT — we never delete the directory out
 * from under git. Doing so would cause the .git symlink in the dir to resolve to
 * the parent repo, corrupting its worktree state.
 *
 * Idempotent and best-effort: never throws.
 *
 * @param deps.retryDelayMs  How long to wait before the single retry (default: 500ms).
 *                           Inject 0 in tests to avoid actual waits.
 */
export async function teardown(
  workspaces: Workspace[],
  deps?: { retryDelayMs?: number }
): Promise<void> {
  const delayMs = deps?.retryDelayMs ?? 500;

  for (const w of workspaces) {
    let removed = false;

    // First attempt
    try {
      git(["worktree", "remove", "--force", w.dir]);
      removed = true;
    } catch {
      // May be a Windows file lock or "directory not empty" — retry once after delay
    }

    if (!removed) {
      await new Promise<void>((r) => setTimeout(r, delayMs));
      try {
        git(["worktree", "remove", "--force", w.dir]);
        removed = true;
      } catch {
        // Still failed — leave registered and intact to prevent .git corruption
        console.warn(
          `[teardown] WARNING: could not remove worktree at "${w.dir}" after retry — ` +
            `leaving registered and intact to avoid git corruption.`
        );
      }
    }

    // NOTE: git branch -D intentionally omitted.
    // Branches survive teardown for post-hoc inspection.
    // Unique runIds (derived in run.ts) prevent collisions between runs.
  }

  // Prune any worktree registry entries whose directory is already gone.
  // Safe: git worktree prune only removes entries for missing directories.
  try {
    git(["worktree", "prune"]);
  } catch {
    // Prune failure is non-fatal
  }
}
