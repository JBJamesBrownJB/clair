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
//! 1. **PRIMARY (spec-as-written):** the final assistant *paragraph* — the last
//!    blank-line-separated block of the reply. This is what the walkthrough shows
//!    surfacing as `✓ …'s AI concluded: "…"`.
//! 2. **OPTIONAL sentinel (a new design decision, NOT in the spec text):** if the
//!    reply contains a `CLAIR-SUMMARY:` line, the text after it (to end of that
//!    paragraph) wins. SKILL.md declares the exact spelling; the hook honours it
//!    only when present.
//! 3. **Fallback:** if nothing usable remains, truncate the whole reply to
//!    [`MAX_SUMMARY_CHARS`] on a char boundary.

use serde::Deserialize;

use crate::error::{CoreError, Result};

/// The sentinel a Skill may emit to override the paragraph heuristic. Declared
/// here so SKILL.md and the parser agree on one exact spelling.
pub const SENTINEL: &str = "CLAIR-SUMMARY:";

/// The cap on a distilled summary's length (chars). One short paragraph.
pub const MAX_SUMMARY_CHARS: usize = 600;

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

    /// Distil this transcript's final assistant reply to a one-paragraph summary.
    /// Returns `None` if there is no assistant text to summarise.
    pub fn distil_summary(&self) -> Option<String> {
        self.last_assistant_text().map(distil)
    }
}

/// Distil a raw assistant reply to a one-paragraph summary (see module docs).
pub fn distil(reply: &str) -> String {
    // 1) Sentinel override, if the Skill emitted it.
    if let Some(s) = sentinel_summary(reply) {
        return truncate_chars(&s, MAX_SUMMARY_CHARS);
    }
    // 2) The final non-empty paragraph (blank-line separated).
    if let Some(p) = final_paragraph(reply) {
        return truncate_chars(&p, MAX_SUMMARY_CHARS);
    }
    // 3) Fallback: truncate the whole (trimmed) reply.
    truncate_chars(reply.trim(), MAX_SUMMARY_CHARS)
}

/// Extract the text following a `CLAIR-SUMMARY:` sentinel, to the end of its
/// paragraph (stops at the next blank line). Returns `None` if the sentinel is
/// absent or yields empty text.
fn sentinel_summary(reply: &str) -> Option<String> {
    let idx = reply.find(SENTINEL)?;
    let after = &reply[idx + SENTINEL.len()..];
    // Take up to the next blank line (paragraph break).
    let para = after.split("\n\n").next().unwrap_or(after);
    let collapsed = collapse_ws(para);
    if collapsed.is_empty() {
        None
    } else {
        Some(collapsed)
    }
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
}
