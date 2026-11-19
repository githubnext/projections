//! What `Package.resolved` pins for each project, merged across projects.

use crate::project::Project;
use anyhow::Result;
use projections_extractor_sdk::Context;
use projections_extractor_swift_support::{Pin, resolved};
use std::collections::{BTreeMap, BTreeSet};

/// The `Package.resolved` Xcode keeps for the project: in its own workspace,
/// else in a workspace beside it.
pub(crate) fn pins(cx: &Context, project: &Project, files: &[String]) -> Result<Option<(String, Vec<Pin>)>> {
    let own = crate::join(&project.path, "project.xcworkspace/xcshareddata/swiftpm/Package.resolved");
    let beside = files.iter().find(|file| {
        crate::parent_dir(file).ends_with(".xcworkspace/xcshareddata/swiftpm")
            && file.ends_with("/Package.resolved")
            && crate::parent_dir(&crate::parent_dir(&crate::parent_dir(&crate::parent_dir(file)))) == project.dir
    });
    let path = if cx.exists(&own)? { Some(own) } else { beside.cloned() };
    match path {
        Some(path) => {
            let pins = resolved::read(&cx.read_json(&path)?)?;
            Ok(Some((path, pins)))
        }
        None => Ok(None),
    }
}

/// Every project's pins, one per package (the first project's), and, for each
/// package the projects pin differently, what each project pins: an upgrade in
/// one project must not hide behind another's pin.
pub(crate) fn merge(per_project: Vec<(String, Vec<Pin>)>) -> (Vec<Pin>, BTreeMap<String, BTreeMap<String, String>>) {
    let state = |pin: &Pin| {
        pin.version
            .clone()
            .or_else(|| pin.branch.as_ref().map(|branch| format!("branch {branch}")))
            .or_else(|| pin.revision.as_ref().map(|revision| format!("revision {revision}")))
            .unwrap_or_default()
    };
    let mut by_package: BTreeMap<String, Vec<(String, Pin)>> = BTreeMap::new();
    for (project, pins) in per_project {
        for pin in pins {
            by_package.entry(pin.identity.clone()).or_default().push((project.clone(), pin));
        }
    }
    let mut merged = Vec::new();
    let mut conflicts = BTreeMap::new();
    for (identity, pins) in by_package {
        let states: BTreeSet<String> = pins.iter().map(|(_, pin)| state(pin)).collect();
        if states.len() > 1 {
            conflicts.insert(identity, pins.iter().map(|(project, pin)| (project.clone(), state(pin))).collect());
        }
        merged.push(pins[0].1.clone());
    }
    (merged, conflicts)
}

#[cfg(test)]
mod tests {
    use super::merge;
    use projections_extractor_swift_support::Pin;

    fn pin(identity: &str, version: &str) -> Pin {
        Pin {
            identity: identity.into(),
            kind: "remoteSourceControl".into(),
            location: String::new(),
            version: Some(version.into()),
            revision: None,
            branch: None,
        }
    }

    #[test]
    fn packages_pinned_differently_by_projects_keep_each_pin() {
        let (merged, conflicts) = merge(vec![
            ("A.xcodeproj".into(), vec![pin("log", "1.0.0"), pin("collections", "1.1.0")]),
            ("B.xcodeproj".into(), vec![pin("log", "1.2.0"), pin("collections", "1.1.0")]),
        ]);
        assert_eq!(merged.len(), 2);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts["log"]["A.xcodeproj"], "1.0.0");
        assert_eq!(conflicts["log"]["B.xcodeproj"], "1.2.0");
    }
}
