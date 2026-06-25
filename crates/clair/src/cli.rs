//! The clap command surface for `clair`.
//!
//! Thin by design (ADR 0003): every subcommand translates flags into a call to
//! `clair-core` and renders the result. The human commands (`ready`/`pair`/
//! `with`) are implemented in [`crate::cmd`]; the hook adapters, `serve`, and
//! `test-observe` are wired as seams here and fleshed out by later stages.

use clap::{Args, Parser, Subcommand};

/// clair — pair through your AI harness, over git, ephemeral, no server.
#[derive(Debug, Parser)]
#[command(name = "clair", version, about, long_about = None)]
pub struct Cli {
    /// The subcommand. Optional: bare `clair` runs the discovery listing (the
    /// same as `clair pair`) plus a hint about `clair with <name>`.
    #[command(subcommand)]
    pub cmd: Option<Cmd>,
}

/// The top-level subcommands.
#[derive(Debug, Subcommand)]
pub enum Cmd {
    /// Choose and persist this repo's clair alias (your identity).
    Init(InitArgs),

    /// Register me as available to pair in this repo (writes to clair/ready).
    Ready(ReadyArgs),

    /// List everyone ready to pair in this repo, with their branch.
    Pair(PairArgs),

    /// Check out a peer's branch and start a pairing session.
    With(WithArgs),

    /// Claude Code hook adapters (stdin/env -> core -> stdout). Later stage.
    #[command(subcommand)]
    Hook(HookCmd),

    /// Run the MCP server (a later slice). Stub: prints a notice and exits 2.
    Serve,

    /// Hidden Tier-3 stream-json asserter (NDJSON via serde_json). Later stage.
    #[command(hide = true)]
    TestObserve(TestObserveArgs),
}

/// Shared flags for resolving which repo/remote clair operates on.
#[derive(Debug, Args, Clone)]
pub struct RepoArgs {
    /// The repo root (defaults to the current directory).
    #[arg(long, value_name = "PATH")]
    pub repo_root: Option<String>,

    /// The git remote clair pushes/fetches clair refs against.
    #[arg(long, value_name = "REMOTE", default_value = "origin")]
    pub remote: String,
}

impl Default for RepoArgs {
    fn default() -> Self {
        RepoArgs {
            repo_root: None,
            remote: "origin".to_string(),
        }
    }
}

impl Default for PairArgs {
    fn default() -> Self {
        PairArgs {
            repo: RepoArgs::default(),
            as_alias: None,
            json: false,
        }
    }
}

/// `clair init [<alias>]` flags.
#[derive(Debug, Args)]
pub struct InitArgs {
    /// The alias to adopt. If omitted, clair prompts on a TTY, else exits non-zero.
    pub alias: Option<String>,

    #[command(flatten)]
    pub repo: RepoArgs,

    /// Emit machine-readable JSON (`{ "alias": "…" }`) instead of the human line.
    #[arg(long)]
    pub json: bool,
}

/// `clair ready` flags.
#[derive(Debug, Args)]
pub struct ReadyArgs {
    #[command(flatten)]
    pub repo: RepoArgs,

    /// Act as this alias for this invocation AND persist it (`clair.alias`).
    #[arg(long = "as", value_name = "ALIAS")]
    pub as_alias: Option<String>,

    /// Emit machine-readable JSON instead of the human line (for the Skill).
    #[arg(long)]
    pub json: bool,
}

/// `clair pair` flags.
#[derive(Debug, Args)]
pub struct PairArgs {
    #[command(flatten)]
    pub repo: RepoArgs,

    /// Act as this alias for this invocation AND persist it (`clair.alias`).
    #[arg(long = "as", value_name = "ALIAS")]
    pub as_alias: Option<String>,

    /// Emit a JSON array of ready peers instead of the human table.
    #[arg(long)]
    pub json: bool,
}

/// `clair with <handle>` flags.
#[derive(Debug, Args)]
pub struct WithArgs {
    /// The handle of the peer to pair with (case-insensitive exact match).
    pub handle: String,

    #[command(flatten)]
    pub repo: RepoArgs,

    /// Act as this alias for this invocation AND persist it (`clair.alias`).
    #[arg(long = "as", value_name = "ALIAS")]
    pub as_alias: Option<String>,

    /// Emit machine-readable JSON describing the session that was started.
    #[arg(long)]
    pub json: bool,
}

/// The hook adapter subcommands (filled in by a later stage).
#[derive(Debug, Subcommand)]
pub enum HookCmd {
    /// UserPromptSubmit adapter.
    Prompt(HookArgs),
    /// Stop adapter.
    Stop(HookArgs),
}

/// Flags shared by the hook adapters: the repo root and branch.
///
/// Both `--repo-root` and `--branch` are **optional overrides**. When absent the
/// hook is self-sufficient — it resolves the repo root from the `CLAUDE_PROJECT_DIR`
/// env var (set by Claude Code when running a plugin hook), falling back to the
/// current working directory, and resolves the branch from the current git
/// checkout (`git rev-parse --abbrev-ref HEAD`). This is what lets the bundled
/// plugin hooks fire with no baked paths. The Tier-3 harness still passes both
/// explicitly.
#[derive(Debug, Args)]
pub struct HookArgs {
    /// Override the repo root (else `$CLAUDE_PROJECT_DIR`, else the cwd).
    #[arg(long, value_name = "PATH")]
    pub repo_root: Option<String>,
    /// Override the branch (else the current git branch). The single source for
    /// the read ref + write ref + cursor key.
    #[arg(long, value_name = "BRANCH")]
    pub branch: Option<String>,
    /// The git remote.
    #[arg(long, value_name = "REMOTE", default_value = "origin")]
    pub remote: String,
}

/// `clair test-observe <mode>` flags (hidden, Tier-3).
#[derive(Debug, Args)]
pub struct TestObserveArgs {
    /// The assertion mode (parsed by a later stage).
    pub mode: String,
    /// Optional argument for the mode (e.g. an expected substring).
    pub arg: Option<String>,
}
