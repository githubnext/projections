//! The default comparator: a pure function from two extractions and options to
//! a comparison. It matches exact IDs, then explicit identity claims, classifies
//! each change and orders the changes for presentation. The same code runs
//! natively and as a zero-import WebAssembly comparator module.
//!
//! The comparator works on the Engine's typed model; [`json`] is its JSON
//! boundary.

mod json;
pub mod matching;
mod options;
mod order;
#[cfg(all(target_arch = "wasm32", feature = "abi"))]
mod wasm;

use projections_engine::{Comparison, Extraction, Failure, Reverse, Step, fail};

pub use json::{call, compare};
pub use options::{Options, OrderBy};

/// The comparator identifier recorded in comparison documents.
pub const ID: &str = "default";
/// Upper bound for one module call's UTF-8 JSON input.
pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;

/// The comparison of two extractions under `options`, before the Engine
/// checks it.
fn plan(before: &Extraction, after: &Extraction, options: &Options) -> Result<Comparison, Failure> {
    let (matched, steps) = plan_steps(before, after, options)?;
    Ok(to_comparison(&matched.changes, steps))
}

/// Correspondence, status and order for two extractions.
fn plan_steps(before: &Extraction, after: &Extraction, options: &Options) -> Result<(matching::Matched, Vec<Step>), Failure> {
    if before.schema() != after.schema() {
        return Err(fail(
            "schema-mismatch",
            "/after/schema",
            "Comparisons require the same domain schema",
        ));
    }
    let matched = matching::match_extractions(before, after, &matching::DEFAULT_PASSES)?;
    let steps = order::steps(before, after, &matched, options);
    Ok((matched, steps))
}

/// The default comparison of two extractions, with default options and
/// without the Engine's check: the baseline comparators built on this one
/// start from.
pub fn baseline(before: &Extraction, after: &Extraction) -> Result<Comparison, Failure> {
    plan(before, after, &Options::default())
}

/// The baseline as its matching and steps, before either is assembled.
pub fn baseline_plan(before: &Extraction, after: &Extraction) -> Result<(matching::Matched, Vec<Step>), Failure> {
    plan_steps(before, after, &Options::default())
}

/// The comparison of a matching and its steps, with its variation summary
/// when a change has `varied`.
pub fn to_comparison(changes: &[matching::Change], steps: Vec<Step>) -> Comparison {
    let changes: Vec<projections_engine::Change> = changes.iter().map(matching::Change::to_change).collect();
    Comparison {
        variation: projections_engine::volatility::variation(&changes),
        changes,
        steps,
        order: Some(Reverse::Mirror),
        reverse_steps: None,
        metadata: None,
    }
}
