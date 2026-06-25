//! The typed view of what a [`crate::Dev`] would see injected into its session.
//!
//! Tests assert on **structure and provenance** (which authors' prompts/conclusions
//! appear, under which banner) — never on LLM wording, because there is no LLM in
//! the loop. The framed string itself comes straight from
//! `clair_core::render::render_inbound`, so what we assert here is byte-for-byte
//! what the real hook injects.

use clair_core::render::{BG_BANNER, SIGNAL_BANNER};

/// What one `UserPromptSubmit` would surface to the recipient's session.
///
/// `raw` is the exact `additionalContext` string (or `None` when nothing new). The
/// helper predicates parse that string structurally so scenarios read like the spec.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Injected {
    /// The exact framed `additionalContext`, or `None` when there was nothing to surface.
    pub raw: Option<String>,
}

impl Injected {
    /// Build from the optional framed context the hook produced.
    pub fn new(raw: Option<String>) -> Self {
        Injected { raw }
    }

    /// Nothing was injected this turn.
    pub fn is_empty(&self) -> bool {
        self.raw.as_deref().map(str::is_empty).unwrap_or(true)
    }

    /// The framed text, or the empty string when nothing was injected.
    pub fn text(&self) -> &str {
        self.raw.as_deref().unwrap_or("")
    }

    /// True if a `prompt` entry from `author` appears, framed under the BACKGROUND
    /// banner (`↪ <author> asked his AI: …`).
    pub fn mentions_prompt_from(&self, author: &str) -> bool {
        self.has_background()
            && self
                .text()
                .contains(&format!("↪ {author} asked his AI:"))
    }

    /// True if a `summary` entry from `author` appears, framed under the BACKGROUND
    /// banner (`✓ <author>'s AI concluded: …`).
    pub fn mentions_conclusion_from(&self, author: &str) -> bool {
        self.has_background()
            && self
                .text()
                .contains(&format!("✓ {author}'s AI concluded:"))
    }

    /// True if a join `signal` from `author` appears, framed under the SIGNAL
    /// (`── clair ──`) banner (`🤝 <author> joined the pair session on …`).
    pub fn mentions_join_from(&self, author: &str) -> bool {
        self.has_signal()
            && self
                .text()
                .contains(&format!("🤝 {author} joined the pair session on"))
    }

    /// True if the literal text appears anywhere in the framed context.
    pub fn contains(&self, needle: &str) -> bool {
        self.text().contains(needle)
    }

    /// True if the BACKGROUND ("your AI won't act on this") banner is present —
    /// proving prompts/summaries are framed as passive, not directives.
    pub fn has_background(&self) -> bool {
        self.text().contains(BG_BANNER)
    }

    /// True if the SIGNAL (`── clair ──`) banner is present.
    pub fn has_signal(&self) -> bool {
        self.text().contains(SIGNAL_BANNER)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clair_core::render::render_inbound;
    use clair_core::{Author, Entry, EntryId, Kind, Timestamp, TurnId};

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
    fn empty_when_none() {
        let i = Injected::new(None);
        assert!(i.is_empty());
        assert!(!i.mentions_prompt_from("JB"));
        assert!(!i.has_background());
    }

    #[test]
    fn detects_prompt_under_background_banner() {
        let raw = render_inbound(&[entry("JB", Kind::Prompt, "do the thing")]);
        let i = Injected::new(raw);
        assert!(!i.is_empty());
        assert!(i.has_background());
        assert!(i.mentions_prompt_from("JB"));
        assert!(!i.mentions_prompt_from("Rajiv"));
        assert!(!i.has_signal());
        assert!(i.contains("do the thing"));
    }

    #[test]
    fn detects_conclusion_under_background_banner() {
        let raw = render_inbound(&[entry("JB", Kind::Summary, "moved the guard")]);
        let i = Injected::new(raw);
        assert!(i.mentions_conclusion_from("JB"));
        assert!(!i.mentions_prompt_from("JB"));
    }

    #[test]
    fn detects_join_under_signal_banner_only() {
        let raw = render_inbound(&[entry("Rajiv", Kind::Signal, "feature/login")]);
        let i = Injected::new(raw);
        assert!(i.has_signal());
        assert!(!i.has_background());
        assert!(i.mentions_join_from("Rajiv"));
    }

    #[test]
    fn detects_a_multi_point_conclusion_with_every_point() {
        // A multi-point conclusion is framed as a header (which the predicate
        // matches) plus one indented line per point — all of which survive.
        let raw = render_inbound(&[entry(
            "JB",
            Kind::Summary,
            "- moved the guard\n- one expired-token test still red\n- cap is arbitrary",
        )]);
        let i = Injected::new(raw);
        assert!(i.mentions_conclusion_from("JB"));
        assert!(i.contains("- moved the guard"));
        assert!(i.contains("- one expired-token test still red"));
        assert!(i.contains("- cap is arbitrary"));
    }
}
