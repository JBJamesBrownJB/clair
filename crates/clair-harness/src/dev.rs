//! A `Dev` — one developer's machine, mocked around the REAL `clair_core` logic.
//!
//! A [`Dev`] owns a real git clone of the shared bare remote and an identity. It
//! mocks Claude Code only at the *adapter* boundary: `submit_prompt` and
//! `finish_turn` build a [`clair_core::HookCtx`] and call
//! `clair_core::hooks::on_user_prompt_submit` / `on_stop` — the very same functions
//! the production `clair hook` subcommands call — so the path under test is the
//! production path (no adapter drift; see slice open_risks).
//!
//! Everything else is real too: a real [`Repo`] (git shell-out) against a real
//! bare remote, a real [`FileCursorStore`] under `<GIT_DIR>/clair/`, and the real
//! `registry`. The only thing absent is `claude -p` itself; the prompt/reply text
//! is supplied by the test (deterministic, no LLM).

use std::path::{Path, PathBuf};
use std::process::Command;

use clair_core::cursor::CursorStore;
use clair_core::hooks::{HookCtx, HookOutcome};
use clair_core::transcript::Transcript;
use clair_core::{
    registry, Author, FileCursorStore, ReadyPeer, Repo, ShadowRef, Timestamp, TurnId,
};

use crate::injected::Injected;

/// One developer participating in a pairing session.
pub struct Dev {
    /// The pairing handle / author identity.
    handle: String,
    /// The working-tree root of this Dev's clone.
    root: PathBuf,
    /// The branch this Dev's hooks are wired to (the single branch source).
    branch: String,
    /// The session id, used as the turn id tying a prompt to its later summary.
    session: String,
    /// A monotonic clock-ish counter so each entry gets a distinct, ordered ts.
    tick: u64,
}

impl Dev {
    /// Construct a Dev from an existing clone root, handle and branch.
    pub(crate) fn new(handle: impl Into<String>, root: PathBuf, branch: impl Into<String>) -> Self {
        let handle = handle.into();
        let session = format!("session-{handle}");
        Dev {
            handle,
            root,
            branch: branch.into(),
            session,
            tick: 0,
        }
    }

    /// This Dev's pairing handle.
    pub fn handle(&self) -> &str {
        &self.handle
    }

    /// The branch this Dev's hooks are wired to.
    pub fn branch(&self) -> &str {
        &self.branch
    }

    /// The working-tree root of this Dev's clone.
    pub fn root(&self) -> &Path {
        &self.root
    }

    // --- git plumbing for the harness itself ------------------------------------

    /// The real [`Repo`] for this Dev (git shell-out against the shared remote).
    fn repo(&self) -> Repo {
        Repo::open(self.root.clone())
    }

    /// The author identity for provenance.
    fn author(&self) -> Author {
        Author::new(&self.handle)
    }

    /// The context [`ShadowRef`] for this Dev's wired branch.
    fn shadow_ref(&self) -> ShadowRef {
        ShadowRef::context(self.branch.clone())
    }

    /// The file-backed cursor store under `<GIT_DIR>/clair/` (the production path).
    fn cursor_store(&self) -> FileCursorStore {
        let dir = self
            .repo()
            .git_dir()
            .expect("git_dir resolves")
            .join("clair");
        FileCursorStore::new(dir)
    }

    /// A fresh, monotonically-increasing timestamp for this Dev's next entry.
    fn next_ts(&mut self) -> Timestamp {
        self.tick += 1;
        // Distinct, ordered, RFC3339-shaped — content is irrelevant to ordering
        // (ids carry the order) but distinctness keeps the wire honest.
        Timestamp::new(format!("2026-06-25T10:00:{:02}Z", self.tick.min(59)))
    }

    // --- the mocked Claude adapter boundary -------------------------------------

    /// Mock one `UserPromptSubmit`: run the REAL inbound+outbound hook and persist
    /// the cursor, returning the typed view of what would be injected.
    ///
    /// This is the exact sequence the production `clair hook prompt` adapter runs:
    /// load cursor → `on_user_prompt_submit` (inbound read+render+advance, then
    /// outbound append) → save the advanced cursor.
    pub fn submit_prompt(&mut self, prompt: &str) -> Injected {
        let repo = self.repo();
        let shadow = self.shadow_ref();
        let mut store = self.cursor_store();
        let mut cursor = store.load(&shadow).expect("load cursor");
        let ts = self.next_ts();

        let outcome = {
            let mut ctx = HookCtx {
                backend: repo.clone(),
                author: self.author(),
                branch: self.branch.clone(),
                cursor: &mut cursor,
                now: ts,
                turn: TurnId::new(self.session.clone()),
            };
            ctx.on_user_prompt_submit(prompt).expect("prompt hook")
        };

        store.save(&shadow, &cursor).expect("save cursor");

        match outcome {
            HookOutcome::Inject {
                additional_context, ..
            } => Injected::new(additional_context),
            other => panic!("expected Inject from on_user_prompt_submit, got {other:?}"),
        }
    }

    /// Mock one `Stop`: run the REAL `on_stop` over a transcript whose final
    /// assistant reply is `reply`, appending a distilled `summary` entry.
    pub fn finish_turn(&mut self, reply: &str) {
        let repo = self.repo();
        let shadow = self.shadow_ref();
        let mut store = self.cursor_store();
        // Stop never reads inbound, but HookCtx still wants a cursor handle.
        let mut cursor = store.load(&shadow).expect("load cursor");
        let ts = self.next_ts();

        let transcript = transcript_with_reply(reply);
        {
            let mut ctx = HookCtx {
                backend: repo.clone(),
                author: self.author(),
                branch: self.branch.clone(),
                cursor: &mut cursor,
                now: ts,
                turn: TurnId::new(self.session.clone()),
            };
            ctx.on_stop(&transcript).expect("stop hook");
        }
        // Stop doesn't advance the cursor, but persist for symmetry / no-op safety.
        store.save(&shadow, &cursor).expect("save cursor");
    }

    /// A read-only peek at what would be injected on the NEXT interaction WITHOUT
    /// writing a prompt — i.e. the inbound side only. Does NOT advance the cursor,
    /// so it is a non-destructive probe (used to assert "is anything pending?").
    pub fn injected_context(&self) -> Injected {
        let repo = self.repo();
        let shadow = self.shadow_ref();
        let store = self.cursor_store();
        let cursor = store.load(&shadow).expect("load cursor");

        let reader = clair_core::Store::new(&repo, self.author(), shadow);
        let delivery = reader.entries_since(&cursor).expect("entries_since");
        Injected::new(clair_core::render::render_inbound(&delivery.entries))
    }

    // --- the human commands -----------------------------------------------------

    /// `clair ready`: announce this Dev as available to pair on its current branch.
    pub fn ready(&self) {
        let repo = self.repo();
        let slug = repo.repo_slug().expect("repo slug");
        let branch = repo.current_branch().expect("current branch");
        registry::announce(&repo, &self.handle, &slug, &branch, &now_ts())
            .expect("announce");
    }

    /// `clair pair`: list everyone ready to pair in this repo (latest-per-user).
    pub fn pair(&self) -> Vec<ReadyPeer> {
        let repo = self.repo();
        let slug = repo.repo_slug().expect("repo slug");
        registry::list(&repo, &slug).expect("list ready peers")
    }

    /// `clair with <handle>`: resolve the peer, dirty-guard, fetch + checkout their
    /// branch, append a join signal, and re-wire this Dev's hooks to that branch.
    ///
    /// Returns `Ok(branch)` on success. On a dirty tree returns `Err(WithError::Dirty)`
    /// with HEAD untouched and no signal written (clair never moves your work).
    pub fn with(&mut self, handle: &str) -> Result<String, WithError> {
        let repo = self.repo();
        let slug = repo.repo_slug().map_err(|e| WithError::Other(e.to_string()))?;
        let peer = registry::resolve(&repo, &slug, handle)
            .map_err(|e| WithError::Resolve(e.to_string()))?;
        let target = peer.branch.clone();

        // Dirty-guard + fetch + checkout (the one deliberate worktree mutation).
        match repo.checkout_branch(&target) {
            Ok(()) => {}
            Err(clair_core::CoreError::DirtyTree) => return Err(WithError::Dirty),
            Err(e) => return Err(WithError::Other(e.to_string())),
        }

        // Append the join signal so the peer sees "<me> joined …" on their next turn.
        let ts = self.next_ts();
        let signal = clair_core::Entry {
            id: clair_core::EntryId::now(),
            author: self.author(),
            kind: clair_core::Kind::Signal,
            text: target.clone(),
            ts,
            turn: TurnId::new(format!("with-{}", self.session)),
        };
        let line = signal.to_jsonl().map_err(|e| WithError::Other(e.to_string()))?;
        repo.append_lines(&Repo::context_ref(&target), &[line])
            .map_err(|e| WithError::Other(e.to_string()))?;

        // Re-wire this Dev to the peer's branch (the single branch source updates).
        self.branch = target.clone();
        Ok(target)
    }

    // --- assertions exposed for the BDD/Tier-2 layer ----------------------------

    /// Count entries currently on this Dev's wired context ref (read via git).
    pub fn entry_count(&self) -> usize {
        self.entries().len()
    }

    /// Count entries on the wired context ref authored by `author`.
    pub fn entry_count_by(&self, author: &str) -> usize {
        let needle = Author::new(author);
        self.entries().iter().filter(|e| e.author == needle).count()
    }

    /// All entries currently on this Dev's wired context ref (oldest first).
    pub fn entries(&self) -> Vec<clair_core::Entry> {
        let repo = self.repo();
        let lines = repo
            .read_log(&self.shadow_ref().ref_name())
            .unwrap_or_default();
        lines
            .iter()
            .filter_map(|l| clair_core::Entry::from_jsonl(l).ok())
            .collect()
    }

    /// The single-branch-source invariant: the read ref, the write ref and the
    /// cursor key all derive from the one wired branch. Returns `true` when they
    /// agree (they always do by construction — this asserts the construction).
    pub fn assert_branch_source_unified(&self) -> bool {
        let read_ref = self.shadow_ref().ref_name();
        let write_ref = Repo::context_ref(&self.branch);
        let cursor_key = self.shadow_ref().cursor_key();
        let expected_key = ShadowRef::context(self.branch.clone()).cursor_key();
        read_ref == write_ref && cursor_key == expected_key
    }

    /// True if this Dev's working tree currently has uncommitted changes.
    pub fn is_dirty(&self) -> bool {
        self.repo().is_dirty().unwrap_or(false)
    }

    /// The branch HEAD currently points at (via git), for assertions after `with`.
    pub fn head_branch(&self) -> String {
        self.repo().current_branch().unwrap_or_default()
    }

    /// Dirty the working tree by writing an uncommitted file (test helper).
    pub fn dirty_tree(&self, name: &str) {
        std::fs::write(self.root.join(name), "uncommitted\n").expect("write dirty file");
    }
}

/// Why a `with` failed (so the BDD layer can assert the dirty-guard distinctly).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WithError {
    /// The working tree was dirty — clair refused to move your work.
    Dirty,
    /// The handle could not be resolved (absent / ambiguous).
    Resolve(String),
    /// Any other failure.
    Other(String),
}

/// The in-process driver trait the BDD layer and a future Tier-3 `LiveDev` share.
pub trait DevDriver {
    /// Submit a prompt and return what would be injected.
    fn submit_prompt(&mut self, prompt: &str) -> Injected;
    /// Finish a turn whose final reply is `reply`.
    fn finish_turn(&mut self, reply: &str);
    /// Peek at what would be injected next (non-destructive).
    fn injected_context(&self) -> Injected;
}

impl DevDriver for Dev {
    fn submit_prompt(&mut self, prompt: &str) -> Injected {
        Dev::submit_prompt(self, prompt)
    }
    fn finish_turn(&mut self, reply: &str) {
        Dev::finish_turn(self, reply)
    }
    fn injected_context(&self) -> Injected {
        Dev::injected_context(self)
    }
}

/// Build a Claude-Code-shaped transcript whose single assistant message is `reply`.
fn transcript_with_reply(reply: &str) -> Transcript {
    let record = serde_json::json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": [{ "type": "text", "text": reply }] }
    });
    Transcript::from_jsonl(&record.to_string())
}

/// An RFC3339 UTC timestamp for "now" (registry rows are time-ordered by display).
fn now_ts() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // A monotonic-ish second count is enough for latest-per-user fold ordering.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("ts-{secs}")
}

/// Run `git <args>` in `dir`, panicking on failure (harness-internal setup only).
pub(crate) fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git invocation");
    assert!(
        out.status.success(),
        "git {args:?} in {dir:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}
