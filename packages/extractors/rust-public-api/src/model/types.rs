//! Rendering rustdoc types, paths and generic arguments as Rust source.

use super::builder::Builder;
use super::generics::bounds;
use super::rustdoc::key;
use serde_json::Value;

/// A path's last segment as the item is known, with its generic arguments:
/// stable however the source imports it.
pub(super) fn path(value: &Value, builder: &Builder) -> String {
    let written = value["path"].as_str().unwrap_or("_");
    let known = builder
        .paths
        .and_then(|paths| paths.get(&key(&value["id"]).ok()?))
        .and_then(|known| known["path"].as_array())
        .and_then(|segments| segments.last())
        .and_then(Value::as_str);
    let name = known.unwrap_or_else(|| written.rsplit("::").next().unwrap_or(written));
    format!("{name}{}", arguments(&value["args"], builder))
}

fn arguments(value: &Value, builder: &Builder) -> String {
    if let Some(angle) = value.get("angle_bracketed") {
        return angle_bracketed(angle, builder);
    }
    if let Some(parenthesized) = value.get("parenthesized") {
        let inputs: Vec<String> = parenthesized["inputs"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|input| ty(input, builder))
            .collect();
        let output = if parenthesized["output"].is_null() {
            String::new()
        } else {
            format!(" -> {}", ty(&parenthesized["output"], builder))
        };
        return format!("({}){output}", inputs.join(", "));
    }
    String::new()
}

/// `<…>` arguments: lifetimes, types and constants, then associated-item constraints.
fn angle_bracketed(angle: &Value, builder: &Builder) -> String {
    let mut shown: Vec<String> = angle["args"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|argument| generic_argument(argument, builder))
        .collect();
    for constraint in angle["constraints"].as_array().into_iter().flatten() {
        let name = constraint["name"].as_str().unwrap_or("_");
        let binding = &constraint["binding"];
        if let Some(equality) = binding.get("equality") {
            shown.push(format!("{name} = {}", term(equality, builder)));
        } else if let Some(constraint_bounds) = binding.get("constraint") {
            shown.push(format!("{name}: {}", bounds(constraint_bounds, builder)));
        }
    }
    if shown.is_empty() {
        String::new()
    } else {
        format!("<{}>", shown.join(", "))
    }
}

fn generic_argument(argument: &Value, builder: &Builder) -> String {
    match argument {
        Value::Object(argument) => match argument.iter().next() {
            Some((kind, value)) if kind == "lifetime" => value.as_str().unwrap_or("'_").to_owned(),
            Some((kind, value)) if kind == "type" => ty(value, builder),
            Some((kind, value)) if kind == "const" => value["expr"].as_str().or(value["value"].as_str()).unwrap_or("_").to_owned(),
            _ => "_".into(),
        },
        _ => "_".into(),
    }
}

pub(super) fn term(value: &Value, builder: &Builder) -> String {
    if let Some(type_) = value.get("type") {
        ty(type_, builder)
    } else if let Some(constant) = value.get("constant") {
        constant["expr"].as_str().unwrap_or("_").to_owned()
    } else {
        "_".into()
    }
}

/// A rustdoc type, as Rust source.
pub(super) fn ty(value: &Value, builder: &Builder) -> String {
    let Some((kind, inner)) = value.as_object().and_then(|object| object.iter().next()) else {
        return match value.as_str() {
            Some("infer") => "_".into(),
            _ => "_".into(),
        };
    };
    match kind.as_str() {
        "resolved_path" => path(inner, builder),
        "generic" | "primitive" => inner.as_str().unwrap_or("_").to_owned(),
        "tuple" => {
            let items: Vec<String> = inner.as_array().into_iter().flatten().map(|item| ty(item, builder)).collect();
            match items.len() {
                1 => format!("({},)", items[0]),
                _ => format!("({})", items.join(", ")),
            }
        }
        "slice" => format!("[{}]", ty(inner, builder)),
        "array" => format!("[{}; {}]", ty(&inner["type"], builder), inner["len"].as_str().unwrap_or("_")),
        "pat" => ty(&inner["type"], builder),
        "borrowed_ref" | "raw_pointer" => pointer(kind, inner, builder),
        "impl_trait" => format!("impl {}", bounds(inner, builder)),
        "dyn_trait" => dyn_trait(inner, builder),
        "function_pointer" => function_pointer(inner, builder),
        "qualified_path" => qualified_path(inner, builder),
        _ => "_".into(),
    }
}

/// A reference (`&'a mut T`) or raw pointer (`*const T`).
fn pointer(kind: &str, inner: &Value, builder: &Builder) -> String {
    let mutable = inner["is_mutable"] == true;
    if kind == "raw_pointer" {
        return format!("*{} {}", if mutable { "mut" } else { "const" }, ty(&inner["type"], builder));
    }
    format!(
        "&{}{}{}",
        inner["lifetime"]
            .as_str()
            .map(|lifetime| format!("{lifetime} "))
            .unwrap_or_default(),
        if mutable { "mut " } else { "" },
        ty(&inner["type"], builder)
    )
}

fn dyn_trait(inner: &Value, builder: &Builder) -> String {
    let mut traits: Vec<String> = inner["traits"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|item| path(&item["trait"], builder))
        .collect();
    if let Some(lifetime) = inner["lifetime"].as_str() {
        traits.push(lifetime.to_owned());
    }
    format!("dyn {}", traits.join(" + "))
}

fn function_pointer(inner: &Value, builder: &Builder) -> String {
    let inputs: Vec<String> = inner["sig"]["inputs"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|input| ty(&input[1], builder))
        .collect();
    let output = if inner["sig"]["output"].is_null() {
        String::new()
    } else {
        format!(" -> {}", ty(&inner["sig"]["output"], builder))
    };
    format!(
        "{}fn({}){output}",
        if inner["header"]["is_unsafe"] == true { "unsafe " } else { "" },
        inputs.join(", ")
    )
}

fn qualified_path(inner: &Value, builder: &Builder) -> String {
    let name = inner["name"].as_str().unwrap_or("_");
    let self_type = ty(&inner["self_type"], builder);
    if inner["trait"].is_null() {
        format!("{self_type}::{name}")
    } else {
        format!("<{self_type} as {}>::{name}", path(&inner["trait"], builder))
    }
}
