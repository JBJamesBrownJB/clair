#!/usr/bin/env bash
# clair UserPromptSubmit shim — inbound (inject pair context) + outbound (share my prompt).
#
# This is a one-line pass-through to the real binary, which owns ALL logic
# (clair-core::hooks::on_user_prompt_submit). stdin (the Claude hook JSON) is passed
# through untouched. --repo-root and --branch are normally baked at `clair with` time;
# this static shim resolves them from the environment / current repo for manual setups.
#
# CLAIR_REPO_ROOT and CLAIR_BRANCH may be exported by the session; otherwise we fall
# back to the current git repo and its checked-out branch.
set -euo pipefail
REPO_ROOT="${CLAIR_REPO_ROOT:-$(git rev-parse --show-toplevel)}"
BRANCH="${CLAIR_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
exec clair hook prompt --repo-root "$REPO_ROOT" --branch "$BRANCH"
