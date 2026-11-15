use super::assess::Varied;
use super::paths::{expand, render};
use crate::model::{Collection, Datum, Extraction, lookup};
use crate::utf16_cmp;
use projections_engine_verified::generated::{self, Only};

/// Why a generated value was regenerated, in words: "Regenerated because the
/// input and the prompt changed". `input`, `prompt` and `model` read as
/// words; other parts by name, as code.
pub fn regenerated_because(because: &[String]) -> String {
    let words: Vec<String> = because
        .iter()
        .map(|part| match part.as_str() {
            "input" | "prompt" | "model" => format!("the {part}"),
            other => format!("`{other}`"),
        })
        .collect();
    let list = match words.as_slice() {
        [] => return "Regenerated from the same inputs".to_owned(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    };
    format!("Regenerated because {list} changed")
}

/// Judges one generated value by its bases ([`generated::judge`]), one pair
/// per basis path its declarations give: equal bases make any rewording
/// expected variation; a moved basis, or a value on one side only, are
/// beyond. A basis that isn't an object has no parts.
pub(super) fn judge_generated(path: String, values: [Option<&Datum>; 2], bases: Vec<[Option<&Datum>; 2]>) -> Option<Varied> {
    let bases: Vec<_> = bases
        .into_iter()
        .map(|[before, after]| (before.and_then(Datum::as_object), after.and_then(Datum::as_object)))
        .collect();
    let judged = generated::judge((values[0], values[1]), &bases)?;
    let mut because: Vec<String> = judged.because.into_iter().cloned().collect();
    because.sort_by(|x, y| utf16_cmp(x, y));
    because.dedup();
    Some(Varied {
        path,
        within: judged.within,
        generated: true,
        because,
        reason: judged.only.map(|only| {
            match only {
                Only::Before => "Generated only before",
                Only::After => "Generated only after",
            }
            .to_owned()
        }),
    })
}

/// `sha256:` and the lowercase hex SHA-256 of `bytes`.
pub fn sha256(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("sha256:{:x}", Sha256::digest(bytes))
}

/// One generated value of an extraction, with its basis.
#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedValue<'a> {
    pub collection: Collection,
    pub id: &'a str,
    /// The declaration's path, `*` segments and all.
    pub declared: &'a str,
    /// The concrete pointer into the item.
    pub path: String,
    pub basis: &'a Datum,
    pub value: &'a Datum,
}

/// Every generated value of an extraction, in collection, item and
/// declaration order. Validation guarantees each has its basis.
pub fn generated(extraction: &Extraction) -> Vec<GeneratedValue<'_>> {
    let mut result = Vec::new();
    for collection in Collection::ALL {
        for item in extraction.items(collection) {
            for declaration in extraction.volatile() {
                let Some(basis) = &declaration.basis else { continue };
                if !declaration.applies(&item) {
                    continue;
                }
                for (path, bound) in expand(&declaration.path.segments, [Some(item.data), None]) {
                    let basis_path = render(&basis.segments, &bound);
                    let at = |keys: &[String]| lookup(item.data, keys).expect("validation pairs every generated value with its basis");
                    result.push(GeneratedValue {
                        collection,
                        id: item.id,
                        declared: declaration.path.as_str(),
                        value: at(&path.keys),
                        basis: at(&basis_path.keys),
                        path: path.pointer,
                    });
                }
            }
        }
    }
    result
}
