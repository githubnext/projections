//! The environment file a revision declares and its prepare steps.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Result, anyhow, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::{
    Runner, definition_directories,
    definitions::definition_paths,
    revision::{Revision, Storage, safe_path},
    short, which,
};

/// Lockfiles that say which dependencies a revision installs.
const LOCKFILES: [&str; 13] = [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "Cargo.lock",
    "go.sum",
    "packages.lock.json",
    "poetry.lock",
    "uv.lock",
    "Pipfile.lock",
    "Gemfile.lock",
    "composer.lock",
];

impl Runner {
    /// The prepare steps' key hashes at a revision, from its blobs.
    pub(super) fn prepare_keys(
        &self,
        revision: &Revision,
        environment: &crate::environment::Environment,
    ) -> Result<BTreeMap<String, String>> {
        if let Some(root) = revision.directory()
            && matches!(revision.storage, Storage::InPlace(_))
        {
            return crate::environment::checkout_keys(self, root, environment);
        }
        crate::environment::keys(environment, &revision.files, &|matched| {
            Ok(matched
                .iter()
                .map(|path| {
                    let id = revision
                        .entries
                        .get(*path)
                        .and_then(|(_, object)| object.clone())
                        .unwrap_or_default();
                    ((*path).clone(), id)
                })
                .collect())
        })
    }

    /// The environment file a revision declares, validated:
    /// `.github/projections/environment.json` or `.projections/environment.json`.
    pub(super) fn environment_of(&self, revision: &Revision) -> Result<Option<crate::environment::Environment>> {
        let declared: Vec<String> = definition_directories()
            .iter()
            .map(|directory| format!("{directory}/{}", crate::environment::FILE))
            .filter(|path| revision.entries.contains_key(path))
            .collect();
        ensure!(declared.len() <= 1, "Both {} exist; keep one", declared.join(" and "));
        let Some(path) = declared.first() else {
            return Ok(None);
        };
        let bytes = self.read_file(revision, path, 1024 * 1024)?;
        crate::environment::parse(path, std::str::from_utf8(&bytes)?).map(Some)
    }

    /// Where the working tree's own prepare runs are recorded.
    fn working_records(&self) -> Result<crate::environment::Records> {
        Ok(crate::environment::Records::new(
            self.cache_base()?
                .join("prepared")
                .join(crate::extraction_cache::repository_name(&self.common_directory()?)),
        ))
    }

    /// Runs the environment's prepare steps on demand (`projections prepare`):
    /// in the working tree by default, as the user would run tests, or, for
    /// `reference`, in the workspace for that commit. Returns the
    /// `projections.prepare` document.
    pub fn prepare_environment(&self, reference: Option<&str>, options: &crate::environment::Options) -> Result<Value> {
        let missing = |at: &str| {
            anyhow!("{at} declares no prepare steps. Add them to .github/projections/environment.json (see projections help authoring)")
        };
        let Some(reference) = reference.filter(|reference| *reference != "working-tree") else {
            let root = self.repository_root()?;
            let environment = self
                .working_environment()?
                .filter(|environment| !environment.prepare.is_empty())
                .ok_or_else(|| missing("The working tree"))?;
            let keys = crate::environment::checkout_keys(self, &root, &environment)?;
            let steps = crate::environment::prepare(self, &root, &environment, &keys, &self.working_records()?, options, &|event| {
                self.progress(event)
            })?;
            return Ok(json!({"format": "projections.prepare", "version": 0,
                "target": "working-tree", "environment": environment.path, "root": root, "steps": steps}));
        };
        let revision = self.capture(reference)?;
        let commit = revision.repository["commit"].as_str().unwrap_or_default().to_owned();
        let environment = self
            .environment_of(&revision)?
            .filter(|environment| !environment.prepare.is_empty())
            .ok_or_else(|| missing(&short(&commit)))?;
        let choice = crate::workspaces::choose(self, self.workspace, environment.strategy.as_deref())?;
        ensure!(
            !matches!(
                choice.strategy,
                crate::workspaces::Strategy::Fresh | crate::workspaces::Strategy::None
            ),
            "The workspace strategy is {} ({}), which keeps no workspace to prepare; choose one with --workspace worktree",
            choice.strategy.as_str(),
            choice.reason
        );
        let lease = crate::workspaces::lease(self, &commit, choice.strategy, None)?;
        let keys = self.prepare_keys(&revision, &environment)?;
        let steps = crate::environment::prepare(self, &lease.root, &environment, &keys, &lease.records, options, &|event| {
            self.progress(event)
        })?;
        Ok(json!({"format": "projections.prepare", "version": 0, "target": commit,
            "environment": environment.path, "root": lease.root, "strategy": lease.strategy.as_str(),
            "notes": lease.notes, "steps": steps}))
    }

    /// The environment as `projections doctor` and the Inspector report it:
    /// what the working tree declares, each prepare step's state in the working
    /// tree, the workspace strategy and why, and the workspaces.
    pub fn environment_report(&self) -> Result<Value> {
        let root = self.repository_root()?;
        let choice = crate::workspaces::choose(self, self.workspace, None);
        let mut report = json!({
            "workspace": match &choice {
                Ok(choice) => json!({"strategy": choice.strategy.as_str(), "source": choice.source, "reason": choice.reason}),
                Err(error) => json!({"error": format!("{error:#}")}),
            },
            "workspaces": crate::workspaces::list(self).unwrap_or_default(),
        });
        match self.working_environment() {
            Ok(None) => report["declared"] = Value::Null,
            Err(error) => report["error"] = json!(format!("{error:#}")),
            Ok(Some(environment)) => {
                let keys = crate::environment::checkout_keys(self, &root, &environment)?;
                let steps = crate::environment::status(&environment, &keys, &self.working_records()?)?;
                let missing: Vec<String> = environment
                    .prepare
                    .iter()
                    .map(|step| step.run[0].clone())
                    .chain(environment.toolchain.iter().map(|command| command[0].clone()))
                    .filter(|program| {
                        !program.contains('/')
                            && which(program).is_none()
                            && !(crate::python::launches_python(program) && crate::python::find(program).is_some())
                    })
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
                if let Some(strategy) = &environment.strategy
                    && let Ok(choice) = crate::workspaces::choose(self, self.workspace, Some(strategy))
                {
                    report["workspace"] = json!({"strategy": choice.strategy.as_str(), "source": choice.source, "reason": choice.reason});
                }
                report["declared"] = json!(environment.path);
                report["prepare"] = json!(steps);
                report["toolchain"] = json!(environment.toolchain);
                report["devcontainer"] = json!(environment.devcontainer);
                report["missing"] = json!(missing);
            }
        }
        Ok(report)
    }

    /// The environment the working tree declares, if any.
    pub fn working_environment(&self) -> Result<Option<crate::environment::Environment>> {
        let revision = self.capture_paths("working-tree", Some(&definition_paths()))?;
        self.environment_of(&revision)
    }

    /// The well-known lockfiles whose content differs between a commit and the
    /// working tree, whose installed dependencies a copy of the commit borrows.
    pub(super) fn borrowed_lockfiles(&self, examined: &Revision) -> Result<Vec<String>> {
        let lockfiles = |files: &[String]| -> Vec<String> {
            files
                .iter()
                .filter(|file| LOCKFILES.contains(&file.rsplit('/').next().unwrap_or(file)))
                .cloned()
                .collect()
        };
        let root = self.repository_root()?;
        let ours = lockfiles(&examined.files);
        let theirs = self.working_lockfiles()?;
        let theirs_ids: BTreeMap<String, String> = crate::environment::blobs(self, &root, &theirs.iter().collect::<Vec<_>>())?
            .into_iter()
            .collect();
        let mut differing: BTreeSet<String> = theirs
            .iter()
            .filter(|path| !examined.entries.contains_key(*path))
            .cloned()
            .collect();
        for path in ours {
            let id = examined.entries.get(&path).and_then(|(_, object)| object.clone());
            if id.is_none() || theirs_ids.get(&path) != id.as_ref() {
                differing.insert(path);
            }
        }
        Ok(differing.into_iter().collect())
    }

    /// Reports progress (prepare steps) on stderr, and to a listener when one is set.
    pub(super) fn progress(&self, event: Value) {
        if let Some(listener) = &self.listener {
            listener(&event);
            return;
        }
        let step = event["step"].as_str().unwrap_or_default();
        match event["event"].as_str() {
            Some("start") => eprintln!(
                "projections: preparing {step}: {} (log: {})",
                event["run"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" "),
                event["log"].as_str().unwrap_or_default()
            ),
            Some("succeeded") => eprintln!(
                "projections: prepared {step} in {:.1} s",
                event["durationMs"].as_u64().unwrap_or(0) as f64 / 1000.0
            ),
            Some("failed") => eprintln!("projections: preparing {step} failed"),
            _ => {}
        }
    }

    /// The working tree's well-known lockfiles (tracked or untracked, not ignored).
    pub(super) fn working_lockfiles(&self) -> Result<Vec<String>> {
        let root = self.repository_root()?;
        let mut arguments = vec![
            "ls-files".to_owned(),
            "-z".into(),
            "--cached".into(),
            "--others".into(),
            "--exclude-standard".into(),
            "--".into(),
        ];
        arguments.extend(LOCKFILES.iter().map(|name| format!(":(glob)**/{name}")));
        let arguments: Vec<&str> = arguments.iter().map(String::as_str).collect();
        let listed = self.git(&root, &arguments, None, 16 * 1024 * 1024)?;
        let mut files: Vec<String> = std::str::from_utf8(&listed)?
            .split('\0')
            .filter(|name| !name.is_empty() && safe_path(name).is_ok() && root.join(name).is_file())
            .map(str::to_owned)
            .collect();
        files.sort();
        files.dedup();
        Ok(files)
    }

    /// The outputs of the working tree's environment file's `toolchain`
    /// commands (run once per runner, only when trusted), hashed.
    pub(super) fn toolchain_identity(&self) -> String {
        self.toolchain
            .get_or_init(|| {
                // Toolchain commands are repository code: only trusted runs read them.
                if !self.trust {
                    return String::new();
                }
                let commands = match self.working_environment() {
                    Ok(Some(environment)) => environment.toolchain,
                    _ => return String::new(),
                };
                let Ok(root) = self.repository_root() else {
                    return String::new();
                };
                let environment = self.environment(&[]).unwrap_or_default();
                let mut hasher = Sha256::new();
                for command in commands {
                    let output = self
                        .run_argv(&command, &root, None, 30_000, &environment)
                        .map(|output| output.stdout)
                        .unwrap_or_else(|error| format!("unavailable: {error:#}"));
                    hasher.update(command.join(" ").as_bytes());
                    hasher.update(b"\0");
                    hasher.update(output.as_bytes());
                    hasher.update(b"\0");
                }
                format!("{:x}", hasher.finalize())
            })
            .clone()
    }
}
