use super::{Checker, Scope, concrete, inputs, numeric};
use crate::rules::{Classify, ContextRule, Expression, Match, NewStep, Pass, Rules, Steps, Variable};
use crate::types::{self, Ty, assignable, list, map};

pub(super) fn run(mut checker: Checker, rules: &Rules) -> Checker {
    let root = inputs();
    for check in &rules.checks {
        checker.condition(&check.assert, &root);
        checker.text(&check.message, &root);
        if let Some(path) = &check.path {
            checker.text(path, &root);
        }
    }
    let mut file = root.clone();
    checker.variables(&mut file, &rules.variables);
    let pairs = types::pairs();
    for pass in &rules.identity {
        checker.identity(pass, &file, &pairs);
    }
    let stage = file
        .clone()
        .with("changes", list(Ty::Object("Change")))
        .with("pairs", pairs.clone())
        .with("changeOf", types::change_of());
    if let Some(classify) = &rules.classify {
        checker.classify(classify, &stage);
    }
    let annotation = checker.annotation.clone();
    let stage = stage.with("annotations", map(Ty::String, annotation.clone()));
    for rule in &rules.context {
        checker.context(rule, &stage);
    }
    match &rules.steps {
        Some(Steps::Value(variables, value)) => checker.steps_value(variables, value, &stage),
        Some(Steps::Plan {
            variables,
            add,
            rank,
            summary,
            ..
        }) => checker.steps_plan(variables, add, rank.as_ref(), summary.as_ref(), &stage, &annotation),
        None => {}
    }
    if let Some(metadata) = &rules.metadata {
        let mut scope = stage;
        checker.variables(&mut scope, &metadata.variables);
        for (_, value) in &metadata.values {
            checker.check(value, &scope);
        }
    }
    checker
}

impl Checker {
    /// Checks an identity pass: its condition, and its key or claims.
    fn identity(&mut self, pass: &Pass, file: &Scope, pairs: &Ty) {
        let item = if pass.collections == ["entities"] {
            Ty::Object("Entity")
        } else if pass.collections == ["relationships"] {
            Ty::Object("Relationship")
        } else {
            Ty::Object("Item")
        };
        let scope = file
            .clone()
            .with("item", item)
            .with("side", Ty::String)
            .with("pairs", pairs.clone());
        if let Some(when) = &pass.when {
            self.condition(when, &scope);
        }
        match &pass.rule {
            Match::Key(key) => {
                self.check(key, &scope);
            }
            Match::Claims(claims) => {
                let ty = self.check(claims, &scope);
                if !assignable(&ty, &list(Ty::String)) {
                    self.diagnostics.push(claims.at(
                        "invalid-rules",
                        claims.parsed.id,
                        &format!("Claims must be a list of IDs, not {ty}"),
                    ));
                }
            }
        }
    }

    /// Checks `classify`, recording the annotation's type.
    fn classify(&mut self, classify: &Classify, stage: &Scope) {
        let mut scope = per_change(stage);
        if let Some(when) = &classify.when {
            self.condition(when, &scope);
        }
        self.variables(&mut scope, &classify.variables);
        if let Some(summary) = &classify.summary {
            self.text(summary, &scope);
        }
        if let Some(annotation) = &classify.annotation {
            self.annotation = self.check(annotation, &scope);
        }
    }

    /// Checks a `context` rule: its condition, and its `before` and `after`
    /// lists of IDs.
    fn context(&mut self, rule: &ContextRule, stage: &Scope) {
        let mut scope = per_change(stage).with("annotation", self.annotation.clone());
        if let Some(when) = &rule.when {
            self.condition(when, &scope);
        }
        self.variables(&mut scope, &rule.variables);
        for ids in [&rule.before, &rule.after].into_iter().flatten() {
            let ty = self.check(ids, &scope);
            if !assignable(&ty, &list(Ty::String)) {
                self.diagnostics
                    .push(ids.at("invalid-rules", ids.parsed.id, &format!("Context must be a list of IDs, not {ty}")));
            }
        }
    }

    /// Checks steps given as one expression.
    fn steps_value(&mut self, variables: &[Variable], value: &Expression, stage: &Scope) {
        let mut scope = stage.clone();
        self.variables(&mut scope, variables);
        let ty = self.check(value, &scope);
        if !assignable(&ty, &list(Ty::Object("Step"))) {
            self.diagnostics.push(value.at(
                "invalid-rules",
                value.parsed.id,
                &format!("Steps must be a list of steps, not {ty}"),
            ));
        }
    }

    /// Checks declarative step operations.
    fn steps_plan(
        &mut self,
        variables: &[Variable],
        add: &[NewStep],
        rank: Option<&Expression>,
        summary: Option<&Expression>,
        stage: &Scope,
        annotation: &Ty,
    ) {
        let mut scope = stage.clone();
        self.variables(&mut scope, variables);
        let per_change = scope
            .clone()
            .with("change", Ty::Object("Change"))
            .with("origin", Ty::String)
            .with("annotation", annotation.clone());
        for step in add {
            self.condition(&step.changes, &per_change);
            if let Some(sort) = &step.sort {
                self.check(sort, &per_change);
            }
            if let Some(summary) = &step.summary {
                self.text(summary, &scope.clone().with("members", list(Ty::Object("Change"))));
            }
        }
        if let Some(rank) = rank {
            let ty = self.check(rank, &per_change);
            if concrete(&ty) && !numeric(&ty) && !matches!(&ty, Ty::List(item) if numeric(item) || **item == Ty::Never || **item == Ty::Dyn)
            {
                self.diagnostics.push(rank.at(
                    "invalid-rules",
                    rank.parsed.id,
                    &format!("A rank must be a number, a list of numbers or null, not {ty}"),
                ));
            }
        }
        if let Some(summary) = summary {
            self.text(
                summary,
                &scope
                    .with("step", Ty::Object("Step"))
                    .with("members", list(Ty::Object("Change")))
                    .with("lead", Ty::Object("Change")),
            );
        }
    }
}

/// What an expression evaluated per change sees: the change, the pass that
/// matched it and its items.
fn per_change(stage: &Scope) -> Scope {
    stage
        .clone()
        .with("change", Ty::Object("Change"))
        .with("origin", Ty::String)
        .with("item", Ty::Object("Item"))
        .with("beforeItem", Ty::Object("Item"))
        .with("afterItem", Ty::Object("Item"))
        .with("befores", list(Ty::Object("Item")))
        .with("afters", list(Ty::Object("Item")))
}
