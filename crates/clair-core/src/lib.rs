//! clair-core — the smarts of clair.
//!
//! All git access (shell-out) and local logic for the shared pair brain lives here.
//! This crate is harness- and CLI-free: no clap, no tokio, no cucumber. Sync and
//! deterministic, so it can be unit- and BDD-tested with no harness involved
//! (see `docs/architecture/target.md`).
//!
//! Stage: core data model. The data spine is implemented here (error, entry,
//! store, cursor). The git shell-out and the higher layers (registry, render,
//! transcript, hooks) are filled in by later stages.

pub mod cursor;
pub mod entry;
pub mod error;
pub mod git;
pub mod hooks;
pub mod registry;
pub mod render;
pub mod store;
pub mod transcript;

pub use cursor::{Cursor, CursorStore, FileCursorStore, MemoryCursorStore};
pub use entry::{Author, Entry, EntryId, Kind, Timestamp, TurnId};
pub use error::{CoreError, Result};
pub use git::{GitOutput, Repo};
pub use hooks::{HookCtx, HookOutcome};
pub use registry::ReadyPeer;
pub use render::render_inbound;
pub use store::{Delivery, LogSink, LogSource, ShadowRef, Store};
pub use transcript::Transcript;

/// The crate name, exposed so the scaffold has one piece of real, testable surface.
pub const NAME: &str = "clair-core";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crate_name_is_stable() {
        assert_eq!(NAME, "clair-core");
    }
}
