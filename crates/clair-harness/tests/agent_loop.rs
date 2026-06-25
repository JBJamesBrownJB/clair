//! Tier-2 agent-API test: two developers pairing *through the harness*.
//!
//! This file lives in `tests/` (not a `#[cfg(test)]` module) on purpose: it consumes
//! `clair-harness` exactly as an external agent-runner would — through the crate's
//! PUBLIC surface only (`World`, `Dev`, the `DevDriver` trait, `Injected`). If the
//! public API were insufficient to drive a pairing session from outside, this would
//! not compile. It therefore guards the stage requirement "keep it usable by an
//! external agent loop."
//!
//! The two driven `Dev`s call the REAL `clair_core::hooks::*` underneath
//! (`submit_prompt` → `on_user_prompt_submit`, `finish_turn` → `on_stop`), so the
//! awareness asserted here is produced by the production code path, not by the test.

use clair_harness::{Dev, DevDriver, Injected, World};

/// Drive a single agent turn the way an external loop would: hand it a prompt,
/// observe what clair injected as passive background, then a reply to finish on.
/// Returns the injection the agent saw *this* turn (peer deltas surfaced to it).
fn agent_turn(driver: &mut dyn DevDriver, prompt: &str, reply: &str) -> Injected {
    let injected = driver.submit_prompt(prompt);
    driver.finish_turn(reply);
    injected
}

/// The full reciprocal scenario, driven entirely through the `DevDriver` trait
/// objects — the exact handles an external agent loop holds. Proves Rajiv becomes
/// aware of JB's work AND, symmetrically, JB becomes aware of Rajiv's.
#[test]
fn two_agents_pair_through_the_harness_and_become_mutually_aware() {
    let mut world = World::new();
    world.add_dev("JB", "feature/login");
    world.add_dev("Rajiv", "feature/login");

    // --- JB works first (driven as a trait object, like an external loop would). ---
    {
        let jb: &mut dyn DevDriver = world.dev_mut("JB");
        let saw = agent_turn(
            jb,
            "refactor the auth guard to use the new middleware",
            "Working on it.\n\nMoved the guard into AuthMiddleware; 1 test still \
             failing on the expired-token case.",
        );
        // JB is first to speak — nothing peer-authored is pending for him yet.
        assert!(saw.is_empty(), "JB had no peer deltas on the opening turn");
    }

    // --- Rajiv's next turn: clair surfaces JB's prompt + conclusion as background. ---
    {
        let rajiv: &mut dyn DevDriver = world.dev_mut("Rajiv");
        let saw = agent_turn(
            rajiv,
            "look at the session handling",
            "Refreshed the session token on expiry; the failing case is green now.",
        );

        assert!(
            saw.has_background(),
            "JB's deltas must reach Rajiv under the passive background banner, \
             never as a directive: {:?}",
            saw.text()
        );
        assert!(
            saw.mentions_prompt_from("JB"),
            "Rajiv must see JB's question: {:?}",
            saw.text()
        );
        assert!(
            saw.contains("refactor the auth guard to use the new middleware"),
            "the verbatim prompt text must propagate"
        );
        assert!(
            saw.mentions_conclusion_from("JB"),
            "Rajiv must see JB's distilled conclusion: {:?}",
            saw.text()
        );
        assert!(
            saw.contains("Moved the guard into AuthMiddleware"),
            "the distilled conclusion text must propagate"
        );
    }

    // --- Reciprocal: JB's NEXT turn surfaces Rajiv's prompt + conclusion. ---
    {
        let jb: &mut dyn DevDriver = world.dev_mut("JB");
        let saw = jb.submit_prompt("anything new on the token case?");

        assert!(
            saw.has_background(),
            "Rajiv's deltas must reach JB under the background banner: {:?}",
            saw.text()
        );
        assert!(
            saw.mentions_prompt_from("Rajiv"),
            "JB must see Rajiv's question (reciprocal awareness): {:?}",
            saw.text()
        );
        assert!(
            saw.mentions_conclusion_from("Rajiv"),
            "JB must see Rajiv's conclusion (reciprocal awareness): {:?}",
            saw.text()
        );
        assert!(
            saw.contains("Refreshed the session token on expiry"),
            "Rajiv's verbatim conclusion text must propagate back to JB"
        );
    }
}

/// Loop-guard, observed strictly through the public API: an agent that *receives*
/// a peer delta writes nothing of the peer's own, and the delta is not re-delivered
/// on its next turn. This is the invariant an external loop relies on to avoid echo.
#[test]
fn receiving_a_delta_writes_nothing_back_and_does_not_redeliver() {
    let mut world = World::new();
    world.add_dev("JB", "feature/login");
    world.add_dev("Rajiv", "feature/login");

    world.dev_mut("JB").submit_prompt("jb prompt");

    let total_before = world.dev("Rajiv").entry_count();
    let jb_before = world.dev("Rajiv").entry_count_by("JB");

    // Rajiv interacts: he sees JB's delta and appends exactly his own one prompt.
    let saw = world.dev_mut("Rajiv").submit_prompt("rajiv prompt");
    assert!(saw.mentions_prompt_from("JB"));
    assert_eq!(
        world.dev("Rajiv").entry_count(),
        total_before + 1,
        "exactly one new entry (Rajiv's own), receiving wrote nothing extra"
    );
    assert_eq!(
        world.dev("Rajiv").entry_count_by("JB"),
        jb_before,
        "receiving a JB delta must not author any JB entry (no echo)"
    );

    // Next interaction: JB's already-delivered delta is not surfaced again.
    let again = world.dev("Rajiv").injected_context();
    assert!(again.is_empty(), "a delivered delta must not be re-delivered");
}

/// Branch scope, through the public API: a developer on a different branch is
/// structurally blind to the pairing branch's deltas, and the harness exposes the
/// single-branch-source invariant for an external loop to assert.
#[test]
fn entries_are_invisible_across_branches() {
    let mut world = World::new();
    world.add_dev("JB", "feature/login");
    world.add_dev("Sam", "main");

    world.dev_mut("JB").submit_prompt("on feature/login only");

    let sam_saw = world.dev("Sam").injected_context();
    assert!(
        sam_saw.is_empty(),
        "main must not see feature/login deltas: {:?}",
        sam_saw.text()
    );
    assert!(
        world.dev("Sam").assert_branch_source_unified(),
        "read ref, write ref and cursor key must all derive from the one branch"
    );
}

/// Compile-time proof the public `Dev` satisfies the object-safe `DevDriver` seam an
/// external agent runner binds to (a `LiveDev` would later implement the same trait).
#[test]
fn dev_is_usable_as_a_boxed_driver() {
    let mut world = World::new();
    world.add_dev("Solo", "feature/login");
    // Borrow as a trait object and exercise the seam; just must type-check + run.
    let solo: &mut dyn DevDriver = world.dev_mut("Solo");
    let _ = solo.submit_prompt("hello");
    solo.finish_turn("done");
    let _peek: Injected = solo.injected_context();

    // And confirm the concrete type is nameable from outside the crate.
    let _typecheck: Option<&Dev> = None;
}
