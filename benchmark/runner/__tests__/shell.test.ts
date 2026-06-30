import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// vi.mock is hoisted — must appear before imports of the module under test
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { defaultRunCmd } from "../shell.js";
import type { RunCmdFn } from "../shell.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSpawn = vi.mocked(spawn);

/** Build a fake ChildProcess with EventEmitter stdout/stderr. */
function makeFakeChild() {
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  (child as any).stdout = new EventEmitter();
  (child as any).stderr = new EventEmitter();
  return child;
}

beforeEach(() => {
  mockSpawn.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("defaultRunCmd", () => {
  it("resolves { stdout, exit } collected from the child process", async () => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = defaultRunCmd({ argv: ["git", "status"], cwd: "/repo" });

    // Emit stdout data then close
    (child as any).stdout.emit("data", Buffer.from("On branch main\n"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("On branch main\n");
    expect(result.exit).toBe(0);
  });

  it("concatenates multiple stdout chunks", async () => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = defaultRunCmd({ argv: ["git", "log"], cwd: "/repo" });

    (child as any).stdout.emit("data", Buffer.from("commit abc\n"));
    (child as any).stdout.emit("data", Buffer.from("commit def\n"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("commit abc\ncommit def\n");
  });

  it("resolves exit:1 when child closes with null code", async () => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = defaultRunCmd({ argv: ["pnpm", "install"], cwd: "/app" });
    child.emit("close", null);

    const result = await promise;
    expect(result.exit).toBe(1);
  });

  it("resolves exit:1 on child error event (spawn failure)", async () => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = defaultRunCmd({ argv: ["pnpm", "build"], cwd: "/app" });
    child.emit("error", new Error("ENOENT"));

    const result = await promise;
    expect(result.exit).toBe(1);
  });

  it("drains stderr: a data listener is attached so chatty stderr cannot deadlock", async () => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    // Start the command — don't await yet, we want to inspect before close
    const promise = defaultRunCmd({ argv: ["pnpm", "install"], cwd: "/app" });

    // After calling defaultRunCmd, stderr must already have a listener
    expect((child as any).stderr.listenerCount("data")).toBeGreaterThan(0);

    child.emit("close", 0);
    await promise;
  });

  it("passes shell:true in spawn options when process.platform is win32", async () => {
    const desc = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    try {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child);

      const promise = defaultRunCmd({ argv: ["pnpm", "build"], cwd: "/app" });

      expect(mockSpawn).toHaveBeenCalledWith(
        "pnpm",
        ["build"],
        expect.objectContaining({ shell: true })
      );

      child.emit("close", 0);
      await promise;
    } finally {
      Object.defineProperty(process, "platform", desc);
    }
  });

  it("does NOT pass shell:true in spawn options when process.platform is linux", async () => {
    const desc = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    try {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child);

      const promise = defaultRunCmd({ argv: ["git", "status"], cwd: "/repo" });

      const callArgs = mockSpawn.mock.calls[0];
      const spawnOptions = callArgs[2] as Record<string, unknown>;
      expect(spawnOptions.shell).not.toBe(true);

      child.emit("close", 0);
      await promise;
    } finally {
      Object.defineProperty(process, "platform", desc);
    }
  });

  it("type-check: RunCmdFn is exported and defaultRunCmd satisfies it", () => {
    // Static type assertion — if this compiles, the export is correct
    const _: RunCmdFn = defaultRunCmd;
    expect(typeof defaultRunCmd).toBe("function");
  });
});
