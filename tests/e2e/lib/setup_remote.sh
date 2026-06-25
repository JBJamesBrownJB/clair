#!/usr/bin/env bash
# Tier-3 git fixtures: a bare remote + per-dev clones, mirroring the harness World.

# setup_remote <workdir>
# Creates <workdir>/remote (bare) seeded with main + feature/login.
setup_remote() {
  local work="$1"
  local remote="$work/remote"
  git init --bare -b main "$remote" >/dev/null
  local seed="$work/seed"
  git init -b main "$seed" >/dev/null
  git -C "$seed" config user.email seed@clair.dev
  git -C "$seed" config user.name seed
  git -C "$seed" config core.autocrlf false
  git -C "$seed" remote add origin "$remote"
  printf 'clair\n' > "$seed/README.md"
  git -C "$seed" add .
  git -C "$seed" commit -m init >/dev/null
  git -C "$seed" push -u origin main >/dev/null 2>&1
  git -C "$seed" checkout -b feature/login >/dev/null 2>&1
  git -C "$seed" push -u origin feature/login >/dev/null 2>&1
}

# setup_clone <workdir> <handle> <branch>
# Clones the remote into <workdir>/<handle>, configures identity, checks out
# <branch>. Echoes the clone dir.
setup_clone() {
  local work="$1" handle="$2" branch="$3"
  local dir="$work/$handle"
  git init -b main "$dir" >/dev/null
  git -C "$dir" config user.email "$handle@clair.dev"
  git -C "$dir" config user.name "$handle"
  git -C "$dir" config clair.user "$handle"
  git -C "$dir" config core.autocrlf false
  git -C "$dir" remote add origin "$work/remote"
  git -C "$dir" fetch origin >/dev/null 2>&1
  git -C "$dir" checkout -b "$branch" --track "origin/$branch" >/dev/null 2>&1
  echo "$dir"
}
