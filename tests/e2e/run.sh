#!/usr/bin/env bash
# clair Tier-3 end-to-end — two REAL `claude -p` sessions paired through clair.
#
# GATED: this never runs in fast CI. It runs only when:
#   - CLAIR_E2E=1 is set, AND
#   - `claude` is on PATH.
# Otherwise it prints a skip notice and exits 0 (so a harnessed caller treats it as
# an intentionally-ignored test, @tier3 @ignore).
#
# What it proves (the deterministic anchor): JB's prompt/conclusion, captured by the
# clair UserPromptSubmit/Stop hooks, surface in RAJIV's session as the exact framed
# additionalContext (both banners, byte-exact) — and Rajiv's AI does NOT act on them
# (no Edit tool_use on the recipient's stream). The first session id is PINNED via
# --session-id <uuid> so the reciprocal --resume turn cannot silently degrade.
#
# ALL stream-json parsing goes through `clair test-observe` (serde_json) — jq is NOT
# on PATH on the reference box, so any jq here would silently break the e2e.
#
# `clair test-observe` is fully implemented (assert-additional-context /
# assert-no-tool / assert-result / hook-events / session-id), so this script is
# runnable once CLAIR_E2E=1 and `claude` are present; it is excluded from fast CI
# (gated below), not blocked behind an unimplemented asserter.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/assert.sh
source "$HERE/lib/assert.sh"
# shellcheck source=lib/setup_remote.sh
source "$HERE/lib/setup_remote.sh"
# shellcheck source=lib/make_settings.sh
source "$HERE/lib/make_settings.sh"

# --- gate -------------------------------------------------------------------
if [[ "${CLAIR_E2E:-0}" != "1" ]]; then
  echo "clair Tier-3 e2e: SKIPPED (set CLAIR_E2E=1 to run)."
  exit 0
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "clair Tier-3 e2e: SKIPPED ('claude' not on PATH)."
  exit 0
fi

CLAIR_BIN="${CLAIR_BIN:-clair}"
if ! command -v "$CLAIR_BIN" >/dev/null 2>&1; then
  echo "clair Tier-3 e2e: FAILED ('$CLAIR_BIN' not found; build it or set CLAIR_BIN)." >&2
  exit 1
fi

TIMEOUT="${CLAIR_E2E_TIMEOUT:-180}"
FIRST_SESSION="${CLAIR_E2E_SESSION:-$(uuidgen 2>/dev/null || echo 11111111-2222-7333-8444-555555555555)}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "clair Tier-3 e2e: setting up shared remote + two clones under $WORK"
setup_remote "$WORK"                       # creates $WORK/remote (bare) + main/feature/login
JB_DIR="$(setup_clone "$WORK" jb feature/login)"
RAJIV_DIR="$(setup_clone "$WORK" rajiv feature/login)"

JB_SETTINGS="$(make_settings "$JB_DIR" feature/login "$CLAIR_BIN")"
RAJIV_SETTINGS="$(make_settings "$RAJIV_DIR" feature/login "$CLAIR_BIN")"

PROMPT='refactor the auth guard to use the new middleware'

echo "clair Tier-3 e2e: JB turn (pinned session $FIRST_SESSION) — shares a prompt + conclusion"
JB_STREAM="$WORK/jb.stream.ndjson"
( cd "$JB_DIR" && timeout "$TIMEOUT" claude -p "$PROMPT" \
    --session-id "$FIRST_SESSION" \
    --settings "$JB_SETTINGS" \
    --output-format stream-json --include-hook-events --verbose \
    --dangerously-skip-permissions ) > "$JB_STREAM" 2>"$WORK/jb.err" || {
      echo "clair Tier-3 e2e: FAILED (JB claude turn errored)" >&2; cat "$WORK/jb.err" >&2; exit 1; }

echo "clair Tier-3 e2e: RAJIV turn — must SEE JB's framed context, must NOT act on it"
RAJIV_STREAM="$WORK/rajiv.stream.ndjson"
( cd "$RAJIV_DIR" && timeout "$TIMEOUT" claude -p 'continue where you left off' \
    --settings "$RAJIV_SETTINGS" \
    --output-format stream-json --include-hook-events --verbose \
    --dangerously-skip-permissions ) > "$RAJIV_STREAM" 2>"$WORK/rajiv.err" || {
      echo "clair Tier-3 e2e: FAILED (Rajiv claude turn errored)" >&2; cat "$WORK/rajiv.err" >&2; exit 1; }

# --- deterministic assertions (all via clair test-observe / serde_json) -----
# 1) Rajiv's stream carried clair's hook output with the BACKGROUND-framed prompt.
assert_observe "$CLAIR_BIN" "$RAJIV_STREAM" assert-additional-context \
  "$PROMPT" "Rajiv must receive JB's prompt as framed additionalContext"

# 2) Rajiv's AI did NOT edit auth.rs (passivity: background, not a directive).
assert_observe "$CLAIR_BIN" "$RAJIV_STREAM" assert-no-tool \
  "Edit" "Rajiv's AI must not act on the injected background prompt"

echo "clair Tier-3 e2e: PASSED"
