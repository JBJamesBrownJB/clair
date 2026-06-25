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

/// Build a [`Repo`] from the shared repo flags, defaulting the root to `.`.
pub fn repo_from(args: &RepoArgs) -> Repo {
    let root = args
        .repo_root
        .clone()
        .unwrap_or_else(|| ".".to_string());
    Repo::open(root).with_remote(args.remote.clone())
}

/// Resolve the repo root a self-sufficient hook should operate against.
///
/// Priority (highest wins) — pure so it is unit-testable:
/// 1. an explicit `--repo-root` override,
/// 2. the `CLAUDE_PROJECT_DIR` env var (Claude Code sets this to the user's project
///    root when it runs a plugin hook),
/// 3. the current working directory (`.`).
///
/// `override_root` is the `--repo-root` value; `project_dir` is the
/// `CLAUDE_PROJECT_DIR` value. Both are passed in so this can be exercised without
/// touching the real environment.
pub fn resolve_hook_root(override_root: Option<&str>, project_dir: Option<&str>) -> String {
    if let Some(r) = override_root.map(str::trim).filter(|s| !s.is_empty()) {
        return r.to_string();
    }
    if let Some(p) = project_dir.map(str::trim).filter(|s| !s.is_empty()) {
        return p.to_string();
    }
    ".".to_string()
}

/// Build a [`Repo`] and resolve the branch for a self-sufficient hook invocation.
///
/// `--repo-root`/`--branch` are optional overrides; when absent the root comes from
/// `$CLAUDE_PROJECT_DIR` (else the cwd) and the branch from the repo's current
/// checkout. Returns the repo plus the resolved branch (the single source for the
/// read ref, write ref and cursor key for this invocation).
pub fn repo_and_branch_for_hook(
    override_root: Option<&str>,
    override_branch: Option<&str>,
    remote: &str,
) -> (Repo, String) {
    let project_dir = std::env::var("CLAUDE_PROJECT_DIR").ok();
    let root = resolve_hook_root(override_root, project_dir.as_deref());
    let repo = Repo::open(root).with_remote(remote.to_string());

    let branch = override_branch
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| repo.current_branch().unwrap_or_else(|_| "main".to_string()));

    (repo, branch)
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

#[cfg(test)]
mod tests {
    use super::resolve_hook_root;

    #[test]
    fn hook_root_prefers_explicit_override() {
        // An explicit --repo-root beats CLAUDE_PROJECT_DIR.
        assert_eq!(
            resolve_hook_root(Some("/over/ride"), Some("/proj/dir")),
            "/over/ride"
        );
    }

    #[test]
    fn hook_root_falls_back_to_claude_project_dir() {
        // No override → CLAUDE_PROJECT_DIR is used (the plugin-hook path).
        assert_eq!(resolve_hook_root(None, Some("/proj/dir")), "/proj/dir");
        // A whitespace-only override is ignored.
        assert_eq!(resolve_hook_root(Some("   "), Some("/proj/dir")), "/proj/dir");
    }

    #[test]
    fn hook_root_falls_back_to_cwd_when_nothing_set() {
        // Neither override nor env → current working directory.
        assert_eq!(resolve_hook_root(None, None), ".");
        // Empty env value is treated as unset.
        assert_eq!(resolve_hook_root(None, Some("")), ".");
    }
}
