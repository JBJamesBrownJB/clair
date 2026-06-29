#!/usr/bin/env bash
# Held-out acceptance gate. Run by the harness AFTER integrating the slice
# branches — never seen by the slice agents. Exits non-zero on any failure.
set -euo pipefail

echo "== [floor] typecheck (tsc --noEmit) =="
pnpm typecheck

echo "== [floor] client build =="
pnpm build:client

echo "== [regression] visible suite =="
pnpm test

echo "== [acceptance] held-out behavioural gate =="
pnpm test:gate

echo "== [slice 4] dependency audit — seeded advisories must be gone =="
# Non-fatal report; the deterministic version assertions live in gate/upgrades.test.ts.
pnpm audit --audit-level=high || true

echo "GATE COMPLETE"
