#!/usr/bin/env bash
# Tier-3: produce the --settings merge file that wires clair's hooks for a clone.
#
# Delegates to the real `clair with`-style path resolution by invoking the binary's
# own session-settings writer indirectly: we run `clair hook` shims baked with the
# clone's repo root + branch. Rather than reimplement the JSON, we shell out to
# `clair with` is NOT available here (no peer registry), so we generate the same
# shape the binary's cmd/with.rs writes, under <clone>/.git/clair/.

# make_settings <clone-dir> <branch> <clair-bin>
# Writes prompt/stop shims + session-settings.json under <clone>/.git/clair and
# echoes the settings path.
make_settings() {
  local dir="$1" branch="$2" bin="$3"
  local gitdir
  gitdir="$(git -C "$dir" rev-parse --git-dir)"
  # rev-parse --git-dir may be relative to the repo root.
  case "$gitdir" in
    /*) : ;;
    *) gitdir="$dir/$gitdir" ;;
  esac
  local cdir="$gitdir/clair"
  mkdir -p "$cdir"

  local abs_root
  abs_root="$(git -C "$dir" rev-parse --show-toplevel)"

  local prompt_sh="$cdir/prompt-hook.sh"
  local stop_sh="$cdir/stop-hook.sh"
  cat > "$prompt_sh" <<EOF
#!/usr/bin/env bash
exec "$bin" hook prompt --repo-root "$abs_root" --branch "$branch"
EOF
  cat > "$stop_sh" <<EOF
#!/usr/bin/env bash
exec "$bin" hook stop --repo-root "$abs_root" --branch "$branch"
EOF
  chmod +x "$prompt_sh" "$stop_sh"

  local settings="$cdir/session-settings.json"
  cat > "$settings" <<EOF
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "bash \"$prompt_sh\"" }] }],
    "Stop":            [{ "hooks": [{ "type": "command", "command": "bash \"$stop_sh\"" }] }]
  }
}
EOF
  echo "$settings"
}
