//! `clair test-observe` — the hidden Tier-3 stream-json asserter.
//!
//! The Tier-3 e2e (`tests/e2e/run.sh`) drives two real `claude -p` sessions and
//! observes them with `--output-format stream-json --include-hook-events
//! --verbose`. Every line is one JSON object (NDJSON). This asserter parses that
//! stream with `serde_json` — **never `jq`**, which is not on PATH on the
//! reference box (open_risks "jq is NOT on PATH"). Any `jq` in the e2e would
//! silently break it; routing all parsing here keeps the e2e honest.
//!
//! ## What the stream looks like (verified on Claude Code 2.1.x)
//! - Hook events surface as `system` events with `subtype` `hook_started` /
//!   `hook_response`, carrying `hook_name`, `hook_event` and `output` — where
//!   `output` is the JSON the hook printed to stdout (so clair's
//!   `hookSpecificOutput.additionalContext` rides inside `output`).
//! - The model's tool calls appear as `tool_use` content blocks inside
//!   `assistant` events (`{"type":"tool_use","name":"Edit",...}`).
//! - The final answer text appears in `assistant` / `result` events.
//!
//! We parse leniently: the exact nesting of hook output has shifted across CC
//! versions, so we scan each line's JSON recursively for the relevant keys
//! (`additionalContext`, `tool_use`/`name`, result text) rather than pinning one
//! path. This tolerates both top-level and `hookSpecificOutput`-nested shapes
//! until the wire format is re-probed live.
//!
//! ## Modes
//! - `assert-additional-context <substr>` — at least one hook event injected
//!   `additionalContext` containing `<substr>`. Exit 0 on match, non-zero + a
//!   diff on miss.
//! - `assert-no-tool <ToolName>` — no `tool_use` block named `<ToolName>` appears
//!   (the passivity check: the recipient's AI must not act on injected
//!   background). Exit 0 when absent, non-zero when present.
//! - `assert-result <substr>` — the final result/assistant text contains
//!   `<substr>`.
//! - `hook-events` — diagnostic: print the `additionalContext` of every hook
//!   event seen (always exit 0); used to debug a failing run.
//! - `session-id` — print the first `session_id` seen on stdout (diagnostic).

use std::io::Read;

use serde_json::Value;

use crate::cli::TestObserveArgs;

/// Exit code for an assertion miss (non-zero, distinct from clap/usage errors).
const EXIT_ASSERT_FAILED: i32 = 1;
/// Exit code for a usage problem (unknown mode, missing argument).
const EXIT_USAGE: i32 = 64;

/// Entry point: read the whole NDJSON stream from stdin and dispatch on the mode.
pub fn run(args: &TestObserveArgs) -> i32 {
    let mut buf = String::new();
    if std::io::stdin().read_to_string(&mut buf).is_err() {
        eprintln!("clair test-observe: failed to read stdin");
        return EXIT_USAGE;
    }
    run_on(&args.mode, args.arg.as_deref(), &buf)
}

/// The testable core: dispatch a mode over an already-read NDJSON string.
pub fn run_on(mode: &str, arg: Option<&str>, stream: &str) -> i32 {
    let lines = parse_ndjson(stream);
    match mode {
        "assert-additional-context" => {
            let needle = match require_arg(mode, arg) {
                Ok(n) => n,
                Err(code) => return code,
            };
            let contexts = additional_contexts(&lines);
            if contexts.iter().any(|c| c.contains(needle)) {
                eprintln!(
                    "clair test-observe: OK — additionalContext contains {needle:?} \
                     ({} hook context(s) seen)",
                    contexts.len()
                );
                0
            } else {
                eprintln!(
                    "clair test-observe: FAIL — no hook additionalContext contained {needle:?}"
                );
                eprintln!("  hook contexts seen: {}", contexts.len());
                for (i, c) in contexts.iter().enumerate() {
                    eprintln!("  [{i}] {}", truncate(c, 400));
                }
                EXIT_ASSERT_FAILED
            }
        }
        "assert-no-tool" => {
            let tool = match require_arg(mode, arg) {
                Ok(t) => t,
                Err(code) => return code,
            };
            let used = tool_uses(&lines);
            if used.iter().any(|t| t == tool) {
                eprintln!(
                    "clair test-observe: FAIL — tool {tool:?} WAS used (passivity violated)"
                );
                eprintln!("  tools seen: {used:?}");
                EXIT_ASSERT_FAILED
            } else {
                eprintln!(
                    "clair test-observe: OK — tool {tool:?} not used ({} tool_use block(s) seen)",
                    used.len()
                );
                0
            }
        }
        "assert-result" => {
            let needle = match require_arg(mode, arg) {
                Ok(n) => n,
                Err(code) => return code,
            };
            let text = result_text(&lines);
            if text.contains(needle) {
                eprintln!("clair test-observe: OK — result text contains {needle:?}");
                0
            } else {
                eprintln!("clair test-observe: FAIL — result text lacked {needle:?}");
                eprintln!("  result text: {}", truncate(&text, 600));
                EXIT_ASSERT_FAILED
            }
        }
        "hook-events" => {
            let contexts = additional_contexts(&lines);
            for (i, c) in contexts.iter().enumerate() {
                println!("--- hook additionalContext [{i}] ---");
                println!("{c}");
            }
            eprintln!(
                "clair test-observe: {} hook additionalContext block(s)",
                contexts.len()
            );
            0
        }
        "session-id" => {
            match first_session_id(&lines) {
                Some(id) => {
                    println!("{id}");
                    0
                }
                None => {
                    eprintln!("clair test-observe: no session_id found in stream");
                    EXIT_ASSERT_FAILED
                }
            }
        }
        other => {
            eprintln!("clair test-observe: unknown mode {other:?}");
            eprintln!(
                "  modes: assert-additional-context | assert-no-tool | assert-result | \
                 hook-events | session-id"
            );
            EXIT_USAGE
        }
    }
}

/// Require a mode argument, emitting a usage error (exit 64) if it is missing.
fn require_arg<'a>(mode: &str, arg: Option<&'a str>) -> Result<&'a str, i32> {
    match arg {
        Some(a) => Ok(a),
        None => {
            eprintln!("clair test-observe: mode {mode:?} needs an argument");
            Err(EXIT_USAGE)
        }
    }
}

/// Parse the NDJSON stream into one `Value` per non-blank, parseable line.
///
/// Lines that are not valid JSON (e.g. a stray log line) are skipped, never fatal
/// — the same lenient posture the hooks take.
fn parse_ndjson(stream: &str) -> Vec<Value> {
    stream
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect()
}

/// Collect every `additionalContext` string reachable in any line.
///
/// Scans recursively so we catch both the top-level shape and the
/// `hookSpecificOutput`-nested shape, and the `output`-wrapped hook-event shape,
/// without pinning one path across CC versions.
fn additional_contexts(lines: &[Value]) -> Vec<String> {
    let mut out = Vec::new();
    for v in lines {
        collect_additional_context(v, &mut out);
    }
    out
}

/// Recursively gather `additionalContext` string values from a JSON value.
///
/// `output` may itself be a JSON-encoded string (the hook printed JSON to
/// stdout, captured verbatim); we parse such strings and recurse into them too.
fn collect_additional_context(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(map) => {
            for (k, child) in map {
                if k == "additionalContext" {
                    if let Some(s) = child.as_str() {
                        out.push(s.to_string());
                    }
                }
                // The hook's stdout is sometimes carried as a JSON string in
                // `output`; parse and recurse so nested additionalContext is found.
                if let Some(s) = child.as_str() {
                    if let Ok(parsed) = serde_json::from_str::<Value>(s) {
                        collect_additional_context(&parsed, out);
                    }
                }
                collect_additional_context(child, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_additional_context(item, out);
            }
        }
        _ => {}
    }
}

/// Collect the `name` of every `tool_use` content block in any line.
fn tool_uses(lines: &[Value]) -> Vec<String> {
    let mut out = Vec::new();
    for v in lines {
        collect_tool_uses(v, &mut out);
    }
    out
}

/// Recursively gather tool_use names. A block is a tool use when it has
/// `"type":"tool_use"` and a `name`.
fn collect_tool_uses(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("tool_use") {
                if let Some(name) = map.get("name").and_then(Value::as_str) {
                    out.push(name.to_string());
                }
            }
            for child in map.values() {
                collect_tool_uses(child, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_tool_uses(item, out);
            }
        }
        _ => {}
    }
}

/// Concatenate the visible text of `result` and `assistant` text blocks.
fn result_text(lines: &[Value]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for v in lines {
        let ty = v.get("type").and_then(Value::as_str);
        // A top-level `result` field (the final result event).
        if ty == Some("result") {
            if let Some(s) = v.get("result").and_then(Value::as_str) {
                parts.push(s.to_string());
            }
        }
        // Assistant message text content blocks.
        if ty == Some("assistant") {
            collect_text_blocks(v, &mut parts);
        }
    }
    parts.join("\n")
}

/// Recursively gather `text` from `{"type":"text","text":...}` blocks.
fn collect_text_blocks(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(t) = map.get("text").and_then(Value::as_str) {
                    out.push(t.to_string());
                }
            }
            for child in map.values() {
                collect_text_blocks(child, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text_blocks(item, out);
            }
        }
        _ => {}
    }
}

/// Find the first `session_id` anywhere in the stream.
fn first_session_id(lines: &[Value]) -> Option<String> {
    for v in lines {
        if let Some(id) = find_string_key(v, "session_id") {
            return Some(id);
        }
    }
    None
}

/// Recursively find the first string value for `key`.
fn find_string_key(v: &Value, key: &str) -> Option<String> {
    match v {
        Value::Object(map) => {
            if let Some(s) = map.get(key).and_then(Value::as_str) {
                return Some(s.to_string());
            }
            for child in map.values() {
                if let Some(found) = find_string_key(child, key) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => {
            for item in items {
                if let Some(found) = find_string_key(item, key) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

/// Truncate a string to `max` chars at a char boundary, appending an ellipsis.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A realistic hook_response system event carrying clair's stdout in `output`
    /// as a JSON-encoded string (the shape we expect from --include-hook-events).
    fn hook_response_line(additional_context: &str) -> String {
        let inner = serde_json::json!({
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": additional_context,
            }
        });
        let line = serde_json::json!({
            "type": "system",
            "subtype": "hook_response",
            "hook_name": "UserPromptSubmit",
            "hook_event": "UserPromptSubmit",
            // output is the hook's stdout, captured as a JSON-encoded STRING.
            "output": serde_json::to_string(&inner).unwrap(),
        });
        serde_json::to_string(&line).unwrap()
    }

    /// The same, but with `output` as a nested OBJECT rather than a string,
    /// covering the alternate nesting we tolerate.
    fn hook_response_line_object(additional_context: &str) -> String {
        let line = serde_json::json!({
            "type": "system",
            "subtype": "hook_response",
            "output": {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": additional_context,
                }
            }
        });
        serde_json::to_string(&line).unwrap()
    }

    fn assistant_tool_use_line(tool: &str) -> String {
        let line = serde_json::json!({
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    { "type": "tool_use", "name": tool, "input": {} }
                ]
            }
        });
        serde_json::to_string(&line).unwrap()
    }

    fn assistant_text_line(text: &str) -> String {
        let line = serde_json::json!({
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [ { "type": "text", "text": text } ]
            }
        });
        serde_json::to_string(&line).unwrap()
    }

    #[test]
    fn additional_context_found_when_output_is_json_string() {
        let stream = hook_response_line(
            "── shared pair context ──\n↪ JB asked his AI: \"refactor the auth guard\"",
        );
        assert_eq!(
            run_on("assert-additional-context", Some("refactor the auth guard"), &stream),
            0
        );
    }

    #[test]
    fn additional_context_found_when_output_is_object() {
        let stream = hook_response_line_object("↪ JB asked his AI: \"refactor the auth guard\"");
        assert_eq!(
            run_on("assert-additional-context", Some("auth guard"), &stream),
            0
        );
    }

    #[test]
    fn additional_context_missing_fails() {
        let stream = hook_response_line("↪ JB asked his AI: \"something else entirely\"");
        assert_eq!(
            run_on("assert-additional-context", Some("not present"), &stream),
            EXIT_ASSERT_FAILED
        );
    }

    #[test]
    fn assert_no_tool_passes_when_tool_absent() {
        let stream = format!(
            "{}\n{}",
            hook_response_line("↪ JB asked his AI: \"refactor\""),
            assistant_text_line("I will not act on the background context.")
        );
        assert_eq!(run_on("assert-no-tool", Some("Edit"), &stream), 0);
    }

    #[test]
    fn assert_no_tool_fails_when_tool_present() {
        let stream = format!(
            "{}\n{}",
            assistant_tool_use_line("Edit"),
            assistant_text_line("done")
        );
        assert_eq!(
            run_on("assert-no-tool", Some("Edit"), &stream),
            EXIT_ASSERT_FAILED
        );
    }

    #[test]
    fn assert_no_tool_ignores_other_tools() {
        // A Read happened, but we assert no Edit — should pass.
        let stream = assistant_tool_use_line("Read");
        assert_eq!(run_on("assert-no-tool", Some("Edit"), &stream), 0);
    }

    #[test]
    fn assert_result_matches_assistant_text() {
        let stream = assistant_text_line("Moved the guard into AuthMiddleware.");
        assert_eq!(run_on("assert-result", Some("AuthMiddleware"), &stream), 0);
    }

    #[test]
    fn assert_result_matches_result_event() {
        let line = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "result": "Done. Guard now in AuthMiddleware.",
        });
        let stream = serde_json::to_string(&line).unwrap();
        assert_eq!(run_on("assert-result", Some("Guard now in"), &stream), 0);
    }

    #[test]
    fn malformed_lines_are_skipped_not_fatal() {
        let stream = format!(
            "this is not json\n{}\n   \n<garbage/>",
            hook_response_line("↪ JB asked his AI: \"hello\"")
        );
        assert_eq!(run_on("assert-additional-context", Some("hello"), &stream), 0);
    }

    #[test]
    fn missing_argument_is_usage_error() {
        assert_eq!(run_on("assert-additional-context", None, ""), EXIT_USAGE);
    }

    #[test]
    fn unknown_mode_is_usage_error() {
        assert_eq!(run_on("frobnicate", Some("x"), ""), EXIT_USAGE);
    }

    #[test]
    fn session_id_extracted() {
        let line = serde_json::json!({
            "type": "system",
            "subtype": "init",
            "session_id": "11111111-2222-7333-8444-555555555555",
        });
        let stream = serde_json::to_string(&line).unwrap();
        assert_eq!(run_on("session-id", None, &stream), 0);
    }

    #[test]
    fn session_id_missing_fails() {
        assert_eq!(run_on("session-id", None, "{}"), EXIT_ASSERT_FAILED);
    }

    #[test]
    fn hook_events_diagnostic_always_succeeds() {
        let stream = hook_response_line("anything");
        assert_eq!(run_on("hook-events", None, &stream), 0);
    }
}
