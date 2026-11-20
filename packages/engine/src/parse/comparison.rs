//! A comparison's JSON, read and checked against two extractions as it is
//! read: the parser reads each part, and the integrity core
//! ([`crate::comparison`]) checks it, in the order the contract fixes.

use super::encode::to_value;
use super::fields::{array, choice, fields, name, object, optional, text, version_zero};
use crate::comparison::{Inconsistent, Integrity, reverse_steps};
use crate::context::MAX_CONTEXT;
use crate::model::{Change, Collection, Context, Correspondence, Extraction, Reverse, Side, Status, StepKind};
use crate::volatility::Varied;
use crate::{Failure, fail, pointer, utf16_cmp};
use serde_json::Value;
use std::collections::HashSet;

/// Checks a comparison's JSON against two extractions.
pub(crate) fn check(before: &Extraction, after: &Extraction, comparison: &Value) -> Result<(), Failure> {
    let path = "/comparison";
    let mut integrity = Integrity::new(before, after)?;
    fields(
        comparison,
        &[
            "protocolVersion",
            "changes",
            "steps",
            "order",
            "reverseSteps",
            "variation",
            "metadata",
        ],
        path,
    )?;
    version_zero(&comparison["protocolVersion"], &pointer(path, "protocolVersion"))?;
    let changes_path = pointer(path, "changes");
    for (position, change) in array(&comparison["changes"], &changes_path)?.iter().enumerate() {
        claim(&mut integrity, change, pointer(&changes_path, &position.to_string()))?;
    }
    let aliases = integrity.aliases();
    integrity.assessments(&aliases).map_err(inconsistent)?;
    let variation_path = pointer(path, "variation");
    if let Some(expected) = integrity.variation(comparison.get("variation").is_some(), &variation_path)? {
        let claimed = &comparison["variation"];
        fields(claimed, &["within", "beyond"], &variation_path)?;
        let counted = |key: &str, count: usize| claimed[key].as_u64() == Some(count as u64);
        if !(counted("within", expected.within) && counted("beyond", expected.beyond)) {
            return Err(fail(
                "inconsistent-variation",
                &variation_path,
                &format!("Expected variation {expected}"),
            ));
        }
    }
    integrity.hidden(&aliases, &changes_path)?;
    let reverse = optional(comparison, "order", path, order)?.unwrap_or(Reverse::Mirror);
    steps(&integrity, &comparison["steps"], &pointer(path, "steps"))?;
    let reverse_path = pointer(path, "reverseSteps");
    if reverse_steps(reverse, comparison.get("reverseSteps").is_some(), &reverse_path)? {
        steps(&integrity, &comparison["reverseSteps"], &reverse_path)?;
    }
    optional(comparison, "metadata", path, |metadata, path| object(metadata, path).map(|_| ()))?;
    Ok(())
}

fn inconsistent(inconsistent: Inconsistent) -> Failure {
    match inconsistent {
        Inconsistent::Varied { path, expected } => fail(
            "inconsistent-variation",
            &path,
            &match expected.as_slice() {
                [] => "No volatile value differs, so the change has no varied".to_owned(),
                expected => format!("Expected varied {}", to_value(&expected)),
            },
        ),
        Inconsistent::Status { path, message } => fail("inconsistent-status", &path, message),
    }
}

/// Reads one change and claims it.
fn claim(integrity: &mut Integrity, change: &Value, path: String) -> Result<(), Failure> {
    fields(
        change,
        &[
            "id",
            "collection",
            "before",
            "after",
            "status",
            "correspondence",
            "varied",
            "summary",
            "context",
        ],
        &path,
    )?;
    let id_path = pointer(&path, "id");
    let id = name(&change["id"], &id_path)?;
    integrity.claim_id(&id, &id_path)?;
    let collection = choice(
        &change["collection"],
        &Collection::ALL,
        Collection::name,
        &pointer(&path, "collection"),
        "Expected entities or relationships",
    )?;
    let status = choice(
        &change["status"],
        &Status::ALL,
        Status::name,
        &pointer(&path, "status"),
        "Expected added, removed, modified or unchanged",
    )?;
    let correspondence = choice(
        &change["correspondence"],
        &Correspondence::ALL,
        Correspondence::name,
        &pointer(&path, "correspondence"),
        "Expected exact, declared, split, merge or none",
    )?;
    let summary = optional(change, "summary", &path, name)?;
    let varied = optional(change, "varied", &path, |value, path| {
        Integrity::allow_varied(correspondence, path)?;
        varied(value, path)
    })?
    .unwrap_or_default();
    let before = references(integrity, change, &path, collection, Side::Before)?;
    let after = references(integrity, change, &path, collection, Side::After)?;
    let mut claimed = Change {
        id,
        collection,
        before,
        after,
        status,
        correspondence,
        varied,
        summary,
        context: None,
    };
    if let Some(context) = change_context(change, &path)? {
        integrity.context(&claimed, &context, &pointer(&path, "context"))?;
        claimed.context = Some(context);
    }
    integrity.record(claimed, path)
}

/// A change's `context`, when it has one: each revision's IDs, distinct,
/// nonblank and in UTF-16 order within the bound, and the rules that added
/// to it.
fn change_context(change: &Value, path: &str) -> Result<Option<Context>, Failure> {
    optional(change, "context", path, |value, path| {
        fields(value, &["before", "after", "rules"], path)?;
        let side = |name: &str| -> Result<Vec<String>, Failure> {
            let path = pointer(path, name);
            let members = array(&value[name], &path)?;
            if members.len() > MAX_CONTEXT {
                return Err(fail(
                    "context-limit",
                    &path,
                    &format!("A change has at most {MAX_CONTEXT} context IDs in each revision"),
                ));
            }
            let mut ids: Vec<String> = Vec::with_capacity(members.len());
            for (position, id) in members.iter().enumerate() {
                let member_path = pointer(&path, &position.to_string());
                let id = text(id, &member_path, true)?;
                if ids.last().is_some_and(|last| utf16_cmp(last, id) != std::cmp::Ordering::Less) {
                    return Err(fail("invalid-context", &member_path, "Context IDs are unique and sorted"));
                }
                ids.push(id.to_owned());
            }
            Ok(ids)
        };
        let (before, after) = (side("before")?, side("after")?);
        let rules = optional(value, "rules", path, |rules, path| {
            let names = array(rules, path)?;
            if names.is_empty() {
                return Err(fail("invalid-type", path, "Expected at least one rule; omit rules otherwise"));
            }
            let mut seen = HashSet::new();
            names
                .iter()
                .enumerate()
                .map(|(position, rule)| {
                    let path = pointer(path, &position.to_string());
                    let rule = name(rule, &path)?;
                    if !seen.insert(rule.clone()) {
                        return Err(fail("invalid-context", &path, "Context rules are named once"));
                    }
                    Ok(rule)
                })
                .collect()
        })?
        .unwrap_or_default();
        Ok(Context { before, after, rules })
    })
}

/// The IDs a change references on one side, read and claimed.
fn references(integrity: &mut Integrity, change: &Value, path: &str, collection: Collection, side: Side) -> Result<Vec<String>, Failure> {
    let side_path = pointer(path, side.name());
    let members = ids(&change[side.name()], &side_path)?;
    integrity.reference(collection, side, &members, &side_path)?;
    Ok(members)
}

/// A change's IDs on one side: distinct nonblank strings.
fn ids(value: &Value, path: &str) -> Result<Vec<String>, Failure> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for (position, id) in array(value, path)?.iter().enumerate() {
        let path = pointer(path, &position.to_string());
        let id = text(id, &path, true)?;
        if !seen.insert(id) {
            return Err(fail("duplicate-reference", &path, "Duplicate ID in a change"));
        }
        result.push(id.to_owned());
    }
    Ok(result)
}

/// A change's claimed `varied`: nonempty, sorted unique paths.
fn varied(value: &Value, path: &str) -> Result<Vec<Varied>, Failure> {
    let items = array(value, path)?;
    if items.is_empty() {
        return Err(fail(
            "invalid-type",
            path,
            "Expected at least one varied path; omit varied otherwise",
        ));
    }
    let mut result: Vec<Varied> = Vec::with_capacity(items.len());
    for (position, item) in items.iter().enumerate() {
        let item_path = pointer(path, &position.to_string());
        fields(item, &["path", "within", "reason", "generated", "because"], &item_path)?;
        let varied_path = text(&item["path"], &pointer(&item_path, "path"), true)?;
        let Some(within) = item["within"].as_bool() else {
            return Err(fail("invalid-type", &pointer(&item_path, "within"), "Expected a boolean"));
        };
        let reason = optional(item, "reason", &item_path, name)?;
        if result
            .last()
            .is_some_and(|last| utf16_cmp(&last.path, varied_path) != std::cmp::Ordering::Less)
        {
            return Err(fail(
                "invalid-varied",
                &pointer(&item_path, "path"),
                "Varied paths are unique and sorted",
            ));
        }
        let generated = match item.get("generated") {
            None => false,
            Some(Value::Bool(true)) => true,
            Some(_) => {
                return Err(fail(
                    "invalid-type",
                    &pointer(&item_path, "generated"),
                    "Expected true; omit generated for other volatile values",
                ));
            }
        };
        result.push(Varied {
            path: varied_path.to_owned(),
            within,
            reason,
            generated,
            because: optional(item, "because", &item_path, because)?.unwrap_or_default(),
        });
    }
    Ok(result)
}

/// A generated value's moved basis parts: nonempty, nonblank.
fn because(value: &Value, path: &str) -> Result<Vec<String>, Failure> {
    let parts = array(value, path)?;
    if parts.is_empty() {
        return Err(fail("invalid-type", path, "Expected at least one part; omit because otherwise"));
    }
    parts
        .iter()
        .enumerate()
        .map(|(index, part)| name(part, &pointer(path, &index.to_string())))
        .collect()
}

/// The comparison's `order`: how it plays backwards.
fn order(order: &Value, path: &str) -> Result<Reverse, Failure> {
    fields(order, &["reverse"], path)?;
    match order["reverse"].as_str() {
        Some("mirror") => Ok(Reverse::Mirror),
        Some("explicit") => Ok(Reverse::Explicit),
        _ => Err(fail("invalid-type", &pointer(path, "reverse"), "Expected mirror or explicit")),
    }
}

/// Every change appears in exactly one step, except changes that are only
/// expected variation, which appear in none.
fn steps(integrity: &Integrity, value: &Value, path: &str) -> Result<(), Failure> {
    let mut coverage = integrity.coverage();
    for (position, step) in array(value, path)?.iter().enumerate() {
        let path = pointer(path, &position.to_string());
        fields(step, &["changes", "kind", "summary"], &path)?;
        let members_path = pointer(&path, "changes");
        let members = array(&step["changes"], &members_path)?;
        if members.is_empty() {
            return Err(fail("empty-step", &members_path, "A step must contain at least one change"));
        }
        for (member, id) in members.iter().enumerate() {
            let path = pointer(&members_path, &member.to_string());
            coverage.member(text(id, &path, true)?, &path)?;
        }
        optional(step, "kind", &path, |kind, path| {
            choice(kind, &StepKind::ALL, StepKind::name, path, "Expected remove, restructure or add")
                .map_err(|_| fail("invalid-step", path, "Expected remove, restructure or add"))
        })?;
        optional(step, "summary", &path, name)?;
    }
    coverage.complete(path)
}
