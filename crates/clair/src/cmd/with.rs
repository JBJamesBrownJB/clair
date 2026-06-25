//! `clair with <handle>` — check out a peer's branch and start a pairing session.
//!
//! Orchestration:
//! 1. resolve `<handle>` to a ready peer (exit 3 on absent/ambiguous),
//! 2. dirty-guard (exit 4 — clair never moves your work),
//! 3. `git fetch` + checkout the peer's branch (tracking branch if needed),
//! 4. append a `kind=signal` "joined" entry to `clair/<branch>` and push, so the
//!    peer sees the join framed under the `── clair ──` banner on their next turn,
//! 5. write `session-settings.json` + the prompt/stop hook shims under
//!    `<GIT_DIR>/clair/` (worktree-correct, the SAME resolution the cursor uses),
//! 6. print the activation line and the `claude --settings …` command.

use std::path::{Path, PathBuf};

use clair_core::entry::{Author, Entry, EntryId, Kind, Timestamp, TurnId};
use clair_core::error::CoreError;
use clair_core::{registry, Repo};

use crate::cli::WithArgs;
use crate::cmd::{now_rfc3339, repo_from, resolve_identity, EXIT_DIRTY, EXIT_RESOLVE};

/// Run `clair with <handle>`. Returns the process exit code.
pub fn run(args: &WithArgs) -> i32 {
    let repo = repo_from(&args.repo);

    let slug = match repo.repo_slug() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("clair: could not determine repo: {e}");
            return 1;
        }
    };

    // 1. Resolve the handle.
    let peer = match registry::resolve(&repo, &slug, &args.handle) {
        Ok(p) => p,
        Err(CoreError::Registry(msg)) => {
            eprintln!("clair: {msg}");
            return EXIT_RESOLVE;
        }
        Err(e) => {
            eprintln!("clair: failed to resolve '{}': {e}", args.handle);
            return 1;
        }
    };
    let target = peer.branch.clone();

    // 2 + 3. Dirty-guard then fetch + checkout (checkout_branch guards first, so a
    // dirty tree never gets a fetch/checkout and HEAD is untouched).
    println!("↪ Switching you to {target} (git fetch + checkout)…");
    match repo.checkout_branch(&target) {
        Ok(()) => {}
        Err(CoreError::DirtyTree) => {
            eprintln!(
                "clair: working tree dirty — commit or stash; clair never moves your work"
            );
            return EXIT_DIRTY;
        }
        Err(e) => {
            eprintln!("clair: could not switch to {target}: {e}");
            return 1;
        }
    }

    let me = resolve_identity(&repo);

    // 4. Append the join signal to clair/<branch>.
    let ts = now_rfc3339();
    let signal = Entry {
        id: EntryId::now(),
        author: Author::new(&me),
        kind: Kind::Signal,
        text: format!("{me} joined the pair session on {target}."),
        ts: Timestamp::new(ts.clone()),
        turn: TurnId::new(format!("with-{}", EntryId::now())),
    };
    if let Ok(line) = signal.to_jsonl() {
        if let Err(e) = repo.append_lines(&Repo::context_ref(&target), &[line]) {
            // A failed signal push must not abort the session — log and continue.
            eprintln!("clair: warning: could not push join signal: {e}");
        }
    }

    // 5. Write the session settings + hook shims under <GIT_DIR>/clair.
    let settings_path = match write_session(&repo, &target) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("clair: could not write session settings: {e}");
            return 1;
        }
    };

    // 6. Activation output.
    if args.json {
        let v = serde_json::json!({
            "paired_with": peer.user,
            "branch": target,
            "settings": settings_path.to_string_lossy(),
        });
        println!("{v}");
    } else {
        println!(
            "🤝 Pairing with {} on {target}. Ephemeral — nothing is logged permanently.",
            peer.user
        );
        println!("claude --settings \"{}\"", settings_path.to_string_lossy());
    }
    0
}

/// The directory under the git dir where clair keeps per-branch local state.
fn clair_state_dir(repo: &Repo) -> Result<PathBuf, CoreError> {
    let dir = repo.git_dir()?.join("clair");
    std::fs::create_dir_all(&dir).map_err(|e| CoreError::Io(e.to_string()))?;
    Ok(dir)
}

/// Write `session-settings.json` plus the `prompt-hook.sh`/`stop-hook.sh` shims
/// under `<GIT_DIR>/clair/`. Returns the settings-file path.
///
/// The shims bake `--repo-root` and `--branch`, so the branch is the single
/// source for the read ref, write ref and cursor key for the whole session.
fn write_session(repo: &Repo, branch: &str) -> Result<PathBuf, CoreError> {
    let dir = clair_state_dir(repo)?;

    // Resolve the repo root to an absolute, forward-slashed path for bash on Windows.
    let abs_root = repo
        .run(&["rev-parse", "--show-toplevel"], None)
        .ok()
        .filter(|o| o.ok)
        .map(|o| o.stdout.trim().to_string())
        .unwrap_or_else(|| repo.root().to_string_lossy().to_string());
    let abs_root = posix(&abs_root);

    let exe = std::env::current_exe()
        .map(|p| posix(&p.to_string_lossy()))
        .unwrap_or_else(|_| "clair".to_string());

    // The two shims. Each is one line: exec the real clair binary with the branch
    // baked in. stdin is passed through untouched by exec.
    let prompt_shim = format!(
        "#!/usr/bin/env bash\nexec \"{exe}\" hook prompt --repo-root \"{abs_root}\" --branch \"{branch}\"\n"
    );
    let stop_shim = format!(
        "#!/usr/bin/env bash\nexec \"{exe}\" hook stop --repo-root \"{abs_root}\" --branch \"{branch}\"\n"
    );

    let prompt_path = dir.join("prompt-hook.sh");
    let stop_path = dir.join("stop-hook.sh");
    write_file(&prompt_path, &prompt_shim)?;
    write_file(&stop_path, &stop_shim)?;

    // The --settings merge file. Commands invoke the shims via `bash "<abs>"`.
    let settings = serde_json::json!({
        "hooks": {
            "UserPromptSubmit": [{
                "hooks": [{
                    "type": "command",
                    "command": format!("bash \"{}\"", posix(&prompt_path.to_string_lossy()))
                }]
            }],
            "Stop": [{
                "hooks": [{
                    "type": "command",
                    "command": format!("bash \"{}\"", posix(&stop_path.to_string_lossy()))
                }]
            }]
        }
    });
    let settings_path = dir.join("session-settings.json");
    let pretty = serde_json::to_string_pretty(&settings)
        .map_err(|e| CoreError::Serde(e.to_string()))?;
    write_file(&settings_path, &pretty)?;

    Ok(settings_path)
}

/// Forward-slash a path so bash on Windows accepts it.
fn posix(p: &str) -> String {
    p.replace('\\', "/")
}

fn write_file(path: &Path, contents: &str) -> Result<(), CoreError> {
    std::fs::write(path, contents).map_err(|e| CoreError::Io(e.to_string()))
}
