//! `clair ready` — register me as available to pair in this repo.

use crate::cli::ReadyArgs;
use crate::cmd::repo_from;
use crate::handshake;

/// Run `clair ready`. Returns the process exit code.
pub fn run(args: &ReadyArgs) -> i32 {
    let repo = repo_from(&args.repo);

    let out = match handshake::ready(&repo, args.as_alias.as_deref()) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("clair: {}", e.message());
            return e.exit_code();
        }
    };

    if args.json {
        let v = serde_json::json!({
            "user": out.user,
            "repo": out.repo,
            "branch": out.branch,
            "ts": out.ts,
        });
        println!("{v}");
    } else {
        println!(
            "You're available to pair  ·  repo: {}  ·  branch: {}",
            out.repo, out.branch
        );
    }
    0
}
