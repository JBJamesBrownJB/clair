//! Tier-1 CLI tests for `clair ready` / `pair` / `with`, driven through the real
//! binary via `assert_cmd` against temp bare-remote repos.
//!
//! Each test stands up a bare "origin" plus one or two working clones on disk and
//! runs the compiled `clair` binary with `--repo-root` pointed at a clone, then
//! asserts the registry / checkout / signal effects from the other side.

use std::path::Path;
use std::process::Command as StdCommand;

use assert_cmd::prelude::*;
use tempfile::TempDir;

/// Run a raw git command in `dir`, asserting success.
fn git(dir: &Path, args: &[&str]) {
    let out = StdCommand::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git invocation");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Capture trimmed stdout of a raw git command.
fn git_out(dir: &Path, args: &[&str]) -> String {
    let out = StdCommand::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git invocation");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn ident(dir: &Path, name: &str) {
    git(dir, &["config", "user.email", &format!("{name}@clair.dev")]);
    git(dir, &["config", "user.name", name]);
    git(dir, &["config", "clair.user", name]);
    git(dir, &["config", "core.autocrlf", "false"]);
}

/// A bare remote shared by every clone in a test.
fn bare_remote() -> TempDir {
    let remote = TempDir::new().unwrap();
    git(remote.path(), &["init", "--bare", "-b", "main"]);
    remote
}

/// A working clone of `remote` with identity `name`, on a fresh `main` with one
/// initial commit. The first clone seeds the remote; later clones fetch it.
fn clone(remote: &Path, name: &str, seed: bool) -> TempDir {
    let dir = TempDir::new().unwrap();
    git(dir.path(), &["init", "-b", "main"]);
    ident(dir.path(), name);
    git(
        dir.path(),
        &["remote", "add", "origin", &remote.to_string_lossy()],
    );
    if seed {
        std::fs::write(dir.path().join("README.md"), "hi\n").unwrap();
        git(dir.path(), &["add", "."]);
        git(dir.path(), &["commit", "-m", "init"]);
        git(dir.path(), &["push", "-u", "origin", "main"]);
    } else {
        git(dir.path(), &["fetch", "origin"]);
        git(dir.path(), &["checkout", "main"]);
    }
    dir
}

/// Build a `clair <sub...>` Command rooted at `dir`. `--repo-root` is appended
/// after the subcommand args because it is a subcommand-scoped flag.
fn clair(dir: &Path, sub: &[&str]) -> std::process::Command {
    let mut c = std::process::Command::cargo_bin("clair").unwrap();
    c.args(sub).arg("--repo-root").arg(dir);
    c
}

/// Read every JSONL line on `clair/<ref>` from `dir`'s remote view.
fn read_clair_log(dir: &Path, clair_ref: &str) -> Vec<String> {
    // Fetch the ref into a tracking ref, then cat-file the blob.
    let refspec = format!("+refs/heads/{clair_ref}:refs/remotes/origin/{clair_ref}");
    let _ = StdCommand::new("git")
        .arg("-C")
        .arg(dir)
        .args(["fetch", "origin", &refspec])
        .output();
    let spec = format!("refs/remotes/origin/{clair_ref}:log.jsonl");
    let out = StdCommand::new("git")
        .arg("-C")
        .arg(dir)
        .args(["cat-file", "-p", &spec])
        .output()
        .expect("git cat-file");
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.to_string())
        .collect()
}

/// A clone with a git identity (email + name) but NO deliberate clair alias and
/// NO `user.name`-as-handle expectation — used to test the "no resolvable alias"
/// path. Only `user.email` and autocrlf are set; `user.name`/`clair.user`/
/// `clair.alias` are deliberately absent.
fn clone_no_alias(remote: &Path, email: &str, seed: bool) -> TempDir {
    let dir = TempDir::new().unwrap();
    git(dir.path(), &["init", "-b", "main"]);
    git(dir.path(), &["config", "user.email", email]);
    git(dir.path(), &["config", "core.autocrlf", "false"]);
    // A name is required to commit; we set it transiently for the seed commit then
    // unset it so resolution finds no deliberate alias.
    git(
        dir.path(),
        &["remote", "add", "origin", &remote.to_string_lossy()],
    );
    if seed {
        git(dir.path(), &["config", "user.name", "tmp-committer"]);
        std::fs::write(dir.path().join("README.md"), "hi\n").unwrap();
        git(dir.path(), &["add", "."]);
        git(dir.path(), &["commit", "-m", "init"]);
        git(dir.path(), &["push", "-u", "origin", "main"]);
        git(dir.path(), &["config", "--unset", "user.name"]);
    } else {
        git(dir.path(), &["fetch", "origin"]);
        git(dir.path(), &["checkout", "main"]);
    }
    dir
}

/// The platform "null device" path, for pointing GIT_CONFIG_GLOBAL/SYSTEM at
/// nothing so only a clone's local config is consulted.
fn devnull() -> &'static str {
    if cfg!(windows) {
        "NUL"
    } else {
        "/dev/null"
    }
}

/// Read clair's persisted alias from `<GIT_DIR>/clair/alias` (trimmed; empty if
/// unset). The alias lives in clair's own file — never git config.
fn read_alias(dir: &Path) -> String {
    let git_dir = git_out(dir, &["rev-parse", "--git-dir"]);
    let base = if Path::new(&git_dir).is_absolute() {
        std::path::PathBuf::from(&git_dir)
    } else {
        dir.join(&git_dir)
    };
    std::fs::read_to_string(base.join("clair").join("alias"))
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[test]
fn init_persists_alias_and_resolution_uses_it() {
    let remote = bare_remote();
    // A clone with no clair alias yet (ident() sets clair.user=JB though).
    let jb = clone(remote.path(), "JB", true);

    // `clair init Pseudo` persists the alias to <GIT_DIR>/clair/alias and confirms.
    clair(jb.path(), &["init", "Pseudo"])
        .assert()
        .success()
        .stdout(predicates::str::contains("Pseudo"));
    assert_eq!(read_alias(jb.path()), "Pseudo");

    // A subsequent `ready` resolves to the persisted alias (the alias file beats the
    // legacy clair.user=JB), so the registry row is authored by "Pseudo".
    git(jb.path(), &["checkout", "-b", "feature/x"]);
    git(jb.path(), &["push", "-u", "origin", "feature/x"]);
    clair(jb.path(), &["ready"]).assert().success();
    let lines = read_clair_log(jb.path(), "clair/ready");
    assert_eq!(lines.len(), 1, "one ready row: {lines:?}");
    assert!(lines[0].contains("\"Pseudo\""), "row: {}", lines[0]);
}

#[test]
fn init_no_alias_non_tty_exits_nonzero_with_guidance() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    // assert_cmd runs with a piped (non-TTY) stdin/stdout, so `init` with no alias
    // must fail with guidance rather than block on a prompt.
    clair(jb.path(), &["init"])
        .assert()
        .failure()
        .stderr(predicates::str::contains("clair init <alias>"));
}

#[test]
fn as_flag_overrides_and_persists_for_the_session() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    git(jb.path(), &["checkout", "-b", "feature/login"]);
    git(jb.path(), &["push", "-u", "origin", "feature/login"]);

    // `ready --as Rajiv`: overrides identity for THIS call AND persists the alias.
    clair(jb.path(), &["ready", "--as", "Rajiv"]).assert().success();
    assert_eq!(read_alias(jb.path()), "Rajiv");
    let lines = read_clair_log(jb.path(), "clair/ready");
    assert_eq!(lines.len(), 1);
    assert!(lines[0].contains("\"Rajiv\""), "row: {}", lines[0]);

    // A later call WITHOUT --as keeps the persisted alias (sticky for the session).
    let out = clair(jb.path(), &["pair", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    // pair excludes myself: with alias Rajiv and only Rajiv in the registry, empty.
    let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(v.as_array().unwrap().len(), 0, "Rajiv excludes self: {v}");
}

#[test]
fn bare_clair_lists_peers_like_pair() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    git(jb.path(), &["checkout", "-b", "feature/login"]);
    git(jb.path(), &["push", "-u", "origin", "feature/login"]);
    clair(jb.path(), &["ready"]).assert().success();

    // Rajiv runs bare `clair` (no subcommand) → same discovery listing as `pair`,
    // plus a one-line hint about `clair with <name>`. Bare clair has no
    // subcommand-scoped `--repo-root`, so it operates on the current directory.
    let rajiv = clone(remote.path(), "Rajiv", false);
    let mut c = std::process::Command::cargo_bin("clair").unwrap();
    c.current_dir(rajiv.path());
    c.assert()
        .success()
        .stdout(predicates::str::contains("JB"))
        .stdout(predicates::str::contains("feature/login"))
        .stdout(predicates::str::contains("clair with"));
}

#[test]
fn with_no_resolvable_alias_non_tty_exits_nonzero_with_guidance() {
    let remote = bare_remote();
    // JB announces (with a clair.user identity, fine).
    let jb = clone(remote.path(), "JB", true);
    git(jb.path(), &["checkout", "-b", "feature/login"]);
    git(jb.path(), &["push", "-u", "origin", "feature/login"]);
    clair(jb.path(), &["ready"]).assert().success();

    // Rajiv's clone has NO deliberate alias (no clair.alias / clair.user / user.name)
    // and runs under a non-TTY harness, so `with jb` must exit non-zero with
    // guidance rather than silently pairing as the OS login or blocking on a prompt.
    let rajiv = clone_no_alias(remote.path(), "rajiv@clair.dev", false);
    // Isolate from this machine's global/system git config (which may carry a
    // user.name) so "no resolvable alias" is deterministic: only local config counts.
    clair(rajiv.path(), &["with", "jb"])
        .env("GIT_CONFIG_GLOBAL", devnull())
        .env("GIT_CONFIG_SYSTEM", devnull())
        .assert()
        .failure()
        .stderr(predicates::str::contains("clair init"));
    // HEAD never moved — we failed before checkout.
    assert_eq!(
        git_out(rajiv.path(), &["rev-parse", "--abbrev-ref", "HEAD"]),
        "main"
    );
}

#[test]
fn ready_registers_me_and_pair_lists_me() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    // JB moves onto feature/login.
    git(jb.path(), &["checkout", "-b", "feature/login"]);
    git(jb.path(), &["push", "-u", "origin", "feature/login"]);

    // JB runs ready.
    clair(jb.path(), &["ready"])
        .assert()
        .success()
        .stdout(predicates::str::contains("feature/login"));

    // The registry now has a JB row.
    let lines = read_clair_log(jb.path(), "clair/ready");
    assert_eq!(lines.len(), 1, "one ready row: {lines:?}");
    assert!(lines[0].contains("\"JB\""));
    assert!(lines[0].contains("feature/login"));

    // Rajiv (a different clone, on main) runs pair and sees JB.
    let rajiv = clone(remote.path(), "Rajiv", false);
    clair(rajiv.path(), &["pair"])
        .assert()
        .success()
        .stdout(predicates::str::contains("JB"))
        .stdout(predicates::str::contains("feature/login"));
}

#[test]
fn pair_json_emits_array_with_branch() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    git(jb.path(), &["checkout", "-b", "feature/login"]);
    git(jb.path(), &["push", "-u", "origin", "feature/login"]);
    clair(jb.path(), &["ready"]).assert().success();

    let rajiv = clone(remote.path(), "Rajiv", false);
    let out = clair(rajiv.path(), &["pair", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
    let arr = v.as_array().expect("json array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["user"], "JB");
    assert_eq!(arr[0]["branch"], "feature/login");
    assert!(arr[0]["ago_secs"].is_number());
}

#[test]
fn pair_excludes_myself() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    clair(jb.path(), &["ready"]).assert().success();
    // JB runs pair: he should not list himself.
    let out = clair(jb.path(), &["pair", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(v.as_array().unwrap().len(), 0, "I am not listed: {v}");
}

#[test]
fn with_checks_out_branch_and_signals_join() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    git(jb.path(), &["checkout", "-b", "feature/login"]);
    git(jb.path(), &["push", "-u", "origin", "feature/login"]);
    clair(jb.path(), &["ready"]).assert().success();

    // Rajiv on main runs `with jb`.
    let rajiv = clone(remote.path(), "Rajiv", false);
    assert_eq!(git_out(rajiv.path(), &["rev-parse", "--abbrev-ref", "HEAD"]), "main");

    clair(rajiv.path(), &["with", "jb"])
        .assert()
        .success()
        .stdout(predicates::str::contains("feature/login"));

    // Rajiv's HEAD moved to feature/login.
    assert_eq!(
        git_out(rajiv.path(), &["rev-parse", "--abbrev-ref", "HEAD"]),
        "feature/login"
    );

    // A signal "joined" entry is on clair/feature/login, authored by Rajiv.
    let lines = read_clair_log(rajiv.path(), "clair/feature/login");
    assert_eq!(lines.len(), 1, "one join signal: {lines:?}");
    assert!(lines[0].contains("\"signal\""), "kind=signal: {}", lines[0]);
    assert!(lines[0].contains("Rajiv"));
    assert!(lines[0].contains("joined the pair session on feature/login"));

    // `with` no longer writes any session settings or hook shims: the clair plugin
    // owns the hooks (they auto-fire). Assert NOTHING was written under <GIT_DIR>/clair.
    let git_dir = git_out(rajiv.path(), &["rev-parse", "--git-dir"]);
    let base = if Path::new(&git_dir).is_absolute() {
        std::path::PathBuf::from(&git_dir)
    } else {
        rajiv.path().join(&git_dir)
    };
    let clair_dir = base.join("clair");
    assert!(
        !clair_dir.join("session-settings.json").exists(),
        "with must not generate a session-settings.json (plugin owns hooks)"
    );
    assert!(!clair_dir.join("prompt-hook.sh").exists());
    assert!(!clair_dir.join("stop-hook.sh").exists());
}

#[test]
fn with_aborts_on_dirty_tree() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    git(jb.path(), &["checkout", "-b", "feature/login"]);
    git(jb.path(), &["push", "-u", "origin", "feature/login"]);
    clair(jb.path(), &["ready"]).assert().success();

    let rajiv = clone(remote.path(), "Rajiv", false);
    // Dirty Rajiv's tree.
    std::fs::write(rajiv.path().join("README.md"), "dirty\n").unwrap();

    clair(rajiv.path(), &["with", "jb"])
        .assert()
        .code(4)
        .stderr(predicates::str::contains("commit or stash"));

    // HEAD unchanged: still on main, nothing checked out.
    assert_eq!(
        git_out(rajiv.path(), &["rev-parse", "--abbrev-ref", "HEAD"]),
        "main"
    );
    // No signal was written (we aborted before the append).
    let lines = read_clair_log(rajiv.path(), "clair/feature/login");
    assert!(lines.is_empty(), "no signal on abort: {lines:?}");
}

#[test]
fn with_unknown_handle_exits_3() {
    let remote = bare_remote();
    let rajiv = clone(remote.path(), "Rajiv", true);
    // Nobody announced.
    clair(rajiv.path(), &["with", "ghost"])
        .assert()
        .code(3)
        .stderr(predicates::str::contains("ghost"));
}
