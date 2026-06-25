//! The shared handshake operations — the ONE implementation behind both surfaces.
//!
//! `clair` exposes its handshake (`init` / `ready` / `pair` / `with` / `status`)
//! through two thin layers (ADR 0003): the clap CLI ([`crate::cmd`]) and the MCP
//! server ([`crate::serve`]). To keep them from drifting, every behaviour lives
//! here as a plain function that takes a [`Repo`] plus parsed arguments and returns
//! a structured result (or a typed [`HandshakeError`]). Neither layer reimplements
//! anything: the CLI renders the result as human text / `--json` and maps the error
//! to an exit code; the MCP tool renders it as a tool result and maps the error to
//! an `is_error` message.
//!
//! Identity, branch and slug resolution all flow through the same helpers the CLI
//! already used ([`crate::cmd::identity`], [`Repo::current_branch`],
//! [`Repo::repo_slug`]), so the two surfaces speak one vocabulary.

use clair_core::entry::{Author, Entry, EntryId, Kind, Timestamp, TurnId};
use clair_core::error::CoreError;
use clair_core::registry::{self, ReadyPeer};
use clair_core::Repo;

use crate::cmd::identity;
use crate::cmd::now_rfc3339;

/// The exit code used when `with` aborts on a dirty working tree.
pub const EXIT_DIRTY: i32 = 4;
/// The exit code used when a `with <handle>` cannot be resolved.
pub const EXIT_RESOLVE: i32 = 3;
/// The exit code used when `with` has no resolvable alias to act as.
pub const EXIT_NO_ALIAS: i32 = 5;

/// A typed failure shared by every handshake operation.
///
/// Each variant carries the exit code the CLI historically used, so both surfaces
/// agree on semantics: the CLI calls [`HandshakeError::exit_code`]; the MCP tool
/// renders [`HandshakeError::message`] as an error result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandshakeError {
    /// No deliberately-chosen alias is set and none was supplied (`with`). Exit 5.
    NoAlias,
    /// The working tree is dirty; clair never moves the user's work. Exit 4.
    Dirty,
    /// A `with <handle>` could not be resolved (absent / ambiguous). Exit 3.
    Resolve(String),
    /// Any other failure (git, branch, slug, registry I/O). Exit 1.
    Other(String),
}

impl HandshakeError {
    /// The process exit code the CLI should return for this error.
    pub fn exit_code(&self) -> i32 {
        match self {
            HandshakeError::NoAlias => EXIT_NO_ALIAS,
            HandshakeError::Dirty => EXIT_DIRTY,
            HandshakeError::Resolve(_) => EXIT_RESOLVE,
            HandshakeError::Other(_) => 1,
        }
    }

    /// A human-readable, surface-agnostic message for this error.
    pub fn message(&self) -> String {
        match self {
            HandshakeError::NoAlias => {
                "no alias set. Choose one first: clair init <alias>  (or pass as <alias>)"
                    .to_string()
            }
            HandshakeError::Dirty => {
                "working tree dirty — commit or stash; clair never moves your work".to_string()
            }
            HandshakeError::Resolve(msg) => msg.clone(),
            HandshakeError::Other(msg) => msg.clone(),
        }
    }
}

/// Result of [`init`]: the alias that was persisted.
#[derive(Debug, Clone)]
pub struct InitResult {
    /// The alias now persisted to `<GIT_DIR>/clair/alias` for this repo.
    pub alias: String,
}

/// Result of [`ready`]: the announcement that was written to `clair/ready`.
#[derive(Debug, Clone)]
pub struct ReadyResult {
    /// The resolved alias the announcement was authored by.
    pub user: String,
    /// The repo slug the readiness applies to.
    pub repo: String,
    /// The branch the user announced on.
    pub branch: String,
    /// The RFC3339 timestamp written.
    pub ts: String,
}

/// Result of [`pair`]: who is ready to pair in this repo (excluding me).
#[derive(Debug, Clone)]
pub struct PairResult {
    /// The repo slug the listing was filtered to.
    pub repo: String,
    /// The ready peers, sorted by handle, with their branch (excluding me).
    pub peers: Vec<ReadyPeer>,
}

/// Result of [`with`]: the session that was started.
#[derive(Debug, Clone)]
pub struct WithResult {
    /// The peer I paired with (display casing preserved).
    pub paired_with: String,
    /// The branch I was switched onto.
    pub branch: String,
    /// A non-fatal warning (e.g. the join signal could not be pushed), if any.
    pub warning: Option<String>,
}

/// Result of [`status`]: my current alias / branch / pairing state.
#[derive(Debug, Clone)]
pub struct StatusResult {
    /// My deliberately-chosen alias, if one is set (no OS-username fallback).
    pub alias: Option<String>,
    /// The repo slug, if resolvable.
    pub repo: Option<String>,
    /// The current branch, if resolvable.
    pub branch: Option<String>,
    /// How many peers are ready to pair right now (excluding me).
    pub peers_ready: usize,
}

/// `init` — persist `alias` as this repo's clair identity (`<GIT_DIR>/clair/alias`).
///
/// The alias is trimmed; an empty alias is a [`HandshakeError::Other`].
pub fn init(repo: &Repo, alias: &str) -> std::result::Result<InitResult, HandshakeError> {
    let alias = alias.trim();
    if alias.is_empty() {
        return Err(HandshakeError::Other("no alias given".to_string()));
    }
    let src = identity::RepoConfig::new(repo);
    identity::persist_alias(&src, alias)
        .map_err(|e| HandshakeError::Other(format!("could not persist alias: {e}")))?;
    Ok(InitResult {
        alias: alias.to_string(),
    })
}

/// `ready` — announce me as available to pair on the current branch.
///
/// `as_alias` is an optional `--as`/`as_alias` override that, when present, is
/// resolved AND persisted to the alias file for the session.
pub fn ready(
    repo: &Repo,
    as_alias: Option<&str>,
) -> std::result::Result<ReadyResult, HandshakeError> {
    let user = identity::resolve_and_persist(repo, as_alias);
    let branch = repo
        .current_branch()
        .map_err(|e| HandshakeError::Other(format!("could not determine current branch: {e}")))?;
    let slug = repo
        .repo_slug()
        .map_err(|e| HandshakeError::Other(format!("could not determine repo: {e}")))?;
    let ts = now_rfc3339();

    registry::announce(repo, &user, &slug, &branch, &ts)
        .map_err(|e| HandshakeError::Other(format!("failed to announce readiness: {e}")))?;

    Ok(ReadyResult {
        user,
        repo: slug,
        branch,
        ts,
    })
}

/// `pair` — list everyone ready to pair in this repo, excluding me.
///
/// `as_alias` behaves as in [`ready`]: an override that is also persisted.
pub fn pair(repo: &Repo, as_alias: Option<&str>) -> std::result::Result<PairResult, HandshakeError> {
    let slug = repo
        .repo_slug()
        .map_err(|e| HandshakeError::Other(format!("could not determine repo: {e}")))?;
    let me = identity::resolve_and_persist(repo, as_alias).to_ascii_lowercase();

    let mut peers = registry::list(repo, &slug)
        .map_err(|e| HandshakeError::Other(format!("failed to read the registry: {e}")))?;
    peers.retain(|p| p.user.trim().to_ascii_lowercase() != me);

    Ok(PairResult { repo: slug, peers })
}

/// `with` — resolve `handle`, dirty-guard, fetch + check out their branch, signal join.
///
/// `as_alias` is the optional identity override (resolved + persisted). When no
/// deliberate alias is set and `as_alias` is `None`, returns
/// [`HandshakeError::NoAlias`] so the caller can prompt (CLI) or instruct the user
/// (MCP). The dirty-guard fires before any checkout, so HEAD is never moved on a
/// dirty tree ([`HandshakeError::Dirty`]).
pub fn with(
    repo: &Repo,
    handle: &str,
    as_alias: Option<&str>,
) -> std::result::Result<WithResult, HandshakeError> {
    let slug = repo
        .repo_slug()
        .map_err(|e| HandshakeError::Other(format!("could not determine repo: {e}")))?;

    // Only a deliberately-chosen alias counts; never silently pair as the OS login.
    let me = identity::resolve_explicit_and_persist(repo, as_alias)
        .ok_or(HandshakeError::NoAlias)?;

    let peer = match registry::resolve(repo, &slug, handle) {
        Ok(p) => p,
        Err(CoreError::Registry(msg)) => return Err(HandshakeError::Resolve(msg)),
        Err(e) => {
            return Err(HandshakeError::Other(format!(
                "failed to resolve '{handle}': {e}"
            )))
        }
    };
    let target = peer.branch.clone();

    match repo.checkout_branch(&target) {
        Ok(()) => {}
        Err(CoreError::DirtyTree) => return Err(HandshakeError::Dirty),
        Err(e) => return Err(HandshakeError::Other(format!("could not switch to {target}: {e}"))),
    }

    // Append the join signal to clair/<branch> (best-effort: a push failure must not
    // abort the session — surface it as a warning instead).
    let ts = now_rfc3339();
    let signal = Entry {
        id: EntryId::now(),
        author: Author::new(&me),
        kind: Kind::Signal,
        text: format!("{me} joined the pair session on {target}."),
        ts: Timestamp::new(ts),
        turn: TurnId::new(format!("with-{}", EntryId::now())),
    };
    let mut warning = None;
    if let Ok(line) = signal.to_jsonl() {
        if let Err(e) = repo.append_lines(&Repo::context_ref(&target), &[line]) {
            warning = Some(format!("could not push join signal: {e}"));
        }
    }

    Ok(WithResult {
        paired_with: peer.user,
        branch: target,
        warning,
    })
}

/// `status` — my alias / repo / branch and how many peers are ready right now.
///
/// Best-effort and never hard-fails on missing identity: `alias` is `None` when no
/// deliberate alias is set. Repo/branch are `None` when this is not a usable git
/// repo. The ready count excludes me.
pub fn status(repo: &Repo) -> StatusResult {
    let alias = identity::resolve_explicit_and_persist(repo, None);
    let branch = repo.current_branch().ok();
    let slug = repo.repo_slug().ok();

    let me = alias
        .as_deref()
        .map(|a| a.trim().to_ascii_lowercase())
        .unwrap_or_default();
    let peers_ready = match &slug {
        Some(s) => registry::list(repo, s)
            .map(|peers| {
                peers
                    .into_iter()
                    .filter(|p| me.is_empty() || p.user.trim().to_ascii_lowercase() != me)
                    .count()
            })
            .unwrap_or(0),
        None => 0,
    };

    StatusResult {
        alias,
        repo: slug,
        branch,
        peers_ready,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_exit_codes_match_cli_contract() {
        assert_eq!(HandshakeError::NoAlias.exit_code(), 5);
        assert_eq!(HandshakeError::Dirty.exit_code(), 4);
        assert_eq!(HandshakeError::Resolve("x".into()).exit_code(), 3);
        assert_eq!(HandshakeError::Other("x".into()).exit_code(), 1);
    }

    #[test]
    fn error_messages_carry_guidance() {
        assert!(HandshakeError::NoAlias.message().contains("clair init"));
        assert!(HandshakeError::Dirty.message().contains("commit or stash"));
        assert_eq!(HandshakeError::Resolve("nope".into()).message(), "nope");
    }
}

/// Integration tests against a real temp bare remote, exercising the SHARED
/// functions directly (the same code both surfaces call).
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

    fn ident(dir: &Path, name: &str) {
        git(dir, &["config", "user.email", &format!("{name}@clair.dev")]);
        git(dir, &["config", "user.name", name]);
        git(dir, &["config", "core.autocrlf", "false"]);
    }

    fn remote_and_clone(name: &str) -> (TempDir, TempDir, Repo) {
        let remote = TempDir::new().unwrap();
        let clone = TempDir::new().unwrap();
        git(remote.path(), &["init", "--bare", "-b", "main"]);
        git(clone.path(), &["init", "-b", "main"]);
        ident(clone.path(), name);
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

    fn second_clone(remote: &Path, name: &str) -> (TempDir, Repo) {
        let clone = TempDir::new().unwrap();
        git(clone.path(), &["init", "-b", "main"]);
        ident(clone.path(), name);
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
    fn init_persists_then_ready_uses_it() {
        let (_remote, _clone, repo) = remote_and_clone("JB");
        let out = init(&repo, "Pseudo").unwrap();
        assert_eq!(out.alias, "Pseudo");

        git(repo.root(), &["checkout", "-b", "feature/x"]);
        git(repo.root(), &["push", "-u", "origin", "feature/x"]);
        let r = ready(&repo, None).unwrap();
        // The alias persisted by init (to <GIT_DIR>/clair/alias) beats clair.user.
        assert_eq!(r.user, "Pseudo");
        assert_eq!(r.branch, "feature/x");
    }

    #[test]
    fn ready_then_peer_pairs_and_with_signals_join() {
        let (remote, _clone, repo_a) = remote_and_clone("JB");
        git(repo_a.root(), &["checkout", "-b", "feature/login"]);
        git(repo_a.root(), &["push", "-u", "origin", "feature/login"]);
        let r = ready(&repo_a, Some("JB")).unwrap();
        assert_eq!(r.user, "JB");

        // Rajiv, a second clone, lists peers and pairs.
        let (_rdir, repo_r) = second_clone(remote.path(), "Rajiv");
        let listing = pair(&repo_r, Some("Rajiv")).unwrap();
        assert_eq!(listing.peers.len(), 1);
        assert_eq!(listing.peers[0].user, "JB");

        let w = with(&repo_r, "jb", None).unwrap();
        assert_eq!(w.paired_with, "JB");
        assert_eq!(w.branch, "feature/login");
        assert_eq!(
            current_branch(repo_r.root()),
            "feature/login",
            "HEAD moved to the peer's branch"
        );
    }

    #[test]
    fn with_dirty_tree_is_typed_dirty_and_keeps_head() {
        let (remote, _clone, repo_a) = remote_and_clone("JB");
        git(repo_a.root(), &["checkout", "-b", "feature/login"]);
        git(repo_a.root(), &["push", "-u", "origin", "feature/login"]);
        ready(&repo_a, Some("JB")).unwrap();

        let (rdir, repo_r) = second_clone(remote.path(), "Rajiv");
        std::fs::write(rdir.path().join("README.md"), "dirty\n").unwrap();
        let err = with(&repo_r, "jb", None).unwrap_err();
        assert_eq!(err, HandshakeError::Dirty);
        assert_eq!(current_branch(repo_r.root()), "main", "HEAD never moved");
    }

    #[test]
    fn with_unknown_handle_is_typed_resolve() {
        let (_remote, _clone, repo) = remote_and_clone("Rajiv");
        let err = with(&repo, "ghost", Some("Rajiv")).unwrap_err();
        match err {
            HandshakeError::Resolve(msg) => assert!(msg.contains("ghost")),
            other => panic!("expected Resolve, got {other:?}"),
        }
    }

    fn current_branch(dir: &Path) -> String {
        let out = StdCommand::new("git")
            .arg("-C")
            .arg(dir)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }
}
