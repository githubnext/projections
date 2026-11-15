use super::paths::Concrete;
use crate::model::{Datum, Fields, lookup};
use crate::utf16_cmp;
use projections_engine_verified::tolerance;

/// How the declarations at one concrete path judge it: as a plain volatile
/// value with an optional tolerance, or as a generated value by the basis at
/// a concrete path. The proved rules are in
/// [`projections_engine_verified::tolerance`].
pub(super) type Rule = tolerance::Rule<Concrete, Concrete>;

/// One declared tolerance as it applies at a concrete path: the spread
/// resolved to a concrete path.
pub(super) type Effective = tolerance::Effective<Concrete>;

/// The tighter of two rules ([`tolerance::Rule::merge`]): symmetric, so it
/// doesn't matter which side, or which declaration, came first.
pub(super) fn merge(earlier: Rule, later: Rule) -> Rule {
    Rule::merge(earlier, later)
}

pub(super) fn spread_value(data: &Fields, path: &Concrete) -> Option<f64> {
    lookup(data, &path.keys).and_then(Datum::as_f64).filter(|value| *value >= 0.0)
}

/// Whether a difference is within a tolerance: within if any declared bound
/// holds, `|after − before| ≤ max(absolute, relative × max(|before|,
/// |after|), factor × √(spread_before² + spread_after²))` over the bounds
/// that can be evaluated. Only numbers have a tolerance.
pub(super) fn judge(tolerance: Option<&Effective>, values: [Option<&Datum>; 2], data: [&Fields; 2]) -> (bool, Option<String>) {
    let Some(tolerance) = tolerance else {
        return (true, None);
    };
    let (Some(before), Some(after)) = (values[0].and_then(Datum::as_f64), values[1].and_then(Datum::as_f64)) else {
        return (false, None);
    };
    // Every spread must hold; one that can't be evaluated holds for none.
    // Spreads are read in path order, so the reason names the same one
    // whichever side declared it.
    let mut spreads: Vec<&(Concrete, f64)> = tolerance.spreads.iter().collect();
    spreads.sort_by(|(a, x), (b, y)| utf16_cmp(&a.pointer, &b.pointer).then(x.total_cmp(y)));
    let mut reason = None;
    let mut scaled = Vec::with_capacity(spreads.len());
    for (path, factor) in spreads {
        match (spread_value(data[0], path), spread_value(data[1], path)) {
            (Some(a), Some(b)) => scaled.push((*factor, (a * a + b * b).sqrt())),
            (a, _) => {
                let side = if a.is_none() { "before" } else { "after" };
                reason = Some(format!("Spread {} is not a finite nonnegative number {side}", path.pointer));
                scaled.clear();
                break;
            }
        }
    }
    let within = tolerance::within(before, after, tolerance.absolute, tolerance.relative, &scaled);
    (within, if within { None } else { reason })
}

#[cfg(test)]
mod tests;
