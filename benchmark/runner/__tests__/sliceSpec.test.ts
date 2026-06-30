import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRun } from "../loadRun.js";
import { buildSliceSpecs } from "../sliceSpec.js";
import type { RunConfig } from "../types.js"; // used in cast below

// Resolve paths relative to the repo root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const runConfigPath = path.join(repoRoot, "benchmark/runs/standard-L1.run.yaml");
const backlogPath = path.join(repoRoot, "benchmark/backlog/backlog.md");

describe("loadRun", () => {
  it("parses the run config and returns 3 slices", () => {
    const run = loadRun(runConfigPath);
    expect(run.slices).toHaveLength(3);
  });

  it("parses slice ids correctly", () => {
    const run = loadRun(runConfigPath);
    const ids = run.slices.map(s => s.id);
    expect(ids).toEqual(["S1", "S2", "S3"]);
  });

  it("parses S1 backlog ids", () => {
    const run = loadRun(runConfigPath);
    expect(run.slices[0].backlog).toEqual(["F-08", "F-10", "F-09"]);
  });

  it("parses level and model fields", () => {
    const run = loadRun(runConfigPath);
    expect(run.level).toBe("L1");
    expect(run.model).toBe("claude-opus-4-8");
  });
});

describe("buildSliceSpecs", () => {
  it("returns exactly 3 specs", () => {
    const run = loadRun(runConfigPath);
    const specs = buildSliceSpecs(run, backlogPath);
    expect(specs).toHaveLength(3);
  });

  it("assigns correct ids and titles", () => {
    const run = loadRun(runConfigPath);
    const specs = buildSliceSpecs(run, backlogPath);
    expect(specs[0].id).toBe("S1");
    expect(specs[1].id).toBe("S2");
    expect(specs[2].id).toBe("S3");
    expect(specs[0].title).toBe("Authz hardening + role-management");
    expect(specs[2].title).toBe("Export (CSV + JSON)");
  });

  describe("information asymmetry", () => {
    it("S1 prompt contains F-08 acceptance criteria text", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      const s1 = specs.find(s => s.id === "S1")!;
      // F-08 AC: viewer-role JWT calling POST/PATCH/DELETE /api/items receives 403
      expect(s1.prompt).toContain("viewer-role JWT");
    });

    it("S1 prompt contains F-08 touch-set hint files", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      const s1 = specs.find(s => s.id === "S1")!;
      // F-08 touch-set includes src/server/routes/items.ts
      expect(s1.prompt).toContain("src/server/routes/items.ts");
    });

    it("S1 prompt does NOT contain F-06 text (S2 content)", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      const s1 = specs.find(s => s.id === "S1")!;
      // F-06 AC mentions microscope (3 items, case-insensitive name match)
      expect(s1.prompt).not.toContain("microscope");
    });

    it("S1 prompt does NOT contain F-17 text (S3 content)", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      const s1 = specs.find(s => s.id === "S1")!;
      // F-17 AC mentions CSV / text/csv
      expect(s1.prompt).not.toContain("text/csv");
    });

    it("S2 prompt contains F-06 text", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      const s2 = specs.find(s => s.id === "S2")!;
      expect(s2.prompt).toContain("microscope");
    });

    it("S3 prompt contains F-17 text", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      const s3 = specs.find(s => s.id === "S3")!;
      expect(s3.prompt).toContain("text/csv");
    });

    it("S2 prompt does NOT contain F-08 text (S1 content)", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      const s2 = specs.find(s => s.id === "S2")!;
      // F-08 rationale mentions requireRole
      expect(s2.prompt).not.toContain("requireRole");
    });

    it("S3 prompt does NOT contain F-06 text (S2 content)", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      const s3 = specs.find(s => s.id === "S3")!;
      expect(s3.prompt).not.toContain("microscope");
    });
  });

  describe("acceptance-criteria parse errors", () => {
    it("throws when a backlog item has no parseable acceptance criteria", () => {
      // Write a minimal backlog with F-99 present but AC block absent/malformed
      const malformedBacklog = [
        "### `F-99` — Malformed item",
        "",
        "- **Rationale:** Some rationale",
        "",
        "- **Touch-set:** `src/foo.ts`",
        "",
        "- **Acceptance criteria (behavioral — gate material):**",
        // no bullet lines follow — block is empty
        "",
      ].join("\n");

      const tmpBacklog = path.join(os.tmpdir(), `backlog-malformed-${Date.now()}.md`);
      fs.writeFileSync(tmpBacklog, malformedBacklog, "utf-8");

      // buildSliceSpecs only reads run.slices; cast minimal object to satisfy TS
      const fakeRun = {
        slices: [{ id: "S1", title: "Fake slice", backlog: ["F-99"] }],
      } as unknown as RunConfig;

      try {
        expect(() => buildSliceSpecs(fakeRun, tmpBacklog)).toThrow("F-99");
      } finally {
        fs.unlinkSync(tmpBacklog);
      }
    });
  });

  describe("prompt structure", () => {
    it("each prompt includes the slice title", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      for (const spec of specs) {
        expect(spec.prompt).toContain(spec.title);
      }
    });

    it("each prompt includes the instruction to work only in its worktree", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      for (const spec of specs) {
        expect(spec.prompt).toContain("worktree");
      }
    });

    it("each prompt includes the instruction to never block or wait", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      for (const spec of specs) {
        expect(spec.prompt).toContain("Never block");
      }
    });

    it("each prompt includes the instruction to write tests and commit", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      for (const spec of specs) {
        expect(spec.prompt).toContain("tests");
        expect(spec.prompt).toContain("commit");
      }
    });

    it("S1 prompt names touch-set as hints, not commands", () => {
      const run = loadRun(runConfigPath);
      const specs = buildSliceSpecs(run, backlogPath);
      const s1 = specs.find(s => s.id === "S1")!;
      // Touch-set is labelled 'Hint files' not e.g. 'Edit these files'
      expect(s1.prompt).toContain("Hint files");
    });
  });
});
