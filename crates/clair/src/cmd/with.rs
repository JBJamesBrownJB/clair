//! `clair with <handle>` — check out a peer's branch and start a pairing session.
//!
//! The orchestration (resolve handle → dirty-guard → fetch + checkout → append the
//! join signal) lives in [`crate::handshake::with`], the ONE implementation both
//! the CLI and the MCP `with` tool call. This module only adds the CLI niceties:
//! the TTY prompt when no alias is set, and rendering / exit-code mapping.
//!
//! `with` does NOT wire any hooks. The capture+inject hooks are bundled in the
//! clair Claude Code **plugin** (`plugin/hooks/hooks.json`) and auto-fire whenever
//! the plugin is enabled.

use std::io::{IsTerminal, Write};

use crate::cli::WithArgs;
use crate::cmd::{identity, repo_from};
use crate::handshake::{self, HandshakeError};

/// Exit code when `with` cannot resolve MY alias and can't prompt (non-TTY).
pub const EXIT_NO_ALIAS: i32 = handshake::EXIT_NO_ALIAS;

/// Run `clair with <handle>`. Returns the process exit code.
pub fn run(args: &WithArgs) -> i32 {
    let repo = repo_from(&args.repo);

    // Resolve once with whatever `--as` was given. If the only obstacle is a missing
    // alias, prompt on a TTY (a CLI-only nicety) and retry; otherwise surface it.
    let result = match handshake::with(&repo, &args.handle, args.as_alias.as_deref()) {
        Ok(r) => r,
        Err(HandshakeError::NoAlias) => match prompt_for_alias() {
            Some(a) => {
                // Persist the chosen alias and retry as that identity.
                let _ = identity::resolve_and_persist(&repo, Some(&a));
                match handshake::with(&repo, &args.handle, Some(&a)) {
                    Ok(r) => r,
                    Err(e) => return fail(e),
                }
            }
            None => {
                eprintln!(
                    "clair: no alias set. Choose one first: clair init <alias>  \
                     (or pass --as <alias>)"
                );
                return EXIT_NO_ALIAS;
            }
        },
        Err(e) => return fail(e),
    };

    if let Some(w) = &result.warning {
        eprintln!("clair: warning: {w}");
    }

    if args.json {
        let v = serde_json::json!({
            "paired_with": result.paired_with,
            "branch": result.branch,
        });
        println!("{v}");
    } else {
        println!(
            "🤝 Pairing with {} on {}. Ephemeral — nothing is logged permanently.",
            result.paired_with, result.branch
        );
    }
    0
}

/// Map a handshake error to the CLI's stderr line + exit code.
fn fail(e: HandshakeError) -> i32 {
    eprintln!("clair: {}", e.message());
    e.exit_code()
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
