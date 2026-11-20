//! Comparing extractions with the default or a custom comparator, and
//! validating comparison documents.

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use super::{byte_sha256, extraction::sha256_digest, fields, validate_extraction};
use projections_engine::Pairing;

/// The default comparator module embedded in this executable, loaded once. It
/// runs in the comparator runtime, sandboxed with the same limits as rules.
fn default_module() -> Result<&'static projections_comparator_runtime::ComparatorModule> {
    static MODULE: std::sync::OnceLock<Result<projections_comparator_runtime::ComparatorModule, String>> = std::sync::OnceLock::new();
    MODULE
        .get_or_init(|| {
            let bytes = crate::assets::default_comparator_module().ok_or_else(|| {
                "The default comparator module is not embedded in this build; build packages/comparators/default (npm run build) first"
                    .to_owned()
            })?;
            projections_comparator_runtime::ComparatorModule::load(bytes)
                .map_err(|error| format!("The embedded default comparator module is invalid ({}): {error}", error.code()))
        })
        .as_ref()
        .map_err(|message| anyhow::anyhow!("{message}"))
}

/// The default comparator's identity: its module digest. Viewers rerun the same
/// module to verify a comparison.
pub fn default_comparator() -> Result<Value> {
    Ok(json!({"id": DEFAULT_COMPARATOR, "digest": default_module()?.digest()}))
}

/// The comparator ID recorded for the default comparator.
pub const DEFAULT_COMPARATOR: &str = "default";

/// The custom comparator a definition names, if any: its comparator file's
/// path, from either form (`"comparator": "<path>"` or `{"file": "<path>"}`).
pub fn custom_comparator(definition: &Value) -> Option<&str> {
    let comparator = &definition["comparator"];
    comparator.as_str().or_else(|| comparator["file"].as_str())
}

/// The rules comparator module embedded in this executable, compiled once.
fn rules_interpreter() -> Result<projections_comparator_runtime::ComparatorModule> {
    use projections_comparator_runtime::ComparatorModule;
    static INTERPRETER: std::sync::OnceLock<std::result::Result<ComparatorModule, String>> = std::sync::OnceLock::new();
    INTERPRETER
        .get_or_init(|| {
            let bytes = crate::assets::rules_comparator_module().ok_or_else(|| {
                "The rules comparator module is not embedded in this build; build packages/comparators/rules (npm run build) first"
                    .to_owned()
            })?;
            ComparatorModule::load(bytes).map_err(|error| format!("The embedded rules comparator module is invalid: {error}"))
        })
        .clone()
        .map_err(|error| anyhow::anyhow!(error))
}

/// Loads a custom comparator: a comparator file, run by the embedded rules
/// interpreter module. Each comparator file is checked once per content and cached.
pub fn load_comparator(path: &str, bytes: &[u8]) -> Result<projections_comparator_runtime::ComparatorModule> {
    use projections_comparator_runtime::ComparatorModule;
    type Checked = std::collections::HashMap<String, ComparatorModule>;
    static CHECKED: std::sync::Mutex<Option<Checked>> = std::sync::Mutex::new(None);
    let key = byte_sha256(bytes);
    if let Some(checked) = CHECKED.lock().ok().and_then(|cache| cache.as_ref()?.get(&key).cloned()) {
        return Ok(checked);
    }
    let checked = ComparatorModule::rules(&rules_interpreter()?, bytes)
        .map_err(|error| anyhow::anyhow!("Comparator file {path} is invalid ({}): {error}", error.code()))?;
    if let Ok(mut cache) = CHECKED.lock() {
        let cache = cache.get_or_insert_with(Checked::new);
        // A long-running Inspector sees each edit of a comparator file; keep the cache bounded.
        if cache.len() >= 64 {
            cache.clear();
        }
        cache.insert(key, checked.clone());
    }
    Ok(checked)
}

/// The comparison the default comparator module produces with `options`, run
/// in the comparator runtime and validated by the Engine. The default
/// comparator produces the baseline, so it gets an empty one.
pub fn default_comparison(before: &Value, after: &Value, options: &Value) -> Result<Value> {
    use projections_comparator_runtime::Limits;
    let input = json!({"protocolVersion": 0, "before": before, "after": after,
        "baseline": {}, "options": options});
    let comparison = default_module()?
        .compare(&input, &Limits::default())
        .map_err(|error| anyhow::anyhow!("Default comparator failed ({}): {error}", error.code()))?;
    projections_engine::validate_comparison(before, after, &comparison).map_err(|failure| {
        anyhow::anyhow!(
            "Default comparator produced an invalid comparison: {}",
            failure.iter().map(ToString::to_string).collect::<Vec<_>>().join("; ")
        )
    })
}

/// Checks default comparator options the way the module does: by running it on
/// two empty extractions, which rejects invalid options before comparing anything.
pub fn default_comparator_options(options: &Value) -> Result<()> {
    let empty = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []});
    default_comparison(&empty, &empty, options)
        .map(|_| ())
        .context("comparator.options are invalid for the default comparator")
}

/// Runs a custom comparator, a comparator file, on two normalized extractions and
/// validates its result with the Engine. Any failure is explicit; the baseline
/// is never substituted for failed rules.
pub fn run_custom_comparator(path: &str, rules: &[u8], before: &Value, after: &Value, options: &Value) -> Result<(Value, Value)> {
    run_comparator_file(path, path, rules, before, after, options)
}

/// [`run_custom_comparator`] for the definition's comparator `path` with the
/// rules read from `file`, which its diagnostics name.
fn run_comparator_file(path: &str, file: &str, rules: &[u8], before: &Value, after: &Value, options: &Value) -> Result<(Value, Value)> {
    use projections_comparator_runtime::Limits;
    let loaded = load_comparator(file, rules)?;
    // The rules interpreter computes the default baseline itself, natively.
    let input = json!({"protocolVersion": 0, "before": before, "after": after,
        "baseline": {"protocolVersion": 0, "changes": [], "steps": []}, "options": options});
    let comparison = loaded
        .compare(&input, &Limits::rules())
        .map_err(|error| anyhow::anyhow!("Comparator {file} failed ({}): {error}", error.code()))?;
    let comparison = projections_engine::validate_comparison(before, after, &comparison).map_err(|failure| {
        anyhow::anyhow!(
            "Comparator {file} produced an invalid comparison: {}",
            failure.iter().map(ToString::to_string).collect::<Vec<_>>().join("; ")
        )
    })?;
    Ok((comparison, json!({"id": path, "digest": loaded.digest()})))
}

/// [`run_custom_comparator`] with rule coverage: the validated comparison,
/// or why there is none, and the `projections.rules-coverage` report of what
/// the rules ran, which a failed comparison has too.
pub fn run_custom_comparator_with_coverage(
    path: &str,
    rules: &[u8],
    before: &Value,
    after: &Value,
    options: &Value,
) -> (Result<Value>, Option<Value>) {
    use projections_comparator_runtime::Limits;
    let loaded = match load_comparator(path, rules) {
        Ok(loaded) => loaded,
        Err(error) => return (Err(error), None),
    };
    let input = json!({"protocolVersion": 0, "before": before, "after": after,
        "baseline": {"protocolVersion": 0, "changes": [], "steps": []}, "options": options});
    let (comparison, coverage) = loaded.compare_with_coverage(&input, &Limits::rules());
    let comparison = comparison
        .map_err(|error| anyhow::anyhow!("Comparator {path} failed ({}): {error}", error.code()))
        .and_then(|comparison| {
            projections_engine::validate_comparison(before, after, &comparison).map_err(|failure| {
                anyhow::anyhow!(
                    "Comparator {path} produced an invalid comparison: {}",
                    failure.iter().map(ToString::to_string).collect::<Vec<_>>().join("; ")
                )
            })
        });
    (comparison, coverage)
}

/// Explains why two extractions can't be compared, or `None` when they can:
/// the engine pairs them ([`projections_engine::pairing`]), and they must share
/// one domain schema.
pub fn pairing_mismatch(before: &Value, after: &Value) -> Option<String> {
    let (old, new) = (&before["provenance"], &after["provenance"]);
    let differ = |why: String| {
        Some(format!(
            "Compared extractions come from different projection definitions ({} and {}): {why}. Extract both revisions with one definition",
            old["definitionDigest"], new["definitionDigest"],
        ))
    };
    match projections_engine::pairing(before, after) {
        Err(failure) => return Some(format!("Compared extractions can't be paired: {}", failure[0])),
        Ok(Pairing::Same) => {}
        Ok(Pairing::Projection) => {
            return Some(format!(
                "Compared extractions come from different projections ({} and {})",
                before["projection"]["id"], after["projection"]["id"]
            ));
        }
        Ok(Pairing::Definition(differing)) => {
            return differ(format!("the projection definition itself differs ({})", differing.join(", ")));
        }
        Ok(Pairing::Components) => return differ("the definition's declared component sources differ".into()),
    }
    if before["extraction"]["schema"] != after["extraction"]["schema"] {
        return Some("Compared extractions must share one domain schema".into());
    }
    None
}

/// Compares two saved extractions of one projection definition with its
/// default comparator.
pub fn compare_extractions(before: &Value, after: &Value) -> Result<Value> {
    compare_extractions_with(before, after, None)
}

/// Compares two saved extractions of one projection definition with its
/// comparator. A custom comparator's comparator file must be supplied; it comes
/// from the definition's revision.
pub fn compare_extractions_with(before: &Value, after: &Value, rules: Option<&[u8]>) -> Result<Value> {
    compare_extractions_from(before, after, rules, None)
}

/// [`compare_extractions_with`], the custom comparator's rules read from
/// `file` (`--comparator FILE`), which its diagnostics name, rather than from
/// the definition's comparator path.
pub fn compare_extractions_from(before: &Value, after: &Value, rules: Option<&[u8]>, file: Option<&str>) -> Result<Value> {
    let before = validate_extraction(before)?;
    let after = validate_extraction(after)?;
    if let Some(mismatch) = pairing_mismatch(&before, &after) {
        bail!("{mismatch}");
    }
    let definition = &before["provenance"]["definition"];
    let options = definition["comparator"].get("options").cloned().unwrap_or_else(|| json!({}));
    let (comparison, comparator) = match custom_comparator(definition) {
        Some(path) => {
            let rules = rules.with_context(|| {
                format!(
                    "Projection {} uses the custom comparator {path}; supply that file from the definition's revision (--comparator FILE)",
                    before["projection"]["id"]
                )
            })?;
            run_comparator_file(
                path,
                file.unwrap_or(path),
                rules,
                &before["extraction"],
                &after["extraction"],
                &options,
            )?
        }
        None => {
            ensure!(
                rules.is_none(),
                "Projection {} uses the default comparator; a custom comparator was supplied unnecessarily",
                before["projection"]["id"]
            );
            (
                default_comparison(&before["extraction"], &after["extraction"], &options)?,
                default_comparator()?,
            )
        }
    };
    let notices = missing_input_notices(&before, &after);
    let mut document = json!({
        "format": "projections.comparison", "version": 0,
        "before": before, "after": after, "comparison": comparison,
        "comparator": comparator,
    });
    set_notices(&mut document, &notices);
    Ok(document)
}

/// A comparison document's notices.
pub fn notices(document: &Value) -> Vec<String> {
    document["notices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

fn json_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => left.as_f64() == right.as_f64(),
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len() && left.iter().zip(right).all(|(left, right)| json_equal(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .all(|(key, left)| right.get(key).is_some_and(|right| json_equal(left, right)))
        }
        _ => left == right,
    }
}

/// At most this many missing inputs are named in a notice.
const MAX_NAMED_INPUTS: usize = 5;

/// The declared inputs an extraction document records as missing at its revision.
pub fn missing_inputs(document: &Value) -> Vec<String> {
    document["extraction"]["missingInputs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

/// How notices name an extraction's revision: `the working tree`, or the
/// commit's first eight hex digits as code.
pub fn revision_name(document: &Value) -> String {
    let revision = &document["provenance"]["revision"];
    if revision["kind"] == "working-tree" {
        return "the working tree".into();
    }
    let commit = revision["commit"].as_str().unwrap_or_default();
    crate::runtime::code(&commit[..commit.len().min(8)])
}

/// `paths` as code spans in a sentence: `` `a` ``, `` `a` and `b` ``, `` `a`, `b` and `c` ``,
/// and how many more past [`MAX_NAMED_INPUTS`]; with the verb agreeing.
fn named_inputs(paths: &[String]) -> (String, &'static str, &'static str) {
    let mut named: Vec<String> = paths.iter().take(MAX_NAMED_INPUTS).map(|path| crate::runtime::code(path)).collect();
    if paths.len() > MAX_NAMED_INPUTS {
        named.push(format!("{} more", paths.len() - MAX_NAMED_INPUTS));
    }
    let text = match named.split_last() {
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
        None => String::new(),
    };
    if paths.len() == 1 {
        (text, "doesn't", "its")
    } else {
        (text, "don't", "their")
    }
}

/// Notices for the declared inputs either side of a comparison lacks: missing
/// before, their contents show as added; missing after, as removed.
pub fn missing_input_notices(before: &Value, after: &Value) -> Vec<String> {
    let (missing_before, missing_after) = (missing_inputs(before), missing_inputs(after));
    let both: Vec<String> = missing_before.iter().filter(|path| missing_after.contains(path)).cloned().collect();
    let only = |paths: &[String]| -> Vec<String> { paths.iter().filter(|path| !both.contains(path)).cloned().collect() };
    let mut notices = vec![];
    for (paths, side, shown) in [(only(&missing_before), before, "added"), (only(&missing_after), after, "removed")] {
        if !paths.is_empty() {
            let (named, verb, pronoun) = named_inputs(&paths);
            notices.push(format!(
                "{named} {verb} exist at {}, so {pronoun} contents show as {shown}.",
                revision_name(side)
            ));
        }
    }
    if !both.is_empty() {
        let (named, verb, _) = named_inputs(&both);
        notices.push(format!(
            "{named} {verb} exist at {} or {}, so there is nothing of {} to compare.",
            revision_name(before),
            revision_name(after),
            if both.len() == 1 { "it" } else { "them" }
        ));
    }
    notices
}

/// The notice for an extraction whose revision lacks declared inputs: when it
/// has nothing to show, that the projection has nothing to show there.
pub fn missing_input_notice(document: &Value) -> Option<String> {
    let missing = missing_inputs(document);
    if missing.is_empty() {
        return None;
    }
    let (named, verb, pronoun) = named_inputs(&missing);
    let revision = revision_name(document);
    let empty = document["extraction"]["entities"].as_array().is_none_or(Vec::is_empty);
    Some(if empty {
        format!(
            "Projection {} has nothing to show at {revision}: {named} {verb} exist there.",
            crate::runtime::code(document["projection"]["id"].as_str().unwrap_or_default())
        )
    } else {
        format!("{named} {verb} exist at {revision}, so {pronoun} contents aren't shown.")
    })
}

/// At most this many notices accompany a comparison.
pub const MAX_NOTICES: usize = 20;

/// Records how the compared revisions define the projection differently on a
/// comparison document. Notices are informational; an empty list is omitted.
pub fn set_notices(document: &mut Value, notices: &[String]) {
    if notices.is_empty() {
        if let Some(object) = document.as_object_mut() {
            object.remove("notices");
        }
    } else {
        document["notices"] = json!(notices);
    }
}

/// A saved comparison's optional notices: at most `MAX_NOTICES` nonempty strings.
fn comparison_notices(value: &Value) -> Result<Vec<String>> {
    let Some(notices) = value.get("notices") else {
        return Ok(Vec::new());
    };
    let notices = notices.as_array().context("Comparison notices must be an array")?;
    ensure!(notices.len() <= MAX_NOTICES, "Comparison has more than {MAX_NOTICES} notices");
    notices
        .iter()
        .map(|notice| {
            let notice = notice
                .as_str()
                .filter(|text| !text.trim().is_empty() && text.chars().count() <= 4096)
                .context("Comparison notices must be nonempty strings of at most 4096 characters")?;
            Ok(notice.to_owned())
        })
        .collect()
}

/// Validates a saved comparison by rerunning its comparator, never trusting its claims.
pub fn validate_comparison(value: &Value) -> Result<Value> {
    validate_comparison_with(value, None)
}

/// Validates a saved comparison. The default comparator, and a custom
/// comparator whose comparator file is supplied, are rerun and must reproduce it.
/// Without the rules, a custom comparison is still checked by the Engine
/// against both extractions, so it can't hide or invent changes, but its order
/// and summaries can't be reproduced. Notices are informational and kept as
/// they are.
pub fn validate_comparison_with(value: &Value, rules: Option<&[u8]>) -> Result<Value> {
    fields(
        value,
        &["format", "version", "before", "after", "comparison", "comparator", "notices"],
        "Comparison",
    )?;
    ensure!(
        value["format"] == "projections.comparison" && value["version"].as_f64() == Some(0.0),
        "Unsupported comparison format/version"
    );
    fields(&value["comparator"], &["id", "digest"], "comparator")?;
    let notices = comparison_notices(value)?;
    let custom = custom_comparator(&value["before"]["provenance"]["definition"]);
    if let (Some(path), None) = (custom, rules) {
        let before = validate_extraction(&value["before"])?;
        let after = validate_extraction(&value["after"])?;
        if let Some(mismatch) = pairing_mismatch(&before, &after) {
            bail!("{mismatch}");
        }
        ensure!(
            value["comparator"]["id"] == path,
            "Comparison names comparator {} but its definition uses {path}",
            value["comparator"]["id"]
        );
        sha256_digest(&value["comparator"]["digest"], "comparator.digest")?;
        let comparison = projections_engine::validate_comparison(&before["extraction"], &after["extraction"], &value["comparison"])
            .map_err(|failure| {
                anyhow::anyhow!(
                    "Comparison is inconsistent with its extractions: {}",
                    failure.iter().map(ToString::to_string).collect::<Vec<_>>().join("; ")
                )
            })?;
        let mut validated = json!({
            "format": "projections.comparison", "version": 0,
            "before": before, "after": after, "comparison": comparison,
            "comparator": value["comparator"],
        });
        set_notices(&mut validated, &notices);
        return Ok(validated);
    }
    let mut comparison = compare_extractions_with(&value["before"], &value["after"], rules)?;
    ensure!(
        value["comparator"] == comparison["comparator"],
        "Comparison was produced by a different comparator ({}); compare the extractions again",
        value["comparator"]
    );
    ensure!(
        json_equal(&value["comparison"], &comparison["comparison"]),
        "Comparison does not match the comparator result"
    );
    set_notices(&mut comparison, &notices);
    Ok(comparison)
}
