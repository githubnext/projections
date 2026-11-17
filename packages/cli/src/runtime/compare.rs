//! Comparing two revisions of a projection with one definition.

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

use super::{
    Runner,
    diagnostics::code,
    revision::{Revision, named_paths},
};
use crate::artifact;

const WORKING_TREE: &str = "working-tree";

/// A comparison notice naming the submodules and special entries neither
/// extraction saw, when there are any the definition's scope covers.
fn skipped_notice<'a>(revisions: impl IntoIterator<Item = &'a Revision>, definition: &Value) -> Option<String> {
    let scope = super::effective_scope(definition);
    let mut skipped: Vec<String> = revisions
        .into_iter()
        .flat_map(|revision| revision.skipped_within(scope.as_deref()))
        .collect();
    skipped.sort();
    skipped.dedup();
    (!skipped.is_empty()).then(|| {
        format!(
            "Submodules and special entries are not materialized, as git archive omits them, so this comparison does not cover {}",
            named_paths(&skipped)
        )
    })
}

/// Which revision's projection definition explains a comparison.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DefinitionSource {
    Base,
    Head,
}

impl Runner {
    /// Compares two revisions with the base revision's definition.
    pub fn compare(&self, id: &str, before: &str, after: &str) -> Result<Value> {
        Ok(self.compare_with(id, before, after, DefinitionSource::Base)?.document)
    }

    pub fn compare_with(&self, id: &str, before: &str, after: &str, source: DefinitionSource) -> Result<Compared> {
        let before = self.capture(before)?;
        let after = self.capture(after)?;
        self.compare_from(id, &before, &after, source)
    }

    /// Compares two revisions with the definition and component code of a
    /// third, `definition_reference` (for example `working-tree`), so
    /// uncommitted projection code can be tried on real history.
    pub fn compare_using(&self, id: &str, before: &str, after: &str, definition_reference: &str) -> Result<Compared> {
        let before = self.capture(before)?;
        let after = self.capture(after)?;
        let program = self.capture(definition_reference)?;
        self.compare_using_from(id, &before, &after, &program, definition_reference, None)
    }

    /// Compares two captured revisions with the definition and component code
    /// of `program`, captured from `definition_reference`; `reason` replaces
    /// the notice saying which definition applied.
    pub(super) fn compare_using_from(
        &self,
        id: &str,
        before: &Revision,
        after: &Revision,
        program: &Revision,
        definition_reference: &str,
        reason: Option<String>,
    ) -> Result<Compared> {
        let definition = self
            .definition(program, id)
            .with_context(|| format!("Projection {id} is not defined at {definition_reference}"))?;
        self.require_trust(&definition)?;
        let rules = self.comparator_bytes(&definition, program)?;
        let mut notices = vec![reason.unwrap_or_else(|| {
            format!(
                "Both revisions were extracted with the {} definition of {id}.",
                definition_name(definition_reference)
            )
        })];
        notices.extend(skipped_notice([before, after], &definition));
        let mut document = artifact::compare_extractions_with(
            &self.extract(before, &definition, program)?,
            &self.extract(after, &definition, program)?,
            rules.as_deref(),
        )?;
        notices.extend(artifact::notices(&document));
        artifact::set_notices(&mut document, &notices);
        Ok(Compared { document, notices })
    }

    /// The two revisions a range names; `<base>...<head>` starts at the merge base.
    pub fn resolve_range(&self, range: &str) -> Result<(String, String)> {
        let (base, head, symmetric) = parse_range(range)?;
        if !symmetric {
            return Ok((base, head));
        }
        ensure!(
            base != "working-tree" && head != "working-tree",
            "A merge-base range (<base>...<head>) requires two commits"
        );
        let root = self.repository_root()?;
        let (first, second) = (self.resolve(&root, &base)?, self.resolve(&root, &head)?);
        let merge_base = self.git_text(&root, &["merge-base", &first, &second])?;
        Ok((self.resolve(&root, &merge_base)?, head))
    }

    /// One definition, with one version of its component code, explains both
    /// revisions; it comes from the revision `source` names.
    pub(super) fn compare_from(&self, id: &str, before: &Revision, after: &Revision, source: DefinitionSource) -> Result<Compared> {
        let (program, other) = match source {
            DefinitionSource::Base => (before, after),
            DefinitionSource::Head => (after, before),
        };
        let sides = source.sides();
        let definition = self
            .definition(program, id)
            .map_err(|error| error.context(self.undefined_advice(id, other, sides)))?;
        self.require_trust(&definition)?;
        let digest = self.definition_digest(&definition, program)?;
        let mut notices: Vec<String> = self.definition_notice(id, &definition, &digest, other, sides).into_iter().collect();
        notices.extend(skipped_notice([before, after], &definition));
        let rules = self.comparator_bytes(&definition, program)?;
        let mut document = artifact::compare_extractions_with(
            &self.extract(before, &definition, program)?,
            &self.extract(after, &definition, program)?,
            rules.as_deref(),
        )?;
        notices.extend(artifact::notices(&document));
        artifact::set_notices(&mut document, &notices);
        Ok(Compared { document, notices })
    }

    /// Why a comparison can't use the `sides.definition` revision's definition,
    /// and an option that would work: the other revision's definition when it
    /// has one, else the working tree's or `HEAD`'s.
    fn undefined_advice(&self, id: &str, other: &Revision, sides: Sides<'_>) -> String {
        let Sides {
            definition: side,
            other: other_side,
        } = sides;
        if self.definition(other, id).is_ok() {
            return format!(
                "Projection {id} is not defined at the {side} revision; compare with --definition {other_side} to use the {other_side} revision's definition"
            );
        }
        let defines = |reference: &str| {
            self.discover(reference)
                .is_ok_and(|definitions| definitions.iter().any(|definition| definition["id"] == id))
        };
        match [WORKING_TREE, "HEAD"].into_iter().find(|reference| defines(reference)) {
            Some(reference) => format!(
                "Projection {id} is not defined at the base or the head revision; compare with --definition-revision {reference} to apply the {} definition to both",
                definition_name(reference)
            ),
            None => format!("Projection {id} is not defined at the base or the head revision, the working tree or HEAD"),
        }
    }

    /// Explains how `other` defines the projection differently, if it does.
    fn definition_notice(&self, id: &str, definition: &Value, digest: &str, other: &Revision, sides: Sides<'_>) -> Option<String> {
        let Sides {
            definition: side,
            other: other_side,
        } = sides;
        let shown = code(id);
        let advice = format!(
            "This comparison uses the {side} revision's definition; compare with `--definition {other_side}` to use the {other_side} revision's version, which runs the {other_side} revision's projection code"
        );
        let Ok(other_definition) = self.definition(other, id) else {
            return Some(format!(
                "The {other_side} revision does not define projection {shown}. This comparison uses the {side} revision's definition"
            ));
        };
        // Presentation defaults don't change what is extracted or compared.
        if artifact::semantic_definition(&other_definition) != artifact::semantic_definition(definition) {
            return Some(format!(
                "The {other_side} revision changes the definition of projection {shown}. {advice}"
            ));
        }
        match self.definition_digest(&other_definition, other) {
            Ok(other_digest) if other_digest == digest => None,
            _ => Some(format!(
                "The {other_side} revision changes the component code of projection {shown} (declared sources: {}). {advice}",
                artifact::definition_sources(definition)
                    .iter()
                    .map(|source| code(source))
                    .collect::<Vec<_>>()
                    .join(", ")
            )),
        }
    }
}

/// A comparison and the notices that explain how its revisions define the
/// projection differently.
pub struct Compared {
    pub document: Value,
    pub notices: Vec<String>,
}

impl Compared {
    pub(super) fn batch_item(&self, id: &str) -> Value {
        json!({"id":id,"status":changed(&self.document),"comparison":self.document,"notices":self.notices})
    }
}

/// A definition revision in words: "working tree's", else "<reference>".
pub(super) fn definition_name(reference: &str) -> String {
    if reference == WORKING_TREE {
        "working tree's".to_owned()
    } else {
        reference.to_owned()
    }
}

/// A short commit for messages; other references are unchanged.
pub fn short(reference: &str) -> String {
    if reference.len() >= 40 && reference.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        reference[..12].to_owned()
    } else {
        reference.to_owned()
    }
}

pub(super) fn changed(comparison: &Value) -> &'static str {
    if comparison["comparison"]["changes"]
        .as_array()
        .is_some_and(|changes| !changes.is_empty())
    {
        "changed"
    } else {
        "unchanged"
    }
}

/// Parses `<base>[..<head>]` or `<base>...<head>`. One revision compares with
/// the working tree; an empty side means `HEAD`, as in Git.
pub fn parse_range(range: &str) -> Result<(String, String, bool)> {
    ensure!(!range.is_empty(), "A revision range is required");
    let side = |value: &str| {
        if value.is_empty() { "HEAD".to_owned() } else { value.to_owned() }
    };
    Ok(if let Some((base, head)) = range.split_once("...") {
        (side(base), side(head), true)
    } else if let Some((base, head)) = range.split_once("..") {
        (side(base), side(head), false)
    } else {
        (range.to_owned(), "working-tree".to_owned(), false)
    })
}

/// A definition's revision and the other revision of a comparison.
#[derive(Clone, Copy)]
pub struct Sides<'a> {
    pub definition: &'a str,
    pub other: &'a str,
}

impl DefinitionSource {
    pub fn sides(self) -> Sides<'static> {
        match self {
            DefinitionSource::Base => Sides {
                definition: "base",
                other: "head",
            },
            DefinitionSource::Head => Sides {
                definition: "head",
                other: "base",
            },
        }
    }
}
