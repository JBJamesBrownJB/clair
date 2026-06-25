//! `clair init [<alias>]` — choose and persist this repo's clair alias.
//!
//! The alias is the user's clair identity (see [`crate::cmd::identity`]). It is
//! written to the LOCAL git config key `clair.alias`, so two clones of one git
//! account can hold two different aliases — the basis of solo "impersonation".
//!
//! - `clair init JB` → persist `JB`, print a confirmation.
//! - `clair init` (no alias) on a TTY → prompt "Choose your clair alias: " and
//!   persist the entered value.
//! - `clair init` (no alias) NOT on a TTY → exit non-zero with guidance.

use std::io::{IsTerminal, Write};

use crate::cli::InitArgs;
use crate::cmd::repo_from;
use crate::handshake;

/// Run `clair init`. Returns the process exit code.
pub fn run(args: &InitArgs) -> i32 {
    let repo = repo_from(&args.repo);

    // Resolve the alias to persist: explicit arg, else an interactive prompt, else
    // a guidance error on a non-TTY. (Prompting is a CLI-only concern; persistence
    // is the shared handshake operation.)
    let alias = match args.alias.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(a) => a.to_string(),
        None => match prompt_for_alias() {
            Some(a) => a,
            None => {
                eprintln!("clair: no alias given. Provide one: clair init <alias>");
                return 2;
            }
        },
    };

    let out = match handshake::init(&repo, &alias) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("clair: {}", e.message());
            return e.exit_code();
        }
    };

    if args.json {
        println!("{}", serde_json::json!({ "alias": out.alias }));
    } else {
        println!("You are now '{}' in this repo.", out.alias);
    }
    0
}

/// Prompt for an alias on a TTY, returning the trimmed entry.
///
/// Returns `None` when stdin/stdout is NOT a terminal (so the caller can exit with
/// guidance instead of blocking), or when the user entered nothing.
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
