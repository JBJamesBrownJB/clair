//! The SINGLE source of truth for inbound framing strings.
//!
//! Both the real hook adapter (which prints `additionalContext`) and the Tier-2
//! harness render through this module, so what the model sees and what the tests
//! assert are byte-for-byte identical (no drift).
//!
//! There are **two banners**, matching the spec walkthrough:
//! - the BACKGROUND banner ([`BG_BANNER`]) wraps `prompt` and `summary` entries —
//!   "shared pair context (background — your AI won't act on this)" — so the
//!   recipient's AI treats them as passive context, never a directive (spec §1a ②);
//! - the SIGNAL banner ([`SIGNAL_BANNER`]) wraps `signal`/join entries — the
//!   distinct `── clair ──` framing of the spec walkthrough (lines 49-51).
//!
//! Per-entry lines:
//! - prompt  → `↪ <author> asked his AI: "<text>"`
//! - summary → `✓ <author>'s AI concluded: "<text>"`
//! - signal  → `🤝 <author> joined the pair session on <branch>.`
//!   (the signal text *is* the branch the author joined.)
//!
//! [`render_inbound`] groups a slice of entries under the correct banner(s),
//! oldest first, and caps the total at [`MAX_CONTEXT_CHARS`] by dropping the
//! oldest lines. It returns `None` when there is nothing to surface, so the
//! adapter can emit `{}` (no `additionalContext`).

use crate::entry::{Entry, Kind};

/// The background banner header (prompt + summary entries render under this).
pub const BG_BANNER: &str =
    "── shared pair context (background — your AI won't act on this) ──";

/// The background banner rule (closes the block).
pub const BG_RULE: &str =
    "─────────────────────────────────────────────────────────────────";

/// The signal banner header (join/signal entries render under this).
pub const SIGNAL_BANNER: &str = "── clair ──────────────────────────────────";

/// The signal banner rule (closes the block).
pub const SIGNAL_RULE: &str = "───────────────────────────────────────────";

/// The cap on injected `additionalContext` size (chars). Oldest lines drop first.
pub const MAX_CONTEXT_CHARS: usize = 10_000;

/// The per-entry framed line for `kind=prompt`.
pub fn prompt_line(author: &str, text: &str) -> String {
    format!("↪ {author} asked his AI: \"{text}\"")
}

/// The per-entry framed line for `kind=summary`.
pub fn summary_line(author: &str, text: &str) -> String {
    format!("✓ {author}'s AI concluded: \"{text}\"")
}

/// The per-entry framed line for `kind=signal` (the text is the branch joined).
pub fn signal_line(author: &str, branch: &str) -> String {
    format!("🤝 {author} joined the pair session on {branch}.")
}

/// The framed line for a single entry, dispatched by kind.
fn entry_line(e: &Entry) -> String {
    match e.kind {
        Kind::Prompt => prompt_line(e.author.as_str(), &e.text),
        Kind::Summary => summary_line(e.author.as_str(), &e.text),
        Kind::Signal => signal_line(e.author.as_str(), &e.text),
    }
}

/// Which banner an entry belongs under.
fn is_background(kind: Kind) -> bool {
    matches!(kind, Kind::Prompt | Kind::Summary)
}

/// Render new peer `entries` into one framed `additionalContext` string.
///
/// Entries are grouped by banner (background block, then signal block), each in
/// the original oldest-first order. The whole result is capped at
/// [`MAX_CONTEXT_CHARS`]; if it would exceed that, the oldest entry *lines* are
/// dropped (banners/rules are never split). Returns `None` when there is nothing
/// to surface.
pub fn render_inbound(entries: &[Entry]) -> Option<String> {
    if entries.is_empty() {
        return None;
    }

    // Cap by dropping oldest entry lines first. We measure each candidate block's
    // rendered size and keep as many of the newest entries as fit.
    let kept = cap_oldest_first(entries, MAX_CONTEXT_CHARS);
    if kept.is_empty() {
        return None;
    }

    let mut blocks: Vec<String> = Vec::new();

    let background: Vec<String> = kept
        .iter()
        .filter(|e| is_background(e.kind))
        .map(|e| entry_line(e))
        .collect();
    if !background.is_empty() {
        blocks.push(framed(BG_BANNER, &background, BG_RULE));
    }

    let signal: Vec<String> = kept
        .iter()
        .filter(|e| !is_background(e.kind))
        .map(|e| entry_line(e))
        .collect();
    if !signal.is_empty() {
        blocks.push(framed(SIGNAL_BANNER, &signal, SIGNAL_RULE));
    }

    if blocks.is_empty() {
        None
    } else {
        Some(blocks.join("\n"))
    }
}

/// Human-facing header for the `systemMessage` banner — what the paired developer
/// actually reads in their terminal (distinct from the model-facing background
/// framing of [`render_inbound`]).
pub const HUMAN_HEADER: &str = "🤝 clair · your pair";

/// Human line for `kind=prompt`.
pub fn human_prompt_line(author: &str, text: &str) -> String {
    format!("   💬 {author} asked: \"{text}\"")
}

/// Human line for `kind=summary`. Note "'s AI": the conclusion is the AI's, not the
/// person's — `<author> concluded` would misattribute it to the human.
pub fn human_summary_line(author: &str, text: &str) -> String {
    format!("   ✓ {author}'s AI concluded: \"{text}\"")
}

/// Human line for `kind=signal` (the text is the branch joined).
pub fn human_signal_line(author: &str, branch: &str) -> String {
    format!("   🤝 {author} joined on {branch}")
}

/// The human line for a single entry, dispatched by kind.
fn human_entry_line(e: &Entry) -> String {
    match e.kind {
        Kind::Prompt => human_prompt_line(e.author.as_str(), &e.text),
        Kind::Summary => human_summary_line(e.author.as_str(), &e.text),
        Kind::Signal => human_signal_line(e.author.as_str(), &e.text),
    }
}

/// Render new peer `entries` into a concise, human-facing banner for `systemMessage`
/// — the visible signal the paired developer sees in their own terminal. One header,
/// then one line per entry, oldest-first, capped like [`render_inbound`]. Returns
/// `None` when there is nothing to surface.
///
/// This is the human twin of [`render_inbound`]: the same delivered entries, framed
/// for a person instead of the model. The hook emits BOTH — `additionalContext` for
/// the AI, this for the human — so the pair's activity is actually visible, not just
/// silently fed to the recipient's model.
pub fn render_inbound_human(entries: &[Entry]) -> Option<String> {
    if entries.is_empty() {
        return None;
    }
    let kept = cap_oldest_first(entries, MAX_CONTEXT_CHARS);
    if kept.is_empty() {
        return None;
    }
    let mut lines = Vec::with_capacity(kept.len() + 1);
    lines.push(HUMAN_HEADER.to_string());
    for e in &kept {
        lines.push(human_entry_line(e));
    }
    Some(lines.join("\n"))
}

/// Assemble one banner block: header, the lines, then the rule.
fn framed(banner: &str, lines: &[String], rule: &str) -> String {
    let mut out = String::new();
    out.push_str(banner);
    for line in lines {
        out.push('\n');
        out.push_str(line);
    }
    out.push('\n');
    out.push_str(rule);
    out
}

/// Keep as many of the newest entries as render within `cap` chars (measuring the
/// final assembled output). Drops oldest first; returns kept entries oldest-first.
fn cap_oldest_first(entries: &[Entry], cap: usize) -> Vec<Entry> {
    // Fast path: everything fits.
    if measure(entries) <= cap {
        return entries.to_vec();
    }
    // Drop from the front (oldest) until it fits or nothing remains.
    let mut start = 0;
    while start < entries.len() {
        let candidate = &entries[start..];
        if measure(candidate) <= cap {
            return candidate.to_vec();
        }
        start += 1;
    }
    Vec::new()
}

/// The char length of the assembled render of `entries` (0 if empty).
fn measure(entries: &[Entry]) -> usize {
    match render_assembled(entries) {
        Some(s) => s.chars().count(),
        None => 0,
    }
}

/// Render without the cap (used only by [`measure`]).
fn render_assembled(entries: &[Entry]) -> Option<String> {
    if entries.is_empty() {
        return None;
    }
    let mut blocks: Vec<String> = Vec::new();
    let background: Vec<String> = entries
        .iter()
        .filter(|e| is_background(e.kind))
        .map(|e| entry_line(e))
        .collect();
    if !background.is_empty() {
        blocks.push(framed(BG_BANNER, &background, BG_RULE));
    }
    let signal: Vec<String> = entries
        .iter()
        .filter(|e| !is_background(e.kind))
        .map(|e| entry_line(e))
        .collect();
    if !signal.is_empty() {
        blocks.push(framed(SIGNAL_BANNER, &signal, SIGNAL_RULE));
    }
    if blocks.is_empty() {
        None
    } else {
        Some(blocks.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::{Author, EntryId, Timestamp, TurnId};

    fn entry(author: &str, kind: Kind, text: &str) -> Entry {
        Entry {
            id: EntryId::now(),
            author: Author::new(author),
            kind,
            text: text.into(),
            ts: Timestamp::new("2026-06-25T10:00:00Z"),
            turn: TurnId::new("turn-1"),
        }
    }

    #[test]
    fn empty_renders_to_none() {
        assert_eq!(render_inbound(&[]), None);
    }

    #[test]
    fn prompt_renders_byte_exact_under_background_banner() {
        let e = entry("JB", Kind::Prompt, "refactor the auth guard to use the new middleware");
        let got = render_inbound(&[e]).unwrap();
        let expected = "── shared pair context (background — your AI won't act on this) ──\n\
↪ JB asked his AI: \"refactor the auth guard to use the new middleware\"\n\
─────────────────────────────────────────────────────────────────";
        assert_eq!(got, expected);
    }

    #[test]
    fn summary_renders_byte_exact_under_background_banner() {
        let e = entry(
            "JB",
            Kind::Summary,
            "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case.",
        );
        let got = render_inbound(&[e]).unwrap();
        let expected = "── shared pair context (background — your AI won't act on this) ──\n\
✓ JB's AI concluded: \"Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case.\"\n\
─────────────────────────────────────────────────────────────────";
        assert_eq!(got, expected);
    }

    #[test]
    fn signal_renders_byte_exact_under_clair_banner() {
        let e = entry("Rajiv", Kind::Signal, "feature/login");
        let got = render_inbound(&[e]).unwrap();
        let expected = "── clair ──────────────────────────────────\n\
🤝 Rajiv joined the pair session on feature/login.\n\
───────────────────────────────────────────";
        assert_eq!(got, expected);
    }

    /// The exact `additionalContext` from the hook contract (prompt + summary
    /// together under one background block).
    #[test]
    fn prompt_and_summary_share_one_background_block() {
        let p = entry("JB", Kind::Prompt, "refactor the auth guard to use the new middleware");
        let s = entry(
            "JB",
            Kind::Summary,
            "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case.",
        );
        let got = render_inbound(&[p, s]).unwrap();
        let expected = "── shared pair context (background — your AI won't act on this) ──\n\
↪ JB asked his AI: \"refactor the auth guard to use the new middleware\"\n\
✓ JB's AI concluded: \"Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case.\"\n\
─────────────────────────────────────────────────────────────────";
        assert_eq!(got, expected);
    }

    /// Mixed kinds: background block first, then the signal block.
    #[test]
    fn mixed_kinds_render_two_blocks_background_then_signal() {
        let p = entry("JB", Kind::Prompt, "do the thing");
        let j = entry("Rajiv", Kind::Signal, "feature/login");
        let got = render_inbound(&[p, j]).unwrap();
        let expected = "── shared pair context (background — your AI won't act on this) ──\n\
↪ JB asked his AI: \"do the thing\"\n\
─────────────────────────────────────────────────────────────────\n\
── clair ──────────────────────────────────\n\
🤝 Rajiv joined the pair session on feature/login.\n\
───────────────────────────────────────────";
        assert_eq!(got, expected);
    }

    #[test]
    fn cap_drops_oldest_entries() {
        // Build many entries so the assembled render exceeds the cap.
        let big = "x".repeat(500);
        let entries: Vec<Entry> = (0..50)
            .map(|i| entry("JB", Kind::Prompt, &format!("{i}-{big}")))
            .collect();
        let got = render_inbound(&entries).unwrap();
        assert!(got.chars().count() <= MAX_CONTEXT_CHARS);
        // The newest entry survives; the very oldest is dropped. Match the full
        // framed line (with the leading quote) so "0-" can't match "10-".
        assert!(got.contains(&format!("\"49-{big}\"")));
        assert!(!got.contains(&format!("\"0-{big}\"")));
    }

    #[test]
    fn human_render_is_a_concise_visible_banner() {
        // The human twin: one header, one readable line per entry, no model-facing
        // "background — won't act" framing.
        let p = entry("JB", Kind::Prompt, "refactor the auth guard to use the new middleware");
        let s = entry("JB", Kind::Summary, "moved the guard into AuthMiddleware; 1 test still failing");
        let got = render_inbound_human(&[p, s]).unwrap();
        let expected = "🤝 clair · your pair\n   💬 JB asked: \"refactor the auth guard to use the new middleware\"\n   ✓ JB's AI concluded: \"moved the guard into AuthMiddleware; 1 test still failing\"";
        assert_eq!(got, expected);
    }

    #[test]
    fn human_render_empty_is_none() {
        assert_eq!(render_inbound_human(&[]), None);
    }

    #[test]
    fn human_render_signal_joins_without_doubling_a_sentence() {
        // The human signal line wraps the branch directly (the entry text IS the
        // branch), so it reads cleanly: "Rajiv joined on feature/login".
        let j = entry("Rajiv", Kind::Signal, "feature/login");
        let got = render_inbound_human(&[j]).unwrap();
        assert_eq!(got, "🤝 clair · your pair\n   🤝 Rajiv joined on feature/login");
    }

    #[test]
    fn per_line_helpers_are_byte_exact() {
        assert_eq!(prompt_line("JB", "hi"), "↪ JB asked his AI: \"hi\"");
        assert_eq!(summary_line("JB", "done"), "✓ JB's AI concluded: \"done\"");
        assert_eq!(
            signal_line("Rajiv", "feature/login"),
            "🤝 Rajiv joined the pair session on feature/login."
        );
    }
}
