//! The append-only entry type and its identifiers.
//!
//! An [`Entry`] is one line in `clair/<branch>`'s `log.jsonl`. Its serde shape
//! matches the slice spec §6:
//!
//! ```jsonc
//! { "id":"uuid", "author":"JB", "kind":"prompt|summary|signal",
//!   "text":"…", "ts":"2026-06-25T10:00:00Z", "turn":"uuid" }
//! ```
//!
//! Design notes (see the agreed plan / ADR 0004):
//! - [`EntryId`] is a UUIDv7: a 48-bit Unix-ms prefix plus random tail. This gives
//!   collision-free concurrent appends with no coordination, and a per-machine
//!   chronological total order via the derived `Ord`. (UUIDv7 is per-machine
//!   monotonic only — it is NOT a cross-machine total order.)
//! - [`Author`] is normalised on construction (trim + ASCII case-fold) so the
//!   provenance filter `author == me` is reliable and never leaks your own entries
//!   back into your own context.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The kind of an entry. Serialises to its lowercase name to match the wire format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// A prompt the author submitted to their AI.
    Prompt,
    /// A one-paragraph distillation of the author's finished turn.
    Summary,
    /// A session signal (e.g. "joined the pair session").
    Signal,
}

/// A monotonic, globally-unique entry id (UUIDv7).
///
/// The derived `Ord`/`PartialOrd` compares the underlying 128 bits, whose most
/// significant bits are the UUIDv7 millisecond timestamp — so ordering is
/// chronological on a single machine and total everywhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct EntryId(pub Uuid);

impl EntryId {
    /// Mint a fresh id from the current time (UUIDv7).
    pub fn now() -> Self {
        EntryId(Uuid::now_v7())
    }

    /// Borrow the inner UUID.
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}

impl std::fmt::Display for EntryId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A turn identifier — equal to the harness session id, tying a prompt to its
/// later summary.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TurnId(pub String);

impl TurnId {
    /// Wrap an arbitrary session-id string.
    pub fn new(s: impl Into<String>) -> Self {
        TurnId(s.into())
    }
}

impl std::fmt::Display for TurnId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// An author handle, normalised on construction so provenance comparison is reliable.
///
/// Normalisation = trim surrounding whitespace + ASCII-lowercase the *comparison*.
/// We preserve the trimmed original for display but compare case-insensitively,
/// so `"JB"` and `" jb "` are the same author.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Author(String);

impl Author {
    /// Construct an author, trimming surrounding whitespace.
    pub fn new(s: impl AsRef<str>) -> Self {
        Author(s.as_ref().trim().to_string())
    }

    /// The display form (trimmed original casing).
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The normalised key used for provenance comparison.
    fn key(&self) -> String {
        self.0.to_ascii_lowercase()
    }
}

impl PartialEq for Author {
    fn eq(&self, other: &Self) -> bool {
        self.key() == other.key()
    }
}

impl Eq for Author {}

impl std::hash::Hash for Author {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.key().hash(state);
    }
}

impl std::fmt::Display for Author {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// An RFC3339 UTC timestamp, stored as a string to match the wire format exactly.
///
/// We keep it as a string (not a parsed `OffsetDateTime`) because ordering and
/// identity already come from [`EntryId`]; the timestamp is human-facing metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Timestamp(pub String);

impl Timestamp {
    /// Wrap an RFC3339 string.
    pub fn new(s: impl Into<String>) -> Self {
        Timestamp(s.into())
    }

    /// Borrow the underlying string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for Timestamp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// One append-only entry in a shared-context log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// Globally-unique, monotonic id (UUIDv7).
    pub id: EntryId,
    /// Who wrote it (normalised handle).
    pub author: Author,
    /// What kind of entry it is.
    pub kind: Kind,
    /// The payload text.
    pub text: String,
    /// RFC3339 UTC timestamp.
    pub ts: Timestamp,
    /// The turn (session) this entry belongs to.
    pub turn: TurnId,
}

impl Entry {
    /// Serialise to a single JSONL line (no trailing newline).
    pub fn to_jsonl(&self) -> crate::error::Result<String> {
        Ok(serde_json::to_string(self)?)
    }

    /// Parse one JSONL line into an [`Entry`].
    pub fn from_jsonl(line: &str) -> crate::error::Result<Entry> {
        serde_json::from_str(line)
            .map_err(|e| crate::error::CoreError::ParseJsonl(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_id_now_is_monotonic_and_sortable() {
        let mut ids: Vec<EntryId> = (0..1000).map(|_| EntryId::now()).collect();
        let original = ids.clone();
        ids.sort();
        // UUIDv7 minted in sequence on one machine is already non-decreasing.
        assert_eq!(ids, original, "sequential UUIDv7 ids must already be sorted");
        // And strictly increasing (no collisions) across the batch.
        for w in ids.windows(2) {
            assert!(w[0] < w[1], "ids must be strictly increasing: {} !< {}", w[0], w[1]);
        }
    }

    #[test]
    fn author_is_normalised_for_provenance() {
        assert_eq!(Author::new("JB"), Author::new(" jb "));
        assert_eq!(Author::new("Rajiv"), Author::new("rajiv"));
        assert_ne!(Author::new("JB"), Author::new("Rajiv"));
        // Display preserves trimmed original casing.
        assert_eq!(Author::new(" JB ").as_str(), "JB");
    }

    #[test]
    fn kind_serialises_lowercase() {
        assert_eq!(serde_json::to_string(&Kind::Prompt).unwrap(), "\"prompt\"");
        assert_eq!(serde_json::to_string(&Kind::Summary).unwrap(), "\"summary\"");
        assert_eq!(serde_json::to_string(&Kind::Signal).unwrap(), "\"signal\"");
    }

    /// Deserialize the spec §6 example, then re-serialize and assert the required
    /// fields + lowercase kind survive — NOT byte-identity to the hand-wrapped JSONC.
    #[test]
    fn deserialize_then_reserialize_spec_example() {
        let line = r#"{ "id":"018f5e2a-0000-7000-8000-000000000000", "author":"JB", "kind":"prompt", "text":"refactor the auth guard to use the new middleware", "ts":"2026-06-25T10:00:00Z", "turn":"abc123" }"#;

        let entry = Entry::from_jsonl(line).expect("spec example must parse");
        assert_eq!(entry.author.as_str(), "JB");
        assert_eq!(entry.kind, Kind::Prompt);
        assert_eq!(entry.text, "refactor the auth guard to use the new middleware");
        assert_eq!(entry.ts.as_str(), "2026-06-25T10:00:00Z");
        assert_eq!(entry.turn, TurnId::new("abc123"));

        // Re-serialize and re-parse: equivalence, not byte-identity.
        let reserialised = entry.to_jsonl().unwrap();
        let roundtrip = Entry::from_jsonl(&reserialised).unwrap();
        assert_eq!(entry, roundtrip);

        // The required fields are present and kind is lowercase in the output.
        let v: serde_json::Value = serde_json::from_str(&reserialised).unwrap();
        for field in ["id", "author", "kind", "text", "ts", "turn"] {
            assert!(v.get(field).is_some(), "missing field {field}");
        }
        assert_eq!(v["kind"], serde_json::json!("prompt"));
    }

    #[test]
    fn all_kinds_roundtrip() {
        for kind in [Kind::Prompt, Kind::Summary, Kind::Signal] {
            let entry = Entry {
                id: EntryId::now(),
                author: Author::new("JB"),
                kind,
                text: "hello".into(),
                ts: Timestamp::new("2026-06-25T10:00:00Z"),
                turn: TurnId::new("turn-1"),
            };
            let line = entry.to_jsonl().unwrap();
            assert_eq!(Entry::from_jsonl(&line).unwrap(), entry);
        }
    }

    #[test]
    fn malformed_line_is_parse_error() {
        let err = Entry::from_jsonl("not json").unwrap_err();
        matches!(err, crate::error::CoreError::ParseJsonl(_));
    }
}
