//! `clair pair` — list everyone ready to pair in this repo, with their branch.
//!
//! Read-only: fetches `clair/ready`, folds latest-per-user, filters this repo.
//! Repo-wide and branch-aware — my own current branch is irrelevant.

use clair_core::registry::{self, ReadyPeer};

use crate::cli::PairArgs;
use crate::cmd::identity;
use crate::cmd::{now_rfc3339, repo_from};

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

    let slug = match repo.repo_slug() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("clair: could not determine repo: {e}");
            return 1;
        }
    };

    // `--as` overrides AND persists my alias for the session.
    let me = identity::resolve_and_persist(&repo, args.as_alias.as_deref()).to_ascii_lowercase();

    let mut peers = match registry::list(&repo, &slug) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("clair: failed to read the registry: {e}");
            return 1;
        }
    };
    // Don't list myself as someone to pair with.
    peers.retain(|p| p.user.trim().to_ascii_lowercase() != me);

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
