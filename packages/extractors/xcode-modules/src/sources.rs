//! The Swift files a target compiles: those its Sources build phase lists,
//! and those in the folders it synchronizes (Xcode 16), less the folders'
//! membership exceptions for it.

use crate::project::Project;
use serde_json::{Map, Value};
use std::collections::BTreeSet;

pub(crate) fn swift_files(project: &Project, target_id: &str, target: &Map<String, Value>, files: &[String]) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    for (_, phase) in project.each(target, "buildPhases") {
        if phase.get("isa").and_then(Value::as_str) != Some("PBXSourcesBuildPhase") {
            continue;
        }
        for (_, build_file) in project.each(phase, "files") {
            let path = project.follow(build_file, "fileRef").and_then(|(id, _)| project.paths.get(id));
            if let Some(path) = path.filter(|path| path.ends_with(".swift")) {
                found.insert(path.clone());
            }
        }
    }
    for (group_id, group) in project.each(target, "fileSystemSynchronizedGroups") {
        let Some(folder) = project.paths.get(group_id) else {
            continue;
        };
        let excluded = exceptions(project, group, target_id);
        let prefix = if folder.is_empty() { String::new() } else { format!("{folder}/") };
        for file in files.iter().filter(|file| file.ends_with(".swift")) {
            if let Some(relative) = file.strip_prefix(&prefix)
                && !excluded
                    .iter()
                    .any(|exception| relative == *exception || relative.starts_with(&format!("{exception}/")))
            {
                found.insert(file.clone());
            }
        }
    }
    found
}

/// The paths, relative to a synchronized folder, it excludes from `target`.
fn exceptions<'a>(project: &'a Project, group: &'a Map<String, Value>, target_id: &str) -> Vec<&'a str> {
    project
        .each(group, "exceptions")
        .filter(|(_, set)| {
            set.get("isa").and_then(Value::as_str) == Some("PBXFileSystemSynchronizedBuildFileExceptionSet")
                && set.get("target").and_then(Value::as_str) == Some(target_id)
        })
        .flat_map(|(_, set)| {
            set.get("membershipExceptions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
        })
        .collect()
}
