//! clair — the binary.
//!
//! Thin clap surface over `clair-core`: human commands (`ready`/`pair`/`with`),
//! the Claude Code hook adapters (`hook prompt`/`hook stop`), an MCP `serve` stub,
//! and a hidden `test-observe` asserter. The hook subcommands carry zero logic —
//! they only translate stdin/env <-> `HookCtx` <-> stdout JSON, so the Tier-2
//! harness exercises the same code path.
//!
//! This stage implements the human commands `ready`/`pair`/`with`. The hook
//! adapters and `test-observe` are wired as seams (clap parses them) and fleshed
//! out by later stages; `serve` is the deferred-MCP stub (exit 2, ADR 0003).

mod cli;
mod cmd;

use clap::Parser;

use cli::{Cli, Cmd, HookCmd};

fn main() {
    let cli = Cli::parse();
    let code = match &cli.cmd {
        Cmd::Ready(args) => cmd::ready::run(args),
        Cmd::Pair(args) => cmd::pair::run(args),
        Cmd::With(args) => cmd::with::run(args),
        Cmd::Hook(HookCmd::Prompt(args)) => cmd::hook::run_prompt(args),
        Cmd::Hook(HookCmd::Stop(args)) => cmd::hook::run_stop(args),
        Cmd::Serve => {
            eprintln!("MCP serve is a later slice");
            2
        }
        Cmd::TestObserve(args) => cmd::test_observe::run(args),
    };
    std::process::exit(code);
}
