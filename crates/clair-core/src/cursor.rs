//! The local, per-consumer last-seen cursor.
//!
//! A [`Cursor`] is a high-water mark over [`EntryId`]s. It is **local state only**
//! — it is never written to any `clair/` branch. That is precisely what keeps the
//! inbound (read/inject) path from ever needing a write, so the loop-guard holds
//! by construction (see slice spec §7 and ADR 0004).
//!
//! Inbound delivery advances the cursor to the max id *actually delivered* this
//! fetch (see [`crate::store`]), so a concurrent peer entry whose UUIDv7 sorts
//! below my own latest append is not swallowed.
//!
//! The file-backed store lives at `<GIT_DIR>/clair/cursor-<sanitized-branch>`;
//! that path resolution depends on the git module and is wired up in a later
//! stage. This module owns the [`Cursor`] type, the [`CursorStore`] trait, and an
//! in-memory store used by unit tests and the harness.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::entry::EntryId;
use crate::error::{CoreError, Result};
use crate::store::ShadowRef;

/// A per-consumer last-seen high-water mark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Cursor {
    /// Nothing seen yet — the next read delivers the full backlog once.
    #[default]
    Start,
    /// The highest entry id delivered so far.
    At(EntryId),
}

impl Cursor {
    /// True if `id` is strictly newer than this cursor (i.e. should be delivered).
    pub fn is_after(&self, id: &EntryId) -> bool {
        match self {
            Cursor::Start => true,
            Cursor::At(seen) => id > seen,
        }
    }

    /// The id this cursor points at, if any.
    pub fn id(&self) -> Option<EntryId> {
        match self {
            Cursor::Start => None,
            Cursor::At(id) => Some(*id),
        }
    }
}

/// Persistence for a [`Cursor`], keyed by the [`ShadowRef`] it tracks.
pub trait CursorStore {
    /// Load the cursor for `shadow_ref` (defaulting to [`Cursor::Start`] if absent).
    fn load(&self, shadow_ref: &ShadowRef) -> Result<Cursor>;
    /// Persist the cursor for `shadow_ref`.
    fn save(&mut self, shadow_ref: &ShadowRef, cursor: &Cursor) -> Result<()>;
}

/// An in-memory cursor store, used by unit tests and the in-process harness.
///
/// Cheaply cloneable; clones share the same underlying map so a cursor saved
/// through one handle is visible through another (mirrors the on-disk store's
/// single-source-of-truth semantics within a process).
#[derive(Debug, Clone, Default)]
pub struct MemoryCursorStore {
    inner: Arc<Mutex<HashMap<String, Cursor>>>,
}

impl MemoryCursorStore {
    /// Construct an empty store.
    pub fn new() -> Self {
        Self::default()
    }
}

impl CursorStore for MemoryCursorStore {
    fn load(&self, shadow_ref: &ShadowRef) -> Result<Cursor> {
        let map = self
            .inner
            .lock()
            .map_err(|e| crate::error::CoreError::Cursor(e.to_string()))?;
        Ok(map.get(&shadow_ref.cursor_key()).copied().unwrap_or_default())
    }

    fn save(&mut self, shadow_ref: &ShadowRef, cursor: &Cursor) -> Result<()> {
        let mut map = self
            .inner
            .lock()
            .map_err(|e| crate::error::CoreError::Cursor(e.to_string()))?;
        map.insert(shadow_ref.cursor_key(), *cursor);
        Ok(())
    }
}

/// A file-backed cursor store rooted at a directory (in production,
/// `<GIT_DIR>/clair/`). Each ref's cursor is a single small file named
/// `cursor-<sanitized-branch>` containing the high-water EntryId (or empty for
/// [`Cursor::Start`]).
///
/// The directory is the SAME one `clair with` uses for its session-settings and
/// shims (both derive from `git rev-parse --git-dir`), so they stay co-located and
/// worktree-correct. The cursor is **never** written to any clair branch — it is
/// purely local, which is what keeps the inbound path write-free (loop-guard).
#[derive(Debug, Clone)]
pub struct FileCursorStore {
    dir: PathBuf,
}

impl FileCursorStore {
    /// Create a store rooted at `dir` (typically `<GIT_DIR>/clair`).
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        FileCursorStore { dir: dir.into() }
    }

    /// The on-disk path for a ref's cursor file.
    fn path(&self, shadow_ref: &ShadowRef) -> PathBuf {
        self.dir.join(format!("cursor-{}", shadow_ref.cursor_key()))
    }
}

impl CursorStore for FileCursorStore {
    fn load(&self, shadow_ref: &ShadowRef) -> Result<Cursor> {
        let path = self.path(shadow_ref);
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Cursor::Start),
            Err(e) => return Err(CoreError::Cursor(e.to_string())),
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Ok(Cursor::Start);
        }
        let uuid = uuid::Uuid::parse_str(trimmed)
            .map_err(|e| CoreError::Cursor(format!("bad cursor id: {e}")))?;
        Ok(Cursor::At(EntryId(uuid)))
    }

    fn save(&mut self, shadow_ref: &ShadowRef, cursor: &Cursor) -> Result<()> {
        std::fs::create_dir_all(&self.dir).map_err(|e| CoreError::Cursor(e.to_string()))?;
        let path = self.path(shadow_ref);
        let body = match cursor {
            Cursor::Start => String::new(),
            Cursor::At(id) => id.to_string(),
        };
        std::fs::write(&path, body).map_err(|e| CoreError::Cursor(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::EntryId;

    #[test]
    fn start_delivers_everything() {
        let c = Cursor::Start;
        assert!(c.is_after(&EntryId::now()));
        assert_eq!(c.id(), None);
    }

    #[test]
    fn at_filters_by_strict_greater_than() {
        let a = EntryId::now();
        let b = EntryId::now();
        assert!(a < b, "ids must be ordered for this test");
        let c = Cursor::At(a);
        assert!(!c.is_after(&a), "an id equal to the cursor is not after it");
        assert!(c.is_after(&b), "a newer id is after the cursor");
        assert_eq!(c.id(), Some(a));
    }

    #[test]
    fn memory_store_roundtrips_per_ref() {
        let mut store = MemoryCursorStore::new();
        let ctx = ShadowRef::context("feature/login");
        let ready = ShadowRef::READY;

        assert_eq!(store.load(&ctx).unwrap(), Cursor::Start);

        let id = EntryId::now();
        store.save(&ctx, &Cursor::At(id)).unwrap();
        assert_eq!(store.load(&ctx).unwrap(), Cursor::At(id));
        // A different ref is independent.
        assert_eq!(store.load(&ready).unwrap(), Cursor::Start);
    }

    #[test]
    fn memory_store_clones_share_state() {
        let store = MemoryCursorStore::new();
        let mut a = store.clone();
        let b = store.clone();
        let ctx = ShadowRef::context("feature/login");
        let id = EntryId::now();
        a.save(&ctx, &Cursor::At(id)).unwrap();
        assert_eq!(b.load(&ctx).unwrap(), Cursor::At(id));
    }

    #[test]
    fn file_store_roundtrips_and_defaults_to_start() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = FileCursorStore::new(tmp.path().join("clair"));
        let ctx = ShadowRef::context("feature/login");

        // Absent file => Start.
        assert_eq!(store.load(&ctx).unwrap(), Cursor::Start);

        let id = EntryId::now();
        store.save(&ctx, &Cursor::At(id)).unwrap();
        assert_eq!(store.load(&ctx).unwrap(), Cursor::At(id));

        // A different ref is independent.
        assert_eq!(store.load(&ShadowRef::READY).unwrap(), Cursor::Start);

        // Saving Start clears it back to Start.
        store.save(&ctx, &Cursor::Start).unwrap();
        assert_eq!(store.load(&ctx).unwrap(), Cursor::Start);
    }

    #[test]
    fn file_store_uses_path_safe_filenames() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = FileCursorStore::new(tmp.path());
        let ctx = ShadowRef::context("feature/login");
        let id = EntryId::now();
        store.save(&ctx, &Cursor::At(id)).unwrap();
        // The branch slash did not create a subdirectory.
        let expected = tmp.path().join("cursor-clair-feature-login");
        assert!(expected.exists(), "flat cursor file should exist at {expected:?}");
    }
}
