//! Where an extraction runs: in place, in a workspace, from Git objects or
//! materialized, and whether what it read stayed the same.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tempfile::TempDir;

use super::{
    Runner, effective_scope,
    revision::{Revision, Storage, named_paths},
    short,
};

/// What an in-place extraction checks afterwards, to tell whether what it read
/// changed while it ran.
pub(super) enum Check {
    /// The working tree, with its tree hash before the run.
    WorkingTree(String),
    /// The checkout's `HEAD`, clean (or, `untracked`, with unmodified tracked files).
    Head { untracked: bool },
}

/// Where and how one extractor runs, and what its provenance records.
pub(super) struct Placement {
    /// `in-place`, `workspace`, `materialized` or `git-objects`.
    pub(super) mode: &'static str,
    /// The directory examined, when the revision is on disk.
    pub(super) root: Option<PathBuf>,
    /// The definition revision's directory. The extractor's working directory
    /// is the definition's project in it.
    pub(super) cwd: PathBuf,
    /// Where the project's dependencies are installed for this run.
    pub(super) checkout: Option<PathBuf>,
    /// The Git directory and tree, in `git-objects` mode.
    pub(super) git: Option<(PathBuf, String)>,
    /// The provenance source.
    pub(super) source: &'static str,
    /// The workspace strategy, when the revision was put in one.
    pub(super) strategy: Option<&'static str>,
    /// `exact`, `approximate` or `stale`.
    pub(super) fidelity: &'static str,
    /// The examined Git tree.
    pub(super) tree: Option<String>,
    pub(super) limitations: Vec<String>,
    pub(super) check: Option<Check>,
    /// The environment's prepare steps that applied: `{id, key}`.
    pub(super) prepared: Vec<Value>,
    /// The workspace, locked until the run is recorded.
    pub(super) _lease: Option<crate::workspaces::Lease>,
    /// Temporary directories kept until the run is recorded.
    pub(super) _scratch: Vec<TempDir>,
    /// Materializations kept until the run is recorded.
    pub(super) _held: Vec<Revision>,
}

impl Runner {
    /// Where an extractor examines `examined`, with `program`'s definition:
    ///
    /// - under container isolation, temporary materializations of both;
    /// - for a built-in that only reads files, the working tree in place or a
    ///   commit's Git objects, with nothing on disk;
    /// - otherwise in place when the examined revision is the working tree, or a
    ///   commit that is the clean checkout's `HEAD` (or, with `--in-place`, one
    ///   whose tracked files are unmodified);
    /// - otherwise a workspace holding the commit.
    pub(super) fn place(&self, examined: &Revision, program: &Revision, definition: &Value, files_only: bool) -> Result<Placement> {
        let repository = self.repository_root()?;
        let mut notes = Vec::new();
        if self.isolation.is_some() {
            let copy = self.materialize_noting(examined, scoped_paths(definition).as_deref(), &mut notes)?;
            let definition = (examined.repository != program.repository)
                .then(|| self.materialize_noting(program, Some(&program_paths(definition)), &mut notes))
                .transpose()?;
            let root = copy.root().to_path_buf();
            let cwd = definition
                .as_ref()
                .map_or_else(|| root.clone(), |revision| revision.root().to_path_buf());
            return Ok(Placement {
                mode: "materialized",
                root: Some(root),
                cwd,
                checkout: None,
                git: None,
                source: "local-materialized",
                strategy: None,
                fidelity: "exact",
                tree: examined.tree.clone(),
                limitations: [examined.materialized_limitation().to_owned()].into_iter().chain(notes).collect(),
                check: None,
                prepared: Vec::new(),
                _lease: None,
                _scratch: Vec::new(),
                _held: [Some(copy), definition].into_iter().flatten().collect(),
            });
        }
        if files_only && examined.is_commit() {
            let directory = self.git_text(&repository, &["rev-parse", "--git-common-dir"])?;
            let directory = repository.join(directory);
            return Ok(Placement {
                mode: "git-objects",
                root: None,
                cwd: repository,
                checkout: None,
                git: Some((
                    projections_extractor_sdk::canonical(&directory)?,
                    examined.tree.clone().context("Missing commit tree")?,
                )),
                source: "local-git-objects",
                strategy: None,
                fidelity: "exact",
                tree: examined.tree.clone(),
                limitations: vec!["Read from immutable Git objects without checkout filters; nothing was materialized.".into()],
                check: None,
                prepared: Vec::new(),
                _lease: None,
                _scratch: Vec::new(),
                _held: Vec::new(),
            });
        }
        let program_directory = |held: &mut Vec<Revision>, notes: &mut Vec<String>| -> Result<PathBuf> {
            if program.repository == examined.repository {
                return Ok(PathBuf::new());
            }
            if self.in_place(program)?.is_some() {
                return Ok(repository.clone());
            }
            let copy = self.materialize_noting(program, Some(&program_paths(definition)), notes)?;
            let root = copy.root().to_path_buf();
            held.push(copy);
            Ok(root)
        };
        let mut held = Vec::new();
        if let Some(check) = self.in_place(examined)? {
            let mut cwd = program_directory(&mut held, &mut notes)?;
            if cwd.as_os_str().is_empty() {
                cwd = repository.clone();
            }
            let tree = match &check {
                Check::WorkingTree(tree) => Some(tree.clone()),
                Check::Head { .. } => examined.tree.clone(),
            };
            let limitation = match &check {
                Check::WorkingTree(_) => {
                    "Extracted in place in the working tree: its files are what Git lists (tracked, and untracked files it doesn't ignore), and tools may also read ignored files such as installed dependencies. The working tree's identity was checked before and after."
                }
                Check::Head { untracked: false } => {
                    "Extracted in place in a clean checkout of this commit; tools may also read ignored files such as installed dependencies."
                }
                Check::Head { untracked: true } => {
                    "Extracted in place (--in-place) in a checkout of this commit whose tracked files are unmodified; untracked and ignored files, such as build output, were present."
                }
            };
            return Ok(Placement {
                mode: "in-place",
                root: Some(repository.clone()),
                cwd,
                checkout: Some(repository),
                git: None,
                source: "local-in-place",
                strategy: None,
                fidelity: "exact",
                tree,
                limitations: [limitation.to_owned()].into_iter().chain(notes).collect(),
                check: Some(check),
                prepared: Vec::new(),
                _lease: None,
                _scratch: Vec::new(),
                _held: held,
            });
        }
        // A toolchain on a commit that isn't checked out: the only case that
        // needs files on disk, in a workspace the strategy chooses.
        let environment = self.environment_of(examined)?;
        let choice = crate::workspaces::choose(
            self,
            self.workspace,
            environment.as_ref().and_then(|environment| environment.strategy.as_deref()),
        )?;
        let commit = examined.repository["commit"].as_str().unwrap_or_default();
        let scope = effective_scope(definition);
        let mut limitations = Vec::new();
        let mut scratches = Vec::new();
        let (mode, source, strategy, root, records, lease) = match choice.strategy {
            crate::workspaces::Strategy::None => bail!(
                "This toolchain extractor needs commit {} checked out, and the workspace strategy is none ({}). Extract it in place (check it out), reuse CI's extraction (--ci or --artifact DIR), or choose a strategy with --workspace worktree",
                short(commit),
                choice.reason
            ),
            crate::workspaces::Strategy::Fresh => {
                let copy = self.materialize_noting(examined, scoped_paths(definition).as_deref(), &mut notes)?;
                let root = copy.root().to_path_buf();
                held.push(copy);
                limitations.push(examined.materialized_limitation().to_owned());
                // A fresh copy's prepare runs are recorded beside it, so they always run.
                let scratch = tempfile::Builder::new().prefix("projections-records-").tempdir()?;
                let records = crate::environment::Records::new(scratch.path().to_path_buf());
                scratches.push(scratch);
                ("materialized", "local-materialized", "fresh", root, records, None)
            }
            strategy => {
                let lease = crate::workspaces::lease(self, commit, strategy, scope.as_deref())?;
                limitations.extend(lease.notes.iter().cloned());
                limitations.push(format!(
                    "Extracted in a {} workspace Projections owns, checked out at this commit; ignored files from earlier uses (prepared dependencies, build caches) remain.",
                    lease.strategy.as_str()
                ));
                (
                    "workspace",
                    "local-workspace",
                    lease.strategy.as_str(),
                    lease.root.clone(),
                    lease.records.clone(),
                    Some(lease),
                )
            }
        };
        // Its dependencies: prepared there by the environment's steps, or
        // borrowed from the user's checkout.
        let mut fidelity = "exact";
        let mut prepared = Vec::new();
        let checkout = match &environment {
            Some(environment) if !environment.prepare.is_empty() && self.trust => {
                let keys = self.prepare_keys(examined, environment)?;
                let outcomes = crate::environment::prepare(
                    self,
                    &root,
                    environment,
                    &keys,
                    &records,
                    &crate::environment::Options::default(),
                    &|event| self.progress(event),
                )?;
                prepared = outcomes
                    .iter()
                    .map(|outcome| json!({"id": outcome["id"], "key": outcome["key"]}))
                    .collect();
                root.clone()
            }
            _ => {
                let differing = self.borrowed_lockfiles(examined)?;
                if !differing.is_empty() {
                    fidelity = "approximate";
                    limitations.push(format!(
                        "Approximate: dependencies were borrowed from the working tree, whose lockfiles differ from this commit's ({}). Declare prepare steps in {} so a workspace installs this commit's own.",
                        named_paths(&differing),
                        ".github/projections/environment.json"
                    ));
                } else {
                    limitations.push("Dependencies were borrowed from the working tree, whose lockfiles match this commit's.".into());
                }
                repository.clone()
            }
        };
        let mut cwd = program_directory(&mut held, &mut notes)?;
        if cwd.as_os_str().is_empty() {
            cwd = root.clone();
        }
        limitations.extend(notes);
        Ok(Placement {
            mode,
            root: Some(root),
            cwd,
            checkout: Some(checkout),
            git: None,
            source,
            strategy: Some(strategy),
            fidelity,
            tree: examined.tree.clone(),
            limitations,
            check: None,
            prepared,
            _lease: lease,
            _scratch: scratches,
            _held: held,
        })
    }

    /// [`Runner::materialize_within`], recording its note.
    fn materialize_noting(&self, revision: &Revision, paths: Option<&[String]>, notes: &mut Vec<String>) -> Result<Revision> {
        let (copy, note) = self.materialize_within(revision, paths)?;
        notes.extend(note);
        Ok(copy)
    }

    /// How `revision` can be read in place, if it can: the working tree (with
    /// its identity now), or a commit that is the checkout's `HEAD` with a clean
    /// working tree (or, with `--in-place`, unmodified tracked files).
    pub(super) fn in_place(&self, revision: &Revision) -> Result<Option<Check>> {
        match &revision.storage {
            Storage::InPlace(_) => Ok(Some(Check::WorkingTree(self.identity(revision)?))),
            Storage::Temporary(_) => Ok(None),
            Storage::Objects => {
                let root = self.repository_root()?;
                if self.git_text(&root, &["rev-parse", "--is-bare-repository"])? == "true" {
                    return Ok(None);
                }
                let commit = revision.repository["commit"].as_str().unwrap_or_default();
                if self.resolve(&root, "HEAD")? != commit {
                    return Ok(None);
                }
                let check = Check::Head {
                    untracked: self.in_place_allowed,
                };
                Ok(self.head_clean(&root, self.in_place_allowed)?.then_some(check))
            }
        }
    }

    /// Whether the checkout's tracked files (and, unless `untracked`, its
    /// untracked files too) match `HEAD`.
    fn head_clean(&self, root: &Path, untracked: bool) -> Result<bool> {
        let status = self.git(
            root,
            &[
                "status",
                "--porcelain=v1",
                "-z",
                if untracked {
                    "--untracked-files=no"
                } else {
                    "--untracked-files=all"
                },
            ],
            None,
            16 * 1024 * 1024,
        )?;
        Ok(status.is_empty())
    }

    /// Whether what an in-place run read is still what it was before.
    pub(super) fn unchanged(&self, check: &Check) -> Result<bool> {
        match check {
            Check::WorkingTree(tree) => Ok(&self.working_tree()? == tree),
            Check::Head { untracked } => {
                let root = self.repository_root()?;
                let commit = self.resolve(&root, "HEAD")?;
                let current = self.current.lock().expect("revision lock")["commit"].clone();
                Ok(current == commit && self.head_clean(&root, *untracked)?)
            }
        }
    }
}

/// What running a definition's extractor needs of the revision that defines
/// it: the definition directories, its declared sources, and the command's
/// arguments that are paths (relative to its project), repository-relative.
pub(super) fn program_paths(definition: &Value) -> Vec<String> {
    let mut paths: Vec<String> = super::definition_directories().into();
    paths.extend(crate::artifact::definition_sources(definition));
    for argument in definition["extractor"]["command"].as_array().into_iter().flatten().skip(1) {
        let argument = argument.as_str().unwrap_or_default();
        if argument.contains('/')
            && !argument.starts_with(['/', '-'])
            && let Ok(path) = crate::project::resolve(argument)
            && !path.is_empty()
        {
            paths.push(path);
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

/// The examined revision's paths a scoped definition needs: its scope and its own files.
fn scoped_paths(definition: &Value) -> Option<Vec<String>> {
    let mut paths = effective_scope(definition)?;
    paths.extend(program_paths(definition));
    paths.sort();
    paths.dedup();
    Some(paths)
}
