#!/usr/bin/env bash
# clair launcher — exec the bundled, platform-matched clair binary with all args.
#
# The clair plugin is self-contained: it carries the clair binary under
# bin/<platform>-<arch>/ (node-style keys: win32|darwin|linux × x64|arm64). This
# launcher detects the host, picks the matching binary, and execs it passing
# through every argument and stdin/stdout untouched. Hooks and slash commands call
# this — never a bare `clair` on PATH — so users install ONE thing (the plugin).
#
# Resolve our own directory so we work regardless of cwd. ${CLAUDE_PLUGIN_ROOT} is
# set by Claude Code, but we also fall back to the script's own location.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/bin}"
BIN_DIR="${BIN_DIR:-$SELF_DIR}"

# --- detect platform (node os.platform style) ---
uname_s="$(uname -s 2>/dev/null || echo unknown)"
case "$uname_s" in
  Linux*)                         platform="linux" ;;
  Darwin*)                        platform="darwin" ;;
  MINGW*|MSYS*|CYGWIN*|Windows*)  platform="win32" ;;
  *)                              platform="unknown" ;;
esac

# --- detect arch (node os.arch style) ---
uname_m="$(uname -m 2>/dev/null || echo unknown)"
case "$uname_m" in
  x86_64|amd64)   arch="x64" ;;
  arm64|aarch64)  arch="arm64" ;;
  *)              arch="unknown" ;;
esac

key="${platform}-${arch}"
exe="clair"
if [ "$platform" = "win32" ]; then
  exe="clair.exe"
fi

candidate="$BIN_DIR/$key/$exe"
if [ ! -x "$candidate" ] && [ -f "$candidate" ]; then
  # Bundled but not marked executable (e.g. freshly checked out on a unix box).
  chmod +x "$candidate" 2>/dev/null || true
fi

if [ ! -f "$candidate" ]; then
  echo "clair: no prebuilt binary for ${key} yet; build from source (cargo build --release -p clair) or see the project README." >&2
  exit 127
fi

exec "$candidate" "$@"
