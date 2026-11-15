use crate::macros::MatchSite;
use crate::types::Ty;
use crate::yaml::{Document, Position};
use cel::common::ast::{IdedExpr, SourceInfo};
use projections_engine::{Diagnostic, Failure};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Where something in the rules file is, for messages.
#[derive(Clone, Default)]
pub struct Location {
    pub path: String,
    pub position: Option<Position>,
}

/// Builds diagnostics about a rules file.
pub struct Source<'a> {
    pub document: &'a Document,
}

impl Source<'_> {
    pub fn location(&self, path: &str) -> Location {
        Location {
            path: path.to_owned(),
            position: self.document.positions.get(path).copied(),
        }
    }

    pub fn invalid(&self, path: &str, message: &str) -> Failure {
        vec![diagnostic("invalid-rules", &self.location(path), None, message)]
    }
}

/// A diagnostic at a location, or at `offset` characters into the expression
/// `text` written there.
pub fn diagnostic(code: &str, location: &Location, at: Option<(&str, usize, &str)>, message: &str) -> Diagnostic {
    let message = match (&location.position, at) {
        (Some(position), Some((text, offset, source))) => {
            let (line, column) = position.at(text, offset, source);
            format!("Line {line}, column {column}: {message}")
        }
        (Some(position), None) => format!("Line {}, column {}: {message}", position.line, position.column),
        (None, _) => message.to_owned(),
    };
    Diagnostic::new(code, &location.path, &message)
}

pub struct Expression {
    pub source: String,
    pub location: Location,
    /// The parsed expression, for the checker.
    pub parsed: IdedExpr,
    /// The expression evaluated: `parsed` instrumented for cost.
    pub program: Arc<IdedExpr>,
    pub info: Arc<SourceInfo>,
    /// The YAML text, for positions in folded blocks.
    pub text: Arc<str>,
    /// Its `match` macros, for checking their keys against declared values.
    pub matches: Vec<MatchSite>,
    /// The conditionals a `match` or `cond` expanded into, whose branches must have one type.
    pub branches: BTreeMap<u64, &'static str>,
}

impl Expression {
    /// A diagnostic about node `id` of this expression.
    pub fn at(&self, code: &str, id: u64, message: &str) -> Diagnostic {
        self.at_name(code, id, "", message)
    }

    /// A diagnostic about call `id` of function `name`: CEL places a call at
    /// its parenthesis, and the message points at the name.
    pub fn at_name(&self, code: &str, id: u64, name: &str, message: &str) -> Diagnostic {
        let offset = self.info.offset_for(id).map(|(start, _)| {
            // The parser's offsets are in bytes; positions are in characters.
            let start = self
                .source
                .get(..start as usize)
                .map_or(start as usize, |before| before.chars().count());
            let short = name.rsplit('.').next().unwrap_or(name);
            let before: String = self.source.chars().take(start).collect();
            if !short.is_empty() && before.ends_with(short) {
                start - short.chars().count()
            } else {
                start
            }
        });
        diagnostic(
            code,
            &self.location,
            offset.map(|offset| (self.source.as_str(), offset, &*self.text)),
            message,
        )
    }

    /// A diagnostic about the whole expression.
    pub fn fail(&self, code: &str, message: &str) -> Failure {
        vec![diagnostic(code, &self.location, None, &format!("{message} (in `{}`)", self.source))]
    }
}

/// A named value, evaluated once in order: `variables.<name>`.
pub struct Variable {
    pub name: String,
    pub expression: Expression,
    /// The values it may take, when declared (`values:`), for `match`.
    pub values: Option<Vec<Value>>,
}

pub struct Param {
    pub name: String,
    pub ty: Ty,
    /// The values it may take, when declared (`values:`), for `match`.
    pub values: Option<Vec<Value>>,
}

pub struct Function {
    pub name: String,
    pub params: Vec<Param>,
    pub returns: Option<Ty>,
    pub variables: Vec<Variable>,
    pub body: Expression,
    pub location: Location,
}

pub struct Check {
    pub assert: Expression,
    pub code: String,
    pub path: Option<Expression>,
    pub message: Expression,
}

pub enum Match {
    /// Pairs the one unmatched before item and the one unmatched after item
    /// that share a key.
    Key(Expression),
    /// Connects items to the other side's IDs they claim; each connected group
    /// becomes one change.
    Claims(Expression),
}

pub struct Pass {
    pub name: String,
    pub collections: Vec<&'static str>,
    pub when: Option<Expression>,
    pub rule: Match,
}

pub struct Classify {
    pub when: Option<Expression>,
    /// Whether `where` reads `beforeItem`, `afterItem`, `befores` or `afters`.
    pub where_reads_items: bool,
    pub variables: Vec<Variable>,
    pub summary: Option<Expression>,
    pub annotation: Option<Expression>,
}

/// Where a new step goes among the others.
#[derive(Clone, Copy)]
pub enum Place {
    Start,
    End,
    /// Before the first step of a kind, or last when there is none.
    Before(&'static str),
    /// After the last step of a kind, or first when there is none.
    After(&'static str),
}

/// A step made of the changes a predicate selects.
pub struct NewStep {
    pub changes: Expression,
    pub kind: Option<&'static str>,
    pub summary: Option<Expression>,
    pub sort: Option<Expression>,
    pub place: Place,
}

/// How the steps are made: from the baseline's with declarative operations,
/// or by one CEL expression.
// A rules file has one, so the variants' sizes don't matter.
#[allow(clippy::large_enum_variant)]
pub enum Steps {
    Plan {
        variables: Vec<Variable>,
        add: Vec<NewStep>,
        rank: Option<Expression>,
        descending: bool,
        summary: Option<Expression>,
    },
    Value(Vec<Variable>, Expression),
}

pub struct Metadata {
    pub variables: Vec<Variable>,
    pub values: Vec<(String, Expression)>,
}

pub struct Rules {
    pub functions: Vec<Function>,
    pub checks: Vec<Check>,
    pub variables: Vec<Variable>,
    pub identity: Vec<Pass>,
    pub classify: Option<Classify>,
    pub steps: Option<Steps>,
    pub metadata: Option<Metadata>,
    /// Option values used when the comparison's `options` doesn't set them:
    /// `options` is these, overridden key by key by the options given.
    pub defaults: serde_json::Map<String, serde_json::Value>,
    /// Every identifier and function name an expression mentions, so a
    /// comparison only builds the values its rules read.
    pub uses: BTreeSet<String>,
    /// Lint findings: the file loads, but should change.
    pub warnings: Vec<Diagnostic>,
    /// How many chains of two or more conditionals the file has, as written.
    pub chains: usize,
    /// What coverage counts, when the rules were read for it.
    pub coverage: Option<crate::coverage::Inventory>,
}

impl Rules {
    pub(super) fn expressions(&self) -> Vec<&Expression> {
        let mut all: Vec<&Expression> = Vec::new();
        fn variables(list: &[Variable]) -> impl Iterator<Item = &Expression> {
            list.iter().map(|variable| &variable.expression)
        }
        for function in &self.functions {
            all.push(&function.body);
            all.extend(variables(&function.variables));
        }
        for check in &self.checks {
            all.extend([&check.assert, &check.message]);
            all.extend(check.path.as_ref());
        }
        all.extend(variables(&self.variables));
        for pass in &self.identity {
            all.extend(pass.when.as_ref());
            all.push(match &pass.rule {
                Match::Key(expression) | Match::Claims(expression) => expression,
            });
        }
        if let Some(classify) = &self.classify {
            all.extend(classify.when.as_ref());
            all.extend(variables(&classify.variables));
            all.extend(classify.summary.as_ref());
            all.extend(classify.annotation.as_ref());
        }
        match &self.steps {
            Some(Steps::Value(list, value)) => {
                all.extend(variables(list));
                all.push(value);
            }
            Some(Steps::Plan {
                variables: list,
                add,
                rank,
                summary,
                ..
            }) => {
                all.extend(variables(list));
                for step in add {
                    all.push(&step.changes);
                    all.extend(step.summary.as_ref());
                    all.extend(step.sort.as_ref());
                }
                all.extend(rank.as_ref());
                all.extend(summary.as_ref());
            }
            None => {}
        }
        if let Some(metadata) = &self.metadata {
            all.extend(variables(&metadata.variables));
            all.extend(metadata.values.iter().map(|(_, value)| value));
        }
        all
    }
}
