//! One `.xcodeproj`: its objects, and the project-relative path of every file
//! reference and group, resolved through the group tree as Xcode does.

use crate::plist;
use anyhow::{Context as _, Result, bail};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub(crate) struct Project {
    /// The `.xcodeproj` directory, project-relative: `App/Harbor.xcodeproj`.
    pub path: String,
    /// The directory holding it.
    pub dir: String,
    /// Its source root: `dir` with the project's `projectDirPath`, which
    /// `SOURCE_ROOT` paths and local packages are relative to.
    pub source_root: String,
    pub object_version: String,
    objects: Map<String, Value>,
    root: String,
    /// Each file reference's and group's path, when it is in the repository.
    pub paths: BTreeMap<String, String>,
}

impl Project {
    pub fn read(path: &str, text: &str) -> Result<Self> {
        let document = plist::parse(text).with_context(|| format!("{path}/project.pbxproj isn't a property list"))?;
        let Value::Object(objects) = document["objects"].clone() else {
            bail!("{path}/project.pbxproj has no objects");
        };
        let root = document["rootObject"]
            .as_str()
            .context("project.pbxproj has no rootObject")?
            .to_owned();
        let dir = crate::parent_dir(path);
        let mut project = Project {
            path: path.to_owned(),
            source_root: dir.clone(),
            dir,
            object_version: document["objectVersion"].as_str().unwrap_or_default().to_owned(),
            objects,
            root,
            paths: BTreeMap::new(),
        };
        let base = crate::join(
            &project.dir,
            project.root_object().get("projectDirPath").and_then(Value::as_str).unwrap_or(""),
        );
        project.source_root = normalize(&base);
        if let Some(main) = project.root_object().get("mainGroup").and_then(Value::as_str).map(str::to_owned) {
            let root = project.source_root.clone();
            project.resolve(&main, Some(&root), 0);
        }
        Ok(project)
    }

    pub fn object(&self, id: &str) -> Option<&Map<String, Value>> {
        self.objects.get(id).and_then(Value::as_object)
    }

    pub fn root_object(&self) -> &Map<String, Value> {
        self.object(&self.root).expect("rootObject names an object")
    }

    pub fn is_root(&self, id: &str) -> bool {
        id == self.root
    }

    /// The object `field` of `object` names.
    pub fn follow<'a>(&'a self, object: &Map<String, Value>, field: &str) -> Option<(&'a str, &'a Map<String, Value>)> {
        let id = object.get(field)?.as_str()?;
        self.objects
            .get_key_value(id)
            .and_then(|(id, value)| Some((id.as_str(), value.as_object()?)))
    }

    /// The objects `field` of `object` lists.
    pub fn each<'a>(&'a self, object: &'a Map<String, Value>, field: &str) -> impl Iterator<Item = (&'a str, &'a Map<String, Value>)> {
        object
            .get(field)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|id| self.objects.get_key_value(id.as_str()?))
            .filter_map(|(id, value)| Some((id.as_str(), value.as_object()?)))
    }

    /// Every object of the class `isa`.
    pub fn references<'a>(&'a self, isa: &'a str) -> impl Iterator<Item = &'a Map<String, Value>> {
        self.objects
            .values()
            .filter_map(Value::as_object)
            .filter(move |object| object.get("isa").and_then(Value::as_str) == Some(isa))
    }

    /// The project's targets, in its order: `(id, target)`.
    pub fn targets(&self) -> Vec<(&str, &Map<String, Value>)> {
        self.each(self.root_object(), "targets").collect()
    }

    /// Records the path of `id` and, for a group, of its children. `parent` is
    /// the enclosing group's path, `None` when it isn't in the repository.
    fn resolve(&mut self, id: &str, parent: Option<&str>, depth: usize) {
        let Some(object) = self.object(id).cloned() else {
            return;
        };
        if depth > 64 {
            return;
        }
        let own = object.get("path").and_then(Value::as_str);
        let path = match object.get("sourceTree").and_then(Value::as_str).unwrap_or("<group>") {
            "<group>" => parent.map(|parent| own.map_or_else(|| parent.to_owned(), |own| normalize(&crate::join(parent, own)))),
            "SOURCE_ROOT" => Some(normalize(&crate::join(&self.source_root, own.unwrap_or("")))),
            _ => None,
        };
        let path = path.filter(|path| !path.starts_with(".."));
        if let Some(path) = &path {
            self.paths.insert(id.to_owned(), path.clone());
        }
        let children: Vec<String> = object
            .get("children")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        for child in children {
            self.resolve(&child, path.as_deref(), depth + 1);
        }
    }
}

/// A `/`-separated path with `.` and `..` segments folded; leading `..` kept.
pub(crate) fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." if parts.last().is_some_and(|last| *last != "..") => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    parts.join("/")
}

/// A product type without Apple's prefix: `application`, `framework`, `bundle.unit-test`.
pub(crate) fn product_type(target: &Map<String, Value>) -> String {
    match target.get("productType").and_then(Value::as_str) {
        Some(kind) => kind.strip_prefix("com.apple.product-type.").unwrap_or(kind).to_owned(),
        None if target.get("isa").and_then(Value::as_str) == Some("PBXAggregateTarget") => "aggregate".into(),
        None => "legacy".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::Project;

    #[test]
    fn source_root_paths_start_at_the_projects_directory_path() {
        let text = "{ objects = { R = { isa = PBXProject; mainGroup = G; projectDirPath = ..; targets = (); }; G = { isa = PBXGroup; children = (F, S); sourceTree = \"<group>\"; }; F = { isa = PBXFileReference; path = Sources/App.swift; sourceTree = SOURCE_ROOT; }; S = { isa = PBXGroup; children = (); path = Shared; sourceTree = \"<group>\"; }; }; rootObject = R; }";
        let project = Project::read("Config/App.xcodeproj", text).unwrap();
        assert_eq!(project.source_root, "");
        assert_eq!(project.paths["F"], "Sources/App.swift");
        assert_eq!(project.paths["S"], "Shared");
    }
}
