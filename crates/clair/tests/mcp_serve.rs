//! MCP-protocol smoke test for `clair serve`.
//!
//! Spawns the REAL compiled `clair serve` as a stdio MCP server and drives the
//! JSON-RPC handshake by hand (line-delimited JSON, the MCP stdio framing):
//!   1. `initialize`            → assert a JSON-RPC result with serverInfo,
//!   2. `notifications/initialized`,
//!   3. `tools/list`            → assert init/ready/pair/with/status are present,
//!   4. `tools/call` `init`     → assert a non-error result AND that the alias was
//!                                persisted to the temp repo's `clair.alias`.
//!
//! This exercises the same `clair serve` binary the plugin launches via `.mcp.json`.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command as StdCommand, Stdio};

use assert_cmd::prelude::*;

/// Run a raw git command in `dir`, asserting success.
fn git(dir: &Path, args: &[&str]) {
    let out = StdCommand::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git invocation");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// A minimal git repo (the user's "project dir") with a deterministic local config.
fn temp_repo() -> tempfile::TempDir {
    let dir = tempfile::TempDir::new().unwrap();
    git(dir.path(), &["init", "-b", "main"]);
    git(dir.path(), &["config", "user.email", "smoke@clair.dev"]);
    git(dir.path(), &["config", "user.name", "smoke"]);
    git(dir.path(), &["config", "core.autocrlf", "false"]);
    dir
}

/// Read clair's persisted alias from `<GIT_DIR>/clair/alias` (trimmed; empty if
/// unset). The alias lives in clair's own file — never git config.
fn read_alias(dir: &Path) -> String {
    let out = StdCommand::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "--git-dir"])
        .output()
        .expect("git rev-parse --git-dir");
    let git_dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let base = if Path::new(&git_dir).is_absolute() {
        std::path::PathBuf::from(&git_dir)
    } else {
        dir.join(&git_dir)
    };
    std::fs::read_to_string(base.join("clair").join("alias"))
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// A line-delimited JSON-RPC client over the server's stdin/stdout.
struct Rpc {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Rpc {
    fn spawn(project_dir: &Path) -> Rpc {
        let mut cmd = StdCommand::cargo_bin("clair").unwrap();
        cmd.arg("serve")
            .env("CLAIR_PROJECT_DIR", project_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().expect("spawn clair serve");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Rpc { child, stdin, stdout }
    }

    /// Send one JSON-RPC message (object), newline-terminated.
    fn send(&mut self, msg: &serde_json::Value) {
        let line = serde_json::to_string(msg).unwrap();
        self.stdin.write_all(line.as_bytes()).unwrap();
        self.stdin.write_all(b"\n").unwrap();
        self.stdin.flush().unwrap();
    }

    /// Read response lines until one carries the expected JSON-RPC id.
    fn read_result(&mut self, id: i64) -> serde_json::Value {
        for _ in 0..50 {
            let mut line = String::new();
            let n = self.stdout.read_line(&mut line).expect("read line");
            assert!(n > 0, "server closed stdout before id={id} response");
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let v: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue, // skip any non-JSON noise
            };
            if v.get("id").and_then(|i| i.as_i64()) == Some(id) {
                return v;
            }
            // Otherwise it was a notification/other message — keep reading.
        }
        panic!("no JSON-RPC response with id={id}");
    }

    fn shutdown(mut self) {
        // Close stdin so the server sees EOF and exits.
        drop(self.stdin);
        let _ = self.child.wait();
    }
}

#[test]
fn serve_speaks_mcp_lists_tools_and_calls_init() {
    let repo = temp_repo();
    let mut rpc = Rpc::spawn(repo.path());

    // 1. initialize.
    rpc.send(&serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": { "name": "clair-smoke", "version": "0" }
        }
    }));
    let init = rpc.read_result(1);
    let result = init.get("result").expect("initialize result");
    assert!(
        result.get("serverInfo").is_some(),
        "initialize result carries serverInfo: {init}"
    );
    assert!(
        result.get("capabilities").and_then(|c| c.get("tools")).is_some(),
        "server advertises tools capability: {init}"
    );

    // 2. initialized notification (no response expected).
    rpc.send(&serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    }));

    // 3. tools/list.
    rpc.send(&serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list"
    }));
    let listed = rpc.read_result(2);
    let tools = listed["result"]["tools"]
        .as_array()
        .expect("tools array");
    let names: Vec<String> = tools
        .iter()
        .filter_map(|t| t["name"].as_str().map(|s| s.to_string()))
        .collect();
    for expected in ["init", "ready", "pair", "with", "status"] {
        assert!(
            names.iter().any(|n| n == expected),
            "tools/list must include '{expected}'; got {names:?}"
        );
    }

    // 4. tools/call init { alias: "SmokeBot" }.
    rpc.send(&serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "init",
            "arguments": { "alias": "SmokeBot" }
        }
    }));
    let called = rpc.read_result(3);
    let call_result = called.get("result").expect("tools/call result");
    // Not an error result.
    assert_ne!(
        call_result.get("isError").and_then(|b| b.as_bool()),
        Some(true),
        "init tool call should succeed: {called}"
    );
    // The human text mentions the new alias.
    let text = call_result["content"][0]["text"].as_str().unwrap_or("");
    assert!(
        text.contains("SmokeBot"),
        "init result text mentions the alias: {text:?}"
    );

    rpc.shutdown();

    // The alias was actually persisted to clair's own file (<GIT_DIR>/clair/alias),
    // not the user's git config.
    assert_eq!(
        read_alias(repo.path()),
        "SmokeBot",
        "init tool persisted the alias to <GIT_DIR>/clair/alias"
    );
}
