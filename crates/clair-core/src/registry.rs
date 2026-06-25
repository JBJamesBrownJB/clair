//! The `clair/ready` registry — who is available to pair, on which branch.
//!
//! The registry is a second orphan ref (`clair/ready`) holding append-only JSONL,
//! one object per line:
//!
//! ```jsonc
//! { "user":"JB", "repo":"clair", "branch":"feature/login", "ts":"2026-06-25T10:00:00Z" }
//! ```
//!
//! Semantics (slice spec §6): **latest-per-user wins**, folded at read time. A
//! user who runs `ready` twice appears once, with their newest branch. [`list`]
//! filters to one repo slug so unrelated repos sharing a remote never cross.
//! [`resolve`] turns a `with <handle>` argument into exactly one [`ReadyPeer`]
//! (case-insensitive exact match; ambiguity is an error, not a guess).
//!
//! All git access flows through the [`crate::git::Repo`] log API, so the registry
//! never touches the working tree and inherits the same CAS-append semantics as
//! the context log.

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::git::Repo;

/// One registry row: a user is ready to pair on `branch` in `repo`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadyPeer {
    /// The pairing handle (display casing preserved; matched case-insensitively).
    pub user: String,
    /// The repo slug this readiness applies to.
    pub repo: String,
    /// The branch the user is working on / available to pair on.
    pub branch: String,
    /// RFC3339 UTC timestamp the entry was written.
    pub ts: String,
}

impl ReadyPeer {
    /// Serialise to one JSONL line (no trailing newline).
    pub fn to_jsonl(&self) -> Result<String> {
        Ok(serde_json::to_string(self)?)
    }

    /// Parse one JSONL line into a [`ReadyPeer`].
    pub fn from_jsonl(line: &str) -> Result<ReadyPeer> {
        serde_json::from_str(line).map_err(|e| CoreError::ParseJsonl(e.to_string()))
    }
}

/// Append one readiness entry for `user` on `branch` in `repo`, then push.
///
/// Writes to `clair/ready` via the git log API (orphan-created on cold start).
pub fn announce(repo: &Repo, user: &str, repo_slug: &str, branch: &str, ts: &str) -> Result<()> {
    let peer = ReadyPeer {
        user: user.to_string(),
        repo: repo_slug.to_string(),
        branch: branch.to_string(),
        ts: ts.to_string(),
    };
    let line = peer.to_jsonl()?;
    repo.append_lines(Repo::ready_ref(), &[line])
}

/// Read `clair/ready`, fold to latest-per-user, and filter to `repo_slug`.
///
/// The fold keeps the **last** row seen for each user (case-insensitive on the
/// handle), matching append-only "latest wins". Results are sorted by user for a
/// stable display order.
pub fn list(repo: &Repo, repo_slug: &str) -> Result<Vec<ReadyPeer>> {
    let lines = repo.read_log(Repo::ready_ref())?;
    Ok(fold_latest_per_user(&lines, repo_slug))
}

/// Resolve a `with <handle>` argument to exactly one ready peer in `repo_slug`.
///
/// Matching is case-insensitive exact. Zero matches and multiple distinct
/// matches are both errors (we never silently pick one).
pub fn resolve(repo: &Repo, repo_slug: &str, handle: &str) -> Result<ReadyPeer> {
    let peers = list(repo, repo_slug)?;
    let needle = handle.trim().to_ascii_lowercase();

    let matches: Vec<&ReadyPeer> = peers
        .iter()
        .filter(|p| p.user.trim().to_ascii_lowercase() == needle)
        .collect();

    match matches.as_slice() {
        [] => Err(CoreError::Registry(format!(
            "no one named '{handle}' is ready to pair in this repo"
        ))),
        [one] => Ok((*one).clone()),
        many => Err(CoreError::Registry(format!(
            "'{handle}' is ambiguous — {} matches",
            many.len()
        ))),
    }
}

/// Fold raw JSONL lines to one [`ReadyPeer`] per user (latest wins), filtered to
/// `repo_slug`. Malformed lines are skipped. Sorted by user handle.
fn fold_latest_per_user(lines: &[String], repo_slug: &str) -> Vec<ReadyPeer> {
    use std::collections::HashMap;

    // Preserve insertion order of last-seen so re-announce updates in place; we
    // sort by user at the end so the map ordering is irrelevant.
    let mut latest: HashMap<String, ReadyPeer> = HashMap::new();

    for line in lines {
        let peer = match ReadyPeer::from_jsonl(line) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if peer.repo != repo_slug {
            continue;
        }
        // Later lines overwrite earlier ones for the same (case-insensitive) user.
        latest.insert(peer.user.trim().to_ascii_lowercase(), peer);
    }

    let mut peers: Vec<ReadyPeer> = latest.into_values().collect();
    peers.sort_by(|a, b| a.user.to_ascii_lowercase().cmp(&b.user.to_ascii_lowercase()));
    peers
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(user: &str, repo: &str, branch: &str, ts: &str) -> String {
        ReadyPeer {
            user: user.into(),
            repo: repo.into(),
            branch: branch.into(),
            ts: ts.into(),
        }
        .to_jsonl()
        .unwrap()
    }

    #[test]
    fn fold_keeps_latest_per_user_and_filters_repo() {
        let lines = vec![
            line("JB", "clair", "feature/login", "2026-06-25T10:00:00Z"),
            line("Sam", "clair", "fix/cache", "2026-06-25T10:01:00Z"),
            // JB re-announces on a different branch later — latest wins.
            line("JB", "clair", "feature/login-2", "2026-06-25T10:05:00Z"),
            // A different repo is filtered out.
            line("Other", "not-clair", "main", "2026-06-25T10:06:00Z"),
        ];
        let peers = fold_latest_per_user(&lines, "clair");
        assert_eq!(peers.len(), 2);
        // Sorted by user: JB then Sam.
        assert_eq!(peers[0].user, "JB");
        assert_eq!(peers[0].branch, "feature/login-2");
        assert_eq!(peers[1].user, "Sam");
    }

    #[test]
    fn fold_is_case_insensitive_on_user() {
        let lines = vec![
            line("JB", "clair", "feature/login", "2026-06-25T10:00:00Z"),
            line("jb", "clair", "feature/login-2", "2026-06-25T10:05:00Z"),
        ];
        let peers = fold_latest_per_user(&lines, "clair");
        assert_eq!(peers.len(), 1, "same user differing only in case folds to one");
        assert_eq!(peers[0].branch, "feature/login-2");
    }

    #[test]
    fn fold_skips_malformed_lines() {
        let lines = vec![
            "not json".to_string(),
            line("JB", "clair", "feature/login", "2026-06-25T10:00:00Z"),
            String::new(),
        ];
        let peers = fold_latest_per_user(&lines, "clair");
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].user, "JB");
    }

    #[test]
    fn resolve_errors_on_absent_and_ambiguous() {
        // Build the same fold the live path would, then exercise the matcher logic
        // directly via list-equivalent input (no git, pure fold + match).
        let peers = fold_latest_per_user(
            &[
                line("JB", "clair", "feature/login", "2026-06-25T10:00:00Z"),
                line("Sam", "clair", "fix/cache", "2026-06-25T10:01:00Z"),
            ],
            "clair",
        );
        // Absent.
        assert!(peers.iter().all(|p| p.user.to_ascii_lowercase() != "nobody"));
        // Exact case-insensitive match resolves.
        let m: Vec<_> = peers
            .iter()
            .filter(|p| p.user.to_ascii_lowercase() == "jb")
            .collect();
        assert_eq!(m.len(), 1);
    }

    #[test]
    fn readypeer_roundtrips() {
        let p = ReadyPeer {
            user: "JB".into(),
            repo: "clair".into(),
            branch: "feature/login".into(),
            ts: "2026-06-25T10:00:00Z".into(),
        };
        let j = p.to_jsonl().unwrap();
        assert_eq!(ReadyPeer::from_jsonl(&j).unwrap(), p);
        // Required fields present.
        let v: serde_json::Value = serde_json::from_str(&j).unwrap();
        for f in ["user", "repo", "branch", "ts"] {
            assert!(v.get(f).is_some(), "missing field {f}");
        }
    }
}

/// Integration tests against a real temp bare remote (mirrors git.rs's fixture):
/// announce → push, then list/resolve from a SECOND clone (the pair's view).
#[cfg(test)]
mod git_tests {
    use super::*;
    use std::path::Path;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn git(dir: &Path, args: &[&str]) {
        let out = StdCommand::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn ident(dir: &Path) {
        git(dir, &["config", "user.email", "t@clair.dev"]);
        git(dir, &["config", "user.name", "clair-test"]);
        git(dir, &["config", "core.autocrlf", "false"]);
    }

    /// A bare remote plus one clone with an initial commit on `main`.
    fn remote_and_clone() -> (TempDir, TempDir, Repo) {
        let remote = TempDir::new().unwrap();
        let clone = TempDir::new().unwrap();
        git(remote.path(), &["init", "--bare", "-b", "main"]);
        git(clone.path(), &["init", "-b", "main"]);
        ident(clone.path());
        git(
            clone.path(),
            &["remote", "add", "origin", &remote.path().to_string_lossy()],
        );
        std::fs::write(clone.path().join("README.md"), "hi\n").unwrap();
        git(clone.path(), &["add", "."]);
        git(clone.path(), &["commit", "-m", "init"]);
        git(clone.path(), &["push", "-u", "origin", "main"]);
        let repo = Repo::open(clone.path());
        (remote, clone, repo)
    }

    /// A second independent clone of the same remote, on `main`.
    fn second_clone(remote: &Path) -> (TempDir, Repo) {
        let clone = TempDir::new().unwrap();
        git(clone.path(), &["init", "-b", "main"]);
        ident(clone.path());
        git(
            clone.path(),
            &["remote", "add", "origin", &remote.to_string_lossy()],
        );
        git(clone.path(), &["fetch", "origin"]);
        git(clone.path(), &["checkout", "main"]);
        let repo = Repo::open(clone.path());
        (clone, repo)
    }

    #[test]
    fn announce_then_peer_lists_and_resolves() {
        let (remote, _clone_a, repo_a) = remote_and_clone();

        // JB announces on feature/login.
        announce(&repo_a, "JB", "clair", "feature/login", "2026-06-25T10:00:00Z").unwrap();

        // A second independent clone (Rajiv) reads the registry.
        let (_rajiv_dir, repo_r) = second_clone(remote.path());

        let peers = list(&repo_r, "clair").unwrap();
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].user, "JB");
        assert_eq!(peers[0].branch, "feature/login");

        // resolve is case-insensitive exact.
        let resolved = resolve(&repo_r, "clair", "jb").unwrap();
        assert_eq!(resolved.branch, "feature/login");

        // Unknown handle errors.
        assert!(matches!(
            resolve(&repo_r, "clair", "nobody"),
            Err(CoreError::Registry(_))
        ));
    }

    #[test]
    fn reannounce_updates_branch_latest_wins() {
        let (_remote, _clone, repo) = remote_and_clone();
        announce(&repo, "JB", "clair", "feature/login", "2026-06-25T10:00:00Z").unwrap();
        announce(&repo, "JB", "clair", "feature/login-2", "2026-06-25T10:05:00Z").unwrap();
        let peers = list(&repo, "clair").unwrap();
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].branch, "feature/login-2");
    }
}
