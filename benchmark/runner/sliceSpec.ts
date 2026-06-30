import { readFileSync } from "node:fs";
import type { RunConfig, SliceSpec } from "./types.js";

interface BacklogItem {
  id: string;
  title: string;
  rationale: string;
  touchSet: string[];
  acceptanceCriteria: string[];
}

/**
 * Parse the backlog markdown and return a map from backlog ID -> BacklogItem.
 * Each item starts with ### `F-XX` — Title and contains structured fields.
 */
function parseBacklog(backlogPath: string): Map<string, BacklogItem> {
  const raw = readFileSync(backlogPath, "utf-8");
  const items = new Map<string, BacklogItem>();

  // Split on section headers: ### `ID` — Title
  // Each section starts at ### `
  const sectionPattern = /^### `([A-Z]+-\d+)` — (.+)$/m;
  // Split the file into chunks at each ### `...` header
  const parts = raw.split(/^(?=### `[A-Z]+-\d+`)/m);

  for (const part of parts) {
    const headerMatch = part.match(/^### `([A-Z]+-\d+)` — (.+)$/m);
    if (!headerMatch) continue;

    const id = headerMatch[1];
    const title = headerMatch[2].trim();

    // Extract Rationale
    const rationaleMatch = part.match(/\*\*Rationale:\*\*\s+(.+?)(?=\n-\s+\*\*|\n###|\n---|\n\n##|$)/s);
    const rationale = rationaleMatch ? rationaleMatch[1].trim() : "";

    // Extract Touch-set
    const touchSetMatch = part.match(/\*\*Touch-set:\*\*\s+(.+?)(?=\n-\s+\*\*|\n###|\n---|\n\n##|$)/s);
    const touchSetRaw = touchSetMatch ? touchSetMatch[1].trim() : "";
    // Parse backtick-quoted paths: `path/a`, `path/b`
    const touchSet = Array.from(touchSetRaw.matchAll(/`([^`]+)`/g)).map(m => m[1]);

    // Extract Acceptance criteria bullets
    const acMatch = part.match(/\*\*Acceptance criteria \(behavioral — gate material\):\*\*\n((?:\s+-\s+.+\n?)+)/);
    const acceptanceCriteria: string[] = [];
    if (acMatch) {
      const acBlock = acMatch[1];
      for (const line of acBlock.split("\n")) {
        const bullet = line.match(/^\s+-\s+(.+)$/);
        if (bullet) {
          acceptanceCriteria.push(bullet[1].trim());
        }
      }
    }

    items.set(id, { id, title, rationale, touchSet, acceptanceCriteria });
  }

  return items;
}

function buildPrompt(
  sliceId: string,
  sliceTitle: string,
  backlogIds: string[],
  backlog: Map<string, BacklogItem>
): string {
  const lines: string[] = [];

  lines.push(`# Slice ${sliceId}: ${sliceTitle}`);
  lines.push("");
  lines.push(
    "You are implementing this slice in isolation in your own git worktree. " +
    "Build all described behavior, write tests, and commit when done. " +
    "Never block or wait for input — decide and continue."
  );
  lines.push("");
  lines.push("## Backlog items");

  for (const bid of backlogIds) {
    const item = backlog.get(bid);
    if (!item) {
      throw new Error(`Backlog item ${bid} not found in backlog file`);
    }
    lines.push("");
    lines.push(`### ${item.id} — ${item.title}`);
    lines.push("");
    lines.push(`**Rationale:** ${item.rationale}`);
    lines.push("");
    lines.push("**Acceptance criteria:**");
    for (const ac of item.acceptanceCriteria) {
      lines.push(`- ${ac}`);
    }
    lines.push("");
    if (item.touchSet.length > 0) {
      lines.push(`**Hint files (touch-set):** ${item.touchSet.map(p => `\`${p}\``).join(", ")}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("Work only within your assigned slice. Do not modify files outside your slice's scope.");

  return lines.join("\n");
}

export function buildSliceSpecs(run: RunConfig, backlogPath: string): SliceSpec[] {
  const backlog = parseBacklog(backlogPath);

  return run.slices.map(slice => ({
    id: slice.id,
    title: slice.title,
    prompt: buildPrompt(slice.id, slice.title, slice.backlog, backlog),
  }));
}
