//! An extraction's `volatile` declarations, read and normalized: an explicit
//! collection, sorted unique kinds, declarations sorted by collection, path
//! and kinds.

use super::datum::number;
use super::fields::{array, choice, fields, optional, text};
use crate::canonical::{canonical_order, word};
use crate::model::{Collection, Number};
use crate::volatility::paths::{Segment, segments};
use crate::volatility::{Declaration, MAX_DECLARATIONS, Pointer, Tolerance, unvaried_bases, within_path};
use crate::{Failure, fail, pointer};
use serde_json::Value;
use std::collections::HashSet;

/// Reads an extraction's `volatile` list; an empty list normalizes to none.
pub(super) fn declarations(value: &Value, path: &str) -> Result<Vec<Declaration>, Failure> {
    let items = array(value, path)?;
    if items.len() > MAX_DECLARATIONS {
        return Err(fail(
            "volatile-limit",
            path,
            &format!("At most {MAX_DECLARATIONS} volatile declarations"),
        ));
    }
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let item_path = pointer(path, &index.to_string());
        let declaration = declaration(item, &item_path)?;
        let kinds = declaration.kinds.as_ref();
        let key = (
            declaration.collection,
            declaration.path.as_str().to_owned(),
            kinds.cloned().unwrap_or_default().join("\u{0}"),
            kinds.is_some(),
        );
        if !seen.insert(key) {
            return Err(fail(
                "duplicate-volatile",
                &item_path,
                "Another declaration has the same collection, kinds and path",
            ));
        }
        result.push(declaration);
    }
    unvaried_bases(&result, path)?;
    canonical_order(&mut result, declaration_key);
    Ok(result)
}

fn declaration(item: &Value, item_path: &str) -> Result<Declaration, Failure> {
    fields(item, &["collection", "kinds", "path", "tolerance", "generated", "basis"], item_path)?;
    let collection = optional(item, "collection", item_path, |value, path| {
        choice(
            value,
            &Collection::ALL,
            Collection::name,
            path,
            "Expected entities or relationships",
        )
    })?
    .unwrap_or(Collection::Entities);
    let kinds = optional(item, "kinds", item_path, kinds)?;
    let path = declared(&item["path"], &pointer(item_path, "path"))?;
    let basis = generated_basis(item, item_path, &path.segments)?;
    let tolerance = optional(item, "tolerance", item_path, |value, at| tolerance(value, at, &path.segments))?;
    Ok(Declaration {
        collection,
        kinds,
        path,
        tolerance,
        basis,
    })
}

/// A declared pointer under `/data/`.
fn declared(value: &Value, path: &str) -> Result<Pointer, Failure> {
    let raw = text(value, path, true)?;
    let parsed = segments(raw).map_err(|message| fail("invalid-volatile-path", path, message))?;
    Ok(Pointer {
        raw: raw.to_owned(),
        segments: parsed,
    })
}

/// A generated declaration's basis: `generated` is `true` exactly when
/// `basis` is set, the basis uses no `*` its path lacks, and there is no
/// tolerance (the basis is the tolerance).
fn generated_basis(item: &Value, item_path: &str, path: &[Segment]) -> Result<Option<Pointer>, Failure> {
    let generated = match item.get("generated") {
        None => false,
        Some(Value::Bool(true)) => true,
        Some(_) => {
            return Err(fail(
                "invalid-type",
                &pointer(item_path, "generated"),
                "Expected true; omit generated for other volatile values",
            ));
        }
    };
    match (generated, item.get("basis")) {
        (false, None) => Ok(None),
        (false, Some(_)) => Err(fail(
            "invalid-generated",
            &pointer(item_path, "basis"),
            "Only a generated value has a basis; declare generated: true",
        )),
        (true, None) => Err(fail(
            "invalid-generated",
            item_path,
            "A generated value declares the basis it was generated from",
        )),
        (true, Some(value)) => {
            let basis_path = pointer(item_path, "basis");
            let basis = declared(value, &basis_path)?;
            within_path(&basis.segments, path, &basis_path, "basis")?;
            if item.get("tolerance").is_some() {
                return Err(fail(
                    "invalid-tolerance",
                    &pointer(item_path, "tolerance"),
                    "A generated value's basis is its tolerance; remove tolerance",
                ));
            }
            Ok(Some(basis))
        }
    }
}

/// A declaration's kinds, unique and sorted.
fn kinds(value: &Value, kinds_path: &str) -> Result<Vec<String>, Failure> {
    let values = array(value, kinds_path)?;
    if values.is_empty() {
        return Err(fail(
            "invalid-type",
            kinds_path,
            "Expected at least one kind; omit kinds for every kind",
        ));
    }
    let mut list: Vec<String> = Vec::new();
    for (position, kind) in values.iter().enumerate() {
        let kind_path = pointer(kinds_path, &position.to_string());
        let kind = text(kind, &kind_path, true)?;
        if list.iter().any(|listed| listed == kind) {
            return Err(fail("duplicate-kind", &kind_path, "Kinds are listed once"));
        }
        list.push(kind.to_owned());
    }
    canonical_order(&mut list, |kind| vec![word(kind)]);
    Ok(list)
}

/// A finite nonnegative tolerance bound.
fn bound(value: &Value, path: &str) -> Result<Number, Failure> {
    match value {
        Value::Number(bound) if bound.as_f64().is_some_and(|n| n.is_finite() && n >= 0.0) => number(bound, path),
        _ => Err(fail("invalid-tolerance", path, "Expected a finite nonnegative number")),
    }
}

/// A declared tolerance: known bounds, each finite and nonnegative, a factor
/// only with a spread, a spread using only its path's `*` segments, and at
/// least one bound.
fn tolerance(tolerance: &Value, tolerance_path: &str, path: &[Segment]) -> Result<Tolerance, Failure> {
    fields(tolerance, &["absolute", "relative", "spread", "factor"], tolerance_path)?;
    let absolute = optional(tolerance, "absolute", tolerance_path, bound)?;
    let relative = optional(tolerance, "relative", tolerance_path, bound)?;
    let factor = optional(tolerance, "factor", tolerance_path, bound)?;
    let spread = match (tolerance.get("spread"), factor) {
        (None, Some(_)) => {
            return Err(fail(
                "invalid-tolerance",
                &pointer(tolerance_path, "factor"),
                "A factor scales a spread; declare spread too",
            ));
        }
        (Some(spread), _) => {
            let spread_path = pointer(tolerance_path, "spread");
            let spread = declared(spread, &spread_path)?;
            within_path(&spread.segments, path, &spread_path, "spread")?;
            Some(spread)
        }
        (None, None) => None,
    };
    if absolute.is_none() && relative.is_none() && spread.is_none() {
        return Err(fail(
            "invalid-tolerance",
            tolerance_path,
            "A tolerance declares at least one bound: absolute, relative or spread",
        ));
    }
    Ok(Tolerance {
        absolute,
        relative,
        spread,
        factor,
    })
}

/// The canonical sort key of a normalized declaration: by collection, path,
/// then kinds (every kind first), each compared by UTF-16 code units.
fn declaration_key(declaration: &Declaration) -> Vec<Vec<u16>> {
    let mut key = vec![word(declaration.collection.name()), word(declaration.path.as_str())];
    key.push(vec![u16::from(declaration.kinds.is_some())]);
    key.extend(declaration.kinds.iter().flatten().map(|kind| word(kind)));
    key
}
