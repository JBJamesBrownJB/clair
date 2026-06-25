//! `clair with <handle>` — check out a peer's branch and start a pairing session.
//!
//! Orchestration:
//! 1. resolve `<handle>` to a ready peer (exit 3 on absent/ambiguous),
//! 2. dirty-guard (exit 4 — clair never moves your work),
//! 3. `git fetch` + checkout the peer's branch (tracking branch if needed),
//! 4. append a `kind=signal` "joined" entry to `clair/<branch>` and push, so the
//!    peer sees the join framed under the `── clair ──` banner on their next turn,
//! 5. print the activation line.
//!
//! `with` does NOT wire any hooks. The capture+inject hooks are bundled in the
//! clair Claude Code **plugin** (`plugin/hooks/hooks.json`) and auto-fire whenever
//! the plugin is enabled — no per-session settings file, no generated shims. The
//! hook subcommands are self-sufficient: they resolve the repo root from
//! `$CLAUDE_PROJECT_DIR` and the branch from the current checkout.

use std::io::{IsTerminal, Write};

use clair_core::entry::{Author, Entry, EntryId, Kind, Timestamp, TurnId};
use clair_core::error::CoreError;
use clair_core::{registry, Repo};

use crate::cli::WithArgs;
use crate::cmd::identity;
use crate::cmd::{now_rfc3339, repo_from, EXIT_DIRTY, EXIT_RESOLVE};

/// Exit code when `with` cannot resolve MY alias and can't prompt (non-TTY).
pub const EXIT_NO_ALIAS: i32 = 5;

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

    // 0. Resolve MY alias up front (honouring `--as`, which also persists it).
    // Only a deliberately-chosen alias counts; if none is set we prompt on a TTY,
    // else exit with guidance — we never silently pair as the OS login.
    let me = match identity::resolve_explicit_and_persist(&repo, args.as_alias.as_deref()) {
        Some(a) => a,
        None => match prompt_for_alias() {
            Some(a) => {
                let _ = identity::resolve_and_persist(&repo, Some(&a));
                a
            }
            None => {
                eprintln!(
                    "clair: no alias set. Choose one first: clair init <alias>  \
                     (or pass --as <alias>)"
                );
                return EXIT_NO_ALIAS;
            }
        },
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

    // 5. Activation output. The hooks are wired by the clair plugin (auto-fire);
    // `with` only switches the branch and signals the join.
    if args.json {
        let v = serde_json::json!({
            "paired_with": peer.user,
            "branch": target,
        });
        println!("{v}");
    } else {
        println!(
            "🤝 Pairing with {} on {target}. Ephemeral — nothing is logged permanently.",
            peer.user
        );
    }
    0
}

/// Prompt for MY alias on a TTY (when none is set), returning the trimmed entry.
///
/// Returns `None` when stdin/stdout is not a terminal, so `with` exits with
/// guidance instead of blocking.
fn prompt_for_alias() -> Option<String> {
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        return None;
    }
    print!("Choose your clair alias: ");
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line).is_err() {
        return None;
    }
    let trimmed = line.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
