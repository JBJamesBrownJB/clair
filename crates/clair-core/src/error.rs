//! Typed crate error for clair-core.
//!
//! Every fallible operation in clair-core returns [`Result`], which carries a
//! [`CoreError`]. The variants are intentionally coarse strings (rather than
//! wrapping foreign error types) so the crate stays dependency-light and the
//! git shell-out layer can funnel arbitrary `git` stderr into one place.

use thiserror::Error;

/// The crate-wide error type.
#[derive(Debug, Error)]
pub enum CoreError {
    /// A `git` invocation failed (non-zero exit, or could not be spawned).
    #[error("git error: {0}")]
    Git(String),

    /// The working tree was dirty when a clean tree was required (e.g. checkout).
    #[error("working tree dirty — commit or stash; clair never moves your work")]
    DirtyTree,

    /// (De)serialisation of an entry or registry line failed.
    #[error("serde error: {0}")]
    Serde(String),

    /// Reading or writing the local last-seen cursor failed.
    #[error("cursor error: {0}")]
    Cursor(String),

    /// A filesystem operation failed.
    #[error("io error: {0}")]
    Io(String),

    /// A CAS append exhausted its bounded retries against a moving ref.
    #[error("push exhausted: too many non-fast-forward retries")]
    PushExhausted,

    /// A JSONL line could not be parsed into an [`crate::entry::Entry`].
    #[error("malformed jsonl line: {0}")]
    ParseJsonl(String),

    /// A registry handle could not be resolved (absent or ambiguous).
    #[error("registry error: {0}")]
    Registry(String),
}

/// Convenience alias used throughout clair-core.
pub type Result<T> = std::result::Result<T, CoreError>;

impl From<serde_json::Error> for CoreError {
    fn from(e: serde_json::Error) -> Self {
        CoreError::Serde(e.to_string())
    }
}

impl From<std::io::Error> for CoreError {
    fn from(e: std::io::Error) -> Self {
        CoreError::Io(e.to_string())
    }
}
