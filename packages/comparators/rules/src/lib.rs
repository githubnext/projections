//! Rules comparators.
//!
//! A rules file (YAML, see `packages/schemas/schemas/comparator/v0.json` and `docs/design/declarative-comparators.md`)
//! is interpreted over the default comparator. The default comparator's
//! matching core runs the default identity passes and then the file's; the
//! default comparison is the baseline; the file's CEL expressions classify the
//! changes, order them into steps and add metadata. Every expression is checked
//! against declared types when the file loads, and every comparison runs under
//! a deterministic cost budget.
//!
//! The crate builds the rules comparator module, `rules.wasm`: the comparator
//! module ABI with the rules file's text as `options.rules` and its own options
//! as `options.options`, plus `projections_rules_inspect`, which checks a rules
//! file and returns its canonical form, and `projections_rules_cover`, which
//! compares with rule coverage ([`Comparator::with_coverage`]). Editors' language service is a
//! separate module, `rules-editor.wasm` (`projections-rules-editor`), so
//! viewers never download it. The `check`, `macros` and `rules` modules are
//! public for it alone.

#[doc(hidden)]
pub mod check;
mod core;
mod cost;
mod coverage;
mod eval;
mod interpret;
pub mod language;
pub mod library;
#[doc(hidden)]
pub mod macros;
mod module_abi;
#[doc(hidden)]
pub mod rules;
mod steps;
pub mod types;
mod value;
#[cfg(all(target_arch = "wasm32", feature = "abi"))]
mod wasm;
pub use projections_rules_yaml as yaml;

use crate::rules::{Rules, environment};
use cel::Env;
use projections_engine::{Diagnostic, Extraction, Failure, canonical, check_comparison, fail};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub use cost::DEFAULT_BUDGET;
pub use module_abi::{call, cover, inspect};
pub use rules::FORMAT;
pub use yaml::{MAX_BYTES, MAX_DEPTH};

/// Upper bound for one module call's UTF-8 JSON input.
pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;

/// A rules file, read, checked and compiled.
pub struct Comparator {
    env: Arc<Env>,
    rules: Rules,
    canonical: String,
    /// What the comparisons so far covered, when read for coverage.
    coverage: Option<Arc<coverage::Counters>>,
}

/// Reads a rules file's YAML into its JSON value.
pub fn parse(text: &str) -> Result<Value, Failure> {
    yaml::parse(text).map(|document| document.value)
}

/// The rules comparator's digest: `sha256:` over
/// `projections-rules-comparator\n`, the rules comparator module's digest,
/// `\n` and the rules file's canonical form (RFC 8785 JSON of its parsed
/// value), so comments and layout don't change it.
pub fn digest(module_digest: &str, canonical: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"projections-rules-comparator\n");
    hasher.update(module_digest.as_bytes());
    hasher.update(b"\n");
    hasher.update(canonical.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

impl Comparator {
    /// Reads, checks and compiles a rules file.
    pub fn from_yaml(text: &str) -> Result<Self, Failure> {
        Comparator::from_document(&yaml::parse(text)?, false)
    }

    /// Reads a rules file for coverage: every comparison counts the
    /// functions, expressions and branches it runs, and [`Comparator::coverage`]
    /// reports them. Comparisons are the same as [`Comparator::from_yaml`]'s,
    /// at the same cost.
    pub fn with_coverage(text: &str) -> Result<Self, Failure> {
        Comparator::from_document(&yaml::parse(text)?, true)
    }

    /// The coverage of every comparison so far (`projections.rules-coverage`),
    /// when read [`Comparator::with_coverage`].
    pub fn coverage(&self) -> Option<Value> {
        self.coverage.as_ref().map(|counters| counters.to_json())
    }

    /// Checks and compiles parsed rules (errors then have no line numbers).
    pub fn new(rules: &Value) -> Result<Self, Failure> {
        Comparator::from_document(
            &yaml::Document {
                value: rules.clone(),
                ..Default::default()
            },
            false,
        )
    }

    fn from_document(document: &yaml::Document, coverage: bool) -> Result<Self, Failure> {
        let env = environment();
        let mut rules = if coverage {
            Rules::parse_for_coverage(document, &env)?
        } else {
            Rules::parse(document, &env)?
        };
        let (diagnostics, warnings) = check::check(&rules);
        if !diagnostics.is_empty() {
            return Err(diagnostics);
        }
        rules.warnings.extend(warnings);
        Ok(Comparator {
            env,
            coverage: rules.coverage.take().map(coverage::Counters::new),
            rules,
            canonical: canonical(&document.value)?,
        })
    }

    /// The rules file's canonical form, which its digest covers.
    pub fn canonical(&self) -> &str {
        &self.canonical
    }

    /// Lint warnings: the rules load and run, but should change (a long
    /// conditional chain, a `match` that doesn't fit its subject's declared
    /// values).
    pub fn warnings(&self) -> &[Diagnostic] {
        &self.rules.warnings
    }

    /// How many chains of two or more conditionals the rules have as written,
    /// for audits.
    pub fn conditional_chains(&self) -> usize {
        self.rules.chains
    }

    /// Compares two extractions under the default cost budget. Both are
    /// validated and normalized first, and the result is checked by the
    /// Engine before it is returned.
    pub fn compare(&self, before: &Value, after: &Value, options: &Value) -> Result<Value, Failure> {
        self.compare_with(before, after, options, DEFAULT_BUDGET)
            .map(|(comparison, _)| comparison)
    }

    /// Compares under `budget` cost units, returning the comparison and the
    /// units it spent.
    pub fn compare_with(&self, before: &Value, after: &Value, options: &Value, budget: u64) -> Result<(Value, u64), Failure> {
        let before = Extraction::from_json(before, "/before")?;
        let after = Extraction::from_json(after, "/after")?;
        let (comparison, cost) = self.compare_normalized(&before, &after, options, budget)?;
        check_comparison(&before, &after, &comparison)?;
        Ok((comparison, cost))
    }

    /// Compares two extractions the Engine has read, without validating the
    /// result (the host does).
    pub fn compare_normalized(
        &self,
        before: &Extraction,
        after: &Extraction,
        options: &Value,
        budget: u64,
    ) -> Result<(Value, u64), Failure> {
        if before.schema() != after.schema() {
            return Err(fail(
                "schema-mismatch",
                "/after/schema",
                "Comparisons require the same domain schema",
            ));
        }
        if !options.is_object() {
            return Err(fail("invalid-options", "/options", "Expected an object"));
        }
        let meter = cost::Meter::new(budget);
        match self.run([before, after], options, meter.clone()) {
            Err(failure) if meter.exceeded() => Err(fail(
                "cost-limit",
                &failure[0].path,
                &format!("The rules exceeded their cost budget of {budget} units; {}", failure[0].message),
            )),
            result => Ok((result?, meter.used())),
        }
    }
}

/// Compares with a rules file's text.
pub fn compare(rules: &str, before: &Value, after: &Value, options: &Value) -> Result<Value, Failure> {
    Comparator::from_yaml(rules)?.compare(before, after, options)
}
