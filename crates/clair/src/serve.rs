//! `clair serve` — the MCP stdio server (ADR 0003's programmatic surface).
//!
//! This is the typed-tool counterpart to the slash commands: instead of shelling
//! out to the CLI, a harness drives clair's handshake through MCP tools
//! (`mcp__clair__init`, `…__ready`, `…__pair`, `…__with`, `…__status`). Each tool is
//! a thin wrapper that resolves the repo + branch and calls the SAME
//! [`crate::handshake`] functions the CLI subcommands use — one implementation, two
//! surfaces.
//!
//! ## Repo resolution
//! The plugin launches this server once per session via `.mcp.json`, passing
//! `CLAIR_PROJECT_DIR` (the user's project root). The process cwd does NOT follow
//! the user if they `cd` mid-session, so we resolve the repo root from
//! `CLAIR_PROJECT_DIR` (falling back to the cwd) and re-read the branch from git
//! HEAD on every call.
//!
//! Built on the official Rust MCP SDK, `rmcp` (1.x): the `#[tool_router]` /
//! `#[tool]` / `#[tool_handler]` macros generate `list_tools` + `call_tool`, and we
//! serve over the stdio transport.

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, Content, ServerCapabilities, ServerInfo};
use rmcp::transport::stdio;
use rmcp::{schemars, tool, tool_handler, tool_router, ServerHandler, ServiceExt};
use serde::Deserialize;

use clair_core::Repo;

use crate::handshake::{self, HandshakeError};

/// The clair MCP server. Holds the resolved project root; each tool re-opens the
/// [`Repo`] and re-reads the branch so a mid-session branch switch is reflected.
#[derive(Clone)]
pub struct ClairServer {
    /// The user's project root (from `CLAIR_PROJECT_DIR`, else the cwd).
    root: String,
    // Read by the generated `#[tool_handler]` impl; the lint can't see through the macro.
    #[allow(dead_code)]
    tool_router: ToolRouter<ClairServer>,
}

/// Arguments for the `init` tool.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct InitParams {
    /// The alias to adopt as your clair identity in this repo (e.g. "JB", "Rajiv").
    pub alias: String,
}

/// Arguments for the `with` tool.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct WithParams {
    /// The handle / alias of the ready peer to pair with (case-insensitive).
    pub name: String,
    /// Optional: act as this alias for the session (translate a trailing
    /// "as <alias>" to `as_alias`). Sets AND persists your identity.
    #[serde(default)]
    pub as_alias: Option<String>,
}

#[tool_router]
impl ClairServer {
    /// Build a server rooted at `root` (the resolved project directory).
    pub fn new(root: String) -> Self {
        Self {
            root,
            tool_router: Self::tool_router(),
        }
    }

    /// Open the repo at the resolved root, on the `origin` remote.
    fn repo(&self) -> Repo {
        Repo::open(self.root.clone()).with_remote("origin".to_string())
    }

    #[tool(
        name = "init",
        description = "Set and persist your clair alias (identity) for this repo, e.g. \
                       'init JB'. The alias is what your pair sees as the author of \
                       shared prompts and conclusions. Use when the user wants to \
                       choose, set, or change their clair name/alias/identity."
    )]
    async fn init(&self, Parameters(args): Parameters<InitParams>) -> CallToolResult {
        let repo = self.repo();
        match handshake::init(&repo, &args.alias) {
            Ok(o) => ok(format!("You are now '{}' in this repo.", o.alias)),
            Err(e) => err(e),
        }
    }

    #[tool(
        name = "ready",
        description = "Announce that you are available to pair on your current branch \
                       (writes to the clair/ready registry). Use when the user wants to \
                       go ready, become available, or let teammates know they can pair."
    )]
    async fn ready(&self) -> CallToolResult {
        let repo = self.repo();
        match handshake::ready(&repo, None) {
            Ok(r) => ok(format!(
                "You're available to pair · repo: {} · branch: {}",
                r.repo, r.branch
            )),
            Err(e) => err(e),
        }
    }

    #[tool(
        name = "pair",
        description = "List everyone currently ready to pair in this repo, with the \
                       branch each is on (excludes you). Use when the user asks who is \
                       available/ready to pair, or wants to see who they can pair with."
    )]
    async fn pair(&self) -> CallToolResult {
        let repo = self.repo();
        match handshake::pair(&repo, None) {
            Ok(p) if p.peers.is_empty() => {
                ok(format!("No one is ready to pair on {} yet.", p.repo))
            }
            Ok(p) => {
                let mut lines = vec![format!("People ready to pair on {}:", p.repo)];
                for peer in &p.peers {
                    lines.push(format!("  • {} → {}", peer.user, peer.branch));
                }
                if let Some(first) = p.peers.first() {
                    lines.push(format!(
                        "Join with the `with` tool, e.g. with name={}",
                        first.user.to_ascii_lowercase()
                    ));
                }
                ok(lines.join("\n"))
            }
            Err(e) => err(e),
        }
    }

    #[tool(
        name = "with",
        description = "Pair with a ready teammate: resolve their handle, fetch and check \
                       out their branch, and signal that you joined. Stops without moving \
                       your work if the tree is dirty. Use for 'pair with <name>', 'join \
                       <name>', 'pair with <name> as <alias>'. Pass name=<handle> and, \
                       for 'as <alias>', as_alias=<alias>."
    )]
    async fn with(&self, Parameters(args): Parameters<WithParams>) -> CallToolResult {
        let repo = self.repo();
        match handshake::with(&repo, &args.name, args.as_alias.as_deref()) {
            Ok(r) => {
                let mut msg = format!(
                    "🤝 Pairing with {} on {}. Ephemeral — nothing is logged permanently.",
                    r.paired_with, r.branch
                );
                if let Some(w) = r.warning {
                    msg.push_str(&format!("\n(warning: {w})"));
                }
                ok(msg)
            }
            Err(HandshakeError::NoAlias) => err_text(
                "No clair alias is set. Ask the user which alias to use, then call `with` \
                 again passing as_alias=<their answer> (or have them run `init <alias>`).",
            ),
            Err(e) => err(e),
        }
    }

    #[tool(
        name = "status",
        description = "Show your current clair state: your alias (if set), the repo and \
                       branch, and how many peers are ready to pair. Use when the user \
                       asks about their clair status, identity, or pairing state."
    )]
    async fn status(&self) -> CallToolResult {
        let repo = self.repo();
        let s = handshake::status(&repo);
        let alias = s.alias.unwrap_or_else(|| "(none set — run init)".to_string());
        let repo_s = s.repo.unwrap_or_else(|| "(unknown)".to_string());
        let branch = s.branch.unwrap_or_else(|| "(unknown)".to_string());
        ok(format!(
            "alias: {alias}\nrepo: {repo_s}\nbranch: {branch}\npeers ready: {}",
            s.peers_ready
        ))
    }
}

#[tool_handler]
impl ServerHandler for ClairServer {
    fn get_info(&self) -> ServerInfo {
        // ServerInfo is #[non_exhaustive]: build from Default, then set our fields.
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.instructions = Some(
            "clair — pair with a teammate through your AI harness, over git. Tools: \
             init (set your alias), ready (announce availability), pair (list ready \
             peers), with (join a peer's branch), status. Natural language like \
             'pair with rajiv' should map to the `with` tool."
                .to_string(),
        );
        info
    }
}

/// Render a success tool result from a human-readable line.
fn ok(text: impl Into<String>) -> CallToolResult {
    CallToolResult::success(vec![Content::text(text.into())])
}

/// Render an error tool result (is_error) carrying clair's guidance line.
fn err(e: HandshakeError) -> CallToolResult {
    err_text(format!("clair: {}", e.message()))
}

/// Render an error tool result from arbitrary text.
fn err_text(text: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![Content::text(text.into())])
}

/// Resolve the project root for the server: `CLAIR_PROJECT_DIR`, else the cwd.
fn resolve_serve_root() -> String {
    std::env::var("CLAIR_PROJECT_DIR")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| ".".to_string())
}

/// Run the MCP stdio server until the client disconnects. Returns the exit code.
pub fn run() -> i32 {
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("clair serve: could not start async runtime: {e}");
            return 1;
        }
    };
    rt.block_on(serve_async())
}

async fn serve_async() -> i32 {
    let root = resolve_serve_root();
    let server = ClairServer::new(root);
    match server.serve(stdio()).await {
        Ok(running) => {
            if let Err(e) = running.waiting().await {
                eprintln!("clair serve: server exited with error: {e}");
                return 1;
            }
            0
        }
        Err(e) => {
            eprintln!("clair serve: failed to initialize MCP server: {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serve_root_prefers_env_then_cwd() {
        // We can't safely mutate process env in parallel tests; assert the fallback.
        // (The env path is covered by the integration smoke that sets CLAIR_PROJECT_DIR.)
        std::env::remove_var("CLAIR_PROJECT_DIR");
        assert_eq!(resolve_serve_root(), ".");
    }

    #[test]
    fn server_constructs_with_tools() {
        // Constructing the router proves the tool macros expanded and registered.
        let s = ClairServer::new(".".to_string());
        assert!(s.get_info().capabilities.tools.is_some());
    }
}
