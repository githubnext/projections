use super::Base;
use crate::core::{Change, change_of};
use crate::eval::{Vars, bind, evaluate, json, run};
use crate::rules::Steps;
use crate::value::{list, object};
use crate::{Comparator, steps};
use cel::{Context, Value as Cel};
use projections_engine::Failure;
use serde_json::{Map, Value, json};
use std::collections::HashMap;

impl Comparator {
    /// Classifies the matched changes, then makes the steps and metadata and
    /// assembles the comparison.
    pub(super) fn finish(
        &self,
        scope: &Context,
        sides: [&Value; 2],
        changes: &mut [Change],
        pairs: Cel,
        baseline: Base,
    ) -> Result<Value, Failure> {
        let change_of = if self.uses("changeOf") { change_of(changes) } else { Cel::Null };
        let annotations = match &self.rules.classify {
            Some(classify) => self.classify(classify, scope, sides, changes, &pairs, &change_of)?,
            None => Vec::new(),
        };
        let listed: Vec<projections_engine::Change> = changes.iter().map(Change::to_change).collect();
        let json_changes: Vec<Value> = listed.iter().map(projections_engine::Change::to_json).collect();
        let annotations_by_id: HashMap<String, Cel> = annotations.iter().cloned().collect();
        let stage = Vars::new([
            (
                "changes",
                if self.uses("changes") {
                    list(changes.iter().map(Change::to_cel))
                } else {
                    Cel::Null
                },
            ),
            ("annotations", object(annotations)),
            ("pairs", pairs),
            ("changeOf", change_of),
        ]);
        let mut staged = scope.new_inner_scope();
        staged.set_variable_resolver(&stage);
        let steps = self.steps(&staged, changes, &annotations_by_id, baseline.steps)?;
        let metadata = self.metadata(&staged, baseline.metadata)?;
        let variation = projections_engine::volatility::variation(&listed);
        let mut comparison = json!({
            "protocolVersion": 0,
            "changes": json_changes,
            "steps": steps,
            "order": {"reverse": "mirror"},
        });
        if let Some(counts) = variation {
            comparison["variation"] = json!({"within": counts.within, "beyond": counts.beyond});
        }
        if !metadata.is_empty() {
            comparison["metadata"] = Value::Object(metadata);
        }
        Ok(comparison)
    }

    /// The steps: the baseline's, one expression's, or declarative operations
    /// over the baseline's.
    fn steps(&self, staged: &Context, changes: &[Change], annotations: &HashMap<String, Cel>, baseline: Value) -> Result<Value, Failure> {
        Ok(match &self.rules.steps {
            Some(Steps::Value(variables, expression)) => {
                let mut child = staged.new_inner_scope();
                bind(&mut child, variables)?;
                json(expression, &evaluate(&child, &[], expression)?)?
            }
            Some(Steps::Plan {
                variables,
                add,
                rank,
                descending,
                summary,
            }) => {
                let mut child = staged.new_inner_scope();
                bind(&mut child, variables)?;
                steps::plan(
                    &child,
                    changes,
                    annotations,
                    match baseline {
                        Value::Array(steps) => steps,
                        _ => Vec::new(),
                    },
                    steps::Plan {
                        add,
                        rank: rank.as_ref(),
                        descending: *descending,
                        summary: summary.as_ref(),
                    },
                )?
            }
            None => baseline,
        })
    }

    /// The metadata: the baseline's, with each non-null value the rules add.
    fn metadata(&self, staged: &Context, baseline: Value) -> Result<Map<String, Value>, Failure> {
        let mut metadata: Map<String, Value> = match baseline {
            Value::Object(metadata) => metadata,
            _ => Map::new(),
        };
        if let Some(section) = &self.rules.metadata {
            let mut child = staged.new_inner_scope();
            bind(&mut child, &section.variables)?;
            for (key, expression) in &section.values {
                let value = json(expression, &run(&child, expression)?)?;
                if !value.is_null() {
                    metadata.insert(key.clone(), value);
                }
            }
        }
        Ok(metadata)
    }
}
