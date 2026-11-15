use super::paths::{Segment, wildcards};
use crate::model::{Collection, ItemRef, Number};
use crate::{Failure, fail, pointer};

/// A declared pointer under `/data/`, as written and parsed.
#[derive(Debug, Clone, PartialEq)]
pub struct Pointer {
    pub(crate) raw: String,
    pub(crate) segments: Vec<Segment>,
}

impl Pointer {
    pub fn as_str(&self) -> &str {
        &self.raw
    }
}

/// A declared tolerance: at least one of `absolute`, `relative` and
/// `spread`, each finite and nonnegative; a `factor` only with a spread.
/// Numbers keep the form written.
#[derive(Debug, Clone, PartialEq)]
pub struct Tolerance {
    pub(crate) absolute: Option<Number>,
    pub(crate) relative: Option<Number>,
    pub(crate) spread: Option<Pointer>,
    pub(crate) factor: Option<Number>,
}

/// One normalized volatile declaration. `basis` is set exactly for a
/// generated value, which has no tolerance; a spread or basis uses only the
/// `*` segments its path has.
#[derive(Debug, Clone, PartialEq)]
pub struct Declaration {
    pub(crate) collection: Collection,
    /// Distinct kinds, sorted; none for every kind.
    pub(crate) kinds: Option<Vec<String>>,
    pub(crate) path: Pointer,
    pub(crate) tolerance: Option<Tolerance>,
    pub(crate) basis: Option<Pointer>,
}

impl Declaration {
    pub(crate) fn applies(&self, item: &ItemRef) -> bool {
        self.collection == item.collection && self.kinds.as_ref().is_none_or(|kinds| kinds.iter().any(|kind| kind == item.kind))
    }
}

/// Checks a declared spread or basis against its path: it may only use the
/// `*` segments the path has.
pub(crate) fn within_path(inner: &[Segment], path: &[Segment], at: &str, what: &str) -> Result<(), Failure> {
    if wildcards(inner) > wildcards(path) {
        return Err(fail(
            "invalid-volatile-path",
            at,
            &format!("A {what} may only use the * segments its path has"),
        ));
    }
    Ok(())
}

/// Whether two declared paths can address overlapping values: one equals the
/// other or contains it, with `*` matching any segment.
fn overlap(a: &[Segment], b: &[Segment]) -> bool {
    a.iter().zip(b).all(|pair| match pair {
        (Segment::Key(a), Segment::Key(b)) => a == b,
        _ => true,
    })
}

/// Rejects a basis that some declaration makes volatile: the basis decides
/// whether a generated value's variation is expected, so it can't vary.
/// `declarations` are in the order written; `path` is the list's.
pub(crate) fn unvaried_bases(declarations: &[Declaration], path: &str) -> Result<(), Failure> {
    for (index, declaration) in declarations.iter().enumerate() {
        let Some(basis) = &declaration.basis else { continue };
        for (other_index, other) in declarations.iter().enumerate() {
            let kinds = match (&declaration.kinds, &other.kinds) {
                (Some(a), Some(b)) => a.iter().any(|kind| b.contains(kind)),
                _ => true,
            };
            if other.collection == declaration.collection && kinds && overlap(&basis.segments, &other.path.segments) {
                let what = if other_index == index {
                    "its own path".to_owned()
                } else {
                    format!("the path of /volatile/{other_index}")
                };
                return Err(fail(
                    "volatile-basis",
                    &pointer(&pointer(path, &index.to_string()), "basis"),
                    &format!("A basis can't be volatile, and it overlaps {what}"),
                ));
            }
        }
    }
    Ok(())
}
