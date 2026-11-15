//! The steps measuring whether an extraction reproduces: a rerun of the
//! working tree, an extraction from the declared scope alone, and CI's
//! extraction of the same commit.

use super::{failed, step};
use crate::runtime::Runner;
use serde_json::{Value, json};

/// Determinism, measured like flaky tests: the working tree extracted again,
/// with nothing reused, compared with the first run. A difference warns
/// (fails with `--strict-determinism`), naming what varied; an `observed`
/// extraction varies by design and isn't rerun.
pub(super) fn determinism_step(runner: &Runner, id: &str, definition: &Value, first: &Value, strict: bool) -> Value {
    const TITLE: &str = "Determinism";
    let class = crate::runtime::determinism(definition);
    if class == projections_extractor_sdk::Determinism::Observed {
        return step(
            "determinism",
            TITLE,
            "skip",
            "Declared observed: each run is an observation, so it isn't rerun",
        );
    }
    let rerun = match runner.uncached().show(id, "working-tree", None) {
        Ok(document) => document,
        Err(error) => return failed("determinism", TITLE, &error),
    };
    let suspicious = suspicious(class, first);
    let status = if suspicious.is_empty() { "pass" } else { "warn" };
    if rerun["digest"] == first["digest"] {
        return step(
            "determinism",
            TITLE,
            status,
            format!("A rerun matched ({} extraction).{suspicious}", class.as_str()),
        );
    }
    let variation = match crate::determinism::variation(first, &rerun) {
        Ok(variation) => variation,
        Err(error) => return failed("determinism", TITLE, &error),
    };
    if variation.reproducible() {
        let reuse = regenerated(variation.regenerated);
        return step(
            "determinism",
            TITLE,
            status,
            format!(
                "A rerun differed only within the declared volatile fields' tolerances, on {} ({} extraction).{reuse}{suspicious}",
                variation.within.join(", "),
                class.as_str()
            ),
        );
    }
    step(
        "determinism",
        TITLE,
        if strict { "fail" } else { "warn" },
        format!(
            "Two runs of the working tree differ ({} extraction), on {:.0}% of items: {}. Make the extractor deterministic (sort its output, drop timings), mark varying data volatile, or declare execution.determinism observed",
            class.as_str(),
            variation.percent(),
            variation.describe(5)
        ),
    )
}

/// A pure extractor's output is a function of the files; declaring varying
/// fields contradicts that, though it isn't invalid.
fn suspicious(class: projections_extractor_sdk::Determinism, first: &Value) -> &'static str {
    if class != projections_extractor_sdk::Determinism::Pure {
        ""
    } else if crate::determinism::generates(first) {
        " It is declared pure but produces generated values: a pure extraction is cached by its files alone and a rerun must match, which generating can't promise; declare it environmental."
    } else if crate::determinism::declares_volatile(first) {
        " It is declared pure but marks fields volatile: a pure extraction shouldn't vary; declare it environmental or observed if it does."
    } else {
        ""
    }
}

/// The advice for generated values a reproducible rerun regenerated.
fn regenerated(count: usize) -> String {
    match count {
        0 => String::new(),
        count => format!(
            " {count} generated {} regenerated from the same inputs. Reuse {} through the generation store (the extractor helpers' generations()) for identical reruns.",
            if count == 1 { "value was" } else { "values were" },
            if count == 1 { "it" } else { "them" },
        ),
    }
}

/// A declared scope, verified: the working tree extracted from the scope
/// alone matches the full extraction. Verified, cache keys may use the scope;
/// otherwise a warning says the extractor reads outside it.
pub(super) fn scope_step(runner: &Runner, id: &str) -> Option<Value> {
    const TITLE: &str = "Scope";
    match runner.verify_scope(id) {
        Ok(None) => None,
        Ok(Some((scope, variation))) if variation.reproducible() => Some(step(
            "scope",
            TITLE,
            "pass",
            format!(
                "Verified: extracting only {} gives the same extraction, so edits elsewhere never invalidate it",
                scope.join(", ")
            ),
        )),
        Ok(Some((scope, variation))) => Some(step(
            "scope",
            TITLE,
            "warn",
            format!(
                "Extracting only {} differs on {:.0}% of items ({}): the extractor reads outside its scope. Widen execution.scope (in a nested project, `../` paths reach outside it) or remove it",
                scope.join(", "),
                variation.percent(),
                variation.describe(5)
            ),
        )),
        Err(error) => {
            let mut value = failed("scope", TITLE, &error);
            value["status"] = json!("warn");
            value["message"] = json!(format!(
                "Extracting only the scope failed, so the extractor reads outside it: {}",
                value["message"].as_str().unwrap_or_default()
            ));
            Some(value)
        }
    }
}

/// A custom extractor reads the examined revision only through
/// `repository.root`: run from a copy holding only the definition's own files,
/// it gives the same extraction. Otherwise a warning says it reads other files
/// from its working directory, which a comparison takes from the revision that
/// supplied the definition, on both sides.
pub(super) fn own_files_step(runner: &Runner, id: &str, first: &Value) -> Option<Value> {
    const TITLE: &str = "Reads through repository.root";
    const ADVICE: &str = "In a comparison the working directory is the definition's revision on both sides, so those files never show a change. Read the examined revision through request.repository.root (installed dependencies through request.repository.checkout), and list the extractor's own files in extractor.sources";
    let held = |own: &[String]| {
        if own.is_empty() {
            "none of its files".to_owned()
        } else {
            own.join(", ")
        }
    };
    let (own, variation) = match runner.verify_own_files(id, first) {
        Ok(None) => return None,
        Ok(Some(verified)) => verified,
        Err(error) => {
            let mut value = failed("own-files", TITLE, &error);
            value["status"] = json!("warn");
            return Some(value);
        }
    };
    Some(match variation {
        Ok(variation) if variation.reproducible() => step(
            "own-files",
            TITLE,
            "pass",
            format!(
                "Verified: run from a copy holding only the definition's own files ({}), the extractor gives the same extraction",
                held(&own)
            ),
        ),
        Ok(variation) => step(
            "own-files",
            TITLE,
            "warn",
            format!(
                "Run from a copy holding only the definition's own files ({}), the extraction differs on {:.0}% of items ({}): the extractor reads other files relative to its working directory or its own location. {ADVICE}",
                held(&own),
                variation.percent(),
                variation.describe(5)
            ),
        ),
        Err(error) => {
            let mut value = failed("own-files", TITLE, &error);
            value["status"] = json!("warn");
            value["message"] = json!(format!(
                "Run from a copy holding only the definition's own files ({}), the extractor failed, so it reads other files relative to its working directory or its own location: {}. {ADVICE}",
                held(&own),
                value["message"].as_str().unwrap_or_default()
            ));
            value
        }
    })
}

/// `--parity REV`: whether a local extraction of the commit matches CI's.
pub(super) fn parity_step(runner: &Runner, id: &str, reference: &str) -> Value {
    const TITLE: &str = "Parity with CI";
    match runner.parity(id, reference) {
        Ok(None) => step(
            "parity",
            TITLE,
            "skip",
            format!(
                "No CI artifact holds {} with this definition; pass --ci or --artifact DIR",
                crate::runtime::short(reference)
            ),
        ),
        Ok(Some((local, ci))) => compared_with_ci(&local, &ci),
        Err(error) => failed("parity", TITLE, &error),
    }
}

fn compared_with_ci(local: &Value, ci: &Value) -> Value {
    const TITLE: &str = "Parity with CI";
    let run = &ci["provenance"]["execution"]["ci"];
    let source = format!("CI run {} of {}", run["run"], run["repository"].as_str().unwrap_or("?"));
    if local["digest"] == ci["digest"] {
        return step("parity", TITLE, "pass", format!("Matches {source}"));
    }
    // A measurement of stability across environments, not an error.
    match crate::determinism::variation(local, ci) {
        Err(error) => failed("parity", TITLE, &error),
        Ok(variation) if variation.reproducible() => step(
            "parity",
            TITLE,
            "pass",
            format!("Matches {source} within the declared volatile fields' tolerances"),
        ),
        Ok(variation) => step(
            "parity",
            TITLE,
            "warn",
            format!(
                "Varies between this environment and {source} on {:.0}% of items ({}): the toolchain, dependencies or granted variables differ",
                variation.percent(),
                variation.describe(5)
            ),
        ),
    }
}
