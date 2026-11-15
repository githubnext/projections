//! Evidence for the IEEE 754 facts the tolerance proofs assume
//! (`projections_engine_verified::tolerance`): loosening the relative bound
//! or a spread's factor keeps within within, which rests on multiplication
//! rounding monotonically, and the smaller of two bounds is one of them, over
//! random values across the whole finite range.

use projections_engine_verified::tolerance::within;
use proptest::prelude::*;

fn finite() -> impl Strategy<Value = f64> {
    prop_oneof![any::<f64>().prop_filter("finite", |value| value.is_finite()), -1e6..1e6f64]
}

fn bound() -> impl Strategy<Value = f64> {
    prop_oneof![
        any::<f64>().prop_filter("finite, nonnegative", |value| value.is_finite() && *value >= 0.0),
        0.0..2.0f64
    ]
}

fn scale() -> impl Strategy<Value = f64> {
    prop_oneof![bound(), Just(f64::INFINITY)]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 4096, failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn loosening_the_relative_bound_keeps_within_within(before in finite(), after in finite(), bounds in (bound(), bound())) {
        let (tight, loose) = if bounds.0 <= bounds.1 { bounds } else { (bounds.1, bounds.0) };
        prop_assert!(!within(before, after, None, Some(tight), &[]) || within(before, after, None, Some(loose), &[]));
    }

    #[test]
    fn raising_a_spread_factor_keeps_within_within(before in finite(), after in finite(), factors in (bound(), bound()), scale in scale()) {
        let (tight, loose) = if factors.0 <= factors.1 { factors } else { (factors.1, factors.0) };
        prop_assert!(!within(before, after, None, None, &[(tight, scale)]) || within(before, after, None, None, &[(loose, scale)]));
    }

    #[test]
    fn the_smaller_of_two_bounds_is_one_of_them_and_at_most_each(bounds in (bound(), bound())) {
        let least = bounds.0.min(bounds.1);
        prop_assert!(least == bounds.0 || least == bounds.1);
        prop_assert!(least <= bounds.0 && least <= bounds.1);
    }
}
