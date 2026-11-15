//! The load-time checker: every expression is checked against the declared
//! types of what it can see (the inputs, its section's variables, the
//! library and the file's functions) before any comparison runs. It reports
//! what is certainly wrong: an unknown variable, field or function, a call
//! with the wrong number of arguments, an argument of the wrong type, an
//! operator applied to types it has no overload for. Anything it can't know
//! (`dyn`, such as the values in an item's `data`) it lets through to run
//! time.

mod operators;
mod run;
mod suggest;
mod walker;

use self::run::run;
use self::walker::Walker;
use crate::rules::{Expression, Function, Rules, Variable};
use crate::types::{Ty, assignable, map};
use projections_engine::Diagnostic;
use std::collections::{BTreeMap, HashMap};

/// CEL's own functions and macros (global and member), as this
/// implementation registers them.
pub const CEL: &[&str] = &[
    "size",
    "type",
    "int",
    "uint",
    "double",
    "string",
    "bool",
    "bytes",
    "dyn",
    "has",
    "matches",
    "contains",
    "startsWith",
    "endsWith",
    "charAt",
    "indexOf",
    "lastIndexOf",
    "lowerAscii",
    "upperAscii",
    "trim",
    "replace",
    "split",
    "substring",
    "join",
    "format",
    "reverse",
    "strings.quote",
    "distinct",
    "flatten",
    "slice",
    "sort",
    "sortBy",
    "lists.range",
    "math.ceil",
    "math.floor",
    "math.round",
    "math.trunc",
    "math.isInf",
    "math.isNaN",
    "math.isFinite",
    "math.abs",
    "math.sign",
    "math.sqrt",
    "math.bitAnd",
    "math.bitOr",
    "math.bitXor",
    "math.bitNot",
    "math.bitShiftLeft",
    "math.bitShiftRight",
    "math.greatest",
    "math.least",
    "math.@max",
    "math.@min",
    "optional.of",
    "optional.none",
    "optional.ofNonZeroValue",
    "hasValue",
    "value",
    "orValue",
    "or",
    "optMap",
    "optFlatMap",
    "all",
    "exists",
    "exists_one",
    "existsOne",
    "map",
    "filter",
    "@sortByAssociatedKeys",
    "@not_strictly_false",
    "@in",
];

/// Whether `name` is one of CEL's functions.
pub fn known(name: &str) -> bool {
    CEL.contains(&name) || name.starts_with('_') || name == "!_" || name == "-_"
}

/// Namespaces of qualified function names.
pub const NAMESPACES: [&str; 10] = [
    "math",
    "lists",
    "strings",
    "optional",
    "graph",
    "ids",
    "maps",
    "findings",
    "prose",
    "generated",
];

#[derive(Clone)]
struct Signature {
    params: Vec<Ty>,
    returns: Ty,
}

pub struct Checker {
    functions: HashMap<String, Signature>,
    diagnostics: Vec<Diagnostic>,
    warnings: Vec<Diagnostic>,
    /// The types of `classify.annotation`, once checked.
    pub annotation: Ty,
    /// What each expression can see, by its path, when recording for an editor.
    #[cfg(feature = "editing")]
    scopes: Option<HashMap<String, Scope>>,
}

/// The variables an expression can see.
#[derive(Clone, Default)]
pub struct Scope {
    names: BTreeMap<String, Ty>,
    /// The values a name may take, where declared (`values:`), for `match`.
    domains: BTreeMap<String, Vec<serde_json::Value>>,
}

impl Scope {
    /// The names it binds and their types: inputs, parameters and `variables.<name>`.
    pub fn names(&self) -> &BTreeMap<String, Ty> {
        &self.names
    }

    pub fn with(mut self, name: &str, ty: Ty) -> Self {
        self.names.insert(name.to_owned(), ty);
        self
    }

    fn variable(&mut self, name: &str, ty: Ty) {
        self.names.insert(format!("variables.{name}"), ty);
    }

    fn domain(&mut self, name: String, values: &Option<Vec<serde_json::Value>>) {
        if let Some(values) = values {
            self.domains.insert(name, values.clone());
        }
    }
}

/// What every expression sees: the inputs.
pub fn inputs() -> Scope {
    Scope::default()
        .with("before", Ty::Object("Extraction"))
        .with("after", Ty::Object("Extraction"))
        .with("lookup", Ty::Object("Lookup"))
        .with("options", map(Ty::String, Ty::Dyn))
        .with("baseline", Ty::Object("Comparison"))
}

fn numeric(ty: &Ty) -> bool {
    matches!(ty, Ty::Int | Ty::UInt | Ty::Double)
}

/// A concrete type the checker is sure about.
fn concrete(ty: &Ty) -> bool {
    !matches!(ty, Ty::Dyn | Ty::Never | Ty::Null)
}

fn element(ty: &Ty) -> Ty {
    match ty {
        Ty::List(item) => (**item).clone(),
        Ty::Map(key, _) => (**key).clone(),
        _ => Ty::Dyn,
    }
}

impl Checker {
    pub fn new(functions: &[Function]) -> Self {
        Checker::empty().with_functions(functions)
    }

    fn empty() -> Self {
        Checker {
            functions: HashMap::new(),
            diagnostics: Vec::new(),
            warnings: Vec::new(),
            annotation: Ty::Dyn,
            #[cfg(feature = "editing")]
            scopes: None,
        }
    }

    fn with_functions(mut self, functions: &[Function]) -> Self {
        // In dependency order, so a function's callees have signatures first.
        for function in functions {
            let mut scope = inputs();
            for param in &function.params {
                scope = scope.with(&param.name, param.ty.clone());
                scope.domain(param.name.clone(), &param.values);
            }
            self.variables(&mut scope, &function.variables);
            let body = self.check(&function.body, &scope);
            let returns = match &function.returns {
                Some(declared) => {
                    if !assignable(&body, declared) {
                        self.diagnostics.push(function.body.at(
                            "invalid-rules",
                            function.body.parsed.id,
                            &format!("`{}` returns {body}, not the declared {declared}", function.name),
                        ));
                    }
                    declared.clone()
                }
                None => body,
            };
            self.functions.insert(
                function.name.clone(),
                Signature {
                    params: function.params.iter().map(|param| param.ty.clone()).collect(),
                    returns,
                },
            );
        }
        self
    }

    /// Errors, then lint warnings.
    pub fn into_diagnostics(self) -> (Vec<Diagnostic>, Vec<Diagnostic>) {
        (self.diagnostics, self.warnings)
    }

    /// Checks variables in order, adding each to `scope`.
    pub fn variables(&mut self, scope: &mut Scope, variables: &[Variable]) {
        for variable in variables {
            let ty = self.check(&variable.expression, scope);
            scope.variable(&variable.name, ty);
            scope.domain(format!("variables.{}", variable.name), &variable.values);
        }
    }

    /// The type of an expression, reporting what is wrong with it.
    pub fn check(&mut self, expression: &Expression, scope: &Scope) -> Ty {
        #[cfg(feature = "editing")]
        if let Some(scopes) = &mut self.scopes {
            scopes.insert(expression.location.path.clone(), scope.clone());
        }
        self.domains(expression, scope);
        let mut walker = Walker {
            checker: self,
            expression,
            locals: Vec::new(),
        };
        walker.ty(&expression.parsed, scope)
    }

    /// Warns about a `match` on a name with declared values whose keys
    /// aren't among them, or that leaves some of them to its default.
    fn domains(&mut self, expression: &Expression, scope: &Scope) {
        for site in &expression.matches {
            let Some(values) = site.subject.as_ref().and_then(|name| scope.domains.get(name)) else {
                continue;
            };
            let declared: Vec<String> = values
                .iter()
                .map(|value| match value {
                    serde_json::Value::String(text) => format!("'{text}'"),
                    other => other.to_string(),
                })
                .collect();
            let unknown: Vec<&String> = site.keys.iter().filter(|key| !declared.contains(key)).collect();
            let missing: Vec<&String> = declared.iter().filter(|value| !site.keys.contains(value)).collect();
            let subject = site.subject.as_deref().unwrap_or_default();
            if !unknown.is_empty() {
                self.warnings.push(expression.at_name(
                    "match-values",
                    site.id,
                    "match",
                    &format!(
                        "`{subject}` is never {}: its declared values are {}",
                        unknown.iter().map(|key| key.as_str()).collect::<Vec<_>>().join(", "),
                        declared.join(", ")
                    ),
                ));
            }
            if !missing.is_empty() {
                self.warnings.push(expression.at_name(
                    "match-values",
                    site.id,
                    "match",
                    &format!(
                        "The `match` on `{subject}` leaves {} to its default",
                        missing.iter().map(|key| key.as_str()).collect::<Vec<_>>().join(", ")
                    ),
                ));
            }
        }
    }

    /// Checks that an expression is a bool.
    pub fn condition(&mut self, expression: &Expression, scope: &Scope) {
        let ty = self.check(expression, scope);
        if concrete(&ty) && ty != Ty::Bool {
            self.diagnostics
                .push(expression.at("invalid-rules", expression.parsed.id, &format!("Expected a bool, not {ty}")));
        }
    }

    /// Checks that an expression is a string or null.
    pub fn text(&mut self, expression: &Expression, scope: &Scope) {
        let ty = self.check(expression, scope);
        if concrete(&ty) && ty != Ty::String {
            self.diagnostics
                .push(expression.at("invalid-rules", expression.parsed.id, &format!("Expected a string, not {ty}")));
        }
    }
}

/// Checks a whole rules file.
/// The rules' type errors, and lint warnings.
pub fn check(rules: &Rules) -> (Vec<Diagnostic>, Vec<Diagnostic>) {
    run(Checker::new(&rules.functions), rules).into_diagnostics()
}

/// What each expression can see, by its path: the checker's scopes, for an
/// editor's hovers and completions.
#[cfg(feature = "editing")]
pub fn scopes(rules: &Rules) -> HashMap<String, Scope> {
    let mut checker = Checker::empty();
    checker.scopes = Some(HashMap::new());
    run(checker.with_functions(&rules.functions), rules).scopes.unwrap_or_default()
}
