//! BDD integration-test target (cucumber-rs), `harness = false`.
//!
//! Drives the full slice-1 user scenario (spec §1a) plus the loop-guard and
//! branch-scope invariants (§7, §10) against the REAL `clair_core` logic through
//! the in-process [`clair_harness::World`] — two `Dev` clones on a local bare repo
//! as the remote (spec §9), deterministic, with no `claude -p` involved.
//!
//! The step definitions are thin: they translate Gherkin into `Dev` calls and
//! assert on the typed `Injected` view (provenance, framing, scope) — never on LLM
//! wording, because there is no LLM. `fail_on_skipped()` makes an unmatched step a
//! hard failure, so the feature files and step defs cannot silently drift apart.

use cucumber::{given, then, when, World as _};

use clair_harness::{Injected, WithError, World};

// ── Given: world + devs ─────────────────────────────────────────────────────

#[given("a fresh pairing world on the shared remote")]
fn fresh_world(_w: &mut World) {
    // `World::new` (the cucumber init) already stood up the bare remote; nothing
    // more to do. This step exists so the Background reads naturally.
}

#[given(regex = r#"^(\w+) has a clone on branch "([^"]+)"$"#)]
fn dev_clone(w: &mut World, handle: String, branch: String) {
    w.add_dev(&handle, &branch);
}

#[given(regex = r#"^(\w+)'s working tree is dirty$"#)]
fn make_dirty(w: &mut World, handle: String) {
    w.dev(&handle).dirty_tree("scratch.txt");
    assert!(w.dev(&handle).is_dirty(), "tree should now be dirty");
}

#[given(regex = r#"^(\w+) submits the prompt "([^"]+)"$"#)]
fn given_submit(w: &mut World, handle: String, prompt: String) {
    let _ = w.dev_mut(&handle).submit_prompt(&prompt);
}

#[given(regex = r#"^(\w+) runs ready$"#)]
fn given_ready(w: &mut World, handle: String) {
    w.dev(&handle).ready();
}

// ── When: human commands + interactions ─────────────────────────────────────

#[when(regex = r#"^(\w+) runs ready$"#)]
fn when_ready(w: &mut World, handle: String) {
    w.dev(&handle).ready();
}

#[when(regex = r#"^(\w+) runs pair$"#)]
fn when_pair(w: &mut World, handle: String) {
    // `pair` is read-only; we re-run it inside the Then steps that assert on it,
    // so this step just confirms it does not error.
    let _ = w.dev(&handle).pair();
}

#[when(regex = r#"^(\w+) runs with (\w+)$"#)]
fn when_with(w: &mut World, handle: String, target: String) {
    let result = w.dev_mut(&handle).with(&target);
    w.last_with = Some(result);
}

#[when(regex = r#"^(\w+) submits the prompt "([^"]+)"$"#)]
fn when_submit(w: &mut World, handle: String, prompt: String) {
    // A submit runs the inbound hook too, so the submitter may itself see peer
    // context. Stash it so a following Then can assert on what this dev saw.
    let injected = w.dev_mut(&handle).submit_prompt(&prompt);
    w.stash_injected(&handle, injected);
}

#[when(regex = r#"^(\w+) finishes a turn concluding "([^"]+)"$"#)]
fn when_finish(w: &mut World, handle: String, conclusion: String) {
    w.dev_mut(&handle).finish_turn(&conclusion);
}

#[when(regex = r#"^(\w+) interacts$"#)]
fn when_interacts(w: &mut World, handle: String) {
    // A bare interaction: submit an innocuous prompt so the inbound hook runs and
    // the cursor advances exactly as production would. The injected view is then
    // asserted via a non-destructive peek would be stale, so we capture it here.
    let injected = w.dev_mut(&handle).submit_prompt("(continue)");
    w.stash_injected(&handle, injected);
}

#[when(regex = r#"^(\w+) interacts again$"#)]
fn when_interacts_again(w: &mut World, handle: String) {
    let injected = w.dev_mut(&handle).submit_prompt("(continue)");
    w.stash_injected(&handle, injected);
}

// ── Then: assertions on the typed Injected view + git effects ───────────────

#[then(regex = r#"^(\w+) sees (\w+) ready on branch "([^"]+)"$"#)]
fn sees_ready(w: &mut World, viewer: String, peer: String, branch: String) {
    let peers = w.dev(&viewer).pair();
    let found = peers
        .iter()
        .find(|p| p.user.eq_ignore_ascii_case(&peer))
        .unwrap_or_else(|| panic!("{viewer} should see {peer} in pair list: {peers:?}"));
    assert_eq!(found.branch, branch, "wrong branch for {peer}");
}

#[then(regex = r#"^(\w+)'s HEAD is on branch "([^"]+)"$"#)]
fn head_on(w: &mut World, handle: String, branch: String) {
    assert_eq!(
        w.dev(&handle).head_branch(),
        branch,
        "{handle}'s HEAD should be on {branch}"
    );
}

#[then(regex = r#"^(\w+)'s injected context shows (\w+) joined on "([^"]+)"$"#)]
fn shows_join(w: &mut World, viewer: String, joiner: String, _branch: String) {
    let injected = w.dev(&viewer).injected_context();
    assert!(
        injected.mentions_join_from(&joiner),
        "{viewer} should see {joiner}'s join under the clair banner; got: {:?}",
        injected.text()
    );
    assert!(injected.has_signal(), "join must use the signal banner, not background");
}

#[then("the with command is rejected for a dirty tree")]
fn with_rejected_dirty(w: &mut World) {
    match w.last_with.as_ref().expect("a with result was recorded") {
        Err(WithError::Dirty) => {}
        other => panic!("expected a dirty-tree rejection, got {other:?}"),
    }
}

#[then(regex = r#"^(\w+)'s injected context shows (\w+) asked "([^"]+)"$"#)]
fn shows_prompt(w: &mut World, viewer: String, author: String, text: String) {
    let injected = current(w, &viewer);
    assert!(
        injected.mentions_prompt_from(&author),
        "{viewer} should see {author}'s prompt; got: {:?}",
        injected.text()
    );
    assert!(
        injected.contains(&text),
        "{viewer}'s context should contain the prompt text {text:?}; got: {:?}",
        injected.text()
    );
}

#[then(regex = r#"^(\w+)'s injected context shows (\w+) concluded "([^"]+)"$"#)]
fn shows_conclusion(w: &mut World, viewer: String, author: String, text: String) {
    let injected = current(w, &viewer);
    assert!(
        injected.mentions_conclusion_from(&author),
        "{viewer} should see {author}'s conclusion; got: {:?}",
        injected.text()
    );
    assert!(
        injected.contains(&text),
        "{viewer}'s context should contain the conclusion text; got: {:?}",
        injected.text()
    );
}

#[then(regex = r#"^(\w+)'s injected context is framed as passive background$"#)]
fn framed_background(w: &mut World, viewer: String) {
    let injected = current(w, &viewer);
    assert!(
        injected.has_background(),
        "{viewer}'s context must carry the 'your AI won't act on this' banner; got: {:?}",
        injected.text()
    );
}

#[then(regex = r#"^(\w+)'s injected context is empty$"#)]
fn injected_empty(w: &mut World, viewer: String) {
    let injected = current(w, &viewer);
    assert!(
        injected.is_empty(),
        "{viewer}'s context should be empty; got: {:?}",
        injected.text()
    );
}

#[then(regex = r#"^exactly one new entry was written by (\w+) this turn$"#)]
fn one_new_entry(w: &mut World, handle: String) {
    // After a submit_prompt, this dev authored exactly one entry on the ref.
    assert_eq!(
        w.dev(&handle).entry_count_by(&handle),
        1,
        "{handle} should have written exactly one entry"
    );
}

#[then(regex = r#"^no (\w+)-authored entries were written by (\w+)$"#)]
fn no_peer_entries(w: &mut World, peer: String, writer: String) {
    // The writer's clone shows the peer's pre-existing entries unchanged, and the
    // writer authored none of the peer's lines. We assert the writer added nothing
    // attributed to the peer by confirming the peer count equals the single seed.
    let peer_count = w.dev(&writer).entry_count_by(&peer);
    assert_eq!(
        peer_count, 1,
        "{writer} must not write {peer}-authored entries (the one seed must remain one)"
    );
}

#[then("for every dev the read ref, write ref and cursor key derive from one branch")]
fn unified_branch_source(w: &mut World) {
    for handle in w.dev_handles() {
        assert!(
            w.dev(&handle).assert_branch_source_unified(),
            "{handle}'s read/write/cursor must share one branch source"
        );
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// The most recently captured injection for `viewer` (from an `interacts` step),
/// falling back to a fresh non-destructive peek if none was stashed.
fn current(w: &World, viewer: &str) -> Injected {
    w.injected_for(viewer)
        .unwrap_or_else(|| w.dev(viewer).injected_context())
}

#[tokio::main]
async fn main() {
    World::cucumber()
        .fail_on_skipped()
        .run_and_exit("tests/features")
        .await;
}
