//! Centralised alias / identity resolution — the heart of the impersonation feature.
//!
//! A clair user's identity is a chosen **alias**. The same machine / same git
//! account can act as two different aliases in two sessions (this is how a solo
//! developer reviews the pair-brain): provenance compares the *resolved alias*, so
//! two distinct aliases on one git account are two distinct identities that see
//! each other.
//!
//! ## Resolution priority (highest wins)
//!
//! 1. an explicit `--as <alias>` for this invocation,
//! 2. the clair alias file (`<GIT_DIR>/clair/alias`, written by `clair init` / `--as`),
//! 3. `clair.user` git config (LEGACY read-only fallback — kept so existing setups work),
//! 4. `user.name` git config,
//! 5. the OS username (last resort, so a command never hard-fails on identity).
//!
//! The config layers (the alias file plus the read-only git-config lookups) are
//! reached through a small [`ConfigSource`] trait so the priority logic is
//! unit-testable without touching disk or git, while the production path
//! ([`resolve`]) wires it to a real [`Repo`].
//!
//! clair never *writes* to the user's git config: the only thing it persists is the
//! alias, and that goes to `<GIT_DIR>/clair/alias` (beside the cursor). `user.name`
//! and the legacy key are read-only.

use clair_core::Repo;
use std::path::PathBuf;

/// Logical key for a user's chosen clair alias. In production this is backed by the
/// file `<GIT_DIR>/clair/alias` (NOT git config); the string value is retained as the
/// in-memory key the [`ConfigSource`] trait and its tests dispatch on.
pub const ALIAS_KEY: &str = "clair.alias";
/// The LEGACY git-config key kept as a resolution fallback (pre-alias users/tests).
pub const LEGACY_USER_KEY: &str = "clair.user";

/// A read/write view of the git config layers identity resolution consults.
///
/// Abstracted so the priority order in [`resolve_with`] can be exercised in unit
/// tests with an in-memory map, and so persistence (`init` / `--as`) goes through
/// one place.
pub trait ConfigSource {
    /// Read a single config value, `None` if unset or empty.
    fn get(&self, key: &str) -> Option<String>;
    /// Persist `value` to `key` in the LOCAL config (best-effort; errors surface
    /// as `Err`). Used by `init` and `--as`.
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    /// The OS username, if any (the lowest-priority fallback).
    fn os_user(&self) -> Option<String>;
}

/// Resolve the active alias against a [`ConfigSource`], honouring `--as`.
///
/// `over` is the `--as <alias>` value for this invocation (if any). The returned
/// string is the resolved alias verbatim (display casing preserved); provenance
/// case-folds it downstream, so two aliases differing only in case collapse.
pub fn resolve_with(src: &dyn ConfigSource, over: Option<&str>) -> String {
    // 1. explicit --as wins.
    if let Some(a) = over.map(str::trim).filter(|s| !s.is_empty()) {
        return a.to_string();
    }
    // 2. clair.alias.
    if let Some(a) = src.get(ALIAS_KEY) {
        return a;
    }
    // 3. clair.user (legacy).
    if let Some(a) = src.get(LEGACY_USER_KEY) {
        return a;
    }
    // 4. user.name.
    if let Some(a) = src.get("user.name") {
        return a;
    }
    // 5. OS username, else a stable placeholder so we never hard-fail.
    src.os_user()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "anon".to_string())
}

/// Resolve only an **explicitly chosen** alias, WITHOUT the OS-username fallback.
///
/// Returns the alias from `--as`, `clair.alias`, `clair.user` (legacy) or
/// `user.name` — the four levels that reflect a deliberate identity. Returns
/// `None` when none is set, so a caller (notably `with`) can prompt on a TTY or
/// exit with guidance rather than silently pairing as the OS login.
pub fn resolve_explicit_with(src: &dyn ConfigSource, over: Option<&str>) -> Option<String> {
    if let Some(a) = over.map(str::trim).filter(|s| !s.is_empty()) {
        return Some(a.to_string());
    }
    src.get(ALIAS_KEY)
        .or_else(|| src.get(LEGACY_USER_KEY))
        .or_else(|| src.get("user.name"))
}

/// Persist `alias` to clair's alias store (`<GIT_DIR>/clair/alias` in production).
///
/// On success the alias becomes the resolved identity for subsequent invocations
/// (priority level 2), so `--as` and `init` make the choice sticky for the session.
pub fn persist_alias(src: &dyn ConfigSource, alias: &str) -> Result<(), String> {
    src.set(ALIAS_KEY, alias.trim())
}

/// Production [`ConfigSource`] for a real [`Repo`].
///
/// The clair alias is **not** stored in git config: it lives in a clair-owned file
/// at `<GIT_DIR>/clair/alias` (right beside the cursor), so clair never writes to a
/// user's git config. Every other key (`user.name`, the legacy [`LEGACY_USER_KEY`])
/// is a read-only lookup into the existing git config.
pub struct RepoConfig<'a> {
    repo: &'a Repo,
}

impl<'a> RepoConfig<'a> {
    /// Wrap a [`Repo`] as a config source.
    pub fn new(repo: &'a Repo) -> Self {
        RepoConfig { repo }
    }

    /// The clair-owned alias file: `<GIT_DIR>/clair/alias`.
    ///
    /// Per-clone (so two clones of one account hold two aliases — the impersonation
    /// unit), never committed, never pushed; the same `.git/clair/` dir the cursor
    /// uses.
    fn alias_path(&self) -> Option<PathBuf> {
        Some(self.repo.git_dir().ok()?.join("clair").join("alias"))
    }

    /// Read a git-config value (read-only; backs `user.name` and the legacy key).
    fn git_get(&self, key: &str) -> Option<String> {
        let out = self.repo.run(&["config", "--get", key], None).ok()?;
        if !out.ok {
            return None;
        }
        let v = out.stdout.trim();
        if v.is_empty() {
            None
        } else {
            Some(v.to_string())
        }
    }
}

impl ConfigSource for RepoConfig<'_> {
    fn get(&self, key: &str) -> Option<String> {
        if key == ALIAS_KEY {
            let raw = std::fs::read_to_string(self.alias_path()?).ok()?;
            let v = raw.trim();
            return if v.is_empty() {
                None
            } else {
                Some(v.to_string())
            };
        }
        self.git_get(key)
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        // The only thing clair persists is the alias, and it goes to clair's own
        // file — `<GIT_DIR>/clair/alias` — NEVER git config. We do not mutate the
        // user's git config.
        debug_assert_eq!(key, ALIAS_KEY, "RepoConfig only persists the alias");
        let path = self
            .alias_path()
            .ok_or_else(|| "could not resolve <git-dir>/clair for the alias store".to_string())?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, value.trim()).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn os_user(&self) -> Option<String> {
        std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .ok()
            .filter(|s| !s.trim().is_empty())
    }
}

/// Resolve the active alias for `repo`, honouring an explicit `--as` override.
///
/// This is the single production entry point every command uses for identity.
pub fn resolve(repo: &Repo, over: Option<&str>) -> String {
    resolve_with(&RepoConfig::new(repo), over)
}

/// Resolve only an explicitly chosen alias for `repo` (no OS-username fallback).
///
/// Persists an explicit `--as` (so it sticks) before returning. Returns `None`
/// when the user has chosen no alias — `with` uses this to prompt or fail.
pub fn resolve_explicit_and_persist(repo: &Repo, over: Option<&str>) -> Option<String> {
    let src = RepoConfig::new(repo);
    if let Some(a) = over.map(str::trim).filter(|s| !s.is_empty()) {
        let _ = persist_alias(&src, a);
        return Some(a.to_string());
    }
    resolve_explicit_with(&src, None)
}

/// Resolve the alias AND persist an explicit `--as` so it sticks for the session.
///
/// When `over` is `Some`, the alias is written to `clair.alias` before being
/// returned (so later calls in the session keep it). When `over` is `None`, this
/// is a plain [`resolve`]. A persistence failure is non-fatal: we still return the
/// resolved alias (the invocation should not die because config write failed).
pub fn resolve_and_persist(repo: &Repo, over: Option<&str>) -> String {
    let src = RepoConfig::new(repo);
    if let Some(a) = over.map(str::trim).filter(|s| !s.is_empty()) {
        let _ = persist_alias(&src, a);
        return a.to_string();
    }
    resolve_with(&src, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// An in-memory [`ConfigSource`] for exercising the priority order without git.
    struct FakeConfig {
        map: RefCell<HashMap<String, String>>,
        os_user: Option<String>,
    }

    impl FakeConfig {
        fn new() -> Self {
            FakeConfig {
                map: RefCell::new(HashMap::new()),
                os_user: Some("os-login".to_string()),
            }
        }
        fn with(mut self, key: &str, val: &str) -> Self {
            self.map.get_mut().insert(key.to_string(), val.to_string());
            self
        }
        fn no_os_user(mut self) -> Self {
            self.os_user = None;
            self
        }
    }

    impl ConfigSource for FakeConfig {
        fn get(&self, key: &str) -> Option<String> {
            self.map
                .borrow()
                .get(key)
                .cloned()
                .filter(|s| !s.trim().is_empty())
        }
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            self.map
                .borrow_mut()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }
        fn os_user(&self) -> Option<String> {
            self.os_user.clone()
        }
    }

    #[test]
    fn priority_1_as_override_beats_everything() {
        let cfg = FakeConfig::new()
            .with(ALIAS_KEY, "FromAlias")
            .with(LEGACY_USER_KEY, "FromUser")
            .with("user.name", "FromName");
        assert_eq!(resolve_with(&cfg, Some("Override")), "Override");
        // Whitespace-only override is ignored (falls through to clair.alias).
        assert_eq!(resolve_with(&cfg, Some("   ")), "FromAlias");
    }

    #[test]
    fn priority_2_clair_alias_beats_legacy_user_and_name() {
        let cfg = FakeConfig::new()
            .with(ALIAS_KEY, "FromAlias")
            .with(LEGACY_USER_KEY, "FromUser")
            .with("user.name", "FromName");
        assert_eq!(resolve_with(&cfg, None), "FromAlias");
    }

    #[test]
    fn priority_3_legacy_clair_user_kept_as_fallback() {
        // No clair.alias: the legacy clair.user must still resolve (back-compat).
        let cfg = FakeConfig::new()
            .with(LEGACY_USER_KEY, "FromUser")
            .with("user.name", "FromName");
        assert_eq!(resolve_with(&cfg, None), "FromUser");
    }

    #[test]
    fn priority_4_user_name() {
        let cfg = FakeConfig::new().with("user.name", "FromName");
        assert_eq!(resolve_with(&cfg, None), "FromName");
    }

    #[test]
    fn priority_5_os_username_then_placeholder() {
        let cfg = FakeConfig::new();
        assert_eq!(resolve_with(&cfg, None), "os-login");
        // With no OS user either, we fall back to a stable placeholder.
        let cfg = FakeConfig::new().no_os_user();
        assert_eq!(resolve_with(&cfg, None), "anon");
    }

    #[test]
    fn persist_then_resolve_returns_persisted_alias() {
        let cfg = FakeConfig::new().with("user.name", "FromName");
        // Before init, resolution falls to user.name.
        assert_eq!(resolve_with(&cfg, None), "FromName");
        // init persists clair.alias …
        persist_alias(&cfg, "JB").unwrap();
        // … and a subsequent resolve returns it (priority 2 now populated).
        assert_eq!(resolve_with(&cfg, None), "JB");
    }

    #[test]
    fn as_override_is_trimmed_when_resolved() {
        let cfg = FakeConfig::new();
        assert_eq!(resolve_with(&cfg, Some("  Rajiv  ")), "Rajiv");
    }

    #[test]
    fn explicit_resolution_skips_os_fallback() {
        // No deliberate alias anywhere → None (so `with` can prompt / fail), even
        // though plain `resolve_with` would return the OS login.
        let cfg = FakeConfig::new();
        assert_eq!(resolve_with(&cfg, None), "os-login");
        assert_eq!(resolve_explicit_with(&cfg, None), None);

        // Any deliberate level resolves explicitly.
        let cfg = FakeConfig::new().with("user.name", "FromName");
        assert_eq!(resolve_explicit_with(&cfg, None), Some("FromName".to_string()));
        assert_eq!(
            resolve_explicit_with(&cfg, Some("Over")),
            Some("Over".to_string())
        );
    }
}
