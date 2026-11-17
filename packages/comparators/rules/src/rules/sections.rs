use super::model::{Check, Classify, ContextRule, Function, Match, Metadata, NewStep, Pass, Rules, Steps};
use super::reader::Reader;
use super::walk::names;
use super::{COLLECTIONS, DEFAULT_PASSES, FORMAT, identifier};
use crate::macros;
use projections_engine::pointer;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

impl Reader<'_> {
    pub(super) fn read(&mut self, value: &Value) -> Rules {
        let mut rules = Rules {
            functions: Vec::new(),
            checks: Vec::new(),
            variables: Vec::new(),
            identity: Vec::new(),
            classify: None,
            context: Vec::new(),
            steps: None,
            metadata: None,
            defaults: serde_json::Map::new(),
            uses: BTreeSet::new(),
            warnings: Vec::new(),
            chains: 0,
            coverage: None,
        };
        if !self.only(
            value,
            &[
                "$schema",
                "format",
                "version",
                "description",
                "defaults",
                "checks",
                "variables",
                "functions",
                "identity",
                "classify",
                "context",
                "steps",
                "metadata",
            ],
            "",
        ) {
            return rules;
        }
        if value["format"] != FORMAT {
            self.error("/format", &format!("Expected `{FORMAT}`"));
        }
        if value["version"].as_f64() != Some(0.0) {
            self.error("/version", "Expected version 0");
        }

        match value.get("defaults") {
            None => {}
            Some(serde_json::Value::Object(defaults)) => rules.defaults = defaults.clone(),
            Some(_) => self.error("/defaults", "Expected a map of option names to values"),
        }
        rules.functions = self.read_functions(value);
        rules.checks = self.read_checks(value);
        let mut taken = BTreeSet::new();
        rules.variables = self.variables(value.get("variables"), "/variables", &mut taken);
        rules.identity = self.read_identity(value);
        if let Some(section) = value.get("classify") {
            rules.classify = self.read_classify(section, &taken);
        }
        rules.context = self.read_context(value, &taken);
        rules.steps = value.get("steps").and_then(|section| self.read_steps(section, &taken));
        if let Some(section) = value.get("metadata") {
            rules.metadata = self.read_metadata(section, &taken);
        }
        rules
    }

    /// `functions`, in dependency order.
    fn read_functions(&mut self, value: &Value) -> Vec<Function> {
        let mut functions = BTreeMap::new();
        match value.get("functions").map(Value::as_object) {
            None => {}
            Some(None) => self.error("/functions", "Expected a mapping of names to functions"),
            Some(Some(defined)) => {
                for (name, function) in defined {
                    let path = pointer("/functions", name);
                    if !identifier(name) {
                        self.error(&path, "Expected an identifier");
                    } else if crate::library::function(name).is_some()
                        || crate::check::known(name)
                        || macros::MACROS.contains(&name.as_str())
                    {
                        self.error(&path, &format!("`{name}` is a CEL or library function, or a macro"));
                    } else if let Some(function) = self.function(name, function, &path) {
                        functions.insert(name.clone(), function);
                    }
                }
            }
        }
        self.ordered(functions)
    }

    /// `checks`: assertions over the inputs.
    fn read_checks(&mut self, value: &Value) -> Vec<Check> {
        let mut checks = Vec::new();
        for (index, check) in value.get("checks").and_then(Value::as_array).into_iter().flatten().enumerate() {
            let path = pointer("/checks", &index.to_string());
            if !self.only(check, &["assert", "code", "path", "message"], &path) {
                continue;
            }
            let code = match check.get("code") {
                None => "invalid-options".to_owned(),
                Some(Value::String(code)) => code.clone(),
                Some(_) => {
                    self.error(&pointer(&path, "code"), "Expected a diagnostic code");
                    continue;
                }
            };
            let assert = self.compile(&check["assert"], &pointer(&path, "assert"));
            let at = self.optional(check, "path", &path);
            let message = self.compile(&check["message"], &pointer(&path, "message"));
            if let (Some(assert), Some(message)) = (assert, message) {
                checks.push(Check {
                    assert,
                    code,
                    path: at,
                    message,
                });
            }
        }
        if value.get("checks").is_some_and(|checks| !checks.is_array()) {
            self.error("/checks", "Expected a list");
        }

        checks
    }

    /// `identity`: the identity passes, named uniquely.
    fn read_identity(&mut self, value: &Value) -> Vec<Pass> {
        let mut passes = Vec::new();
        let mut names: BTreeSet<String> = DEFAULT_PASSES.iter().map(|name| name.to_string()).collect();
        for (index, pass) in value.get("identity").and_then(Value::as_array).into_iter().flatten().enumerate() {
            if let Some(pass) = self.read_pass(pass, index, &mut names) {
                passes.push(pass);
            }
        }
        if value.get("identity").is_some_and(|identity| !identity.is_array()) {
            self.error("/identity", "Expected a list");
        }

        passes
    }

    /// One identity pass, its name recorded in `names`.
    fn read_pass(&mut self, pass: &Value, index: usize, names: &mut BTreeSet<String>) -> Option<Pass> {
        let path = pointer("/identity", &index.to_string());
        if !self.only(pass, &["name", "description", "collections", "when", "key", "claims"], &path) {
            return None;
        }
        let Some(name) = pass["name"].as_str().filter(|name| identifier(name)) else {
            self.error(&pointer(&path, "name"), "Expected an identifier");
            return None;
        };
        if !names.insert(name.to_owned()) {
            self.error(
                &pointer(&path, "name"),
                &format!("Identity pass `{name}` is already defined (`exact` and `claims` are the default passes)"),
            );
            return None;
        }
        let collections = match pass.get("collections").map(Value::as_array) {
            None => COLLECTIONS.to_vec(),
            Some(Some(list)) if !list.is_empty() => {
                let found: Vec<&'static str> = list
                    .iter()
                    .filter_map(|collection| COLLECTIONS.into_iter().find(|known| collection == *known))
                    .collect();
                if found.len() != list.len() {
                    self.error(&pointer(&path, "collections"), "Expected entities or relationships");
                }
                found
            }
            _ => {
                self.error(&pointer(&path, "collections"), "Expected a list of collections");
                return None;
            }
        };
        let when = self.optional(pass, "when", &path);
        let rule = match (pass.get("key"), pass.get("claims")) {
            (Some(key), None) => self.compile(key, &pointer(&path, "key")).map(Match::Key),
            (None, Some(claims)) => self.compile(claims, &pointer(&path, "claims")).map(Match::Claims),
            _ => {
                self.error(&path, "Expected exactly one of `key` or `claims`");
                None
            }
        };
        Some(Pass {
            name: name.to_owned(),
            collections,
            when,
            rule: rule?,
        })
    }

    /// `classify`.
    fn read_classify(&mut self, section: &Value, taken: &BTreeSet<String>) -> Option<Classify> {
        if !self.only(section, &["where", "variables", "summary", "annotation"], "/classify") {
            return None;
        }
        let mut taken = taken.clone();
        let when = self.optional(section, "where", "/classify");
        let mut read = BTreeSet::new();
        if let Some(when) = &when {
            names(&when.parsed, &mut read);
        }
        Some(Classify {
            where_reads_items: ["item", "beforeItem", "afterItem", "befores", "afters"]
                .iter()
                .any(|name| read.contains(*name)),
            when,
            variables: self.variables(section.get("variables"), "/classify/variables", &mut taken),
            summary: self.optional(section, "summary", "/classify"),
            annotation: self.optional(section, "annotation", "/classify"),
        })
    }

    /// `context`: named rules, each adding context to the changes it selects.
    fn read_context(&mut self, value: &Value, taken: &BTreeSet<String>) -> Vec<ContextRule> {
        let mut rules = Vec::new();
        let mut names = BTreeSet::new();
        match value.get("context") {
            None => {}
            Some(Value::Array(list)) => {
                for (index, rule) in list.iter().enumerate() {
                    if let Some(rule) = self.read_context_rule(rule, &pointer("/context", &index.to_string()), &mut names, taken) {
                        rules.push(rule);
                    }
                }
            }
            Some(_) => self.error("/context", "Expected a list"),
        }
        rules
    }

    /// One `context` rule, its name recorded in `names`.
    fn read_context_rule(
        &mut self,
        rule: &Value,
        path: &str,
        names: &mut BTreeSet<String>,
        taken: &BTreeSet<String>,
    ) -> Option<ContextRule> {
        if !self.only(rule, &["name", "description", "where", "variables", "before", "after"], path) {
            return None;
        }
        let Some(name) = rule["name"].as_str().filter(|name| identifier(name)) else {
            self.error(&pointer(path, "name"), "Expected an identifier");
            return None;
        };
        if !names.insert(name.to_owned()) {
            self.error(&pointer(path, "name"), &format!("Context rule `{name}` is already defined"));
            return None;
        }
        if rule.get("description").is_some_and(|description| !description.is_string()) {
            self.error(&pointer(path, "description"), "Expected a string");
        }
        if rule.get("before").is_none() && rule.get("after").is_none() {
            self.error(path, "Expected `before`, `after` or both");
            return None;
        }
        let mut taken = taken.clone();
        Some(ContextRule {
            name: name.to_owned(),
            when: self.optional(rule, "where", path),
            variables: self.variables(rule.get("variables"), &pointer(path, "variables"), &mut taken),
            before: self.optional(rule, "before", path),
            after: self.optional(rule, "after", path),
        })
    }

    /// `steps`: one expression, `{variables, value}`, or declarative
    /// operations.
    fn read_steps(&mut self, section: &Value, taken: &BTreeSet<String>) -> Option<Steps> {
        match section {
            Value::String(_) => self
                .compile(section, "/steps")
                .map(|expression| Steps::Value(Vec::new(), expression)),
            section if section.get("value").is_some() => {
                if !self.only(section, &["variables", "value"], "/steps") {
                    return None;
                }
                let mut taken = taken.clone();
                let variables = self.variables(section.get("variables"), "/steps/variables", &mut taken);
                self.compile(&section["value"], "/steps/value")
                    .map(|expression| Steps::Value(variables, expression))
            }
            section => self.read_plan(section, taken),
        }
    }

    /// Declarative step operations.
    fn read_plan(&mut self, section: &Value, taken: &BTreeSet<String>) -> Option<Steps> {
        if !self.only(section, &["variables", "add", "rank", "descending", "summary"], "/steps") {
            return None;
        }
        let mut taken = taken.clone();
        let variables = self.variables(section.get("variables"), "/steps/variables", &mut taken);
        let add = section
            .get("add")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
            .filter_map(|(index, step)| self.read_new_step(step, index))
            .collect();
        let descending = match section.get("descending") {
            None => false,
            Some(Value::Bool(descending)) => *descending,
            Some(_) => {
                self.error("/steps/descending", "Expected true or false");
                false
            }
        };
        Some(Steps::Plan {
            variables,
            add,
            rank: self.optional(section, "rank", "/steps"),
            descending,
            summary: self.optional(section, "summary", "/steps"),
        })
    }

    /// One step `add` makes.
    fn read_new_step(&mut self, step: &Value, index: usize) -> Option<NewStep> {
        let path = pointer("/steps/add", &index.to_string());
        if !self.only(step, &["changes", "kind", "summary", "sort", "place"], &path) {
            return None;
        }
        let kind = step.get("kind").and_then(|kind| self.kind(kind, &pointer(&path, "kind")));
        let place = self.place(step.get("place"), &pointer(&path, "place"));
        let changes = self.compile(&step["changes"], &pointer(&path, "changes"));
        let summary = self.optional(step, "summary", &path);
        let sort = self.optional(step, "sort", &path);
        Some(NewStep {
            changes: changes?,
            kind,
            summary,
            sort,
            place,
        })
    }

    /// `metadata`.
    fn read_metadata(&mut self, section: &Value, taken: &BTreeSet<String>) -> Option<Metadata> {
        if !self.only(section, &["variables", "values"], "/metadata") {
            return None;
        }
        let mut taken = taken.clone();
        let variables = self.variables(section.get("variables"), "/metadata/variables", &mut taken);
        let mut values = Vec::new();
        match section.get("values").and_then(Value::as_object) {
            Some(fields) => {
                for (key, expression) in fields {
                    if let Some(expression) = self.compile(expression, &pointer("/metadata/values", key)) {
                        values.push((key.clone(), expression));
                    }
                }
            }
            None => self.error("/metadata/values", "Expected a mapping of keys to expressions"),
        }
        Some(Metadata { variables, values })
    }
}
