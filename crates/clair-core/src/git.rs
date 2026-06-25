//! The git shell-out module — the ONLY place that runs `git` (ADR 0002).
//!
//! All clair state lives on **orphan refs** (`clair/ready`, `clair/<branch>`),
//! each holding a single file `log.jsonl` (one JSON object per line, append-only).
//! This module never touches the user's working tree on the write path: appends go
//! through git **plumbing** (`hash-object` → `mktree` → `commit-tree` → push by sha),
//! so blobs stay LF and HEAD/index are never moved.
//!
//! The one deliberate working-tree mutation is [`Repo::checkout_branch`] (for the
//! `with` command), and it is dirty-guarded: it refuses to move your work.
//!
//! Concurrency: orphan-ref updates are a compare-and-swap (a non-fast-forward push
//! is rejected by the remote). [`Repo::append_lines`] handles that with a bounded
//! fetch-re-append-retry loop, then [`crate::error::CoreError::PushExhausted`].
//!
//! All local-state paths (the cursor, and `with`'s session-settings/shims) derive
//! from [`Repo::git_dir`] — a single `git rev-parse --git-dir`, which is
//! worktree-correct (NOT a literal `<root>/.git`).

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{CoreError, Result};
use crate::store::{LogSink, LogSource, ShadowRef};

/// The single file every clair orphan ref carries.
const LOG_FILE: &str = "log.jsonl";

/// How many times an append retries a non-fast-forward push before giving up.
const MAX_PUSH_RETRIES: u32 = 5;

/// A git repository clair operates on, identified by its working-tree root and the
/// remote name it pushes/fetches clair refs against (usually `origin`).
#[derive(Debug, Clone)]
pub struct Repo {
    root: PathBuf,
    remote: String,
}

/// The captured result of one `git` invocation.
#[derive(Debug, Clone)]
pub struct GitOutput {
    /// True if `git` exited 0.
    pub ok: bool,
    /// The process exit code (or -1 if it was terminated by a signal).
    pub code: i32,
    /// Standard output, decoded lossily as UTF-8.
    pub stdout: String,
    /// Standard error, decoded lossily as UTF-8.
    pub stderr: String,
}

impl Repo {
    /// Open a repo at `root`, defaulting the remote to `origin`.
    pub fn open(root: impl Into<PathBuf>) -> Self {
        Repo {
            root: root.into(),
            remote: "origin".to_string(),
        }
    }

    /// Override the remote name (default `origin`).
    pub fn with_remote(mut self, remote: impl Into<String>) -> Self {
        self.remote = remote.into();
        self
    }

    /// The working-tree root this repo is rooted at.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The remote name clair pushes/fetches against.
    pub fn remote(&self) -> &str {
        &self.remote
    }

    /// The registry ref name.
    pub fn ready_ref() -> &'static str {
        "clair/ready"
    }

    /// The shared-context ref name for a working branch.
    pub fn context_ref(branch: &str) -> String {
        format!("clair/{branch}")
    }

    // --- the single choke-point -------------------------------------------------

    /// Run `git <args>` in this repo's root, optionally feeding `stdin`.
    ///
    /// This is the ONE place that spawns `git` (ADR 0002). No shell is involved —
    /// args are passed directly to the process, so quoting/escaping is a non-issue.
    /// A failure to *spawn* git is a [`CoreError::Git`]; a non-zero *exit* is
    /// returned in the [`GitOutput`] for the caller to interpret (some non-zero
    /// exits, e.g. an absent ref, are expected and not errors).
    pub fn run(&self, args: &[&str], stdin: Option<&[u8]>) -> Result<GitOutput> {
        use std::io::Write;
        use std::process::Stdio;

        let mut cmd = Command::new("git");
        cmd.arg("-C")
            .arg(&self.root)
            .args(args)
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| CoreError::Git(format!("failed to spawn git: {e}")))?;

        if let Some(bytes) = stdin {
            let mut sink = child
                .stdin
                .take()
                .ok_or_else(|| CoreError::Git("git stdin unavailable".to_string()))?;
            sink.write_all(bytes)
                .map_err(|e| CoreError::Git(format!("writing git stdin: {e}")))?;
            // Drop closes the pipe so git sees EOF.
            drop(sink);
        }

        let out = child
            .wait_with_output()
            .map_err(|e| CoreError::Git(format!("waiting on git: {e}")))?;

        Ok(GitOutput {
            ok: out.status.success(),
            code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }

    /// Run `git <args>` and require exit 0, returning trimmed stdout.
    fn run_ok(&self, args: &[&str], stdin: Option<&[u8]>) -> Result<String> {
        let out = self.run(args, stdin)?;
        if !out.ok {
            return Err(CoreError::Git(format!(
                "`git {}` failed (exit {}): {}",
                args.join(" "),
                out.code,
                out.stderr.trim()
            )));
        }
        Ok(out.stdout.trim_end_matches(['\n', '\r']).to_string())
    }

    // --- read-side plumbing -----------------------------------------------------

    /// The current checked-out branch (`git rev-parse --abbrev-ref HEAD`).
    pub fn current_branch(&self) -> Result<String> {
        self.run_ok(&["rev-parse", "--abbrev-ref", "HEAD"], None)
    }

    /// True if the working tree has any uncommitted change (`status --porcelain`).
    pub fn is_dirty(&self) -> Result<bool> {
        let out = self.run_ok(&["status", "--porcelain"], None)?;
        Ok(!out.trim().is_empty())
    }

    /// The real git directory (`git rev-parse --git-dir`), resolved to an absolute
    /// path under the repo root.
    ///
    /// This is the SINGLE source for every local-state path (the cursor file, and
    /// `with`'s session-settings/shims). It is worktree-correct: in a linked
    /// worktree the real git dir is `.git/worktrees/<name>/`, NOT `<root>/.git`.
    pub fn git_dir(&self) -> Result<PathBuf> {
        let raw = self.run_ok(&["rev-parse", "--git-dir"], None)?;
        let p = PathBuf::from(&raw);
        Ok(if p.is_absolute() {
            p
        } else {
            self.root.join(p)
        })
    }

    /// The repo slug — a stable identifier shared by every clone of the same repo.
    ///
    /// Preferred source is the remote URL's basename (with any `.git` suffix
    /// stripped), since that is identical across clones and is what makes the
    /// `clair/ready` registry agree between pairs. Falls back to the toplevel
    /// directory basename when there is no remote (e.g. a brand-new local repo).
    pub fn repo_slug(&self) -> Result<String> {
        // Try the configured remote's URL first.
        let url = self.run(&["remote", "get-url", &self.remote], None)?;
        if url.ok {
            let raw = url.stdout.trim();
            if !raw.is_empty() {
                return Ok(slug_from_url(raw));
            }
        }
        // Fall back to the toplevel directory basename.
        let top = self.run_ok(&["rev-parse", "--show-toplevel"], None)?;
        Ok(Path::new(&top)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| top.clone()))
    }

    // --- the orphan-ref log API -------------------------------------------------

    /// Fetch and read every raw line on `clair_ref`'s `log.jsonl` (oldest first).
    ///
    /// An absent ref (locally and on the remote) yields an empty vector — NOT an
    /// error — so a cold start and a real failure are distinguishable.
    pub fn read_log(&self, clair_ref: &str) -> Result<Vec<String>> {
        // Best-effort fetch: a missing ref on the remote is fine (cold start); a
        // genuine connectivity failure is surfaced. We fetch into a tracking ref so
        // we read the remote's latest without touching local heads.
        self.fetch_ref(clair_ref)?;

        // Read the blob from whichever ref we have (prefer the freshly-fetched one).
        let blob_ref = self.resolved_log_ref(clair_ref)?;
        let Some(blob_ref) = blob_ref else {
            return Ok(Vec::new());
        };

        let spec = format!("{blob_ref}:{LOG_FILE}");
        let out = self.run(&["cat-file", "-p", &spec], None)?;
        if !out.ok {
            // The ref exists but has no log.jsonl yet (shouldn't happen with our
            // writer, but treat an absent path as empty rather than an error).
            return Ok(Vec::new());
        }
        Ok(split_lines(&out.stdout))
    }

    /// Append `lines` to `clair_ref`'s `log.jsonl`, creating the orphan ref if
    /// absent, then push.
    ///
    /// This is a compare-and-swap: we build a new commit whose parent is the
    /// current ref tip and push it. A non-fast-forward rejection means a peer raced
    /// us; we re-fetch and retry, bounded by [`MAX_PUSH_RETRIES`] before returning
    /// [`CoreError::PushExhausted`]. All writes go through plumbing, so the user's
    /// working tree is never touched.
    pub fn append_lines(&self, clair_ref: &str, lines: &[String]) -> Result<()> {
        if lines.is_empty() {
            return Ok(());
        }

        for attempt in 0..=MAX_PUSH_RETRIES {
            // Re-fetch on every attempt after the first so we build atop the latest.
            self.fetch_ref(clair_ref)?;
            let parent = self.resolved_log_ref(clair_ref)?;

            // Existing log content (empty on cold start).
            let mut content = match &parent {
                Some(r) => {
                    let spec = format!("{r}:{LOG_FILE}");
                    let out = self.run(&["cat-file", "-p", &spec], None)?;
                    if out.ok {
                        out.stdout
                    } else {
                        String::new()
                    }
                }
                None => String::new(),
            };

            for line in lines {
                if !content.is_empty() && !content.ends_with('\n') {
                    content.push('\n');
                }
                content.push_str(line);
                content.push('\n');
            }

            // hash-object -w --stdin → blob sha
            let blob = self.run_ok(
                &["hash-object", "-w", "--stdin"],
                Some(content.as_bytes()),
            )?;

            // mktree → tree sha (one entry: 100644 blob <sha>\tlog.jsonl)
            let tree_input = format!("100644 blob {blob}\t{LOG_FILE}\n");
            let tree = self.run_ok(&["mktree"], Some(tree_input.as_bytes()))?;

            // commit-tree <tree> [-p <parent>] -m msg → commit sha
            let msg = "clair: append";
            let commit = match &parent {
                Some(p) => self.run_ok(
                    &["commit-tree", &tree, "-p", p, "-m", msg],
                    None,
                )?,
                None => self.run_ok(&["commit-tree", &tree, "-m", msg], None)?,
            };

            // Push the commit to the remote ref. On cold start there is no parent,
            // so a plain push creates the ref. On a concurrent update the remote
            // rejects the non-fast-forward and we retry.
            let refspec = format!("{commit}:refs/heads/{clair_ref}");
            let push = self.run(&["push", &self.remote, &refspec], None)?;
            if push.ok {
                // Mirror the new tip locally so an immediate read is consistent even
                // before the next fetch.
                let _ = self.run(
                    &["update-ref", &format!("refs/heads/{clair_ref}"), &commit],
                    None,
                );
                return Ok(());
            }

            // Distinguish a non-fast-forward (retryable) from a hard error.
            if !is_non_fast_forward(&push.stderr) {
                return Err(CoreError::Git(format!(
                    "push of {clair_ref} failed (exit {}): {}",
                    push.code,
                    push.stderr.trim()
                )));
            }

            // Bounded jittered backoff before the next attempt.
            if attempt < MAX_PUSH_RETRIES {
                backoff(attempt);
            }
        }

        Err(CoreError::PushExhausted)
    }

    /// Check out `target`, creating a tracking branch if the local branch is absent.
    ///
    /// Dirty-guarded: if the working tree has uncommitted changes this returns
    /// [`CoreError::DirtyTree`] and touches nothing — clair never moves your work.
    /// Never uses `-f` and never stashes.
    pub fn checkout_branch(&self, target: &str) -> Result<()> {
        if self.is_dirty()? {
            return Err(CoreError::DirtyTree);
        }

        // Bring the remote branch into local tracking refs.
        let _ = self.run(&["fetch", &self.remote, target], None);

        // If the local branch already exists, a plain checkout suffices.
        let exists = self
            .run(
                &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{target}")],
                None,
            )?
            .ok;

        let out = if exists {
            self.run(&["checkout", target], None)?
        } else {
            // Create a tracking branch from the remote.
            let start = format!("{}/{target}", self.remote);
            let mut o = self.run(&["checkout", "-b", target, "--track", &start], None)?;
            if !o.ok {
                // Fall back to a plain local branch if no remote-tracking start point
                // exists (e.g. the branch only exists locally elsewhere).
                o = self.run(&["checkout", "-b", target], None)?;
            }
            o
        };

        if !out.ok {
            return Err(CoreError::Git(format!(
                "checkout {target} failed (exit {}): {}",
                out.code,
                out.stderr.trim()
            )));
        }
        Ok(())
    }

    // --- internals --------------------------------------------------------------

    /// Best-effort fetch of a single clair ref into a local tracking ref.
    ///
    /// A ref that is absent on the remote is NOT an error (cold start). A real
    /// transport failure IS surfaced so callers can fail-open deliberately.
    fn fetch_ref(&self, clair_ref: &str) -> Result<()> {
        let refspec = format!(
            "+refs/heads/{clair_ref}:refs/remotes/{}/{clair_ref}",
            self.remote
        );
        let out = self.run(&["fetch", &self.remote, &refspec], None)?;
        if out.ok {
            return Ok(());
        }
        // A missing source ref is reported on stderr; treat that as "nothing to
        // fetch" rather than an error.
        if ref_absent_on_fetch(&out.stderr) {
            return Ok(());
        }
        Err(CoreError::Git(format!(
            "fetch of {clair_ref} failed (exit {}): {}",
            out.code,
            out.stderr.trim()
        )))
    }

    /// Resolve the best available ref carrying this clair log, preferring the
    /// freshly-fetched remote-tracking ref, falling back to the local head.
    /// Returns `None` if neither exists (cold start).
    fn resolved_log_ref(&self, clair_ref: &str) -> Result<Option<String>> {
        let remote_ref = format!("refs/remotes/{}/{clair_ref}", self.remote);
        let local_ref = format!("refs/heads/{clair_ref}");

        for candidate in [remote_ref, local_ref] {
            let out = self.run(
                &["rev-parse", "--verify", "--quiet", &candidate],
                None,
            )?;
            if out.ok {
                return Ok(Some(candidate));
            }
        }
        Ok(None)
    }
}

/// Adapt the [`ShadowRef`] enum to the string ref name this module speaks.
fn ref_name(shadow_ref: &ShadowRef) -> String {
    shadow_ref.ref_name()
}

impl LogSource for Repo {
    fn read_lines(&self, shadow_ref: &ShadowRef) -> Result<Vec<String>> {
        self.read_log(&ref_name(shadow_ref))
    }
}

impl LogSink for Repo {
    fn append_lines(&mut self, shadow_ref: &ShadowRef, lines: &[String]) -> Result<()> {
        Repo::append_lines(self, &ref_name(shadow_ref), lines)
    }
}

// --- free helpers ---------------------------------------------------------------

/// Split blob content into lines, dropping a trailing empty line from the final
/// newline. Empty interior lines are preserved (the store skips malformed lines).
fn split_lines(content: &str) -> Vec<String> {
    let trimmed = content.strip_suffix('\n').unwrap_or(content);
    if trimmed.is_empty() {
        return Vec::new();
    }
    trimmed
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect()
}

/// Derive a repo slug from a remote URL: the last path segment, with any `.git`
/// suffix and trailing slashes removed. Works for SSH (`git@host:org/repo.git`),
/// HTTPS (`https://host/org/repo.git`) and local-path remotes alike.
fn slug_from_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    // Split on both `/` and `:` so `git@github.com:org/repo.git` yields `repo`.
    let last = trimmed
        .rsplit(|c| c == '/' || c == '\\' || c == ':')
        .next()
        .unwrap_or(trimmed);
    last.strip_suffix(".git").unwrap_or(last).to_string()
}

/// Heuristic: did a push fail because it was a non-fast-forward (a peer raced us)?
fn is_non_fast_forward(stderr: &str) -> bool {
    let s = stderr.to_ascii_lowercase();
    s.contains("non-fast-forward")
        || s.contains("fetch first")
        || s.contains("rejected")
        || s.contains("failed to push some refs")
}

/// Heuristic: did a fetch fail merely because the source ref doesn't exist yet?
fn ref_absent_on_fetch(stderr: &str) -> bool {
    let s = stderr.to_ascii_lowercase();
    s.contains("couldn't find remote ref")
        || s.contains("does not exist")
        || s.contains("no such ref")
}

/// Jittered backoff between CAS retries. Kept tiny so the hook never blocks long.
fn backoff(attempt: u32) {
    use std::time::Duration;
    // Deterministic-ish jitter from the OS clock's sub-ms bits; no rand dependency.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let base = 5u64 * (attempt as u64 + 1);
    let jitter = (nanos % 10) as u64;
    std::thread::sleep(Duration::from_millis(base + jitter));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    /// A test fixture: a bare remote plus a working clone, both on disk.
    struct Fixture {
        _remote: TempDir,
        clone: TempDir,
        repo: Repo,
    }

    fn git(dir: &Path, args: &[&str]) -> std::process::Output {
        StdCommand::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git invocation")
    }

    fn assert_git(dir: &Path, args: &[&str]) {
        let out = git(dir, args);
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Build a bare remote and a clone with one real commit on `main`.
    fn fixture() -> Fixture {
        let remote = TempDir::new().unwrap();
        let clone = TempDir::new().unwrap();

        assert_git(remote.path(), &["init", "--bare", "-b", "main"]);

        assert_git(clone.path(), &["init", "-b", "main"]);
        configure_identity(clone.path());
        assert_git(
            clone.path(),
            &["remote", "add", "origin", &remote.path().to_string_lossy()],
        );
        // One real commit so HEAD/branch exists.
        std::fs::write(clone.path().join("README.md"), "hello\n").unwrap();
        assert_git(clone.path(), &["add", "."]);
        assert_git(clone.path(), &["commit", "-m", "init"]);
        assert_git(clone.path(), &["push", "-u", "origin", "main"]);

        let repo = Repo::open(clone.path());
        Fixture {
            _remote: remote,
            clone,
            repo,
        }
    }

    fn configure_identity(dir: &Path) {
        assert_git(dir, &["config", "user.email", "test@clair.dev"]);
        assert_git(dir, &["config", "user.name", "clair-test"]);
        // Keep blobs LF regardless of platform autocrlf.
        assert_git(dir, &["config", "core.autocrlf", "false"]);
    }

    /// A SECOND independent clone of the same remote (a concurrent peer).
    fn second_clone(remote_path: &Path) -> (TempDir, Repo) {
        let clone = TempDir::new().unwrap();
        assert_git(clone.path(), &["init", "-b", "main"]);
        configure_identity(clone.path());
        assert_git(
            clone.path(),
            &["remote", "add", "origin", &remote_path.to_string_lossy()],
        );
        assert_git(clone.path(), &["fetch", "origin"]);
        assert_git(clone.path(), &["checkout", "main"]);
        let repo = Repo::open(clone.path());
        (clone, repo)
    }

    #[test]
    fn current_branch_and_dirty_and_git_dir() {
        let f = fixture();
        assert_eq!(f.repo.current_branch().unwrap(), "main");
        assert!(!f.repo.is_dirty().unwrap());

        // Dirty it.
        std::fs::write(f.clone.path().join("README.md"), "changed\n").unwrap();
        assert!(f.repo.is_dirty().unwrap());

        // git_dir resolves to <root>/.git for a plain checkout.
        let gd = f.repo.git_dir().unwrap();
        assert!(gd.ends_with(".git"), "git_dir was {gd:?}");
        assert!(gd.is_dir(), "git_dir must exist: {gd:?}");
    }

    #[test]
    fn read_log_absent_ref_is_empty_not_error() {
        let f = fixture();
        // The clair/ready ref has never been created.
        let lines = f.repo.read_log("clair/ready").unwrap();
        assert!(lines.is_empty());
    }

    #[test]
    fn append_then_read_roundtrips_cold_start() {
        let f = fixture();
        let r = Repo::context_ref("feature/login");

        f.repo
            .append_lines(&r, &["{\"a\":1}".into(), "{\"b\":2}".into()])
            .unwrap();

        let lines = f.repo.read_log(&r).unwrap();
        assert_eq!(lines, vec!["{\"a\":1}".to_string(), "{\"b\":2}".to_string()]);

        // The user's working tree was NOT touched by the plumbing writes.
        assert!(!f.repo.is_dirty().unwrap());
        assert_eq!(f.repo.current_branch().unwrap(), "main");
    }

    #[test]
    fn append_accumulates_across_calls() {
        let f = fixture();
        let r = Repo::context_ref("main");
        f.repo.append_lines(&r, &["line1".into()]).unwrap();
        f.repo.append_lines(&r, &["line2".into()]).unwrap();
        let lines = f.repo.read_log(&r).unwrap();
        assert_eq!(lines, vec!["line1".to_string(), "line2".to_string()]);
    }

    /// Two clones append concurrently; the CAS retry must let BOTH lines survive.
    #[test]
    fn concurrent_append_retries_and_keeps_both() {
        let f = fixture();
        let (other_dir, other) = second_clone(f._remote.path());
        let r = Repo::context_ref("feature/login");

        // A appends first and pushes.
        f.repo.append_lines(&r, &["from-A".into()]).unwrap();

        // B has not fetched the new tip; its append must fetch+retry, not clobber A.
        other.append_lines(&r, &["from-B".into()]).unwrap();

        // From a fresh read on A's side, both lines are present (order by arrival).
        let lines = f.repo.read_log(&r).unwrap();
        assert!(lines.contains(&"from-A".to_string()), "lines: {lines:?}");
        assert!(lines.contains(&"from-B".to_string()), "lines: {lines:?}");
        assert_eq!(lines.len(), 2, "no line was clobbered: {lines:?}");

        drop(other_dir);
    }

    /// Cold-start root-commit race: two unrelated clones both create the ref from
    /// nothing. The loser must retry onto the winner, not orphan a line.
    #[test]
    fn cold_start_root_commit_race() {
        let f = fixture();
        let (other_dir, other) = second_clone(f._remote.path());
        let r = "clair/ready";

        // Neither side has the ref. A creates it first.
        f.repo.append_lines(r, &["A-ready".into()]).unwrap();
        // B also starts from nothing locally (it never fetched A's create); its push
        // is rejected (the ref now exists) and it must retry onto A's tip.
        other.append_lines(r, &["B-ready".into()]).unwrap();

        let lines = f.repo.read_log(r).unwrap();
        assert!(lines.contains(&"A-ready".to_string()), "lines: {lines:?}");
        assert!(lines.contains(&"B-ready".to_string()), "lines: {lines:?}");
        assert_eq!(lines.len(), 2);

        drop(other_dir);
    }

    #[test]
    fn checkout_branch_aborts_on_dirty_tree() {
        let f = fixture();
        // Create a target branch on the remote so checkout would otherwise succeed.
        assert_git(f.clone.path(), &["branch", "feature/login"]);
        assert_git(f.clone.path(), &["push", "origin", "feature/login"]);
        assert_git(f.clone.path(), &["checkout", "main"]);

        // Dirty the tree.
        std::fs::write(f.clone.path().join("README.md"), "dirty\n").unwrap();

        let err = f.repo.checkout_branch("feature/login").unwrap_err();
        assert!(matches!(err, CoreError::DirtyTree));
        // HEAD unchanged: still on main.
        assert_eq!(f.repo.current_branch().unwrap(), "main");
    }

    #[test]
    fn checkout_branch_switches_when_clean() {
        let f = fixture();
        assert_git(f.clone.path(), &["branch", "feature/login"]);
        assert_git(f.clone.path(), &["push", "origin", "feature/login"]);
        assert_git(f.clone.path(), &["checkout", "main"]);

        f.repo.checkout_branch("feature/login").unwrap();
        assert_eq!(f.repo.current_branch().unwrap(), "feature/login");
    }

    /// `with` onto a peer's branch that we don't yet have locally: a tracking
    /// branch is created from the remote.
    #[test]
    fn checkout_creates_tracking_branch_from_remote() {
        let f = fixture();
        // A peer creates feature/login on the remote (via a second clone).
        let (other_dir, _other) = second_clone(f._remote.path());
        assert_git(other_dir.path(), &["checkout", "-b", "feature/login"]);
        std::fs::write(other_dir.path().join("peer.txt"), "x\n").unwrap();
        assert_git(other_dir.path(), &["add", "."]);
        assert_git(other_dir.path(), &["commit", "-m", "peer"]);
        assert_git(other_dir.path(), &["push", "-u", "origin", "feature/login"]);

        // Our clone has no local feature/login; checkout must create it tracking.
        assert!(
            !f.repo
                .run(
                    &["rev-parse", "--verify", "--quiet", "refs/heads/feature/login"],
                    None
                )
                .unwrap()
                .ok
        );
        f.repo.checkout_branch("feature/login").unwrap();
        assert_eq!(f.repo.current_branch().unwrap(), "feature/login");

        drop(other_dir);
    }

    /// Branch-scope at the git layer: a fetch/read on branch B never returns
    /// branch-A's lines (they are physically different refs).
    #[test]
    fn read_is_branch_scoped() {
        let f = fixture();
        f.repo
            .append_lines(&Repo::context_ref("feature/login"), &["on-A".into()])
            .unwrap();
        let b = f.repo.read_log(&Repo::context_ref("main")).unwrap();
        assert!(b.is_empty(), "branch main must not see feature/login: {b:?}");
    }

    /// The Repo plugs into the Store via LogSource/LogSink, against a real remote.
    #[test]
    fn repo_drives_store_entries_since() {
        use crate::cursor::Cursor;
        use crate::entry::{Author, Entry, EntryId, Kind, Timestamp, TurnId};
        use crate::store::{ShadowRef, Store};

        let f = fixture();
        let ctx = ShadowRef::context("feature/login");

        // JB (a peer) writes a prompt directly through the Repo sink.
        let jb = Entry {
            id: EntryId::now(),
            author: Author::new("JB"),
            kind: Kind::Prompt,
            text: "refactor the auth guard".into(),
            ts: Timestamp::new("2026-06-25T10:00:00Z"),
            turn: TurnId::new("turn-1"),
        };
        let mut sink = f.repo.clone();
        LogSink::append_lines(&mut sink, &ctx, &[jb.to_jsonl().unwrap()]).unwrap();

        // Rajiv reads through a Store bound to the same ref.
        let store = Store::new(f.repo.clone(), Author::new("Rajiv"), ctx);
        let delivery = store.entries_since(&Cursor::Start).unwrap();
        assert_eq!(delivery.entries, vec![jb.clone()]);
        assert_eq!(delivery.next, Cursor::At(jb.id));
    }

    #[test]
    fn ref_name_helpers() {
        assert_eq!(Repo::ready_ref(), "clair/ready");
        assert_eq!(Repo::context_ref("feature/login"), "clair/feature/login");
    }

    #[test]
    fn slug_from_url_handles_common_forms() {
        assert_eq!(slug_from_url("https://github.com/org/clair.git"), "clair");
        assert_eq!(slug_from_url("git@github.com:org/clair.git"), "clair");
        assert_eq!(slug_from_url("https://github.com/org/clair"), "clair");
        assert_eq!(slug_from_url("/tmp/some/clair.git/"), "clair");
        assert_eq!(slug_from_url("C:\\repos\\clair"), "clair");
    }

    /// Two clones of the same remote must agree on the slug (registry depends on it).
    #[test]
    fn repo_slug_is_stable_across_clones() {
        let f = fixture();
        let (other_dir, other) = second_clone(f._remote.path());
        assert_eq!(f.repo.repo_slug().unwrap(), other.repo_slug().unwrap());
        drop(other_dir);
    }
}
