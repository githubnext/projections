//! Generic parameters, where clauses and bounds.

use super::builder::Builder;
use super::types::{path, term, ty};
use serde_json::{Value, json};

/// Generic parameters and where clauses, rendered.
pub(super) struct Generics {
    params: Vec<Param>,
    pub(super) clauses: Vec<String>,
}

/// A generic parameter: as Rust shows it (`T: Clone`, `'a: 'b`, `const N:
/// usize`), its bounds, a `const` parameter's type, and its default.
struct Param {
    name: String,
    shown: String,
    constraints: Vec<String>,
    value_type: Option<String>,
    default: Option<String>,
}

pub(super) fn generics(value: &Value, builder: &Builder) -> Generics {
    let params = value["params"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|param| self::param(param, builder))
        .collect();
    let clauses = value["where_predicates"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|predicate| clause(predicate, builder))
        .collect();
    Generics { params, clauses }
}

/// A lifetime, type or const parameter; `None` for synthetic (`impl Trait`) ones.
fn param(param: &Value, builder: &Builder) -> Option<Param> {
    let name = param["name"].as_str().unwrap_or("_").to_owned();
    let kind = &param["kind"];
    let bounded = |name: &str, constraints: &[String]| {
        if constraints.is_empty() {
            name.to_owned()
        } else {
            format!("{name}: {}", constraints.join(" + "))
        }
    };
    if let Some(lifetime) = kind.get("lifetime") {
        let outlives: Vec<String> = lifetime["outlives"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        let shown = bounded(&name, &outlives);
        Some(Param {
            name,
            shown,
            constraints: outlives,
            value_type: None,
            default: None,
        })
    } else if let Some(parameter) = kind.get("type") {
        if parameter["is_synthetic"] == true {
            return None;
        }
        let constraints = bound_list(&parameter["bounds"], builder);
        let default = parameter["default"].is_object().then(|| ty(&parameter["default"], builder));
        let shown = bounded(&name, &constraints);
        Some(Param {
            name,
            shown,
            constraints,
            value_type: None,
            default,
        })
    } else if let Some(constant) = kind.get("const") {
        let value_type = ty(&constant["type"], builder);
        let shown = format!("const {name}: {value_type}");
        let default = constant["default"].as_str().map(str::to_owned);
        Some(Param {
            name,
            shown,
            constraints: Vec::new(),
            value_type: Some(value_type),
            default,
        })
    } else {
        None
    }
}

/// A where-clause predicate, rendered.
fn clause(predicate: &Value, builder: &Builder) -> Option<String> {
    if let Some(bound) = predicate.get("bound_predicate") {
        Some(format!("{}: {}", ty(&bound["type"], builder), bounds(&bound["bounds"], builder)))
    } else if let Some(lifetime) = predicate.get("lifetime_predicate") {
        let outlives: Vec<&str> = lifetime["outlives"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        Some(format!(
            "{}: {}",
            lifetime["lifetime"].as_str().unwrap_or("'_"),
            outlives.join(" + ")
        ))
    } else {
        predicate
            .get("eq_predicate")
            .map(|equality| format!("{} = {}", ty(&equality["lhs"], builder), term(&equality["rhs"], builder)))
    }
}

impl Generics {
    pub(super) fn params(&self) -> String {
        if self.params.is_empty() {
            return String::new();
        }
        format!(
            "<{}>",
            self.params
                .iter()
                .map(|param| match &param.default {
                    Some(default) => format!("{} = {default}", param.shown),
                    None => param.shown.clone(),
                })
                .collect::<Vec<_>>()
                .join(", ")
        )
    }

    pub(super) fn clauses(&self) -> String {
        if self.clauses.is_empty() {
            String::new()
        } else {
            format!(" where {}", self.clauses.join(", "))
        }
    }

    /// The parameters as api/v0 contract facts.
    pub(super) fn type_parameters(&self) -> Value {
        Value::Array(
            self.params
                .iter()
                .map(|param| {
                    let mut fact = json!({"name": param.name, "constraints": param.constraints});
                    if let Some(value_type) = &param.value_type {
                        fact["type"] = json!(value_type);
                    }
                    if let Some(default) = &param.default {
                        fact["default"] = json!(default);
                    }
                    fact
                })
                .collect(),
        )
    }
}

pub(super) fn bounds(value: &Value, builder: &Builder) -> String {
    bound_list(value, builder).join(" + ")
}

pub(super) fn bound_list(value: &Value, builder: &Builder) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|bound| {
            if let Some(trait_bound) = bound.get("trait_bound") {
                let modifier = match trait_bound["modifier"].as_str() {
                    Some("maybe") => "?",
                    Some("maybe_const") => "~const ",
                    _ => "",
                };
                Some(format!("{modifier}{}", path(&trait_bound["trait"], builder)))
            } else {
                bound.get("outlives").and_then(Value::as_str).map(str::to_owned)
            }
        })
        .collect()
}
