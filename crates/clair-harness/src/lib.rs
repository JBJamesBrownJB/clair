//! clair-harness — Tier-2 in-process driver for clair.
//!
//! Provides [`World`], [`Dev`], [`Injected`] and the [`DevDriver`] trait: a mock of
//! Claude Code built *around* the real `clair_core::hooks::*` so two `Dev`s on two
//! clones prove the end-to-end pairing flow with zero `claude -p`. This is a library
//! (not a `#[cfg(test)]` module) so a future agent-runner can drive `Dev` outside
//! `cargo test`, and so the cucumber-rs runner in `crates/clair/tests/bdd.rs` can use
//! [`World`] directly.
//!
//! Everything below the adapter boundary is REAL: a real bare git remote, real
//! clones driven by git shell-out, the real [`clair_core::FileCursorStore`] under
//! `<GIT_DIR>/clair/`, the real registry, and — crucially — the real
//! `clair_core::hooks::on_user_prompt_submit` / `on_stop`. The only mock is the
//! `claude -p` invocation itself: prompt/reply text is supplied by the test.

mod dev;
mod injected;
mod world;

pub use dev::{Dev, DevDriver, WithError};
pub use injected::Injected;
pub use world::World;

/// Sanity surface for the scaffold: confirms the harness is wired to clair-core.
pub fn core_name() -> &'static str {
    clair_core::NAME
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harness_sees_core() {
        assert_eq!(core_name(), "clair-core");
    }
}
