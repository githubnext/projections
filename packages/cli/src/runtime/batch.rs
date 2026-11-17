//! Extracting and comparing every projection, and bookmarks, at once.

use std::collections::BTreeSet;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use super::{DefinitionSource, Runner, compare::definition_name, diagnostic, revision::Revision};
use crate::artifact;

/// Which definition a bookmark run applies to both of a bookmark's revisions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DefinitionChoice {
    /// The base revision's, or, when neither revision defines the projection,
    /// the definition at the revision the bookmarks file was read from.
    Default,
    /// The base or the head revision's.
    Side(DefinitionSource),
    /// This revision's, for example `working-tree`.
    Revision(String),
}

impl Runner {
    fn batch_ids(&self, revisions: &[&Revision], selected: &[String]) -> Result<Vec<String>> {
        if !selected.is_empty() {
            ensure!(
                selected.iter().collect::<BTreeSet<_>>().len() == selected.len(),
                "Duplicate selected IDs"
            );
            return Ok(selected.to_vec());
        }
        let mut ids = BTreeSet::new();
        for revision in revisions {
            for definition in self.definitions(revision)? {
                ids.insert(definition["id"].as_str().context("Missing ID")?.to_owned());
            }
        }
        Ok(ids.into_iter().collect())
    }

    /// Extracts every selected projection at one revision, retaining failures.
    pub fn show_all(&self, reference: &str, selected: &[String]) -> Result<Value> {
        let revision = self.capture(reference)?;
        let mut results = Vec::new();
        for id in self.batch_ids(&[&revision], selected)? {
            self.check_cancelled()?;
            let definition = self.definition(&revision, &id).ok();
            let result = (|| -> Result<Value> {
                let copy = revision.copy()?;
                let extraction = self.show_from(&copy, &copy, &id)?;
                Ok(json!({"id":id,"status":"extracted","extraction":extraction}))
            })();
            results.push(self.batch_result(&id, definition.as_ref(), result)?);
        }
        Ok(batch_document("show", results))
    }

    /// Compares every projection either revision defines, retaining failures.
    /// A projection the definition revision lacks is shown at the other
    /// revision alone, with its own definition.
    pub fn compare_all(&self, before: &str, after: &str, selected: &[String], source: DefinitionSource) -> Result<Value> {
        let first = self.capture(before)?;
        let second = self.capture(after)?;
        let (program, other) = match source {
            DefinitionSource::Base => (&first, &second),
            DefinitionSource::Head => (&second, &first),
        };
        let sides = source.sides();
        let mut results = Vec::new();
        for id in self.batch_ids(&[&first, &second], selected)? {
            self.check_cancelled()?;
            let definition = self.definition(program, &id).ok();
            let alone = definition.is_none() && self.definition(other, &id).is_ok();
            let resolved = definition.clone().or_else(|| self.definition(other, &id).ok());
            let result = (|| -> Result<Value> {
                if alone {
                    let copy = other.copy()?;
                    let extraction = self.show_from(&copy, &copy, &id)?;
                    return Ok(json!({"id":id,"status":format!("{}-only",sides.other),"extraction":extraction,
                        "notices":[format!("Projection {id} is not defined at the {side} revision, so it is shown at the {other_side} revision alone. Compare with --definition {other_side} to compare both revisions with the {other_side} revision's definition, which runs its projection code",
                            side=sides.definition, other_side=sides.other)]}));
                }
                let compared = self.compare_from(&id, &first.copy()?, &second.copy()?, source)?;
                Ok(compared.batch_item(&id))
            })();
            results.push(self.batch_result(&id, resolved.as_ref(), result)?);
        }
        Ok(batch_document("compare", results))
    }

    fn batch_result(&self, id: &str, definition: Option<&Value>, result: Result<Value>) -> Result<Value> {
        Ok(match result {
            Ok(value) => value,
            Err(error) => {
                self.check_cancelled()?;
                let mut item = json!({"id":id,"status":"error","diagnostics":[diagnostic(&error)]});
                if let Some(definition) = definition {
                    item["definition"] = definition.clone();
                }
                item
            }
        })
    }

    pub fn bookmarks(&self, reference: &str) -> Result<Value> {
        // Only the bookmarks file is needed, not the whole revision.
        let path = &crate::project::path(crate::project::BOOKMARKS);
        let revision = self.capture_paths(reference, Some(std::slice::from_ref(path)))?;
        if !revision.entries.contains_key(path) {
            return Ok(json!({"format":"projections.bookmarks","version":0,"bookmarks":[]}));
        }
        let mut value = artifact::parse(std::str::from_utf8(&self.read_file(&revision, path, 1024 * 1024)?)?)?;
        ensure!(
            value
                .as_object()
                .is_some_and(|object| object.keys().all(|key| ["format", "version", "bookmarks"].contains(&key.as_str())))
                && value["format"] == "projections.bookmarks"
                && value["version"] == 0,
            "Invalid bookmarks format/version"
        );
        let bookmarks = value["bookmarks"].as_array_mut().context("Bookmarks must be an array")?;
        ensure!(bookmarks.len() <= 100, "At most100bookmarks");
        let mut ids = BTreeSet::new();
        let identifier = regex::Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$")?;
        for bookmark in bookmarks.iter_mut() {
            ensure!(
                bookmark.as_object().is_some_and(|object| object
                    .keys()
                    .all(|key| ["id", "title", "projectionId", "before", "after"].contains(&key.as_str()))),
                "Unknown bookmark field"
            );
            for name in ["id", "title", "projectionId", "before"] {
                ensure!(
                    bookmark[name].as_str().is_some_and(|value| !value.is_empty()),
                    "Missing bookmark {name}"
                );
            }
            if let Some(after) = bookmark.get("after") {
                ensure!(after.as_str().is_some_and(|value| !value.is_empty()), "Invalid bookmark after");
            } else {
                bookmark["after"] = json!("working-tree");
            }
            for name in ["id", "projectionId"] {
                ensure!(identifier.is_match(bookmark[name].as_str().unwrap()), "Invalid bookmark {name}");
            }
            ensure!(
                bookmark["title"].as_str().unwrap().chars().count() <= 1000
                    && ["before", "after"]
                        .iter()
                        .all(|name| bookmark[*name].as_str().unwrap().chars().count() <= 1024),
                "Bookmark title/revision exceeds limit"
            );
            ensure!(ids.insert(bookmark["id"].as_str().unwrap().to_owned()), "Duplicate bookmark ID");
        }
        bookmarks.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        Ok(value)
    }

    /// Compares root-authored bookmarks, read from `reference`, retaining failures.
    pub fn compare_bookmarks(&self, reference: &str, selected: &[String], choice: &DefinitionChoice) -> Result<Value> {
        let document = self.bookmarks(reference)?;
        let bookmarks = document["bookmarks"].as_array().context("Invalid bookmarks")?;
        let ids = if selected.is_empty() {
            bookmarks
                .iter()
                .map(|value| value["id"].as_str().unwrap().to_owned())
                .collect::<Vec<_>>()
        } else {
            selected.to_vec()
        };
        ensure!(
            ids.iter().collect::<BTreeSet<_>>().len() == ids.len(),
            "Duplicate selected bookmarks"
        );
        let mut results = Vec::new();
        for id in ids {
            self.check_cancelled()?;
            let mut definition = None;
            let result = (|| -> Result<Value> {
                let bookmark = bookmarks.iter().find(|value| value["id"] == id).context("Unknown bookmark ID")?;
                let projection = bookmark["projectionId"].as_str().unwrap();
                let before = self.capture(bookmark["before"].as_str().unwrap())?;
                let after = self.capture(bookmark["after"].as_str().unwrap_or("working-tree"))?;
                // A bookmark saved before its projection was written has
                // revisions that define neither: the definition beside the
                // bookmarks file explains them.
                let fallback = *choice == DefinitionChoice::Default
                    && !self.has_definition(&before, projection)
                    && !self.has_definition(&after, projection);
                let using = match choice {
                    DefinitionChoice::Revision(revision) => Some((revision.as_str(), None)),
                    _ if fallback => Some((
                        reference,
                        Some(format!(
                            "Neither revision of bookmark {id} defines projection {projection}, so both were extracted with the {} definition, where the bookmarks file is.",
                            definition_name(reference)
                        )),
                    )),
                    _ => None,
                };
                let compared = match using {
                    Some((revision, reason)) => {
                        let program = self.capture(revision)?;
                        definition = self.definition(&program, projection).ok();
                        self.compare_using_from(projection, &before, &after, &program, revision, reason)?
                    }
                    None => {
                        let source = match choice {
                            DefinitionChoice::Side(source) => *source,
                            _ => DefinitionSource::Base,
                        };
                        definition = self
                            .definition(if source == DefinitionSource::Base { &before } else { &after }, projection)
                            .ok();
                        self.compare_from(projection, &before, &after, source)?
                    }
                };
                let mut item = compared.batch_item(&id);
                item["projectionId"] = json!(projection);
                Ok(item)
            })();
            results.push(self.batch_result(&id, definition.as_ref(), result)?);
        }
        Ok(batch_document("bookmarks", results))
    }

    /// Revisions for a pair picker: the working tree, then `limit` commits of
    /// `HEAD`'s history, newest first.
    pub fn revisions(&self, limit: usize) -> Result<Value> {
        ensure!((1..=100).contains(&limit), "Revision limit must be 1-100");
        let root = self.repository_root()?;
        let head = self.resolve(&root, "HEAD")?;
        let dirty = !self
            .git(
                &root,
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                None,
                16 * 1024 * 1024,
            )?
            .is_empty();
        let mut revisions = vec![json!({"ref":"working-tree","commit":head,"title":"Working tree",
            "kind":"working-tree","dirty":dirty})];
        let count = limit.to_string();
        for line in self
            .git_text(&root, &["log", "--max-count", &count, "--format=%H%x09%cI%x09%s", &head])?
            .lines()
        {
            let mut parts = line.splitn(3, '\t');
            let (Some(commit), Some(date), Some(title)) = (parts.next(), parts.next(), parts.next()) else {
                bail!("Invalid Git history");
            };
            revisions.push(json!({"ref":commit,"commit":commit,"title":title,"kind":"commit","date":date}));
        }
        Ok(json!(revisions))
    }
}

pub fn batch_document(operation: &str, results: Vec<Value>) -> Value {
    let failed = results.iter().filter(|value| value["status"] == "error").count();
    json!({"format":"projections.batch","version":0,"operation":operation,"results":results,"failed":failed})
}
