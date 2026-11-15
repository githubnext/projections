use super::declaration::Declaration;
use super::paths::{Segment, expand, render};
use super::{MAX_BASIS_PART_BYTES, MAX_BASIS_PARTS};
use crate::model::{Datum, Extraction, Fields, lookup};
use crate::{Failure, fail, pointer};

/// Whether a basis part's name is valid: a letter, then up to 63 letters,
/// digits, `_` or `-`.
pub(super) fn part_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && name.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Checks a basis value: an object of 1 to 16 named parts, each a nonempty
/// string of at most 256 UTF-8 bytes.
pub(super) fn basis_value(value: &Datum, path: &str) -> Result<(), Failure> {
    let invalid = |path: &str, message: &str| fail("invalid-basis", path, message);
    let Some(parts) = value.as_object() else {
        return Err(invalid(path, "Expected an object of named parts"));
    };
    if parts.is_empty() || parts.len() > MAX_BASIS_PARTS {
        return Err(invalid(path, &format!("Expected 1 to {MAX_BASIS_PARTS} parts")));
    }
    for (name, part) in parts {
        let part_path = pointer(path, name);
        if !part_name(name) {
            return Err(invalid(
                &part_path,
                "A part's name is a letter, then up to 63 letters, digits, _ or -",
            ));
        }
        match part.as_str() {
            Some(text) if !text.is_empty() && text.len() <= MAX_BASIS_PART_BYTES => {}
            _ => {
                return Err(invalid(
                    &part_path,
                    &format!("A part's value is a nonempty string of at most {MAX_BASIS_PART_BYTES} bytes"),
                ));
            }
        }
    }
    Ok(())
}

/// Checks every generated value of an extraction (items still in input
/// order, so paths name the input's items) against its basis: an item has a
/// valid basis exactly when it has the generated value.
pub(crate) fn check_bases(extraction: &Extraction, path: &str) -> Result<(), Failure> {
    for declaration in extraction.volatile() {
        let Some(basis) = &declaration.basis else { continue };
        let collection = declaration.collection;
        for (index, item) in extraction.items(collection).iter().enumerate() {
            if declaration.applies(item) {
                let item_path = pointer(&pointer(path, collection.name()), &index.to_string());
                check_item(declaration, &basis.segments, item.data, &item_path)?;
            }
        }
    }
    Ok(())
}

fn check_item(declaration: &Declaration, basis: &[Segment], data: &Fields, item_path: &str) -> Result<(), Failure> {
    let values = expand(&declaration.path.segments, [Some(data), None]);
    for (value_path, bound) in &values {
        let basis_path = render(basis, bound);
        match lookup(data, &basis_path.keys) {
            Some(value) => basis_value(value, &format!("{item_path}{}", basis_path.pointer))?,
            None => {
                return Err(fail(
                    "missing-basis",
                    &format!("{item_path}{}", value_path.pointer),
                    &format!("A generated value needs its basis at {}", basis_path.pointer),
                ));
            }
        }
    }
    for (basis_path, bound) in expand(basis, [Some(data), None]) {
        if !values.iter().any(|(_, value_bound)| value_bound.starts_with(&bound)) {
            return Err(fail(
                "orphan-basis",
                &format!("{item_path}{}", basis_path.pointer),
                "A basis without its generated value describes nothing; omit both",
            ));
        }
    }
    Ok(())
}
