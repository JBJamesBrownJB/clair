//! Extracting the turn summary for the `Stop` hook — with no nested LLM call.
//!
//! Per the slice spec (§3, §8 item 2, §1a ②) the Skill asks Claude to emit a
//! one-paragraph shared summary as the last step of each turn, and the `Stop`
//! hook *captures* it from the transcript. There is no second model call here.
//!
//! ## What we read
//! The Claude Code transcript is JSONL: one record per line. We care only about
//! `assistant` records, whose `message.content` is an array of blocks; a text
//! block is `{ "type": "text", "text": "…" }`. [`Transcript::from_jsonl`] parses
//! leniently — unknown fields are ignored, malformed lines are skipped — and
//! [`Transcript::last_assistant_text`] returns the concatenated text of the
//! final assistant message.
//!
//! ## How we distil ([`distil`])
//! Newlines are normalised first, then the first match wins (each capped to
//! [`MAX_SUMMARY_LINES`] lines and [`MAX_SUMMARY_CHARS`] chars):
//! 1. **OPTIONAL sentinel:** if the reply contains a `CLAIR-SUMMARY:` line, the
//!    text after it (to the next blank line) wins, line structure preserved so a
//!    bulleted sentinel survives as bullets. SKILL.md declares the exact spelling.
//! 2. **Trailing list:** if the reply *ends* in a list, the whole trailing run of
//!    list items is kept — so a multi-point conclusion shares every point, not
//!    just the last. (A reply ending in prose skips this.)
//! 3. **Final paragraph (spec-as-written):** the last blank-line-separated block,
//!    surfacing as `✓ …'s AI concluded: "…"`.
//! 4. **Fallback:** if nothing usable remains, truncate the whole reply to
//!    [`MAX_SUMMARY_CHARS`] on a char boundary.

use serde::Deserialize;

use crate::error::{CoreError, Result};

/// The sentinel a Skill may emit to override the paragraph heuristic. Declared
/// here so SKILL.md and the parser agree on one exact spelling.
pub const SENTINEL: &str = "CLAIR-SUMMARY:";

/// The cap on a distilled summary's length (chars). A short delta, not a recap.
pub const MAX_SUMMARY_CHARS: usize = 600;

/// The cap on a distilled summary's *lines* — bounds a multi-point conclusion so
/// it stays a delta. Lines past this are dropped and replaced by a single `…`.
pub const MAX_SUMMARY_LINES: usize = 6;

/// A parsed Claude Code transcript: the assistant messages in order.
#[derive(Debug, Clone, Default)]
pub struct Transcript {
    /// The text of each assistant message, oldest first.
    assistant_texts: Vec<String>,
}

/// One transcript record (lenient: every field optional, unknowns ignored).
#[derive(Debug, Deserialize)]
struct Record {
    #[serde(rename = "type")]
    kind: Option<String>,
    message: Option<Message>,
}

/// A message inside a record.
#[derive(Debug, Deserialize)]
struct Message {
    role: Option<String>,
    /// Either a plain string or an array of content blocks (both seen in the wild).
    content: Option<Content>,
}

/// Message content: a bare string, or an array of typed blocks.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Content {
    /// `"content": "plain text"`.
    Text(String),
    /// `"content": [ { "type": "text", "text": "…" }, … ]`.
    Blocks(Vec<Block>),
}

/// One content block.
#[derive(Debug, Deserialize)]
struct Block {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
}

impl Content {
    /// Flatten this content to its text (joining text blocks, ignoring non-text).
    fn into_text(self) -> String {
        match self {
            Content::Text(s) => s,
            Content::Blocks(blocks) => {
                let parts: Vec<String> = blocks
                    .into_iter()
                    .filter(|b| b.kind.as_deref().map(|k| k == "text").unwrap_or(true))
                    .filter_map(|b| b.text)
                    .collect();
                parts.join("")
            }
        }
    }
}

impl Transcript {
    /// Parse a transcript from raw JSONL content. Malformed lines are skipped so
    /// a half-written or foreign line never bricks summarisation.
    pub fn from_jsonl(content: &str) -> Self {
        let mut assistant_texts = Vec::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(rec) = serde_json::from_str::<Record>(line) else {
                continue;
            };
            let is_assistant = rec.kind.as_deref() == Some("assistant")
                || rec
                    .message
                    .as_ref()
                    .and_then(|m| m.role.as_deref())
                    == Some("assistant");
            if !is_assistant {
                continue;
            }
            if let Some(text) = rec.message.and_then(|m| m.content).map(Content::into_text) {
                if !text.trim().is_empty() {
                    assistant_texts.push(text);
                }
            }
        }
        Transcript { assistant_texts }
    }

    /// Read a transcript from a file path, parsing leniently.
    pub fn read(path: &str) -> Result<Self> {
        let content =
            std::fs::read_to_string(path).map_err(|e| CoreError::Io(e.to_string()))?;
        Ok(Self::from_jsonl(&content))
    }

    /// The text of the final assistant message, if any.
    pub fn last_assistant_text(&self) -> Option<&str> {
        self.assistant_texts.last().map(|s| s.as_str())
    }

    /// Distil this transcript's final assistant reply to a short shared summary.
    /// Returns `None` if there is no assistant text to summarise.
    pub fn distil_summary(&self) -> Option<String> {
        self.last_assistant_text().map(distil)
    }
}

/// Distil a raw assistant reply to a short shared summary (see module docs).
///
/// A turn may end with several distinct conclusions; we keep them all (as bullet
/// lines) rather than dropping all but the last, but bound the result to
/// [`MAX_SUMMARY_LINES`] lines and [`MAX_SUMMARY_CHARS`] chars so it stays a delta.
pub fn distil(reply: &str) -> String {
    let reply = normalize_newlines(reply);
    let cap = |s: String| truncate_chars(&cap_lines(&s, MAX_SUMMARY_LINES), MAX_SUMMARY_CHARS);
    // 1) Sentinel override, if the Skill emitted it (line structure preserved).
    if let Some(s) = sentinel_summary(&reply) {
        return cap(s);
    }
    // 2) A trailing list of conclusions — keep the whole list, not just the last.
    if let Some(s) = trailing_list(&reply) {
        return cap(s);
    }
    // 3) The final non-empty paragraph (blank-line separated).
    if let Some(p) = final_paragraph(&reply) {
        return truncate_chars(&p, MAX_SUMMARY_CHARS);
    }
    // 4) Fallback: truncate the whole (trimmed) reply.
    truncate_chars(reply.trim(), MAX_SUMMARY_CHARS)
}

/// Normalise CRLF / lone CR to `\n` so paragraph splitting (`"\n\n"`) is reliable
/// on transcripts written on any platform.
fn normalize_newlines(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

/// Extract the text following a `CLAIR-SUMMARY:` sentinel, to the end of its
/// paragraph (stops at the next blank line). Line structure is preserved so a
/// bulleted sentinel survives as bullets. Returns `None` if the sentinel is
/// absent or yields empty text.
fn sentinel_summary(reply: &str) -> Option<String> {
    let idx = reply.find(SENTINEL)?;
    let after = &reply[idx + SENTINEL.len()..];
    // Take up to the next blank line (paragraph break).
    let para = after.split("\n\n").next().unwrap_or(after);
    let preserved = preserve_lines(para);
    if preserved.is_empty() {
        None
    } else {
        Some(preserved)
    }
}

/// If the reply *ends* in a list, return the whole trailing run of list items
/// (paragraph-separated or line-separated), line structure preserved. `None` when
/// the reply does not end in a list, so prose endings fall through to
/// [`final_paragraph`] unchanged.
fn trailing_list(reply: &str) -> Option<String> {
    let paras: Vec<&str> = reply
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    // Only fire when the reply ends in a list.
    if !paras.last().map(|p| is_list_paragraph(p)).unwrap_or(false) {
        return None;
    }
    // Walk back over the contiguous trailing run of list paragraphs.
    let mut start = paras.len();
    while start > 0 && is_list_paragraph(paras[start - 1]) {
        start -= 1;
    }
    let lines: Vec<String> = paras[start..]
        .iter()
        .flat_map(|p| p.lines())
        .map(collapse_ws)
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

/// Whether `line` opens a Markdown list item: a `-`/`*`/`+` bullet followed by
/// whitespace (so `*emphasis*` is not a marker), or `N.`/`N)` followed by
/// whitespace (so a bare year like `1985 ` is not a marker).
fn starts_list_item(line: &str) -> bool {
    let t = line.trim_start();
    let mut chars = t.chars();
    match chars.next() {
        Some('-') | Some('*') | Some('+') => chars.next().is_some_and(|c| c.is_whitespace()),
        Some(c) if c.is_ascii_digit() => {
            let rest = t.trim_start_matches(|c: char| c.is_ascii_digit());
            let mut r = rest.chars();
            matches!(r.next(), Some('.') | Some(')')) && r.next().is_none_or(|c| c.is_whitespace())
        }
        _ => false,
    }
}

/// Whether a paragraph's first line opens a list item.
fn is_list_paragraph(p: &str) -> bool {
    p.lines().next().map(starts_list_item).unwrap_or(false)
}

/// The last blank-line-separated paragraph with non-empty content, whitespace
/// collapsed to single spaces. `None` if the reply is all whitespace.
fn final_paragraph(reply: &str) -> Option<String> {
    reply
        .split("\n\n")
        .map(collapse_ws)
        .filter(|p| !p.is_empty())
        .last()
}

/// Collapse all runs of whitespace (incl. newlines) to single spaces and trim.
fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Collapse whitespace *within* each line but keep the line breaks — so a bulleted
/// block survives as separate bullet lines. Empty lines are dropped.
fn preserve_lines(block: &str) -> String {
    block
        .lines()
        .map(collapse_ws)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Keep at most `max` lines of `s`; if more were present, append a single `…`
/// line so the truncation is visible. A summary with `<= max` lines is unchanged.
fn cap_lines(s: &str, max: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    if lines.len() <= max {
        return s.to_string();
    }
    let mut kept: Vec<&str> = lines[..max].to_vec();
    kept.push("…");
    kept.join("\n")
}

/// Truncate `s` to at most `max` chars on a char boundary, appending `…` when cut.
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    // Reserve one char for the ellipsis.
    let take = max.saturating_sub(1);
    let mut out: String = s.chars().take(take).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_block_content_and_returns_last_assistant_text() {
        let jsonl = r#"{"type":"user","message":{"role":"user","content":"hi"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"first reply"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"final reply"}]}}"#;
        let t = Transcript::from_jsonl(jsonl);
        assert_eq!(t.last_assistant_text(), Some("final reply"));
    }

    #[test]
    fn parses_plain_string_content() {
        let jsonl =
            r#"{"type":"assistant","message":{"role":"assistant","content":"a plain string reply"}}"#;
        let t = Transcript::from_jsonl(jsonl);
        assert_eq!(t.last_assistant_text(), Some("a plain string reply"));
    }

    #[test]
    fn skips_malformed_lines() {
        let jsonl = "not json at all\n{bad\n{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":\"ok\"}}";
        let t = Transcript::from_jsonl(jsonl);
        assert_eq!(t.last_assistant_text(), Some("ok"));
    }

    #[test]
    fn ignores_non_text_blocks_like_tool_use() {
        let jsonl = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit"},{"type":"text","text":"the words"}]}}"#;
        let t = Transcript::from_jsonl(jsonl);
        assert_eq!(t.last_assistant_text(), Some("the words"));
    }

    #[test]
    fn empty_transcript_has_no_text_and_no_summary() {
        let t = Transcript::from_jsonl("");
        assert_eq!(t.last_assistant_text(), None);
        assert_eq!(t.distil_summary(), None);
    }

    // --- distil: PRIMARY (final paragraph) ------------------------------------

    #[test]
    fn distil_takes_the_final_paragraph() {
        let reply = "I'll move the guard into AuthMiddleware.\n\nDone. Guard now in AuthMiddleware; 1 test still failing on the expired-token case.";
        assert_eq!(
            distil(reply),
            "Done. Guard now in AuthMiddleware; 1 test still failing on the expired-token case."
        );
    }

    #[test]
    fn distil_collapses_internal_whitespace_in_the_paragraph() {
        let reply = "intro\n\nmoved   the\nguard   to middleware";
        assert_eq!(distil(reply), "moved the guard to middleware");
    }

    #[test]
    fn distil_single_paragraph_returns_it() {
        let reply = "just one paragraph here";
        assert_eq!(distil(reply), "just one paragraph here");
    }

    // --- distil: OPTIONAL sentinel --------------------------------------------

    #[test]
    fn distil_honours_the_clair_summary_sentinel_when_present() {
        let reply = "Lots of working text the pair doesn't need.\n\nCLAIR-SUMMARY: Moved the guard into AuthMiddleware; one expired-token test still red.\n\nbye";
        assert_eq!(
            distil(reply),
            "Moved the guard into AuthMiddleware; one expired-token test still red."
        );
    }

    #[test]
    fn sentinel_takes_precedence_over_final_paragraph() {
        let reply = "CLAIR-SUMMARY: the chosen line\n\nthis later paragraph must NOT win";
        assert_eq!(distil(reply), "the chosen line");
    }

    #[test]
    fn empty_sentinel_falls_back_to_paragraph() {
        let reply = "CLAIR-SUMMARY:\n\nthe real final paragraph";
        assert_eq!(distil(reply), "the real final paragraph");
    }

    // --- distil: truncation fallback ------------------------------------------

    #[test]
    fn distil_truncates_an_overlong_paragraph_on_a_char_boundary() {
        let long = "x".repeat(MAX_SUMMARY_CHARS + 50);
        let got = distil(&long);
        assert_eq!(got.chars().count(), MAX_SUMMARY_CHARS);
        assert!(got.ends_with('…'));
    }

    #[test]
    fn distil_handles_multibyte_truncation_without_panic() {
        // Each '✓' is 3 bytes; a naive byte-slice would panic mid-char.
        let long = "✓".repeat(MAX_SUMMARY_CHARS + 10);
        let got = distil(&long);
        assert_eq!(got.chars().count(), MAX_SUMMARY_CHARS);
    }

    // --- distil: multi-point conclusions (the lossy-distillation fix) ----------

    #[test]
    fn distil_preserves_a_blank_separated_numbered_list() {
        // The observed bug: a 1..6 critique where each point is its own paragraph.
        // Old behaviour kept only "6. …"; the fix keeps the whole trailing list.
        let reply = "Here are my concerns.\n\n\
1. instant-wow is unproven\n\n\
2. the cap is arbitrary\n\n\
3. lifecycle is hand-wavy\n\n\
4. no teams story\n\n\
5. channels is preview-grade\n\n\
6. the sentinel is undocumented";
        let got = distil(reply);
        assert!(got.contains("1. instant-wow is unproven"), "got: {got}");
        assert!(
            got.contains("6. the sentinel is undocumented"),
            "got: {got}"
        );
        assert_eq!(got.lines().count(), 6);
    }

    #[test]
    fn distil_preserves_a_contiguous_bulleted_list() {
        let reply = "intro line\n\n- alpha\n- beta\n- gamma";
        assert_eq!(distil(reply), "- alpha\n- beta\n- gamma");
    }

    #[test]
    fn distil_keeps_the_trailing_list_and_drops_a_preceding_intro_paragraph() {
        let reply = "My critique:\n\n- one\n- two";
        assert_eq!(distil(reply), "- one\n- two");
    }

    #[test]
    fn distil_ignores_a_list_in_the_middle_when_the_reply_ends_in_prose() {
        let reply = "- a\n- b\n\nBut on balance it's fine.";
        // Ends in prose → falls through to final_paragraph (single line).
        assert_eq!(distil(reply), "But on balance it's fine.");
    }

    #[test]
    fn distil_caps_a_long_list_at_max_summary_lines() {
        let reply = "lead\n\n- 1\n- 2\n- 3\n- 4\n- 5\n- 6\n- 7\n- 8";
        let got = distil(reply);
        // Six content lines plus a single ellipsis line marking the truncation.
        assert_eq!(got.lines().count(), MAX_SUMMARY_LINES + 1);
        assert!(got.lines().last().unwrap().contains('…'), "got: {got}");
        assert!(got.contains("- 6"), "got: {got}");
        assert!(!got.contains("- 7"), "got: {got}");
    }

    #[test]
    fn distil_multiline_sentinel_preserves_its_bullets() {
        let reply = "working text\n\nCLAIR-SUMMARY:\n- moved the guard\n- one test red\n\nbye";
        assert_eq!(distil(reply), "- moved the guard\n- one test red");
    }

    #[test]
    fn distil_normalizes_crlf_before_splitting() {
        let reply = "intro\r\n\r\n- a\r\n- b\r\n- c";
        assert_eq!(distil(reply), "- a\n- b\n- c");
    }

    #[test]
    fn starts_list_item_matches_markers_not_prose_or_years() {
        assert!(starts_list_item("- a"));
        assert!(starts_list_item("* a"));
        assert!(starts_list_item("+ a"));
        assert!(starts_list_item("1. a"));
        assert!(starts_list_item("6) a"));
        assert!(starts_list_item("  - indented still a marker"));
        assert!(!starts_list_item("*emphasis* not a marker"));
        assert!(!starts_list_item("1985 was a good year"));
        assert!(!starts_list_item("hello world"));
        assert!(!starts_list_item("-no space after dash"));
    }
}
