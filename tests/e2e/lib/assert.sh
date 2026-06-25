#!/usr/bin/env bash
# Tier-3 assertion helpers. ALL stream-json parsing routes through
# `clair test-observe` (serde_json) — never jq (absent on the reference box).

# assert_observe <clair-bin> <stream-file> <mode> <arg> <message>
# Feeds the stream NDJSON to `clair test-observe <mode> <arg>` on stdin and fails
# (exit 1) with <message> if the asserter exits non-zero.
assert_observe() {
  local bin="$1" stream="$2" mode="$3" arg="$4" msg="$5"
  if ! "$bin" test-observe "$mode" "$arg" < "$stream"; then
    echo "clair Tier-3 e2e: ASSERTION FAILED — $msg" >&2
    echo "  (mode=$mode arg=$arg stream=$stream)" >&2
    return 1
  fi
}
