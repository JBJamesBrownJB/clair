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

    // Session settings + shims were written under <GIT_DIR>/clair.
    let git_dir = git_out(rajiv.path(), &["rev-parse", "--git-dir"]);
    let base = if Path::new(&git_dir).is_absolute() {
        std::path::PathBuf::from(&git_dir)
    } else {
        rajiv.path().join(&git_dir)
    };
    let clair_dir = base.join("clair");
    assert!(clair_dir.join("session-settings.json").is_file());
    assert!(clair_dir.join("prompt-hook.sh").is_file());
    assert!(clair_dir.join("stop-hook.sh").is_file());

    // The settings file references both shims via bash "<abs>".
    let settings =
        std::fs::read_to_string(clair_dir.join("session-settings.json")).unwrap();
    assert!(settings.contains("UserPromptSubmit"));
    assert!(settings.contains("Stop"));
    assert!(settings.contains("prompt-hook.sh"));
    assert!(settings.contains("stop-hook.sh"));

    // The shims bake the branch (single source for read/write/cursor).
    let prompt_shim = std::fs::read_to_string(clair_dir.join("prompt-hook.sh")).unwrap();
    assert!(prompt_shim.contains("hook prompt"));
    assert!(prompt_shim.contains("--branch \"feature/login\""));
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
