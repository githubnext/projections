use super::model::{Case, Diagnostic, Source, Suite};
use super::{FORMAT, location_in};
use crate::Position;
use projections_engine::pointer;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

pub(super) struct Reader {
    pub(super) positions: HashMap<String, Position>,
    pub(super) diagnostics: Vec<Diagnostic>,
}

impl Reader {
    pub(super) fn error(&mut self, pointer: &str, message: impl Into<String>) {
        let location = location_in(&self.positions, pointer);
        self.diagnostics.push(Diagnostic {
            pointer: pointer.to_owned(),
            message: message.into(),
            location,
        });
    }

    /// The object at `path`, after rejecting fields outside `allowed`.
    pub(super) fn object<'a>(&mut self, value: &'a Value, path: &str, what: &str, allowed: &[&str]) -> Option<&'a Map<String, Value>> {
        let Some(fields) = value.as_object() else {
            self.error(path, format!("{what} must be a mapping"));
            return None;
        };
        for key in fields.keys() {
            if !allowed.contains(&key.as_str()) {
                self.error(
                    &pointer(path, key),
                    format!(
                        "Unknown field `{key}` in {what}; expected {}",
                        allowed.iter().map(|field| format!("`{field}`")).collect::<Vec<_>>().join(", ")
                    ),
                );
            }
        }
        Some(fields)
    }

    pub(super) fn string(&mut self, value: &Value, path: &str, what: &str) -> Option<String> {
        match value.as_str() {
            Some(text) if !text.trim().is_empty() => Some(text.to_owned()),
            _ => {
                self.error(path, format!("{what} must be a non-empty string"));
                None
            }
        }
    }

    pub(super) fn strings(&mut self, value: &Value, path: &str, what: &str) -> Option<Vec<String>> {
        let Some(items) = value.as_array() else {
            self.error(path, format!("{what} must be a list of IDs"));
            return None;
        };
        let mut strings = Vec::new();
        for (index, item) in items.iter().enumerate() {
            strings.push(self.string(item, &pointer(path, &index.to_string()), "An ID")?);
        }
        Some(strings)
    }

    pub(super) fn one_of(&mut self, value: &Value, path: &str, what: &str, allowed: &[&str]) {
        if !value.as_str().is_some_and(|text| allowed.contains(&text)) {
            self.error(
                path,
                format!(
                    "{what} must be one of {}",
                    allowed.iter().map(|value| format!("`{value}`")).collect::<Vec<_>>().join(", ")
                ),
            );
        }
    }

    /// A relative path inside the repository, as the test file names it.
    pub(super) fn relative_path(&mut self, value: &Value, path: &str, what: &str) -> Option<String> {
        let text = self.string(value, path, what)?;
        let absolute = text.starts_with('/')
            || text.starts_with('\\')
            || text.as_bytes().get(1) == Some(&b':')
            || text.contains('\\')
            || text.contains('\0');
        if absolute {
            self.error(
                path,
                format!("{what} must be a path relative to the test file, with `/` separators"),
            );
            return None;
        }
        Some(text)
    }

    pub(super) fn suite(&mut self, value: &Value) -> Suite {
        let empty = Suite {
            options: None,
            cases: Vec::new(),
            positions: HashMap::new(),
        };
        let Some(fields) = self.object(
            value,
            "",
            "A comparator rules test file",
            &["$schema", "format", "version", "description", "options", "cases"],
        ) else {
            return empty;
        };
        if fields.get("format").and_then(Value::as_str) != Some(FORMAT) {
            self.error("/format", format!("`format` must be `{FORMAT}`"));
        }
        if fields.get("version").and_then(Value::as_i64) != Some(0) {
            self.error("/version", "`version` must be 0");
        }
        if let Some(description) = fields.get("description") {
            if !description.is_string() {
                self.error("/description", "`description` must be a string");
            }
        }
        if let Some(schema) = fields.get("$schema") {
            if !schema.is_string() {
                self.error("/$schema", "`$schema` must be a string");
            }
        }
        let options = fields.get("options").cloned();
        if options.as_ref().is_some_and(|options| !options.is_object()) {
            self.error("/options", "`options` must be a mapping");
        }
        let mut cases = Vec::new();
        match fields.get("cases").and_then(Value::as_array) {
            Some(items) if !items.is_empty() => {
                let mut names = HashSet::new();
                let mut snapshots = HashSet::new();
                for (index, item) in items.iter().enumerate() {
                    if let Some(case) = self.case(item, index) {
                        if !names.insert(case.name.clone()) {
                            self.error(
                                &format!("/cases/{index}/name"),
                                format!("Duplicate case name `{}`; names are case IDs", case.name),
                            );
                        }
                        if let Some(snapshot) = &case.snapshot {
                            if !snapshots.insert(snapshot.clone()) {
                                self.error(
                                    &format!("/cases/{index}/snapshot"),
                                    format!("Another case already writes the snapshot {snapshot}"),
                                );
                            }
                        }
                        cases.push(case);
                    }
                }
            }
            Some(_) => self.error("/cases", "`cases` must list at least one case"),
            None if fields.contains_key("cases") => self.error("/cases", "`cases` must be a list of cases"),
            None => self.error("", "A comparator rules test file needs `cases`"),
        }
        Suite {
            options,
            cases,
            positions: HashMap::new(),
        }
    }

    pub(super) fn case(&mut self, value: &Value, index: usize) -> Option<Case> {
        let path = format!("/cases/{index}");
        let fields = self.object(
            value,
            &path,
            "A case",
            &["name", "before", "after", "options", "expect", "snapshot"],
        )?;
        let errors = self.diagnostics.len();
        let name = match fields.get("name") {
            Some(name) => self.string(name, &format!("{path}/name"), "A case's `name`"),
            None => {
                self.error(&path, "A case needs a `name`");
                None
            }
        };
        let side = |reader: &mut Self, key: &str| match fields.get(key) {
            Some(value) => reader.source(value, &format!("{path}/{key}")),
            None => {
                reader.error(
                    &path,
                    format!("A case needs `{key}`: a fixture file, {{extraction}} or {{revision}}"),
                );
                None
            }
        };
        let before = side(self, "before");
        let after = side(self, "after");
        let options = fields.get("options").cloned();
        if options.as_ref().is_some_and(|options| !options.is_object()) {
            self.error(&format!("{path}/options"), "`options` must be a mapping");
        }
        let expect = fields
            .get("expect")
            .and_then(|value| self.expectations(value, &format!("{path}/expect")));
        let snapshot = fields
            .get("snapshot")
            .and_then(|value| self.relative_path(value, &format!("{path}/snapshot"), "`snapshot`"));
        if expect.is_none() && snapshot.is_none() && !fields.contains_key("expect") {
            self.error(&path, "A case asserts nothing: give it `expect`, a `snapshot`, or both");
        }
        if let Some(expect) = &expect {
            let others = expect.order.is_some()
                || expect.steps.is_some()
                || !expect.changes.is_empty()
                || expect.count_changes.is_some()
                || expect.count_steps.is_some()
                || expect.metadata.is_some();
            if expect.error.is_some() && (others || snapshot.is_some()) {
                self.error(
                    &format!("{path}/expect/error"),
                    "A case that expects an `error` has no comparison to check: give it no other expectations or snapshot",
                );
            }
            if !others && expect.error.is_none() && snapshot.is_none() {
                self.error(&format!("{path}/expect"), "A case asserts nothing: `expect` lists no expectations");
            }
        }
        if self.diagnostics.len() > errors {
            return None;
        }
        Some(Case {
            index,
            name: name?,
            location: location_in(&self.positions, &path),
            before: before?,
            after: after?,
            options,
            expect,
            snapshot,
        })
    }

    pub(super) fn source(&mut self, value: &Value, path: &str) -> Option<Source> {
        if value.is_string() {
            return self.relative_path(value, path, "A fixture path").map(Source::File);
        }
        let fields = self.object(value, path, "A source", &["file", "extraction", "revision"])?;
        if fields.len() != 1 {
            self.error(path, "A source is one of a fixture path, {file}, {extraction} or {revision}");
            return None;
        }
        let (key, item) = fields.iter().next()?;
        let path = pointer(path, key);
        match key.as_str() {
            "file" => self.relative_path(item, &path, "`file`").map(Source::File),
            "extraction" => {
                if item.is_object() {
                    Some(Source::Extraction(item.clone()))
                } else {
                    self.error(&path, "`extraction` must be an extraction (a mapping)");
                    None
                }
            }
            _ => self.string(item, &path, "`revision`").map(Source::Revision),
        }
    }
}
