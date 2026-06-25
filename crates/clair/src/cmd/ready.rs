//! `clair ready` — register me as available to pair in this repo.

use clair_core::registry;

use crate::cli::ReadyArgs;
use crate::cmd::identity;
use crate::cmd::{now_rfc3339, repo_from};

/// Run `clair ready`. Returns the process exit code.
pub fn run(args: &ReadyArgs) -> i32 {
    let repo = repo_from(&args.repo);

    // `--as` overrides AND persists my alias for the session.
    let user = identity::resolve_and_persist(&repo, args.as_alias.as_deref());
    let branch = match repo.current_branch() {
        Ok(b) => b,
        Err(e) => {
            eprintln!("clair: could not determine current branch: {e}");
            return 1;
        }
    };
    let slug = match repo.repo_slug() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("clair: could not determine repo: {e}");
            return 1;
        }
    };
    let ts = now_rfc3339();

    if let Err(e) = registry::announce(&repo, &user, &slug, &branch, &ts) {
        eprintln!("clair: failed to announce readiness: {e}");
        return 1;
    }

    if args.json {
        let v = serde_json::json!({
            "user": user,
            "repo": slug,
            "branch": branch,
            "ts": ts,
        });
        println!("{v}");
    } else {
        println!("You're available to pair  ·  repo: {slug}  ·  branch: {branch}");
    }
    0
}
