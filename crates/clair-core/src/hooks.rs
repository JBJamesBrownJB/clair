//! THE single logic home for both Claude Code hooks.
//!
//! Both the real binary (`clair hook prompt` / `clair hook stop`) and the Tier-2
//! in-process harness call **these** functions — never re-implementing them — so
//! the path the tests exercise is byte-for-byte the path production runs (no
//! adapter drift; see open_risks "Adapter drift").
//!
//! The functions are *pure* in the sense that they take an explicit [`HookCtx`]:
//! no env, no stdin/stdout, no `exit`. The adapter layer (binary or harness) owns
//! all of that and just translates to/from a `HookCtx`.
//!
//! ## The single branch source
//! [`HookCtx`] carries exactly one `branch`. That one field derives the context
//! [`ShadowRef`] used for **both** the inbound read and the outbound append, AND
//! (via the caller's cursor store) the cursor key. Read ref, write ref and cursor
//! key therefore cannot desync — BRANCH-SCOPE is structural, not enforced by a
//! filter.
//!
//! ## The loop-guard
//! - `on_user_prompt_submit` does inbound FIRST (read peer entries, render,
//!   advance the LOCAL cursor) THEN outbound (append exactly one `prompt` entry).
//!   The inbound read writes nothing — the cursor is local — so receiving/
//!   injecting a peer entry produces zero new entries on the ref (spec §7).
//! - `on_stop` appends exactly one `summary` entry and never injects.

use crate::cursor::Cursor;
use crate::entry::{Author, Entry, EntryId, Kind, Timestamp, TurnId};
use crate::error::Result;
use crate::render;
use crate::store::{LogSink, LogSource, ShadowRef, Store};
use crate::transcript::Transcript;

/// Everything a hook needs, supplied explicitly by the adapter.
///
/// `B` is the git backend (anything that is both a [`LogSource`] and a
/// [`LogSink`]): the real [`crate::git::Repo`] in production, an in-memory fake in
/// the harness/tests. The `cursor` is borrowed mutably so the inbound path can
/// advance the caller's local high-water mark in place; the caller persists it.
pub struct HookCtx<'a, B> {
    /// The git backend (read + append).
    pub backend: B,
    /// My pairing identity (provenance filter source).
    pub author: Author,
    /// The SINGLE branch source: context ShadowRef (read + append) + cursor key.
    pub branch: String,
    /// My local last-seen cursor for this branch (advanced in place on inbound).
    pub cursor: &'a mut Cursor,
    /// The timestamp to stamp on any entry I write.
    pub now: Timestamp,
    /// The turn id = harness session id (ties a prompt to its later summary).
    pub turn: TurnId,
}

/// What a hook decided to do, for the adapter to serialise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookOutcome {
    /// `UserPromptSubmit`: optional framed `additionalContext` to inject, plus the
    /// id of the prompt entry pushed (if any).
    Inject {
        /// The framed peer context to inject, or `None` if there was nothing new.
        additional_context: Option<String>,
        /// The id of the `prompt` entry appended this turn (if the append ran).
        pushed: Option<EntryId>,
    },
    /// `Stop`: the id of the `summary` entry pushed (if any). Never injects.
    Captured {
        /// The id of the `summary` entry appended this turn (if any).
        pushed: Option<EntryId>,
    },
    /// Nothing happened (e.g. anti-recursion short-circuit).
    Noop,
}

impl<'a, B> HookCtx<'a, B> {
    /// The context [`ShadowRef`] derived from the single branch source.
    pub fn shadow_ref(&self) -> ShadowRef {
        ShadowRef::context(self.branch.clone())
    }

    /// Build an [`Entry`] authored by me for this turn.
    fn new_entry(&self, kind: Kind, text: String) -> Entry {
        Entry {
            id: EntryId::now(),
            author: self.author.clone(),
            kind,
            text,
            ts: self.now.clone(),
            turn: self.turn.clone(),
        }
    }
}

impl<'a, B: LogSource + LogSink> HookCtx<'a, B> {
    /// Handle a `UserPromptSubmit`: inbound (read peer deltas, render, advance the
    /// local cursor) THEN outbound (append exactly one `prompt` entry for my
    /// prompt). Returns the framed `additionalContext` (if any) and the pushed id.
    ///
    /// Order matters for the loop-guard and for not surfacing my own just-written
    /// prompt back to me on the same turn.
    pub fn on_user_prompt_submit(&mut self, prompt: &str) -> Result<HookOutcome> {
        let shadow_ref = self.shadow_ref();

        // --- INBOUND: read peer deltas, render, advance the LOCAL cursor. -------
        // This writes nothing to the ref (cursor is local) — the loop-guard.
        let additional_context = {
            let reader = Store::new(&self.backend, self.author.clone(), shadow_ref.clone());
            let delivery = reader.entries_since(self.cursor)?;
            *self.cursor = delivery.next;
            render::render_inbound(&delivery.entries)
        };

        // --- OUTBOUND: append exactly one prompt entry authored by me. ----------
        let entry = self.new_entry(Kind::Prompt, prompt.to_string());
        let pushed = entry.id;
        {
            let mut writer =
                Store::new(&mut self.backend, self.author.clone(), shadow_ref.clone());
            writer.append(&entry)?;
        }

        Ok(HookOutcome::Inject {
            additional_context,
            pushed: Some(pushed),
        })
    }

    /// Handle a `Stop`: distil the final assistant paragraph (honouring a
    /// `CLAIR-SUMMARY` sentinel if the Skill emitted one) and append exactly one
    /// `summary` entry. Never injects, never reads peer entries.
    ///
    /// If `stop_hook_active` is true the caller has already short-circuited; this
    /// function assumes it is being called for a real stop. If the transcript
    /// yields no assistant text, nothing is appended ([`HookOutcome::Captured`]
    /// with `pushed: None`).
    pub fn on_stop(&mut self, transcript: &Transcript) -> Result<HookOutcome> {
        let Some(summary) = transcript.distil_summary() else {
            return Ok(HookOutcome::Captured { pushed: None });
        };
        if summary.trim().is_empty() {
            return Ok(HookOutcome::Captured { pushed: None });
        }

        let shadow_ref = self.shadow_ref();
        let entry = self.new_entry(Kind::Summary, summary);
        let pushed = entry.id;
        let mut writer = Store::new(&mut self.backend, self.author.clone(), shadow_ref);
        writer.append(&entry)?;

        Ok(HookOutcome::Captured {
            pushed: Some(pushed),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// In-memory git backend implementing both seams (mirrors store.rs's fake).
    #[derive(Default)]
    struct FakeGit {
        logs: RefCell<HashMap<String, Vec<String>>>,
    }

    impl FakeGit {
        fn new() -> Self {
            Self::default()
        }
        fn lines(&self, shadow_ref: &ShadowRef) -> Vec<String> {
            self.logs
                .borrow()
                .get(&shadow_ref.ref_name())
                .cloned()
                .unwrap_or_default()
        }
        fn count(&self, shadow_ref: &ShadowRef) -> usize {
            self.lines(shadow_ref).len()
        }
        fn seed(&self, shadow_ref: &ShadowRef, entries: &[Entry]) {
            let mut map = self.logs.borrow_mut();
            let log = map.entry(shadow_ref.ref_name()).or_default();
            for e in entries {
                log.push(e.to_jsonl().unwrap());
            }
        }
    }

    impl LogSource for FakeGit {
        fn read_lines(&self, shadow_ref: &ShadowRef) -> Result<Vec<String>> {
            Ok(self.lines(shadow_ref))
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

    fn entry(author: &str, kind: Kind, text: &str) -> Entry {
        Entry {
            id: EntryId::now(),
            author: Author::new(author),
            kind,
            text: text.into(),
            ts: Timestamp::new("2026-06-25T10:00:00Z"),
            turn: TurnId::new("turn-x"),
        }
    }

    fn ctx<'a>(
        backend: FakeGit,
        me: &str,
        branch: &str,
        cursor: &'a mut Cursor,
    ) -> HookCtx<'a, FakeGit> {
        HookCtx {
            backend,
            author: Author::new(me),
            branch: branch.to_string(),
            cursor,
            now: Timestamp::new("2026-06-25T10:00:00Z"),
            turn: TurnId::new("turn-x"),
        }
    }

    #[test]
    fn prompt_injects_peer_entry_and_appends_my_prompt() {
        let git = FakeGit::new();
        let shadow = ShadowRef::context("feature/login");
        let jb = entry("JB", Kind::Prompt, "refactor the auth guard to use the new middleware");
        git.seed(&shadow, &[jb.clone()]);

        let mut cursor = Cursor::Start;
        let mut hc = ctx(git, "Rajiv", "feature/login", &mut cursor);
        let outcome = hc.on_user_prompt_submit("my own prompt").unwrap();

        match outcome {
            HookOutcome::Inject {
                additional_context,
                pushed,
            } => {
                let ac = additional_context.expect("JB's entry should be injected");
                assert!(ac.contains("↪ JB asked his AI:"));
                assert!(ac.contains("refactor the auth guard to use the new middleware"));
                assert!(pushed.is_some());
            }
            other => panic!("expected Inject, got {other:?}"),
        }

        // Exactly ONE new line was written (my prompt). JB's seed + my prompt = 2.
        assert_eq!(hc.backend.count(&shadow), 2);
        // The cursor advanced to JB's id (the delivered-set max).
        assert_eq!(cursor, Cursor::At(jb.id));
    }

    #[test]
    fn loop_guard_inbound_writes_only_my_prompt_not_peer_entries() {
        let git = FakeGit::new();
        let shadow = ShadowRef::context("feature/login");
        git.seed(&shadow, &[entry("JB", Kind::Prompt, "p1"), entry("JB", Kind::Summary, "s1")]);
        let before = git.count(&shadow);

        let mut cursor = Cursor::Start;
        let mut hc = ctx(git, "Rajiv", "feature/login", &mut cursor);
        hc.on_user_prompt_submit("mine").unwrap();

        // Only my own single prompt was appended on top of the two peer entries.
        assert_eq!(hc.backend.count(&shadow), before + 1);
        // And every peer-authored line is untouched / no Rajiv lines but mine.
        let mine: Vec<Entry> = hc
            .backend
            .lines(&shadow)
            .iter()
            .filter_map(|l| Entry::from_jsonl(l).ok())
            .filter(|e| e.author == Author::new("Rajiv"))
            .collect();
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].kind, Kind::Prompt);
    }

    #[test]
    fn second_interaction_does_not_redeliver_the_same_peer_entry() {
        let git = FakeGit::new();
        let shadow = ShadowRef::context("feature/login");
        git.seed(&shadow, &[entry("JB", Kind::Prompt, "only once")]);

        let mut cursor = Cursor::Start;
        let mut hc = ctx(git, "Rajiv", "feature/login", &mut cursor);

        // First interaction injects JB's entry.
        let first = hc.on_user_prompt_submit("turn 1").unwrap();
        let HookOutcome::Inject { additional_context, .. } = first else {
            panic!("expected Inject");
        };
        assert!(additional_context.unwrap().contains("only once"));

        // Second interaction: nothing new from JB → no additionalContext.
        let second = hc.on_user_prompt_submit("turn 2").unwrap();
        let HookOutcome::Inject { additional_context, .. } = second else {
            panic!("expected Inject");
        };
        assert_eq!(additional_context, None, "peer entry must not be re-delivered");
    }

    #[test]
    fn empty_inbound_emits_no_additional_context_but_still_pushes_my_prompt() {
        let git = FakeGit::new();
        let shadow = ShadowRef::context("feature/login");
        let mut cursor = Cursor::Start;
        let mut hc = ctx(git, "Rajiv", "feature/login", &mut cursor);

        let outcome = hc.on_user_prompt_submit("hello").unwrap();
        match outcome {
            HookOutcome::Inject { additional_context, pushed } => {
                assert_eq!(additional_context, None);
                assert!(pushed.is_some());
            }
            other => panic!("expected Inject, got {other:?}"),
        }
        assert_eq!(hc.backend.count(&shadow), 1);
    }

    #[test]
    fn stop_appends_distilled_summary_and_never_injects() {
        let git = FakeGit::new();
        let shadow = ShadowRef::context("feature/login");
        let mut cursor = Cursor::Start;
        let mut hc = ctx(git, "JB", "feature/login", &mut cursor);

        let transcript = Transcript::from_jsonl(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"working...\n\nMoved the guard into AuthMiddleware; 1 test still failing on the expired-token case."}]}}"#,
        );
        let outcome = hc.on_stop(&transcript).unwrap();

        match outcome {
            HookOutcome::Captured { pushed } => assert!(pushed.is_some()),
            other => panic!("expected Captured, got {other:?}"),
        }
        // One summary entry written.
        assert_eq!(hc.backend.count(&shadow), 1);
        let written = Entry::from_jsonl(&hc.backend.lines(&shadow)[0]).unwrap();
        assert_eq!(written.kind, Kind::Summary);
        assert_eq!(
            written.text,
            "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case."
        );
        assert_eq!(written.author, Author::new("JB"));
    }

    #[test]
    fn stop_with_empty_transcript_writes_nothing() {
        let git = FakeGit::new();
        let shadow = ShadowRef::context("feature/login");
        let mut cursor = Cursor::Start;
        let mut hc = ctx(git, "JB", "feature/login", &mut cursor);

        let outcome = hc.on_stop(&Transcript::from_jsonl("")).unwrap();
        assert_eq!(outcome, HookOutcome::Captured { pushed: None });
        assert_eq!(hc.backend.count(&shadow), 0);
    }

    #[test]
    fn branch_scope_is_structural_read_write_cursor_share_one_branch() {
        // An entry on branch A is invisible to a ctx bound to branch B.
        let git = FakeGit::new();
        let branch_a = ShadowRef::context("feature/login");
        git.seed(&branch_a, &[entry("JB", Kind::Prompt, "on A")]);

        let mut cursor = Cursor::Start;
        let mut hc = ctx(git, "Sam", "main", &mut cursor);
        let outcome = hc.on_user_prompt_submit("on B").unwrap();
        let HookOutcome::Inject { additional_context, .. } = outcome else {
            panic!("expected Inject");
        };
        assert_eq!(additional_context, None, "branch B must not see branch A");

        // The ctx's read/write/cursor all derive from the one branch.
        assert_eq!(hc.shadow_ref(), ShadowRef::context("main"));
        assert_eq!(hc.backend.count(&branch_a), 1, "branch A untouched");
        assert_eq!(hc.backend.count(&ShadowRef::context("main")), 1, "my prompt on B");
    }
}
