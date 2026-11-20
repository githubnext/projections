//! The rules language as data: what a rules file can say and what it means,
//! without how the interpreter implements it. Its digest is the interpreter's
//! identity, which every rules comparator's digest covers, so refactoring the
//! interpreter, or building it on another host, doesn't invalidate saved
//! comparisons; changing the language does. `language.json` in this crate is
//! the committed manifest, held to this function by `tests/language.rs`.

use crate::{library, macros, types};
use serde_json::{Value, json};

/// Bump when the interpreter's behaviour changes in a way the manifest
/// doesn't show: what a library function, a macro or a step operation does,
/// the core's matching, the YAML subset, the checker's rules or the cost
/// model. Hosts rerun recorded comparisons when they verify them, so a
/// behaviour change that isn't bumped makes saved comparisons fail
/// verification rather than pass wrongly.
pub const REVISION: u32 = 4;

/// The manifest: the format and its revision, the macros, the standard
/// library's signatures and cost classes, the declared object types and the
/// default cost budget.
pub fn manifest() -> Value {
    json!({
        "format": "projections.comparator",
        "version": 0,
        "revision": REVISION,
        "macros": macros::MACROS,
        "library": library::LIBRARY.iter().map(|function| json!({
            "name": function.name,
            "params": (function.params)().iter().map(ToString::to_string).collect::<Vec<_>>(),
            "returns": (function.returns)().to_string(),
            "cost": function.cost,
        })).collect::<Vec<_>>(),
        "types": types::OBJECTS.iter().map(|name| json!({
            "name": name,
            "fields": types::fields(name).unwrap_or_default().into_iter()
                .map(|(field, ty)| json!([field, ty.to_string()])).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "budget": crate::cost::DEFAULT_BUDGET,
    })
}
