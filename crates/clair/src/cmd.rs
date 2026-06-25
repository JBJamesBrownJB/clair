//! The command implementations behind the clap surface.
//!
//! Each module is a thin translator: parse flags into a `clair-core` call and
//! render the result (human line, table, or `--json`). Shared resolution of the
//! repo, identity, branch and slug lives in this module so every command speaks
//! the same vocabulary.

pub mod hook;
pub mod identity;
pub mod init;
pub mod pair;
pub mod ready;
pub mod test_observe;
pub mod with;

use clair_core::Repo;

use crate::cli::RepoArgs;

/// The exit code used when `with` aborts on a dirty working tree.
pub const EXIT_DIRTY: i32 = 4;
/// The exit code used when a `with <handle>` cannot be resolved.
pub const EXIT_RESOLVE: i32 = 3;

/// Build a [`Repo`] from the shared repo flags, defaulting the root to `.`.
pub fn repo_from(args: &RepoArgs) -> Repo {
    let root = args
        .repo_root
        .clone()
        .unwrap_or_else(|| ".".to_string());
    Repo::open(root).with_remote(args.remote.clone())
}

/// Build a [`Repo`] from explicit root/remote strings (used by the hook adapters,
/// whose `--repo-root` is required and baked into the shim).
pub fn repo_from_parts(repo_root: &str, remote: &str) -> Repo {
    Repo::open(repo_root.to_string()).with_remote(remote.to_string())
}

/// Resolve the local pairing **alias** (identity) for this repo.
///
/// Delegates to [`identity::resolve`] with no `--as` override, applying the full
/// priority order: `clair.alias` → `clair.user` (legacy) → `user.name` → OS user.
/// Commands that accept `--as` should call [`identity::resolve_and_persist`]
/// directly so the override is honoured AND persisted for the session.
pub fn resolve_identity(repo: &Repo) -> String {
    identity::resolve(repo, None)
}

/// An RFC3339 UTC timestamp for "now", second precision (matches the wire format).
pub fn now_rfc3339() -> String {
    use time::format_description::well_known::Rfc3339;
    use time::OffsetDateTime;
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .unwrap_or_else(|_| OffsetDateTime::now_utc())
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
