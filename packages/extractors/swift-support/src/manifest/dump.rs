//! The manifest `swift package dump-package` prints: SwiftPM's own evaluation
//! of `Package.swift`, conditions and computed values included.

use super::{Condition, Dependency, DependencyKind, Manifest, Product, Requirement, Source, Target, TargetDependency};
use anyhow::{Context as _, Result, bail};
use projections_extractor_sdk::{array, object, strings, text};
use serde_json::Value;

/// The manifest `document` describes. Local dependencies' absolute paths are
/// made relative to the package's directory, as SwiftPM records it
/// (`packageKind.root`).
pub fn read(document: &Value) -> Result<Manifest> {
    object(document, "dump-package output")?;
    let root = document["packageKind"]["root"][0].as_str().unwrap_or_default();
    let mut products = Vec::new();
    for product in array(&document["products"], "products")? {
        products.push(self::product(product)?);
    }
    let mut dependencies = Vec::new();
    for dependency in array(&document["dependencies"], "dependencies")? {
        dependencies.push(self::dependency(dependency, root)?);
    }
    let mut targets = Vec::new();
    for target in array(&document["targets"], "targets")? {
        targets.push(self::target(target)?);
    }
    Ok(Manifest {
        name: text(&document["name"], "name")?.to_owned(),
        tools_version: None,
        products,
        dependencies,
        targets,
    })
}

/// The single key of an enum-like object (`{"library": ["automatic"]}`) and its value.
fn variant<'a>(value: &'a Value, what: &str) -> Result<(&'a str, &'a Value)> {
    let fields = object(value, what)?;
    let mut entries = fields.iter();
    match (entries.next(), entries.next()) {
        (Some((key, value)), None) => Ok((key.as_str(), value)),
        _ => bail!("{what} isn't a single-case value"),
    }
}

fn product(value: &Value) -> Result<Product> {
    let name = text(&value["name"], "product.name")?.to_owned();
    let (kind, detail) = variant(&value["type"], "product.type")?;
    let linkage = match kind {
        "library" => Some(text(&array(detail, "library linkage")?[0], "library linkage")?.to_owned()),
        _ => None,
    };
    let targets = strings(&value["targets"], "product.targets")?;
    Ok(Product {
        name,
        kind: kind.to_owned(),
        linkage,
        targets,
    })
}

fn dependency(value: &Value, root: &str) -> Result<Dependency> {
    let (kind, detail) = variant(value, "dependency")?;
    let detail = array(detail, "dependency")?.first().context("empty dependency")?;
    let identity = text(&detail["identity"], "dependency.identity")?.to_owned();
    let name = detail["nameForTargetDependencyResolutionOnly"].as_str().map(str::to_owned);
    let (source, requirement) = match kind {
        "sourceControl" => {
            let (place, location) = variant(&detail["location"], "dependency.location")?;
            let location = &array(location, "dependency.location")?[0];
            let location = if place == "remote" { &location["urlString"] } else { location };
            (
                Source::Repository(text(location, "dependency.location")?.to_owned()),
                requirement(&detail["requirement"])?,
            )
        }
        "fileSystem" => (
            Source::Local(relative(text(&detail["path"], "dependency.path")?, root)),
            Requirement::Local,
        ),
        "registry" => (Source::Registry(identity.clone()), requirement(&detail["requirement"])?),
        other => bail!("Unknown dependency kind `{other}`"),
    };
    Ok(Dependency {
        identity,
        name,
        source,
        requirement,
    })
}

fn requirement(value: &Value) -> Result<Requirement> {
    let (kind, detail) = variant(value, "requirement")?;
    let first = array(detail, "requirement")?.first().context("empty requirement")?;
    Ok(match kind {
        "range" => Requirement::Range {
            lower: text(&first["lowerBound"], "lowerBound")?.to_owned(),
            upper: text(&first["upperBound"], "upperBound")?.to_owned(),
        },
        "exact" => Requirement::Exact(text(first, "exact")?.to_owned()),
        "branch" => Requirement::Branch(text(first, "branch")?.to_owned()),
        "revision" => Requirement::Revision(text(first, "revision")?.to_owned()),
        other => bail!("Unknown requirement kind `{other}`"),
    })
}

/// `path` relative to `root`, with `..` where it lies outside, `/`-separated.
fn relative(path: &str, root: &str) -> String {
    let split = |path: &str| {
        path.split(['/', '\\'])
            .filter(|part| !part.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    let (path, root) = (split(path), split(root));
    let common = path.iter().zip(&root).take_while(|(a, b)| a == b).count();
    let mut parts = vec!["..".to_owned(); root.len() - common];
    parts.extend(path[common..].iter().cloned());
    parts.join("/")
}

fn target(value: &Value) -> Result<Target> {
    let name = text(&value["name"], "target.name")?.to_owned();
    let kind = text(&value["type"], "target.type")?.to_owned();
    let path = value["path"].as_str().map(str::to_owned);
    let mut dependencies = Vec::new();
    for dependency in array(&value["dependencies"], "target.dependencies")? {
        let (kind, detail) = variant(dependency, "target dependency")?;
        let detail = array(detail, "target dependency")?;
        let name = text(&detail[0], "target dependency name")?.to_owned();
        let (kind, condition) = match kind {
            "byName" => (DependencyKind::ByName, &detail[1]),
            "target" => (DependencyKind::Target, &detail[1]),
            "product" => (
                DependencyKind::Product {
                    package: detail[1].as_str().map(str::to_owned),
                },
                &detail[3],
            ),
            other => bail!("Unknown target dependency kind `{other}`"),
        };
        dependencies.push(TargetDependency {
            kind,
            name,
            condition: self::condition(condition)?,
        });
    }
    Ok(Target {
        name,
        kind,
        path,
        dependencies,
    })
}

fn condition(value: &Value) -> Result<Condition> {
    if value.is_null() {
        return Ok(Condition::default());
    }
    let list = |key: &str| {
        if value[key].is_null() {
            Ok(Vec::new())
        } else {
            strings(&value[key], key)
        }
    };
    Ok(Condition {
        platforms: list("platformNames")?,
        traits: list("traits")?,
    })
}
