//! The Claude Code hook adapters — pure stdin/env <-> `HookCtx` <-> stdout JSON.
//!
//! These subcommands carry **zero business logic** (open_risks "Adapter drift"):
//! they parse the Claude hook JSON from stdin, build a [`HookCtx`], call
//! `clair_core::hooks::*`, and serialise the outcome to the exact stdout contract.
//! The same `clair_core::hooks` functions back the Tier-2 harness, so what we test
//! is what runs.
//!
//! ## Self-sufficient by default
//! The bundled Claude Code plugin wires `clair hook prompt` / `clair hook stop`
//! with **no baked paths**. When `--repo-root` is absent the root is resolved from
//! `$CLAUDE_PROJECT_DIR` (set by Claude Code), falling back to the cwd; when
//! `--branch` is absent it is resolved from the current git checkout. Both flags
//! remain optional overrides (the Tier-3 harness still passes them).
//!
//! ## The single branch source
//! The resolved branch is the one source, within an invocation, for the read ref,
//! the write ref AND the cursor key (via [`FileCursorStore`]), so they cannot
//! desync — BRANCH-SCOPE by construction.
//!
//! ## Fail-open
//! The prompt hook is on the model's critical path. If git is slow/offline the
//! inbound read or the outbound push may fail; we never block the turn — on error
//! we emit `{}` (no injection) and exit 0. The Stop hook likewise always exits 0.

use std::io::Read;

use clair_core::cursor::CursorStore;
use clair_core::entry::{Author, Timestamp, TurnId};
use clair_core::hooks::{HookCtx, HookOutcome};
use clair_core::store::ShadowRef;
use clair_core::transcript::Transcript;
use clair_core::{Cursor, FileCursorStore, Repo};
use serde::{Deserialize, Serialize};

use crate::cli::HookArgs;
use crate::cmd::{now_rfc3339, repo_and_branch_for_hook, resolve_identity};

// --- stdin shapes (lenient: unknown fields ignored, everything Option) ----------

/// The `UserPromptSubmit` hook payload Claude writes to stdin.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct PromptInput {
    /// The session id — used as the turn id tying a prompt to its later summary.
    pub session_id: Option<String>,
    /// The prompt text the user submitted.
    pub prompt: Option<String>,
    /// The hook event name (informational; we don't branch on it).
    pub hook_event_name: Option<String>,
    /// The working directory Claude was invoked in (informational).
    pub cwd: Option<String>,
}

/// The `Stop` hook payload Claude writes to stdin.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct StopInput {
    /// The session id — used as the turn id.
    pub session_id: Option<String>,
    /// The path to the transcript JSONL, read for the final assistant reply.
    pub transcript_path: Option<String>,
    /// True when Claude is already inside a Stop-hook-triggered continuation;
    /// in that case we must write nothing (anti-recursion).
    pub stop_hook_active: Option<bool>,
    /// The hook event name (informational).
    pub hook_event_name: Option<String>,
}

// --- stdout shapes (the exact contract) -----------------------------------------

/// The full `UserPromptSubmit` hook response carrying `additionalContext`.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PromptOutput {
    #[serde(rename = "hookSpecificOutput")]
    hook_specific_output: PromptSpecific,
}

/// The `hookSpecificOutput` body for `UserPromptSubmit`.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PromptSpecific {
    #[serde(rename = "hookEventName")]
    hook_event_name: String,
    #[serde(rename = "additionalContext")]
    additional_context: String,
}

/// Serialise a prompt-hook outcome to the stdout contract.
///
/// When there is framed peer context, emit the full `hookSpecificOutput`;
/// otherwise emit the empty object `{}` (no injection). The pushed-entry id never
/// appears in stdout — it is internal bookkeeping.
pub fn render_prompt_stdout(outcome: &HookOutcome) -> String {
    let additional = match outcome {
        HookOutcome::Inject {
            additional_context: Some(ctx),
            ..
        } => Some(ctx.clone()),
        _ => None,
    };
    match additional {
        Some(ctx) => {
            let out = PromptOutput {
                hook_specific_output: PromptSpecific {
                    hook_event_name: "UserPromptSubmit".to_string(),
                    additional_context: ctx,
                },
            };
            serde_json::to_string(&out).unwrap_or_else(|_| "{}".to_string())
        }
        None => "{}".to_string(),
    }
}

/// The `Stop` hook always emits the empty object — it never injects.
pub fn render_stop_stdout() -> String {
    "{}".to_string()
}

// --- the adapters ---------------------------------------------------------------

/// `clair hook prompt`: read stdin, run the inbound+outbound logic, print stdout.
///
/// Always exits 0 (fail-open): a git/parse failure degrades to `{}` so the turn is
/// never blocked.
pub fn run_prompt(args: &HookArgs) -> i32 {
    let input: PromptInput = read_stdin_json().unwrap_or_default();
    let prompt = input.prompt.unwrap_or_default();
    let turn = TurnId::new(input.session_id.unwrap_or_default());

    match run_prompt_inner(args, &prompt, turn) {
        Ok(outcome) => {
            print!("{}", render_prompt_stdout(&outcome));
            0
        }
        Err(_) => {
            // Fail-open: never block the turn on a slow/offline remote.
            print!("{{}}");
            0
        }
    }
}

/// `clair hook stop`: read stdin, distil + push a summary, always print `{}`.
///
/// Honours `stop_hook_active` (anti-recursion: write nothing) and always exits 0.
pub fn run_stop(args: &HookArgs) -> i32 {
    let input: StopInput = read_stdin_json().unwrap_or_default();

    // Anti-recursion: if we're already inside a Stop continuation, do nothing.
    if input.stop_hook_active.unwrap_or(false) {
        print!("{}", render_stop_stdout());
        return 0;
    }

    let turn = TurnId::new(input.session_id.unwrap_or_default());
    let transcript = match input.transcript_path.as_deref() {
        Some(path) if !path.is_empty() => Transcript::read(path).unwrap_or_default(),
        _ => Transcript::default(),
    };

    // Fail-open on any error; Stop never blocks and always prints `{}`.
    let _ = run_stop_inner(args, &transcript, turn);
    print!("{}", render_stop_stdout());
    0
}

/// Build the shared pieces (repo, identity, cursor store) and run the prompt hook.
fn run_prompt_inner(args: &HookArgs, prompt: &str, turn: TurnId) -> clair_core::Result<HookOutcome> {
    let (repo, branch) =
        repo_and_branch_for_hook(args.repo_root.as_deref(), args.branch.as_deref(), &args.remote);
    let me = Author::new(resolve_identity(&repo));
    let shadow = ShadowRef::context(branch.clone());

    let mut cursor_store = cursor_store(&repo)?;
    let mut cursor = cursor_store.load(&shadow)?;

    let mut hc = HookCtx {
        backend: repo,
        author: me,
        branch,
        cursor: &mut cursor,
        now: Timestamp::new(now_rfc3339()),
        turn,
    };
    let outcome = hc.on_user_prompt_submit(prompt)?;

    // Persist the advanced cursor (local state only — never a clair branch).
    cursor_store.save(&shadow, &cursor)?;
    Ok(outcome)
}

/// Build the shared pieces and run the stop hook.
fn run_stop_inner(
    args: &HookArgs,
    transcript: &Transcript,
    turn: TurnId,
) -> clair_core::Result<HookOutcome> {
    let (repo, branch) =
        repo_and_branch_for_hook(args.repo_root.as_deref(), args.branch.as_deref(), &args.remote);
    let me = Author::new(resolve_identity(&repo));
    // Stop reads no peer entries, so the cursor is irrelevant; pass a throwaway.
    let mut cursor = Cursor::Start;

    let mut hc = HookCtx {
        backend: repo,
        author: me,
        branch,
        cursor: &mut cursor,
        now: Timestamp::new(now_rfc3339()),
        turn,
    };
    hc.on_stop(transcript)
}

/// The local cursor store, rooted at `<GIT_DIR>/clair` (same resolution `with`
/// uses for its shims/settings — worktree-correct).
fn cursor_store(repo: &Repo) -> clair_core::Result<FileCursorStore> {
    let git_dir = repo.git_dir()?;
    Ok(FileCursorStore::new(git_dir.join("clair")))
}

/// Read and parse stdin as JSON `T`. Returns `None` on empty/malformed input so
/// the caller can fall back to defaults (lenient parsing).
fn read_stdin_json<T: for<'de> Deserialize<'de>>(
) -> Option<T> {
    let mut buf = String::new();
    std::io::stdin().read_to_string(&mut buf).ok()?;
    let trimmed = buf.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str(trimmed).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use clair_core::entry::EntryId;

    #[test]
    fn parses_user_prompt_submit_input_leniently() {
        let json = r#"{
            "session_id": "abc123",
            "hook_event_name": "UserPromptSubmit",
            "prompt": "refactor the auth guard to use the new middleware",
            "cwd": "F:/dev/clair",
            "unknown_future_field": 42
        }"#;
        let input: PromptInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.session_id.as_deref(), Some("abc123"));
        assert_eq!(
            input.prompt.as_deref(),
            Some("refactor the auth guard to use the new middleware")
        );
    }

    #[test]
    fn parses_partial_prompt_input() {
        // Only the prompt present — everything else defaults to None.
        let input: PromptInput = serde_json::from_str(r#"{"prompt":"hi"}"#).unwrap();
        assert_eq!(input.prompt.as_deref(), Some("hi"));
        assert_eq!(input.session_id, None);
    }

    #[test]
    fn parses_stop_input_with_stop_hook_active() {
        let json = r#"{
            "session_id": "abc123",
            "hook_event_name": "Stop",
            "transcript_path": "/c/Users/x/abc123.jsonl",
            "stop_hook_active": true
        }"#;
        let input: StopInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.stop_hook_active, Some(true));
        assert_eq!(input.transcript_path.as_deref(), Some("/c/Users/x/abc123.jsonl"));
    }

    #[test]
    fn prompt_stdout_with_context_matches_the_contract() {
        let ctx = "── shared pair context (background — your AI won't act on this) ──\n\
↪ JB asked his AI: \"refactor the auth guard to use the new middleware\"\n\
─────────────────────────────────────────────────────────────────";
        let outcome = HookOutcome::Inject {
            additional_context: Some(ctx.to_string()),
            pushed: Some(EntryId::now()),
        };
        let stdout = render_prompt_stdout(&outcome);

        // Parse the emitted JSON and assert the exact contract shape + bytes.
        let v: serde_json::Value = serde_json::from_str(&stdout).unwrap();
        assert_eq!(
            v["hookSpecificOutput"]["hookEventName"],
            serde_json::json!("UserPromptSubmit")
        );
        assert_eq!(
            v["hookSpecificOutput"]["additionalContext"],
            serde_json::json!(ctx)
        );
        // Only the one key.
        assert_eq!(v.as_object().unwrap().len(), 1);
    }

    #[test]
    fn prompt_stdout_without_context_is_empty_object() {
        let outcome = HookOutcome::Inject {
            additional_context: None,
            pushed: Some(EntryId::now()),
        };
        assert_eq!(render_prompt_stdout(&outcome), "{}");
    }

    #[test]
    fn prompt_stdout_for_noop_is_empty_object() {
        assert_eq!(render_prompt_stdout(&HookOutcome::Noop), "{}");
    }

    #[test]
    fn stop_stdout_is_always_empty_object() {
        assert_eq!(render_stop_stdout(), "{}");
    }

    /// The exact `additionalContext` from the hook contract round-trips: the
    /// emitted JSON, when re-parsed, yields back the framing string byte-for-byte
    /// (escaping of quotes/newlines is handled by serde, not by hand).
    #[test]
    fn additional_context_survives_json_escaping_roundtrip() {
        let ctx = clair_core::render::render_inbound(&[clair_core::entry::Entry {
            id: EntryId::now(),
            author: Author::new("JB"),
            kind: clair_core::entry::Kind::Summary,
            text: "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case.".into(),
            ts: Timestamp::new("2026-06-25T10:00:00Z"),
            turn: TurnId::new("t"),
        }])
        .unwrap();

        let outcome = HookOutcome::Inject {
            additional_context: Some(ctx.clone()),
            pushed: None,
        };
        let stdout = render_prompt_stdout(&outcome);
        let v: serde_json::Value = serde_json::from_str(&stdout).unwrap();
        assert_eq!(
            v["hookSpecificOutput"]["additionalContext"].as_str().unwrap(),
            ctx
        );
    }
}
