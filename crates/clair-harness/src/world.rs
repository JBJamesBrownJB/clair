//! The `World` — a bare git remote plus the `Dev` clones that pair against it.
//!
//! This is the cucumber-rs `World` *and* a poke-able Tier-2 fixture. It stands up a
//! real bare remote in a [`tempfile::TempDir`] with an initial commit on `main`, and
//! hands out [`Dev`]s that are real clones of it. Two `Dev`s on the same branch prove
//! the full pairing flow end-to-end through git, with zero `claude -p`.

use std::collections::HashMap;
use std::path::Path;

use tempfile::TempDir;

use crate::dev::{git, Dev};
use crate::injected::Injected;

/// The shared-remote test world: one bare remote, many `Dev` clones.
#[derive(cucumber::World)]
#[world(init = Self::new)]
pub struct World {
    /// The bare remote every `Dev` pushes to / fetches from.
    remote: TempDir,
    /// Each clone's TempDir kept alive for the world's lifetime, keyed by handle.
    clones: HashMap<String, TempDir>,
    /// The live `Dev`s, keyed by handle.
    devs: HashMap<String, Dev>,
    /// Scratch for the most recent `with` result, for the BDD layer to assert on.
    pub last_with: Option<Result<String, crate::dev::WithError>>,
    /// The injection each dev saw on its most recent `interacts` step. Captured
    /// because `submit_prompt` advances the cursor, so a later peek would be empty.
    stashed: HashMap<String, Injected>,
}

impl std::fmt::Debug for World {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("World")
            .field("remote", &self.remote.path())
            .field("devs", &self.devs.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl World {
    /// Stand up a fresh world: a bare remote seeded with one commit on `main`.
    pub fn new() -> Self {
        let remote = TempDir::new().expect("temp remote");
        git(remote.path(), &["init", "--bare", "-b", "main"]);

        // Seed the remote with an initial commit on main via a throwaway clone, so
        // every real Dev clone has a base to branch from.
        let seed = TempDir::new().expect("temp seed");
        git(seed.path(), &["init", "-b", "main"]);
        ident(seed.path(), "seed");
        git(
            seed.path(),
            &["remote", "add", "origin", &remote.path().to_string_lossy()],
        );
        std::fs::write(seed.path().join("README.md"), "clair\n").expect("seed readme");
        git(seed.path(), &["add", "."]);
        git(seed.path(), &["commit", "-m", "init"]);
        git(seed.path(), &["push", "-u", "origin", "main"]);
        // Also create feature/login on the remote so peers can `with`/checkout it.
        git(seed.path(), &["checkout", "-b", "feature/login"]);
        git(seed.path(), &["push", "-u", "origin", "feature/login"]);

        World {
            remote,
            clones: HashMap::new(),
            devs: HashMap::new(),
            last_with: None,
            stashed: HashMap::new(),
        }
    }

    /// The bare remote's path.
    pub fn remote_path(&self) -> &Path {
        self.remote.path()
    }

    /// Create (or replace) a [`Dev`] named `handle`, cloned and checked out on
    /// `branch`. The branch must already exist on the remote (the world seeds
    /// `main` and `feature/login`); other branches are created locally + pushed.
    pub fn add_dev(&mut self, handle: &str, branch: &str) {
        // Default: handle and git account agree (handle@clair.dev).
        let email = format!("{handle}@clair.dev");
        self.add_dev_with_account(handle, branch, &email);
    }

    /// Like [`World::add_dev`] but with an EXPLICIT git account email, so two devs
    /// can share ONE git account (same `user.email`) while keeping DISTINCT clair
    /// aliases. This is the impersonation case: provenance keys on the alias, so a
    /// single git account acting under two aliases yields two identities that see
    /// each other.
    pub fn add_dev_with_account(&mut self, handle: &str, branch: &str, email: &str) {
        let dir = TempDir::new().expect("temp clone");
        git(dir.path(), &["init", "-b", "main"]);
        ident_with_email(dir.path(), handle, email);
        git(
            dir.path(),
            &["remote", "add", "origin", &self.remote.path().to_string_lossy()],
        );
        git(dir.path(), &["fetch", "origin"]);

        // Check out the requested branch: track the remote one if it exists, else
        // create it locally from main and push so peers can fetch it.
        let remote_has = git_ok(
            dir.path(),
            &["rev-parse", "--verify", "--quiet", &format!("origin/{branch}")],
        );
        if remote_has {
            git(dir.path(), &["checkout", "-b", branch, "--track", &format!("origin/{branch}")]);
        } else {
            git(dir.path(), &["checkout", "main"]);
            git(dir.path(), &["checkout", "-b", branch]);
            git(dir.path(), &["push", "-u", "origin", branch]);
        }

        let dev = Dev::new(handle, dir.path().to_path_buf(), branch);
        self.clones.insert(handle.to_string(), dir);
        self.devs.insert(handle.to_string(), dev);
    }

    /// Borrow a [`Dev`] by handle (case-insensitive), panicking if unknown.
    pub fn dev(&self, handle: &str) -> &Dev {
        self.devs
            .get(&self.key(handle))
            .unwrap_or_else(|| panic!("no dev named {handle:?}"))
    }

    /// Mutably borrow a [`Dev`] by handle (case-insensitive), panicking if unknown.
    pub fn dev_mut(&mut self, handle: &str) -> &mut Dev {
        let key = self.key(handle);
        self.devs
            .get_mut(&key)
            .unwrap_or_else(|| panic!("no dev named {key:?}"))
    }

    /// True if a Dev named `handle` exists (case-insensitive).
    pub fn has_dev(&self, handle: &str) -> bool {
        self.devs.contains_key(&self.key(handle))
    }

    /// Every registered dev handle (insertion-order-independent).
    pub fn dev_handles(&self) -> Vec<String> {
        self.devs.keys().cloned().collect()
    }

    /// Record the injection a dev saw on its most recent interaction.
    pub fn stash_injected(&mut self, handle: &str, injected: Injected) {
        let key = self.key(handle);
        self.stashed.insert(key, injected);
    }

    /// The injection a dev saw on its most recent interaction, if any was stashed.
    pub fn injected_for(&self, handle: &str) -> Option<Injected> {
        self.stashed.get(&self.key(handle)).cloned()
    }

    /// Resolve a handle to the stored key (the handles we register are the keys;
    /// we match case-insensitively against them).
    fn key(&self, handle: &str) -> String {
        if self.devs.contains_key(handle) {
            return handle.to_string();
        }
        let lower = handle.to_ascii_lowercase();
        self.devs
            .keys()
            .find(|k| k.to_ascii_lowercase() == lower)
            .cloned()
            .unwrap_or_else(|| handle.to_string())
    }
}

/// Configure a clone's git identity + clair handle, autocrlf off so blobs stay LF.
fn ident(dir: &Path, name: &str) {
    ident_with_email(dir, name, &format!("{name}@clair.dev"));
}

/// Like [`ident`] but with an explicit `email`, decoupling the git ACCOUNT
/// (`user.email`) from the clair ALIAS (`clair.user`) so two clones can share one
/// account under two aliases — the impersonation case.
fn ident_with_email(dir: &Path, alias: &str, email: &str) {
    git(dir, &["config", "user.email", email]);
    git(dir, &["config", "user.name", alias]);
    git(dir, &["config", "clair.user", alias]);
    git(dir, &["config", "core.autocrlf", "false"]);
}

/// Run `git <args>` in `dir`, returning whether it exited 0 (no panic).
fn git_ok(dir: &Path, args: &[&str]) -> bool {
    std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_devs_share_a_prompt_then_a_summary() {
        let mut w = World::new();
        w.add_dev("JB", "feature/login");
        w.add_dev("Rajiv", "feature/login");

        // JB submits a prompt; Rajiv hasn't seen anything yet.
        w.dev_mut("JB").submit_prompt("refactor the auth guard to use the new middleware");

        // Rajiv's next interaction surfaces JB's prompt as passive background.
        let injected = w.dev_mut("Rajiv").submit_prompt("unrelated work");
        assert!(injected.has_background(), "must be framed as background");
        assert!(injected.mentions_prompt_from("JB"));
        assert!(injected.contains("refactor the auth guard to use the new middleware"));

        // JB finishes a turn; Rajiv next sees the conclusion.
        w.dev_mut("JB").finish_turn(
            "Working on it.\n\nMoved the guard into AuthMiddleware; 1 test still failing on the expired-token case.",
        );
        let injected = w.dev("Rajiv").injected_context();
        assert!(injected.mentions_conclusion_from("JB"));
    }

    #[test]
    fn loop_guard_no_self_write_and_no_redelivery() {
        let mut w = World::new();
        w.add_dev("JB", "feature/login");
        w.add_dev("Rajiv", "feature/login");
        w.dev_mut("JB").submit_prompt("jb prompt");

        let before = w.dev("Rajiv").entry_count();
        let jb_before = w.dev("Rajiv").entry_count_by("JB");

        // Rajiv receives JB's entry and writes exactly his own prompt (nothing of JB's).
        let injected = w.dev_mut("Rajiv").submit_prompt("rajiv prompt");
        assert!(injected.mentions_prompt_from("JB"));
        assert_eq!(w.dev("Rajiv").entry_count(), before + 1, "exactly one new entry");
        assert_eq!(w.dev("Rajiv").entry_count_by("JB"), jb_before, "no JB entries written");

        // Second interaction: JB's entry is NOT re-delivered.
        let again = w.dev("Rajiv").injected_context();
        assert!(again.is_empty(), "peer entry must not be re-delivered");
    }

    #[test]
    fn branch_scope_isolates_other_branches() {
        let mut w = World::new();
        w.add_dev("JB", "feature/login");
        w.add_dev("Sam", "main");
        w.dev_mut("JB").submit_prompt("on feature/login");

        let sam = w.dev("Sam").injected_context();
        assert!(sam.is_empty(), "main must not see feature/login");
        assert!(w.dev("Sam").assert_branch_source_unified());
    }
}
