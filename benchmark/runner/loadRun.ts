import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { RunConfig } from "./types.js";

export function loadRun(path: string): RunConfig {
  const raw = readFileSync(path, "utf-8");
  return parse(raw) as RunConfig;
}
