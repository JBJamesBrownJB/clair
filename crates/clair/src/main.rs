//! clair — the binary.
//!
//! Thin clap surface over `clair-core`: human commands (`ready`/`pair`/`with`),
//! the Claude Code hook adapters (`hook prompt`/`hook stop`), the MCP `serve`
//! server, and a hidden `test-observe` asserter. The hook subcommands carry zero
//! logic — they only translate stdin/env <-> `HookCtx` <-> stdout JSON, so the
//! Tier-2 harness exercises the same code path.
//!
//! The handshake operations live once in [`handshake`]; both the CLI subcommands
//! ([`cmd`]) and the MCP tools ([`serve`]) call that single implementation (ADR
//! 0003 — dual MCP + Skill surface).

mod cli;
mod cmd;
mod handshake;
mod serve;

use clap::Parser;

use cli::{Cli, Cmd, HookCmd, PairArgs};

fn main() {
    let cli = Cli::parse();
    let code = match &cli.cmd {
        // Bare `clair` (no subcommand): run the discovery listing, plus a hint.
        None => cmd::pair::run_bare(&PairArgs::default()),
        Some(Cmd::Init(args)) => cmd::init::run(args),
        Some(Cmd::Ready(args)) => cmd::ready::run(args),
        Some(Cmd::Pair(args)) => cmd::pair::run(args),
        Some(Cmd::With(args)) => cmd::with::run(args),
        Some(Cmd::Hook(HookCmd::Prompt(args))) => cmd::hook::run_prompt(args),
        Some(Cmd::Hook(HookCmd::Stop(args))) => cmd::hook::run_stop(args),
        Some(Cmd::Serve) => serve::run(),
        Some(Cmd::TestObserve(args)) => cmd::test_observe::run(args),
    };
    std::process::exit(code);
}
