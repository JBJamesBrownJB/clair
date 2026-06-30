/**
 * shell.ts — shared subprocess helper
 *
 * Exports RunCmdFn (injectable type) and defaultRunCmd (real implementation).
 * Both gate.ts and ci.ts import from here instead of each defining their own copy.
 *
 * Win32: shell:true so pnpm/git .cmd shims resolve correctly.
 * Stderr: drained via a no-op data handler so a chatty subprocess (e.g. pnpm install)
 * cannot fill the pipe buffer and hang.
 */
import { spawn } from "node:child_process";

/**
 * Injectable shell-command abstraction.
 * argv[0] is the executable; rest are arguments.
 * Returns captured stdout and the process exit code.
 */
export type RunCmdFn = (cmd: {
  argv: string[];
  cwd: string;
}) => Promise<{ stdout: string; exit: number }>;

/**
 * Default implementation: spawns argv[0] with the rest as args in cwd.
 *
 * - win32: passes shell:true so pnpm/git .cmd wrappers are resolved by cmd.exe.
 * - stderr: attaches a no-op data handler to drain the pipe and prevent deadlocks.
 */
export const defaultRunCmd: RunCmdFn = ({ argv, cwd }) => {
  const [file, ...args] = argv;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // On Windows, pnpm/git are .cmd shims; shell:true lets cmd.exe resolve them.
      ...(process.platform === "win32" ? { shell: true } : {}),
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    // Drain stderr: without a consumer, a verbose subprocess fills the OS pipe
    // buffer and blocks — neither close nor error fires, hanging indefinitely.
    child.stderr.on("data", () => {});

    child.on("close", (code: number | null) => {
      resolve({ stdout, exit: code ?? 1 });
    });
    child.on("error", () => {
      resolve({ stdout, exit: 1 });
    });
  });
};
