//! Each target of the projects read: its module name, sources' imports, the
//! targets it depends on or links, and the package products it uses.

use crate::locals::{attribute, local_products};
use crate::packages::{ProductDependency, products};
use crate::project::{Project, product_type};
use crate::settings::{configuration, expand, settings};
use crate::sources::swift_files;
use anyhow::Result;
use projections_extractor_sdk::{Context, key};
use projections_extractor_swift_support::{Import, imports};
use serde_json::{Map, Value, json};

pub(crate) struct Target {
    pub id: String,
    pub project: usize,
    pub name: String,
    pub kind: String,
    /// `PRODUCT_MODULE_NAME`; none when a setting it uses isn't known here.
    pub module: Option<String>,
    pub sdk: Option<String>,
    pub configuration: Option<String>,
    /// Targets it names as dependencies, and targets whose products it links.
    pub dependencies: Vec<String>,
    pub links: Vec<String>,
    pub products: Vec<ProductDependency>,
    pub imports: Vec<Import>,
    /// `{file, reason}` for each source whose imports were read only up to a
    /// part the reader can't read.
    pub unread: Vec<Value>,
}

pub(crate) fn id(project: &Project, name: &str) -> String {
    key(&["xcode", &project.path, "target", name])
}

pub(crate) struct Options<'a> {
    pub configuration: Option<&'a str>,
    pub imports: bool,
}

pub(crate) fn targets(cx: &Context, projects: &[Project], options: &Options) -> Result<Vec<Target>> {
    let files = cx.files()?;
    let mut found = Vec::new();
    for (index, project) in projects.iter().enumerate() {
        let locals = local_products(cx, project)?;
        for (object_id, target) in project.targets() {
            let name = target.get("name").and_then(Value::as_str).unwrap_or_default().to_owned();
            let configuration = configuration(project, target, options.configuration).map(str::to_owned);
            let settings = match &configuration {
                Some(configuration) => settings(cx, project, Some(target), configuration)?,
                None => Default::default(),
            };
            let module = settings.get("PRODUCT_MODULE_NAME").and_then(|value| expand(&settings, value));
            let (mut imported, mut unread) = (Vec::new(), Vec::new());
            if options.imports {
                for file in swift_files(project, object_id, target, files) {
                    let (found, reason) = imports(&cx.read_source(&file)?);
                    imported.extend(found);
                    if let Some(reason) = reason {
                        unread.push(json!({"file": file, "reason": reason}));
                    }
                }
            }
            let mut products = products(project, target);
            attribute(&mut products, &locals);
            found.push(Target {
                id: id(project, &name),
                project: index,
                kind: product_type(target),
                module,
                sdk: settings.get("SDKROOT").and_then(|value| expand(&settings, value)),
                configuration,
                dependencies: dependencies(projects, index, target),
                links: links(projects, index, target),
                products,
                imports: imported,
                unread,
                name,
            });
        }
    }
    Ok(found)
}

/// The target `object_id` names in `projects[index]`, as an entity ID.
fn target_named(projects: &[Project], index: usize, object_id: &str) -> Option<String> {
    let project = &projects[index];
    let name = project.object(object_id)?.get("name")?.as_str()?;
    Some(id(project, name))
}

/// The project a container proxy's portal is: this one, or another read project.
fn portal(projects: &[Project], index: usize, proxy: &Map<String, Value>) -> Option<usize> {
    let project = &projects[index];
    let portal = proxy.get("containerPortal")?.as_str()?;
    if project.is_root(portal) {
        return Some(index);
    }
    let path = project.paths.get(portal)?;
    projects.iter().position(|other| &other.path == path)
}

fn dependencies(projects: &[Project], index: usize, target: &Map<String, Value>) -> Vec<String> {
    let project = &projects[index];
    project
        .each(target, "dependencies")
        .filter_map(|(_, dependency)| {
            if let Some(local) = dependency.get("target").and_then(Value::as_str) {
                return target_named(projects, index, local);
            }
            let (_, proxy) = project.follow(dependency, "targetProxy")?;
            target_named(
                projects,
                portal(projects, index, proxy)?,
                proxy.get("remoteGlobalIDString")?.as_str()?,
            )
        })
        .collect()
}

/// Targets whose products the target links: a product of its own project, or
/// one another project builds (a reference proxy).
fn links(projects: &[Project], index: usize, target: &Map<String, Value>) -> Vec<String> {
    let project = &projects[index];
    let producer = |index: usize, product: &str| {
        let project = &projects[index];
        project
            .targets()
            .into_iter()
            .find(|(_, candidate)| candidate.get("productReference").and_then(Value::as_str) == Some(product))
            .map(|(object_id, _)| object_id.to_owned())
            .and_then(|object_id| target_named(projects, index, &object_id))
    };
    project
        .each(target, "buildPhases")
        .filter(|(_, phase)| phase.get("isa").and_then(Value::as_str) == Some("PBXFrameworksBuildPhase"))
        .flat_map(|(_, phase)| project.each(phase, "files"))
        .filter_map(|(_, build_file)| {
            let (reference_id, reference) = project.follow(build_file, "fileRef")?;
            if reference.get("isa").and_then(Value::as_str) != Some("PBXReferenceProxy") {
                return producer(index, reference_id);
            }
            let (_, proxy) = project.follow(reference, "remoteRef")?;
            producer(portal(projects, index, proxy)?, proxy.get("remoteGlobalIDString")?.as_str()?)
        })
        .collect()
}
