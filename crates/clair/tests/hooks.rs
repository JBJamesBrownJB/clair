//! Tier-1 end-to-end tests for the hook adapters (`clair hook prompt` / `stop`),
//! driven through the real compiled binary via `assert_cmd` against temp
//! bare-remote repos.
//!
//! These assert the **exact stdin/stdout JSON contract**: we feed the binary the
//! Claude `UserPromptSubmit` / `Stop` payloads on stdin and assert the precise
//! stdout (`{}` or `hookSpecificOutput.additionalContext`), plus the git effects
//! (one entry pushed per turn, loop-guard, branch-scope, reciprocal propagation).

use std::io::Write;
use std::path::Path;
use std::process::{Command as StdCommand, Stdio};

use assert_cmd::prelude::*;
use tempfile::TempDir;

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

fn ident(dir: &Path, name: &str) {
    git(dir, &["config", "user.email", &format!("{name}@clair.dev")]);
    git(dir, &["config", "user.name", name]);
    git(dir, &["config", "clair.user", name]);
    git(dir, &["config", "core.autocrlf", "false"]);
}

fn bare_remote() -> TempDir {
    let remote = TempDir::new().unwrap();
    git(remote.path(), &["init", "--bare", "-b", "main"]);
    remote
}

fn clone(remote: &Path, name: &str, seed: bool) -> TempDir {
    let dir = TempDir::new().unwrap();
    git(dir.path(), &["init", "-b", "main"]);
    ident(dir.path(), name);
    git(dir.path(), &["remote", "add", "origin", &remote.to_string_lossy()]);
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

/// Put a clone onto `feature/login` and push it so peers can fetch it.
fn on_feature(dir: &Path) {
    git(dir, &["checkout", "-b", "feature/login"]);
    git(dir, &["push", "-u", "origin", "feature/login"]);
}

/// Run `clair hook <which>` rooted at `dir`, on branch `branch`, feeding `stdin`,
/// returning trimmed stdout. Asserts the process exited 0 (hooks always fail-open).
fn run_hook(dir: &Path, which: &str, branch: &str, stdin: &str) -> String {
    let mut child = StdCommand::cargo_bin("clair")
        .unwrap()
        .args(["hook", which, "--repo-root"])
        .arg(dir)
        .args(["--branch", branch])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn clair hook");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "hook {which} must exit 0 (fail-open); stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Run `clair hook <which>` with NO `--repo-root` / `--branch` (the self-sufficient
/// plugin path). The repo root is supplied via `CLAUDE_PROJECT_DIR` and the branch
/// is left to be resolved from the checkout. Returns trimmed stdout; asserts exit 0.
fn run_hook_self_sufficient(dir: &Path, which: &str, stdin: &str) -> String {
    let mut child = StdCommand::cargo_bin("clair")
        .unwrap()
        .args(["hook", which])
        .env("CLAUDE_PROJECT_DIR", dir)
        // cwd intentionally elsewhere to prove CLAUDE_PROJECT_DIR (not cwd) is used.
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn clair hook");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "hook {which} must exit 0 (fail-open); stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Run `clair hook <which>` with NO flags AND no `CLAUDE_PROJECT_DIR`, relying on
/// the cwd fallback. The child's cwd is set to `dir`.
fn run_hook_cwd_fallback(dir: &Path, which: &str, stdin: &str) -> String {
    let mut child = StdCommand::cargo_bin("clair")
        .unwrap()
        .args(["hook", which])
        .env_remove("CLAUDE_PROJECT_DIR")
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn clair hook");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "hook {which} must exit 0 (fail-open); stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn read_clair_log(dir: &Path, clair_ref: &str) -> Vec<String> {
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

/// A `UserPromptSubmit` stdin payload.
fn prompt_json(session: &str, prompt: &str) -> String {
    serde_json::json!({
        "session_id": session,
        "hook_event_name": "UserPromptSubmit",
        "prompt": prompt,
        "cwd": "."
    })
    .to_string()
}

/// A `Stop` stdin payload pointing at a transcript file we wrote.
fn stop_json(session: &str, transcript_path: &Path, active: bool) -> String {
    serde_json::json!({
        "session_id": session,
        "hook_event_name": "Stop",
        "transcript_path": transcript_path.to_string_lossy(),
        "stop_hook_active": active
    })
    .to_string()
}

/// Write a one-message assistant transcript and return its path.
fn write_transcript(dir: &Path, name: &str, reply: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    let line = serde_json::json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": [ { "type": "text", "text": reply } ] }
    });
    std::fs::write(&path, format!("{line}\n")).unwrap();
    path
}

#[test]
fn prompt_hook_with_no_peer_entries_emits_empty_object_and_pushes_one_entry() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());

    let stdout = run_hook(
        jb.path(),
        "prompt",
        "feature/login",
        &prompt_json("s1", "refactor the auth guard to use the new middleware"),
    );
    // No peer entries yet → empty object.
    assert_eq!(stdout, "{}");

    // Exactly one entry (JB's prompt) was pushed.
    let lines = read_clair_log(jb.path(), "clair/feature/login");
    assert_eq!(lines.len(), 1, "one prompt entry: {lines:?}");
    assert!(lines[0].contains("\"prompt\""));
    assert!(lines[0].contains("refactor the auth guard"));
    assert!(lines[0].contains("\"JB\""));
}

#[test]
fn peer_prompt_is_injected_as_framed_background_context() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());
    // JB submits a prompt (pushes a prompt entry).
    run_hook(
        jb.path(),
        "prompt",
        "feature/login",
        &prompt_json("s1", "refactor the auth guard to use the new middleware"),
    );

    // Rajiv joins the same branch and submits his own prompt.
    let rajiv = clone(remote.path(), "Rajiv", false);
    git(rajiv.path(), &["fetch", "origin", "feature/login"]);
    git(rajiv.path(), &["checkout", "feature/login"]);

    let stdout = run_hook(
        rajiv.path(),
        "prompt",
        "feature/login",
        &prompt_json("s2", "my own unrelated prompt"),
    );

    // The stdout must carry JB's prompt, framed as passive background.
    let v: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let ctx = v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .expect("additionalContext present");
    assert_eq!(
        v["hookSpecificOutput"]["hookEventName"],
        serde_json::json!("UserPromptSubmit")
    );
    assert!(
        ctx.contains("── shared pair context (background — your AI won't act on this) ──"),
        "background banner present: {ctx}"
    );
    assert!(ctx.contains("↪ JB asked his AI: \"refactor the auth guard to use the new middleware\""));
    // No directive language: it never tells Rajiv's AI to act.
    assert!(!ctx.to_lowercase().contains("you should"));
}

#[test]
fn loop_guard_injecting_a_peer_entry_writes_only_my_own_prompt() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());
    run_hook(jb.path(), "prompt", "feature/login", &prompt_json("s1", "jb prompt"));

    let rajiv = clone(remote.path(), "Rajiv", false);
    git(rajiv.path(), &["fetch", "origin", "feature/login"]);
    git(rajiv.path(), &["checkout", "feature/login"]);

    // First interaction: Rajiv injects JB's entry AND pushes exactly his one prompt.
    let first = run_hook(rajiv.path(), "prompt", "feature/login", &prompt_json("s2", "rajiv 1"));
    assert!(first.contains("jb prompt"), "JB's entry injected: {first}");

    let lines = read_clair_log(rajiv.path(), "clair/feature/login");
    // JB(1) + Rajiv(1) = 2 entries; zero extra writes from the inbound read.
    assert_eq!(lines.len(), 2, "exactly JB + Rajiv entries: {lines:?}");
    let rajiv_lines: Vec<&String> = lines.iter().filter(|l| l.contains("\"Rajiv\"")).collect();
    assert_eq!(rajiv_lines.len(), 1, "only one Rajiv-authored entry");

    // Second interaction: JB's entry is NOT re-delivered (cursor advanced).
    let second = run_hook(rajiv.path(), "prompt", "feature/login", &prompt_json("s3", "rajiv 2"));
    assert_eq!(second, "{}", "peer entry must not be re-delivered: {second}");
}

#[test]
fn stop_hook_pushes_a_distilled_summary_and_prints_empty_object() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());

    let transcript = write_transcript(
        jb.path(),
        "s1.jsonl",
        "I'll move the guard.\n\nDone. Guard now in AuthMiddleware; 1 test still failing on the expired-token case.",
    );
    let stdout = run_hook(
        jb.path(),
        "stop",
        "feature/login",
        &stop_json("s1", &transcript, false),
    );
    // Stop never injects.
    assert_eq!(stdout, "{}");

    let lines = read_clair_log(jb.path(), "clair/feature/login");
    assert_eq!(lines.len(), 1, "one summary entry: {lines:?}");
    assert!(lines[0].contains("\"summary\""));
    assert!(lines[0].contains("Guard now in AuthMiddleware; 1 test still failing on the expired-token case."));
}

#[test]
fn stop_hook_with_stop_hook_active_writes_nothing() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());

    let transcript = write_transcript(jb.path(), "s1.jsonl", "should not be captured");
    let stdout = run_hook(
        jb.path(),
        "stop",
        "feature/login",
        &stop_json("s1", &transcript, true), // stop_hook_active = true
    );
    assert_eq!(stdout, "{}");

    // Anti-recursion: nothing was pushed.
    let lines = read_clair_log(jb.path(), "clair/feature/login");
    assert!(lines.is_empty(), "no summary on stop_hook_active: {lines:?}");
}

#[test]
fn summary_propagates_and_renders_for_the_peer() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());

    let transcript = write_transcript(
        jb.path(),
        "s1.jsonl",
        "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case.",
    );
    run_hook(jb.path(), "stop", "feature/login", &stop_json("s1", &transcript, false));

    let rajiv = clone(remote.path(), "Rajiv", false);
    git(rajiv.path(), &["fetch", "origin", "feature/login"]);
    git(rajiv.path(), &["checkout", "feature/login"]);

    let stdout = run_hook(rajiv.path(), "prompt", "feature/login", &prompt_json("s2", "rajiv asks"));
    let v: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let ctx = v["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
    assert!(ctx.contains("✓ JB's AI concluded: \"Moved the guard into AuthMiddleware"), "{ctx}");
}

#[test]
fn multi_point_summary_propagates_with_every_point_through_the_real_binary() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());

    // JB ends a turn with a blank-line-separated three-point critique, no sentinel.
    let transcript = write_transcript(
        jb.path(),
        "s1.jsonl",
        "Here are my concerns.\n\n\
         1. instant-wow is unproven\n\n\
         2. the cap is arbitrary\n\n\
         3. the sentinel is undocumented",
    );
    run_hook(jb.path(), "stop", "feature/login", &stop_json("s1", &transcript, false));

    let rajiv = clone(remote.path(), "Rajiv", false);
    git(rajiv.path(), &["fetch", "origin", "feature/login"]);
    git(rajiv.path(), &["checkout", "feature/login"]);

    let stdout = run_hook(rajiv.path(), "prompt", "feature/login", &prompt_json("s2", "rajiv asks"));
    let v: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let ctx = v["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
    // The multi-line header frames it, and every point survives the round-trip.
    assert!(ctx.contains("✓ JB's AI concluded:"), "{ctx}");
    assert!(ctx.contains("1. instant-wow is unproven"), "first point lost: {ctx}");
    assert!(ctx.contains("2. the cap is arbitrary"), "middle point lost: {ctx}");
    assert!(ctx.contains("3. the sentinel is undocumented"), "last point lost: {ctx}");
}

#[test]
fn branch_scope_entries_on_branch_a_are_invisible_on_branch_b() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());
    run_hook(jb.path(), "prompt", "feature/login", &prompt_json("s1", "on feature/login"));

    // Sam works on main; his prompt hook is wired to branch `main`.
    let sam = clone(remote.path(), "Sam", false);
    let stdout = run_hook(sam.path(), "prompt", "main", &prompt_json("s2", "on main"));
    // Sam sees nothing from feature/login.
    assert_eq!(stdout, "{}", "branch B must not see branch A: {stdout}");

    // And clair/main does not contain the feature/login text.
    let main_lines = read_clair_log(sam.path(), "clair/main");
    assert!(main_lines.iter().all(|l| !l.contains("on feature/login")));
}

#[test]
fn malformed_stdin_fails_open_with_empty_object() {
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());

    // Garbage stdin: the hook must not crash; it emits {} and exits 0.
    let stdout = run_hook(jb.path(), "prompt", "feature/login", "not json at all");
    assert_eq!(stdout, "{}");
}

#[test]
fn prompt_hook_resolves_root_from_claude_project_dir_and_current_branch() {
    // The self-sufficient plugin path: no --repo-root, no --branch. The root comes
    // from CLAUDE_PROJECT_DIR and the branch from the checkout (feature/login).
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());

    let stdout = run_hook_self_sufficient(
        jb.path(),
        "prompt",
        &prompt_json("s1", "refactor the auth guard via the plugin path"),
    );
    assert_eq!(stdout, "{}", "no peer entries yet → empty object");

    // The entry must land on clair/feature/login (current-branch resolution),
    // proving the branch was read from HEAD, not a baked flag.
    let lines = read_clair_log(jb.path(), "clair/feature/login");
    assert_eq!(lines.len(), 1, "one prompt entry on the current branch: {lines:?}");
    assert!(lines[0].contains("refactor the auth guard via the plugin path"));
    assert!(lines[0].contains("\"JB\""));
}

#[test]
fn prompt_hook_resolves_root_from_cwd_when_no_env_and_branch_from_head() {
    // No CLAUDE_PROJECT_DIR either: the root falls back to the cwd, branch to HEAD.
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());

    let stdout = run_hook_cwd_fallback(
        jb.path(),
        "prompt",
        &prompt_json("s1", "prompt via cwd fallback"),
    );
    assert_eq!(stdout, "{}");

    let lines = read_clair_log(jb.path(), "clair/feature/login");
    assert_eq!(lines.len(), 1, "entry on the current branch via cwd: {lines:?}");
    assert!(lines[0].contains("prompt via cwd fallback"));
}

#[test]
fn stop_hook_resolves_root_and_branch_self_sufficiently() {
    // The Stop hook is likewise self-sufficient via CLAUDE_PROJECT_DIR + HEAD.
    let remote = bare_remote();
    let jb = clone(remote.path(), "JB", true);
    on_feature(jb.path());

    let transcript = write_transcript(
        jb.path(),
        "s1.jsonl",
        "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case.",
    );
    let stdout =
        run_hook_self_sufficient(jb.path(), "stop", &stop_json("s1", &transcript, false));
    assert_eq!(stdout, "{}");

    let lines = read_clair_log(jb.path(), "clair/feature/login");
    assert_eq!(lines.len(), 1, "one summary entry via self-sufficient stop: {lines:?}");
    assert!(lines[0].contains("\"summary\""));
    assert!(lines[0].contains("Moved the guard into AuthMiddleware"));
}
