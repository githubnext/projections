//! The Swift packages a target uses: its package product dependencies and
//! the packages they come from, and what `Package.resolved` pins.

use crate::project::{Project, normalize};
use anyhow::Result;
use projections_extractor_sdk::Context;
use projections_extractor_swift_support::manifest::{Requirement, identity};
use projections_extractor_swift_support::{Pin, resolved};
use serde_json::{Map, Value};

pub(crate) struct Package {
    pub identity: String,
    /// `repository` or `local`.
    pub source: &'static str,
    /// The repository URL, or the local package's project-relative directory.
    pub location: String,
    pub requirement: Option<String>,
}

pub(crate) struct ProductDependency {
    pub product: String,
    /// The package it comes from; none for a product of a local package the
    /// project lists as a folder rather than a package reference.
    pub package: Option<Package>,
}

pub(crate) fn products(project: &Project, target: &Map<String, Value>) -> Vec<ProductDependency> {
    project
        .each(target, "packageProductDependencies")
        .filter_map(|(_, dependency)| {
            let product = dependency.get("productName")?.as_str()?.to_owned();
            let package = project
                .follow(dependency, "package")
                .and_then(|(_, reference)| package(project, reference));
            Some(ProductDependency { product, package })
        })
        .collect()
}

fn package(project: &Project, reference: &Map<String, Value>) -> Option<Package> {
    match reference.get("isa")?.as_str()? {
        "XCRemoteSwiftPackageReference" => {
            let url = reference.get("repositoryURL")?.as_str()?;
            let requirement = reference.get("requirement").and_then(Value::as_object).and_then(requirement);
            Some(Package {
                identity: identity(url),
                source: "repository",
                location: url.to_owned(),
                requirement,
            })
        }
        "XCLocalSwiftPackageReference" => {
            let path = reference.get("relativePath")?.as_str()?;
            let location = normalize(&crate::join(&project.dir, path));
            Some(Package {
                identity: identity(path),
                source: "local",
                location,
                requirement: None,
            })
        }
        _ => None,
    }
}

/// A package reference's requirement, as SwiftPM describes it.
fn requirement(requirement: &Map<String, Value>) -> Option<String> {
    let field = |name: &str| requirement.get(name).and_then(Value::as_str);
    let parsed = match field("kind")? {
        "upToNextMajorVersion" => Requirement::up_to_next_major(field("minimumVersion")?).ok()?,
        "upToNextMinorVersion" => Requirement::up_to_next_minor(field("minimumVersion")?).ok()?,
        "exactVersion" => Requirement::exact(field("version")?).ok()?,
        "versionRange" => Requirement::half_open(field("minimumVersion")?, field("maximumVersion")?).ok()?,
        "branch" => Requirement::Branch(field("branch")?.to_owned()),
        "revision" => Requirement::Revision(field("revision")?.to_owned()),
        _ => return None,
    };
    parsed.describe()
}

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
