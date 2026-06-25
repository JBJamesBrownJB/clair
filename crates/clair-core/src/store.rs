//! The append-only JSONL store and the single inbound read.
//!
//! A [`Store`] is bound to exactly one [`ShadowRef`], so **branch-scope is
//! structural**: branch-A entries physically live on a different ref than branch-B
//! and are invisible by construction, not by filtering.
//!
//! All inbound delivery flows through [`Store::entries_since`] (ADR 0004), so
//! swapping pull → push later is additive. The store reads its log through a
//! [`LogSource`] seam; the real implementation shells out to git (a later stage),
//! while unit tests and the harness use an in-memory fake. This keeps the
//! `entries_since` contract — filter / provenance / dedup / delivery-cursor —
//! testable with no git involved.

use crate::cursor::Cursor;
use crate::entry::{Author, Entry, EntryId};
use crate::error::Result;

/// Which orphan ref a [`Store`] reads from and appends to.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ShadowRef {
    /// The shared pair context for a working branch: `clair/<branch>`.
    Context(String),
    /// The repo-wide registry of available pairers: `clair/ready`.
    Ready,
}

impl ShadowRef {
    /// The registry ref.
    pub const READY: ShadowRef = ShadowRef::Ready;

    /// The context ref for a working branch.
    pub fn context(branch: impl Into<String>) -> Self {
        ShadowRef::Context(branch.into())
    }

    /// The fully-qualified git ref name (under `refs/heads/`), e.g. `clair/feature/login`.
    pub fn ref_name(&self) -> String {
        match self {
            ShadowRef::Context(branch) => format!("clair/{branch}"),
            ShadowRef::Ready => "clair/ready".to_string(),
        }
    }

    /// A filesystem-safe key for this ref, used to name the local cursor file.
    ///
    /// Slashes (and any other path-hostile characters) are replaced so a branch
    /// like `feature/login` maps to a single flat filename.
    pub fn cursor_key(&self) -> String {
        let raw = self.ref_name();
        raw.chars()
            .map(|c| match c {
                'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
                _ => '-',
            })
            .collect()
    }
}

/// The seam over "give me every raw JSONL line currently on this ref".
///
/// The real implementation fetches and `cat-file`s the blob via git shell-out
/// (a later stage). An absent ref yields an empty vector, never an error.
pub trait LogSource {
    /// Read every raw line on `shadow_ref` (oldest first). Absent ref ⇒ empty.
    fn read_lines(&self, shadow_ref: &ShadowRef) -> Result<Vec<String>>;
}

/// The seam over "append these JSONL lines to this ref".
pub trait LogSink {
    /// Append `lines` to `shadow_ref` (creating the orphan ref if absent).
    fn append_lines(&mut self, shadow_ref: &ShadowRef, lines: &[String]) -> Result<()>;
}

// Reference forwarders so a `Store` can borrow a backend (read via `&B`, append
// via `&mut B`) without taking ownership. This lets one owned backend serve both
// the inbound read and the outbound append within a single hook invocation.
impl<T: LogSource + ?Sized> LogSource for &T {
    fn read_lines(&self, shadow_ref: &ShadowRef) -> Result<Vec<String>> {
        (**self).read_lines(shadow_ref)
    }
}

impl<T: LogSink + ?Sized> LogSink for &mut T {
    fn append_lines(&mut self, shadow_ref: &ShadowRef, lines: &[String]) -> Result<()> {
        (**self).append_lines(shadow_ref, lines)
    }
}

/// The result of one inbound read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivery {
    /// The new peer entries to surface, oldest first.
    pub entries: Vec<Entry>,
    /// The cursor to persist: the max id among entries **actually delivered**
    /// this fetch — NOT a global max including my own entries. Combined with
    /// dedup-by-id, this makes delivery at-least-once-then-deduped, so a
    /// concurrent peer entry whose id sorts below my own latest append is not
    /// swallowed.
    pub next: Cursor,
}

/// The append-only JSONL store, bound to one [`ShadowRef`] and one identity.
pub struct Store<S> {
    backend: S,
    me: Author,
    shadow_ref: ShadowRef,
}

impl<S> Store<S> {
    /// Bind a store to a backend, identity, and ref.
    pub fn new(backend: S, me: Author, shadow_ref: ShadowRef) -> Self {
        Store {
            backend,
            me,
            shadow_ref,
        }
    }

    /// The ref this store is bound to (read AND append target).
    pub fn shadow_ref(&self) -> &ShadowRef {
        &self.shadow_ref
    }

    /// The identity used for the provenance filter.
    pub fn me(&self) -> &Author {
        &self.me
    }
}

impl<S: LogSource> Store<S> {
    /// THE single inbound read (ADR 0004).
    ///
    /// Pipeline: read all lines → skip malformed → keep `id > cursor` → drop my
    /// own entries (provenance) → dedup by id → sort by id. The returned
    /// [`Delivery::next`] is the max id of the *delivered* set (or the unchanged
    /// cursor if nothing was delivered).
    ///
    /// READ-ONLY: no append is wired in here, so the loop-guard holds structurally.
    pub fn entries_since(&self, cursor: &Cursor) -> Result<Delivery> {
        let lines = self.backend.read_lines(&self.shadow_ref)?;

        let mut delivered: Vec<Entry> = Vec::new();
        let mut seen_ids: std::collections::HashSet<EntryId> = std::collections::HashSet::new();

        for line in &lines {
            // Skip malformed lines: a half-written or foreign line never bricks delivery.
            let entry = match Entry::from_jsonl(line) {
                Ok(e) => e,
                Err(_) => continue,
            };
            // High-water filter: only entries newer than the cursor.
            if !cursor.is_after(&entry.id) {
                continue;
            }
            // Provenance: never deliver my own entries back to me.
            if entry.author == self.me {
                continue;
            }
            // Dedup by id (at-least-once-then-deduped).
            if !seen_ids.insert(entry.id) {
                continue;
            }
            delivered.push(entry);
        }

        delivered.sort_by(|a, b| a.id.cmp(&b.id));

        // next = max id of the DELIVERED set, not a global max. If nothing was
        // delivered, leave the cursor where it was.
        let next = match delivered.last() {
            Some(e) => Cursor::At(e.id),
            None => *cursor,
        };

        Ok(Delivery {
            entries: delivered,
            next,
        })
    }
}

impl<S: LogSink> Store<S> {
    /// Append one entry (outbound only). Serialises to one JSONL line and pushes.
    pub fn append(&mut self, entry: &Entry) -> Result<()> {
        let line = entry.to_jsonl()?;
        self.backend.append_lines(&self.shadow_ref, &[line])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::{Kind, Timestamp, TurnId};
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// An in-memory log keyed by ref, implementing both seams for tests.
    #[derive(Default)]
    struct FakeGit {
        logs: RefCell<HashMap<String, Vec<String>>>,
    }

    impl FakeGit {
        fn new() -> Self {
            Self::default()
        }
        /// Raw line count on a ref (to assert the inbound path writes nothing).
        fn line_count(&self, shadow_ref: &ShadowRef) -> usize {
            self.logs
                .borrow()
                .get(&shadow_ref.ref_name())
                .map(|v| v.len())
                .unwrap_or(0)
        }
    }

    impl LogSource for FakeGit {
        fn read_lines(&self, shadow_ref: &ShadowRef) -> Result<Vec<String>> {
            Ok(self
                .logs
                .borrow()
                .get(&shadow_ref.ref_name())
                .cloned()
                .unwrap_or_default())
        }
    }

    impl LogSink for FakeGit {
        fn append_lines(&mut self, shadow_ref: &ShadowRef, lines: &[String]) -> Result<()> {
            self.logs
                .borrow_mut()
                .entry(shadow_ref.ref_name())
                .or_default()
                .extend(lines.iter().cloned());
            Ok(())
        }
    }

    fn entry(id: EntryId, author: &str, kind: Kind, text: &str) -> Entry {
        Entry {
            id,
            author: Author::new(author),
            kind,
            text: text.into(),
            ts: Timestamp::new("2026-06-25T10:00:00Z"),
            turn: TurnId::new("turn-1"),
        }
    }

    fn seed(git: &FakeGit, shadow_ref: &ShadowRef, entries: &[Entry]) {
        let mut map = git.logs.borrow_mut();
        let log = map.entry(shadow_ref.ref_name()).or_default();
        for e in entries {
            log.push(e.to_jsonl().unwrap());
        }
    }

    #[test]
    fn ref_names_and_cursor_keys() {
        assert_eq!(ShadowRef::context("feature/login").ref_name(), "clair/feature/login");
        assert_eq!(ShadowRef::READY.ref_name(), "clair/ready");
        // Cursor key is path-safe (no slashes).
        let key = ShadowRef::context("feature/login").cursor_key();
        assert_eq!(key, "clair-feature-login");
        assert!(!key.contains('/'));
    }

    #[test]
    fn entries_since_filters_provenance_and_cursor() {
        let git = FakeGit::new();
        let ctx = ShadowRef::context("feature/login");

        let jb1 = entry(EntryId::now(), "JB", Kind::Prompt, "p1");
        let me1 = entry(EntryId::now(), "Rajiv", Kind::Prompt, "mine");
        let jb2 = entry(EntryId::now(), "JB", Kind::Summary, "s1");
        seed(&git, &ctx, &[jb1.clone(), me1.clone(), jb2.clone()]);

        let store = Store::new(git, Author::new("Rajiv"), ctx);
        let delivery = store.entries_since(&Cursor::Start).unwrap();

        // My own entry is dropped; JB's two survive, sorted by id.
        assert_eq!(delivery.entries, vec![jb1.clone(), jb2.clone()]);
        // next = max delivered id = jb2 (NOT including my own me1).
        assert_eq!(delivery.next, Cursor::At(jb2.id));
    }

    #[test]
    fn entries_since_respects_cursor_highwater() {
        let git = FakeGit::new();
        let ctx = ShadowRef::context("feature/login");

        let jb1 = entry(EntryId::now(), "JB", Kind::Prompt, "p1");
        let jb2 = entry(EntryId::now(), "JB", Kind::Summary, "s1");
        seed(&git, &ctx, &[jb1.clone(), jb2.clone()]);

        let store = Store::new(git, Author::new("Rajiv"), ctx);
        // After seeing jb1, only jb2 is delivered.
        let delivery = store.entries_since(&Cursor::At(jb1.id)).unwrap();
        assert_eq!(delivery.entries, vec![jb2.clone()]);
        assert_eq!(delivery.next, Cursor::At(jb2.id));
    }

    #[test]
    fn entries_since_skips_malformed_lines() {
        let git = FakeGit::new();
        let ctx = ShadowRef::context("feature/login");
        let jb1 = entry(EntryId::now(), "JB", Kind::Prompt, "p1");
        // Insert a malformed line between valid ones.
        {
            let mut map = git.logs.borrow_mut();
            let log = map.entry(ctx.ref_name()).or_default();
            log.push("{ this is not valid json".to_string());
            log.push(jb1.to_jsonl().unwrap());
            log.push(String::new());
        }
        let store = Store::new(git, Author::new("Rajiv"), ctx);
        let delivery = store.entries_since(&Cursor::Start).unwrap();
        assert_eq!(delivery.entries, vec![jb1.clone()]);
    }

    #[test]
    fn entries_since_dedups_by_id() {
        let git = FakeGit::new();
        let ctx = ShadowRef::context("feature/login");
        let jb1 = entry(EntryId::now(), "JB", Kind::Prompt, "p1");
        // Same entry appears twice on the ref (at-least-once delivery upstream).
        seed(&git, &ctx, &[jb1.clone(), jb1.clone()]);
        let store = Store::new(git, Author::new("Rajiv"), ctx);
        let delivery = store.entries_since(&Cursor::Start).unwrap();
        assert_eq!(delivery.entries, vec![jb1.clone()]);
    }

    /// The core concurrency-safety case: a peer entry whose id sorts BELOW my own
    /// most-recent append must still be delivered, because Delivery.next is the
    /// delivered-set max (not a global-max-incl-mine).
    #[test]
    fn peer_entry_below_my_latest_is_still_delivered() {
        let git = FakeGit::new();
        let ctx = ShadowRef::context("feature/login");

        // jb_old is minted FIRST (lower id), then my own entry (higher id).
        let jb_old = entry(EntryId::now(), "JB", Kind::Prompt, "concurrent");
        let mine = entry(EntryId::now(), "Rajiv", Kind::Prompt, "mine");
        assert!(jb_old.id < mine.id);

        // The log, as fetched, contains both. My cursor has NOT been advanced past
        // mine here (cursor is local; this models the delivered-set semantics).
        seed(&git, &ctx, &[jb_old.clone(), mine.clone()]);

        let store = Store::new(git, Author::new("Rajiv"), ctx);
        let delivery = store.entries_since(&Cursor::Start).unwrap();

        // JB's lower-id entry is delivered; my own is dropped by provenance.
        assert_eq!(delivery.entries, vec![jb_old.clone()]);
        // next = jb_old (the delivered-set max), NOT mine's higher id.
        assert_eq!(delivery.next, Cursor::At(jb_old.id));
    }

    #[test]
    fn empty_delivery_leaves_cursor_unchanged() {
        let git = FakeGit::new();
        let ctx = ShadowRef::context("feature/login");
        // Only my own entries on the ref.
        let mine = entry(EntryId::now(), "Rajiv", Kind::Prompt, "mine");
        seed(&git, &ctx, &[mine.clone()]);
        let store = Store::new(git, Author::new("Rajiv"), ctx);
        let cursor = Cursor::At(mine.id);
        let delivery = store.entries_since(&cursor).unwrap();
        assert!(delivery.entries.is_empty());
        assert_eq!(delivery.next, cursor);
    }

    #[test]
    fn entries_since_writes_nothing_loop_guard() {
        let git = FakeGit::new();
        let ctx = ShadowRef::context("feature/login");
        let jb1 = entry(EntryId::now(), "JB", Kind::Prompt, "p1");
        seed(&git, &ctx, &[jb1.clone()]);
        let before = git.line_count(&ctx);
        let store = Store::new(git, Author::new("Rajiv"), ctx.clone());
        let _ = store.entries_since(&Cursor::Start).unwrap();
        // Inbound read wrote nothing.
        assert_eq!(store.backend.line_count(&ctx), before);
    }

    #[test]
    fn append_then_read_excludes_my_own() {
        let ctx = ShadowRef::context("feature/login");
        let mut store = Store::new(FakeGit::new(), Author::new("Rajiv"), ctx.clone());
        let mine = entry(EntryId::now(), "Rajiv", Kind::Prompt, "mine");
        store.append(&mine).unwrap();
        // I appended exactly one line.
        assert_eq!(store.backend.line_count(&ctx), 1);
        // But reading back delivers nothing (provenance drops it).
        let delivery = store.entries_since(&Cursor::Start).unwrap();
        assert!(delivery.entries.is_empty());
    }

    #[test]
    fn branch_scope_is_structural() {
        // Two refs, two logs. A store bound to branch B never sees branch A's lines.
        let git = FakeGit::new();
        let branch_a = ShadowRef::context("feature/login");
        let branch_b = ShadowRef::context("main");
        let a_entry = entry(EntryId::now(), "JB", Kind::Prompt, "on A");
        seed(&git, &branch_a, &[a_entry.clone()]);

        let store_b = Store::new(git, Author::new("Sam"), branch_b);
        let delivery = store_b.entries_since(&Cursor::Start).unwrap();
        assert!(delivery.entries.is_empty(), "branch B must not see branch A entries");
    }
}
