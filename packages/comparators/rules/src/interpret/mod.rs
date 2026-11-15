//! Interpreting a rules file over two extractions: the baseline, the inputs
//! the rules read, the library, the checks and the matching (here); then
//! classification ([`classify`]) and the steps and metadata ([`finish`]).

mod classify;
mod finish;

use crate::core::{Change, RulesPass, lookup, pairs_value};
use crate::eval::{Vars, bind, define, operator, run};
use crate::value::{extraction_to_cel, to_cel};
use crate::{Comparator, cost, library, rules};
use cel::{Context, Value as Cel};
use projections_comparator_default::matching::{self, DEFAULT_PASSES, Matched, Pass};
use projections_engine::{Extraction, Failure, Step, fail};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

/// Whether each one-to-one change, by collection and ID, differs outside its
/// volatile values: set once changes are matched, for `generated.only`.
type Residual = Arc<OnceLock<HashMap<(String, String), bool>>>;

/// What the rules keep of the baseline once its changes are read.
struct Base {
    steps: Value,
    metadata: Value,
}

impl Comparator {
    fn uses(&self, name: &str) -> bool {
        self.rules.uses.contains(name)
    }

    pub(crate) fn run(&self, typed: [&Extraction; 2], options: &Value, meter: Arc<cost::Meter>) -> Result<Value, Failure> {
        // The baseline is the native default comparison; only the values the
        // rules read are converted for CEL.
        let (base_matched, base_steps) = projections_comparator_default::baseline_plan(typed[0], typed[1])?;
        let json = typed.map(Extraction::to_json);
        let [before, after] = [&json[0], &json[1]];
        let inputs = self.inputs(before, after, options, &base_matched, &base_steps);
        let mut root = Context::with_env(self.env.clone());
        root.set_variable_resolver(&inputs);
        let residual: Residual = Arc::default();
        self.register_library(&mut root, before, after, &residual);
        for function in &self.rules.functions {
            define(&mut root, function);
        }
        cost::register(&mut root, meter.clone());
        if let Some(coverage) = &self.coverage {
            coverage.register(&mut root);
        }
        self.check(&root)?;
        let mut file = root.new_inner_scope();
        bind(&mut file, &self.rules.variables)?;

        let base = Base {
            steps: Value::Array(base_steps.iter().map(Step::to_json).collect()),
            metadata: Value::Null,
        };
        let (mut changes, pairs) = self.matched(typed, base_matched, &file)?;
        let _ = residual.set(
            changes
                .iter()
                .filter(|change| change.correspondence.one_to_one())
                .map(|change| ((change.collection.name().to_owned(), change.id.clone()), change.residual))
                .collect(),
        );
        let pairs = if self.uses("pairs") { pairs_value(&pairs) } else { Cel::Null };
        self.finish(&file, [before, after], &mut changes, pairs, base)
    }

    /// The inputs the rules read, converted for CEL: `options` (the file's
    /// `defaults` with the given options over them) always, and
    /// `before`, `after`, `baseline` and `lookup` when used.
    fn inputs(&self, before: &Value, after: &Value, options: &Value, base_matched: &Matched, base_steps: &[Step]) -> Vars {
        let mut effective = self.rules.defaults.clone();
        effective.extend(
            options
                .as_object()
                .into_iter()
                .flatten()
                .map(|(key, value)| (key.clone(), value.clone())),
        );
        let mut inputs = Vars::new([("options", to_cel(&Value::Object(effective)))]);
        for (name, value) in [("before", before), ("after", after)] {
            if self.uses(name) {
                inputs.insert(name, extraction_to_cel(value));
            }
        }
        if self.uses("baseline") {
            let mut baseline = projections_comparator_default::to_comparison(&base_matched.changes, base_steps.to_vec()).to_json();
            // As for `changes`, a change's `varied` is always a list.
            for change in baseline["changes"].as_array_mut().unwrap() {
                change.as_object_mut().unwrap().entry("varied").or_insert(json!([]));
            }
            inputs.insert("baseline", to_cel(&baseline));
        }
        if self.uses("lookup") {
            inputs.insert("lookup", lookup(before, after));
        }
        inputs
    }

    /// Registers the standard library: pure functions as they are, the graph
    /// functions over this comparison's index, and `generated.only` over the
    /// matched changes.
    fn register_library(&self, root: &mut Context, before: &Value, after: &Value, residual: &Residual) {
        let graph = Arc::new(library::Graph::new(
            before,
            after,
            self.uses("parents") || self.uses("children"),
            self.uses("entity"),
            self.uses("relationship"),
        ));
        for function in library::LIBRARY {
            match function.run {
                Some(run) => operator(root, function.name, run),
                None => {
                    let graph = graph.clone();
                    let name = function.name;
                    if name == "generated.only" {
                        let residual = residual.clone();
                        operator(root, name, move |args| match residual.get() {
                            Some(residual) => library::generated_only(residual, args),
                            None => Err("generated.only reads a change, once changes are matched".into()),
                        });
                        continue;
                    }
                    operator(root, name, move |args| match name {
                        "graph.entity" => graph.item(false, args),
                        "graph.relationship" => graph.item(true, args),
                        _ => graph.related(name == "graph.children", args),
                    });
                }
            }
        }
    }

    /// Runs `checks`: the first that fails fails the comparison.
    fn check(&self, root: &Context) -> Result<(), Failure> {
        for check in &self.rules.checks {
            if run(root, &check.assert)? != Cel::Bool(true) {
                let text = |expression: &rules::Expression| -> Result<String, Failure> {
                    match run(root, expression)? {
                        Cel::String(text) => Ok(text.as_ref().clone()),
                        _ => Err(expression.fail("rules-evaluation", "Expected a string")),
                    }
                };
                let path = match &check.path {
                    Some(path) => text(path)?,
                    None => "/options".to_owned(),
                };
                return Err(fail(&check.code, &path, &text(&check.message)?));
            }
        }
        Ok(())
    }

    /// The changes and pairs: the baseline's matching, or the default
    /// passes followed by the file's.
    fn matched(
        &self,
        [before, after]: [&Extraction; 2],
        base_matched: Matched,
        file: &Context,
    ) -> Result<(Vec<Change>, matching::Pairs), Failure> {
        if self.rules.identity.is_empty() {
            // Without passes of its own, the matching is the baseline's.
            let pairs = base_matched.pairs;
            return Ok((base_matched.changes.into_iter().map(Change::from).collect(), pairs));
        }
        drop(base_matched);
        let rules_passes: Vec<RulesPass> = self.rules.identity.iter().map(|pass| RulesPass::new(pass, file)).collect();
        let mut passes: Vec<&dyn Pass> = DEFAULT_PASSES.to_vec();
        passes.extend(rules_passes.iter().map(|pass| pass as &dyn Pass));
        let matched = matching::match_extractions(before, after, &passes)?;
        drop(rules_passes);
        Ok((matched.changes.into_iter().map(Change::from).collect(), matched.pairs))
    }
}
