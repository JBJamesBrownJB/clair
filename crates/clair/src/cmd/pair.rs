//! `clair pair` — list everyone ready to pair in this repo, with their branch.
//!
//! Read-only: fetches `clair/ready`, folds latest-per-user, filters this repo.
//! Repo-wide and branch-aware — my own current branch is irrelevant. The fold +
//! self-exclusion live in [`crate::handshake::pair`]; this module only renders.

use clair_core::registry::ReadyPeer;

use crate::cli::PairArgs;
use crate::cmd::{now_rfc3339, repo_from};
use crate::handshake;

/// Run `clair pair`. Returns the process exit code.
pub fn run(args: &PairArgs) -> i32 {
    run_inner(args, false)
}

/// Run the bare `clair` (no subcommand): the same listing as `clair pair`, plus a
/// one-line hint about `clair with <name>`.
pub fn run_bare(args: &PairArgs) -> i32 {
    run_inner(args, true)
}

fn run_inner(args: &PairArgs, bare: bool) -> i32 {
    let repo = repo_from(&args.repo);

    let result = match handshake::pair(&repo, args.as_alias.as_deref()) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("clair: {}", e.message());
            return e.exit_code();
        }
    };
    let slug = result.repo;
    let peers = result.peers;

    if args.json {
        let now = now_rfc3339();
        let arr: Vec<serde_json::Value> = peers
            .iter()
            .map(|p| {
                serde_json::json!({
                    "user": p.user,
                    "repo": p.repo,
                    "branch": p.branch,
                    "ts": p.ts,
                    "ago_secs": ago_secs(&now, &p.ts),
                })
            })
            .collect();
        println!("{}", serde_json::Value::Array(arr));
        return 0;
    }

    if peers.is_empty() {
        println!("No one is ready to pair on {slug} yet.");
        if bare {
            println!("Once someone is ready, join them with:  clair with <name>");
        }
        return 0;
    }

    println!("People ready to pair on  {slug}:");
    for p in &peers {
        println!("  • {:<6}→  {}", p.user, branch_col(p));
    }
    if let Some(first) = peers.first() {
        let hint = if bare { "clair with" } else { "/clair with" };
        println!("Join with:  {hint} {}", first.user.to_ascii_lowercase());
    }
    0
}

fn branch_col(p: &ReadyPeer) -> String {
    p.branch.clone()
}

/// Seconds between two RFC3339 timestamps (best-effort; 0 if unparsable).
fn ago_secs(now: &str, then: &str) -> i64 {
    use time::format_description::well_known::Rfc3339;
    use time::OffsetDateTime;
    let parse = |s: &str| OffsetDateTime::parse(s, &Rfc3339).ok();
    match (parse(now), parse(then)) {
        (Some(n), Some(t)) => (n - t).whole_seconds().max(0),
        _ => 0,
    }
}
