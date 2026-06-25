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
    #[command(subcommand)]
    pub cmd: Cmd,
}

/// The top-level subcommands.
#[derive(Debug, Subcommand)]
pub enum Cmd {
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

/// `clair ready` flags.
#[derive(Debug, Args)]
pub struct ReadyArgs {
    #[command(flatten)]
    pub repo: RepoArgs,

    /// Emit machine-readable JSON instead of the human line (for the Skill).
    #[arg(long)]
    pub json: bool,
}

/// `clair pair` flags.
#[derive(Debug, Args)]
pub struct PairArgs {
    #[command(flatten)]
    pub repo: RepoArgs,

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

/// Flags shared by the hook adapters: the baked repo root and branch.
#[derive(Debug, Args)]
pub struct HookArgs {
    /// The repo root the hook operates against.
    #[arg(long, value_name = "PATH")]
    pub repo_root: String,
    /// The single branch source (read ref + write ref + cursor key).
    #[arg(long, value_name = "BRANCH")]
    pub branch: String,
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
