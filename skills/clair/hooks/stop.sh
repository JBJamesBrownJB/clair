#!/usr/bin/env bash
# clair Stop shim — distil the final reply to one paragraph and share it as a summary.
#
# One-line pass-through to the real binary, which owns ALL logic
# (clair-core::hooks::on_stop). stdin (the Claude Stop hook JSON, incl. transcript_path
# and stop_hook_active) is passed through untouched; anti-recursion is handled in core.
set -euo pipefail
REPO_ROOT="${CLAIR_REPO_ROOT:-$(git rev-parse --show-toplevel)}"
BRANCH="${CLAIR_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
exec clair hook stop --repo-root "$REPO_ROOT" --branch "$BRANCH"
