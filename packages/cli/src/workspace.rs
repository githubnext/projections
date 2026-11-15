//! The working tree, watched for the Inspector: which projection parts changed,
//! so a live preview re-extracts, reloads a renderer or recomputes a comparison
//! as their files are saved.
//!
//! Every poll fingerprints (size, modification time and content) the definition files,
//! each definition's declared extractor, renderer and comparator files, a custom
//! renderer's development server record, and the files `git status` reports as
//! changed or untracked, which is what an extractor examining the working tree
//! sees beyond `HEAD`.
//!
//! Editors don't save atomically: many truncate and then write, some in chunks.
//! A change is reported, and a run reads the files, only once they have been
//! quiet for [`QUIET`], so neither sees a half-written file.

use crate::{dev_server, fixtures, runtime::Runner};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime},
};

/// Directories are walked to at most this many entries per declared source.
const WALK_LIMIT: usize = 5000;
const SKIPPED: [&str; 4] = ["node_modules", ".git", "target", "__pycache__"];

/// How long files must be unchanged before a change is reported or a run reads them.
pub const QUIET: Duration = Duration::from_millis(120);
/// The longest a change or a run waits for files to settle: a file written
/// continuously is read as it is.
pub const SETTLE_LIMIT: Duration = Duration::from_secs(2);
const SETTLE_STEP: Duration = Duration::from_millis(30);

/// A change to report: `definitions`, `working-tree` (what extractors examine),
/// or `extractor:<id>`, `renderer:<id>`, `comparator:<id>` and `scenarios:<id>`
/// (a custom renderer package's `scenarios.json`).
pub type Change = String;

/// One fingerprint per change kind.
pub type State = BTreeMap<Change, fixtures::Fingerprint>;

fn walk(path: &Path, paths: &mut Vec<PathBuf>) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        paths.push(path.to_path_buf());
        return;
    };
    paths.push(path.to_path_buf());
    if !metadata.is_dir() || paths.len() >= WALK_LIMIT {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        if SKIPPED.iter().any(|skipped| entry.file_name() == *skipped) {
            continue;
        }
        walk(&entry.path(), paths);
        if paths.len() >= WALK_LIMIT {
            return;
        }
    }
}

/// The paths a definition declares for a part (relative to its project), in
/// the checkout at `root`: its `sources`, and for an extractor command, the
/// arguments that name files in the checkout.
fn declared(root: &Path, part: &Value) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let resolved = |relative: &str| crate::project::resolve(relative).ok().filter(|path| !path.is_empty());
    let mut add = |relative: &str| {
        if let Some(path) = resolved(relative) {
            walk(&root.join(path), &mut paths);
        }
    };
    for source in part["sources"].as_array().into_iter().flatten() {
        add(source.as_str().unwrap_or_default());
    }
    for argument in part["command"].as_array().into_iter().flatten() {
        let argument = argument.as_str().unwrap_or_default();
        if resolved(argument).is_some_and(|path| root.join(path).is_file()) {
            add(argument);
        }
    }
    // A custom comparator's file: the comparator itself (a string), or its `file`.
    let file = part
        .as_str()
        .filter(|path| projections_comparator_runtime::is_comparator_file(path));
    if let Some(file) = file.or_else(|| part["file"].as_str()) {
        add(file);
    }
    if let Some(bundle) = part["bundle"].as_str() {
        add(bundle);
    }
    paths
}

/// The definitions in the working tree, read leniently: a definition being
/// edited may be invalid, and still changes `definitions`.
fn definitions(root: &Path) -> (Vec<PathBuf>, Vec<Value>) {
    let mut paths = Vec::new();
    let mut definitions = Vec::new();
    for directory in crate::project::directories() {
        let directory = root.join(directory);
        paths.push(directory.clone());
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        let mut files: Vec<_> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
            .collect();
        files.sort();
        for file in files {
            if let Some(definition) = fs::read(&file)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .filter(|definition| definition["id"].is_string())
            {
                definitions.push(definition);
            }
            paths.push(file);
        }
    }
    (paths, definitions)
}

/// Whether the working tree defines any projection; without one, runners use
/// the built-in defaults.
pub fn authored(root: &Path) -> bool {
    !definitions(root).1.is_empty()
}

/// Fingerprints the working tree of the checkout at `root`.
pub fn state(runner: &Runner, root: &Path) -> State {
    let mut state = State::new();
    let (paths, definitions) = definitions(root);
    state.insert("definitions".into(), fixtures::fingerprint(&paths));
    for definition in &definitions {
        let id = definition["id"].as_str().unwrap_or_default();
        state.insert(
            format!("extractor:{id}"),
            fixtures::fingerprint(&declared(root, &definition["extractor"])),
        );
        let mut renderer = declared(root, &definition["renderer"]);
        if let Some(package) = dev_server::package(root, definition) {
            renderer.push(package.join(dev_server::RECORD));
            state.insert(format!("scenarios:{id}"), fixtures::fingerprint(&[package.join("scenarios.json")]));
        }
        state.insert(format!("renderer:{id}"), fixtures::fingerprint(&renderer));
        state.insert(
            format!("comparator:{id}"),
            fixtures::fingerprint(&declared(root, &definition["comparator"])),
        );
    }
    // What extractors examine: the status itself, and every file it lists, so
    // editing an already modified file is a change too.
    let status = runner
        .git(
            root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            None,
            16 * 1024 * 1024,
        )
        .unwrap_or_default();
    let mut changed = vec![root.join(".git/HEAD"), root.join(".git/index")];
    for entry in status.split(|byte| *byte == 0) {
        if let Some(path) = entry.get(3..).and_then(|path| std::str::from_utf8(path).ok()) {
            changed.push(root.join(path));
        }
    }
    let mut fingerprint = fixtures::fingerprint(&changed);
    fingerprint.push(Some((status.len() as u64, None, 0)));
    fingerprint.push(Some((
        status
            .iter()
            .fold(0u64, |hash, byte| hash.wrapping_mul(31).wrapping_add(u64::from(*byte))),
        None,
        0,
    )));
    state.insert("working-tree".into(), fingerprint);
    state
}

/// Samples until the sample is unchanged for [`QUIET`], or [`SETTLE_LIMIT`]
/// has passed, and returns the last sample.
pub fn settle<T: PartialEq>(mut sample: impl FnMut() -> T, first: T) -> T {
    let start = Instant::now();
    let mut current = first;
    let mut quiet_since = Instant::now();
    while quiet_since.elapsed() < QUIET && start.elapsed() < SETTLE_LIMIT {
        std::thread::sleep(SETTLE_STEP);
        let next = sample();
        if next != current {
            current = next;
            quiet_since = Instant::now();
        }
    }
    current
}

/// The files a working-tree run of projection `id` reads as its program: the
/// definition files (any of them may be the one being written), and the
/// projection's declared extractor and comparator sources.
pub fn inputs(root: &Path, id: &str) -> Vec<PathBuf> {
    let (mut paths, definitions) = definitions(root);
    if let Some(definition) = definitions.iter().find(|definition| definition["id"] == id) {
        for part in ["extractor", "comparator"] {
            paths.extend(declared(root, &definition[part]));
        }
    }
    paths
}

/// Fingerprints a working-tree run's inputs once they have settled: at once
/// when none was modified within [`QUIET`], else after they have been quiet.
pub fn settled_inputs(root: &Path, id: &str) -> fixtures::Fingerprint {
    let sample = || fixtures::fingerprint(&inputs(root, id));
    let first = sample();
    let now = SystemTime::now();
    let recent = first
        .iter()
        .flatten()
        .any(|(_, modified, _)| modified.is_some_and(|modified| now.duration_since(modified).map_or(true, |age| age < QUIET)));
    if recent { settle(sample, first) } else { first }
}

/// The change kinds whose fingerprints differ between two states.
pub fn changes(before: &State, after: &State) -> Vec<Change> {
    let mut kinds: Vec<Change> = after
        .iter()
        .filter(|(kind, fingerprint)| before.get(*kind) != Some(fingerprint))
        .map(|(kind, _)| kind.clone())
        .collect();
    kinds.extend(before.keys().filter(|kind| !after.contains_key(*kind)).cloned());
    kinds
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settling_waits_until_the_sample_is_quiet() {
        let started = Instant::now();
        let mut samples = [1, 2, 2, 3].into_iter();
        let mut at = Vec::new();
        let settled = settle(
            || {
                at.push(Instant::now());
                samples.next().unwrap_or(3)
            },
            0,
        );
        // The repeated 2 is a pause of one step, shorter than QUIET, so settling goes on to 3. A loaded runner can
        // oversleep that step past QUIET; then the pause really was quiet, and settling rightly stops at 2.
        let pause = at[2].duration_since(at[1]);
        let margin = Duration::from_millis(10);
        if pause + margin < QUIET {
            assert_eq!(settled, 3);
            assert!(started.elapsed() >= QUIET + SETTLE_STEP * 3);
        } else if pause > QUIET + margin {
            assert_eq!(settled, 2);
        } else {
            assert!(settled == 2 || settled == 3);
        }
        assert!(started.elapsed() < SETTLE_LIMIT);
        let started = Instant::now();
        let mut count = 0;
        assert_eq!(
            settle(
                || {
                    count += 1;
                    count
                },
                0
            ),
            count
        );
        assert!(started.elapsed() >= SETTLE_LIMIT);
    }

    #[test]
    fn changes_name_added_removed_and_altered_kinds() {
        let mut before = State::new();
        before.insert("definitions".into(), vec![Some((1, None, 0))]);
        before.insert("extractor:a".into(), vec![Some((1, None, 0))]);
        let mut after = before.clone();
        after.insert("definitions".into(), vec![Some((2, None, 0))]);
        after.remove("extractor:a");
        after.insert("renderer:b".into(), vec![None]);
        assert_eq!(changes(&before, &after), ["definitions", "renderer:b", "extractor:a"]);
        assert!(changes(&after, &after).is_empty());
    }
}
