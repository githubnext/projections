//! Tolerance decisions: whether a difference between two numbers is expected
//! variation, and the tolerance that applies where both sides declare one.
//!
//! [`within`] holds when any declared bound holds, a list of spreads holding
//! when every one does; Verus proves that this is all it does, so declaring
//! one more bound or loosening one never turns a difference within tolerance
//! into one beyond it ([`loosening_keeps_within`]). Where several
//! declarations apply, [`tighter`] and [`Rule::merge`] combine them: Verus
//! proves the combination accepts a difference exactly when both would by
//! the same kind of bound, so it is never looser than either and does not
//! depend on which side, or which declaration, came first
//! ([`tighter_accepts`], [`merge_is_symmetric`]). That is what makes a
//! reversed comparison judge each value the same way.
//!
//! Floating point is the trusted boundary. vstd leaves `f64` arithmetic
//! uninterpreted, so each operation here is a one-line wrapper whose result is
//! named by a specification function, and the four facts of IEEE 754 the
//! proofs use are stated as axioms: `<=` is transitive; `min` of two
//! nonnegative numbers is one of them, nonnegative and at most each; and
//! scaling by a nonnegative number preserves order (multiplication rounds
//! monotonically).

// Derived Clone has no Verus specification here; nothing proved clones.
#![cfg_attr(verus_keep_ghost, verifier::allow(autoderive_clone_without_spec))]

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;

use alloc::vec::Vec;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;

verus! {

/// IEEE 754 `a <= b`: false when either is NaN.
pub uninterp spec fn at_most(a: f64, b: f64) -> bool;
/// IEEE 754 `a * b`, rounded.
pub uninterp spec fn times(a: f64, b: f64) -> f64;
/// IEEE 754 `a.min(b)`.
pub uninterp spec fn least(a: f64, b: f64) -> f64;
/// `|after - before|`, rounded.
pub uninterp spec fn difference(before: f64, after: f64) -> f64;
/// `max(|before|, |after|)`.
pub uninterp spec fn magnitude(before: f64, after: f64) -> f64;
/// A number validation admits as a bound or factor: finite and `>= 0`.
pub uninterp spec fn nonnegative(a: f64) -> bool;

#[verifier::external_body]
fn le(a: f64, b: f64) -> (r: bool)
    ensures r == at_most(a, b),
{
    a <= b
}

#[verifier::external_body]
fn mul(a: f64, b: f64) -> (r: f64)
    ensures r == times(a, b),
{
    a * b
}

#[verifier::external_body]
fn min(a: f64, b: f64) -> (r: f64)
    ensures r == least(a, b),
{
    a.min(b)
}

#[verifier::external_body]
fn distance(before: f64, after: f64) -> (r: f64)
    ensures r == difference(before, after),
{
    (after - before).abs()
}

#[verifier::external_body]
fn largest(before: f64, after: f64) -> (r: f64)
    ensures r == magnitude(before, after),
{
    before.abs().max(after.abs())
}

/// IEEE 754: `<=` is transitive (a comparison with NaN is false, so a true
/// premise rules NaN out).
pub axiom fn at_most_transitive(a: f64, b: f64, c: f64)
    requires at_most(a, b), at_most(b, c),
    ensures at_most(a, c);

/// IEEE 754: `min` of two nonnegative numbers is one of them, so it is
/// nonnegative and at most each.
pub axiom fn least_bounds(a: f64, b: f64)
    requires nonnegative(a), nonnegative(b),
    ensures least(a, b) == a || least(a, b) == b, at_most(least(a, b), a), at_most(least(a, b), b);

/// IEEE 754: multiplication rounds monotonically, so `d <= x * m` and
/// `x <= y`, all nonnegative, give `d <= y * m` (when `x * m` is NaN, as for
/// `0 * inf`, the premise is false).
pub axiom fn scaling_preserves_order(d: f64, x: f64, y: f64, m: f64)
    requires at_most(d, times(x, m)), at_most(x, y), nonnegative(x), nonnegative(y),
    ensures at_most(d, times(y, m));

/// Whether a bound, if declared, holds for the difference `d`.
pub open spec fn holds(d: f64, bound: Option<f64>) -> bool {
    match bound {
        Some(bound) => at_most(d, bound),
        None => false,
    }
}

/// Whether a bound scaled by `m`, if declared, holds for the difference `d`.
pub open spec fn holds_scaled(d: f64, bound: Option<f64>, m: f64) -> bool {
    match bound {
        Some(bound) => at_most(d, times(bound, m)),
        None => false,
    }
}

/// Whether every spread, a `(factor, scale)`, holds for `d`.
pub open spec fn all_hold(d: f64, spreads: Seq<(f64, f64)>) -> bool {
    forall|i: int| 0 <= i < spreads.len() ==> at_most(d, times(#[trigger] spreads[i].0, spreads[i].1))
}

/// Whether `d` is within: the absolute bound holds, the relative bound
/// scaled by `m` holds, or there are spreads and every one holds. A spread is
/// its `(factor, scale)`, the scale being `√(spread_before² + spread_after²)`.
pub open spec fn accepts(d: f64, m: f64, absolute: Option<f64>, relative: Option<f64>, spreads: Seq<(f64, f64)>) -> bool {
    holds(d, absolute) || holds_scaled(d, relative, m) || (spreads.len() > 0 && all_hold(d, spreads))
}

/// Whether `difference(before, after)` is within tolerance: within exactly
/// when one of the declared bounds holds, `|after − before| ≤ absolute`,
/// `≤ relative × max(|before|, |after|)` or `≤ factor × scale` for every
/// spread.
pub fn within(before: f64, after: f64, absolute: Option<f64>, relative: Option<f64>, spreads: &[(f64, f64)]) -> (r: bool)
    ensures
        r == accepts(difference(before, after), magnitude(before, after), absolute, relative, spreads@),
{
    let d = distance(before, after);
    if let Some(bound) = absolute {
        if le(d, bound) {
            return true;
        }
    }
    if let Some(bound) = relative {
        if le(d, mul(bound, largest(before, after))) {
            return true;
        }
    }
    if spreads.is_empty() {
        return false;
    }
    let mut i = 0;
    while i < spreads.len()
        invariant
            i <= spreads.len(),
            d == difference(before, after),
            !holds(d, absolute), !holds_scaled(d, relative, magnitude(before, after)),
            forall|j: int| 0 <= j < i ==> at_most(d, times(#[trigger] spreads@[j].0, spreads@[j].1)),
        decreases spreads.len() - i,
    {
        let (factor, scale) = spreads[i];
        if !le(d, mul(factor, scale)) {
            return false;
        }
        i += 1;
    }
    true
}

/// Whether bound `a` is no looser than `b`: it declares a bound only where
/// `b` does, and then one no larger. A bound not declared never holds.
pub open spec fn no_looser(a: Option<f64>, b: Option<f64>) -> bool {
    match (a, b) {
        (None, _) => true,
        (Some(a), Some(b)) => at_most(a, b) && nonnegative(a) && nonnegative(b),
        (Some(_), None) => false,
    }
}

/// Whether spreads `a` are no looser than `b`: none, or the same spreads
/// (scales) with factors no larger.
pub open spec fn no_looser_spreads(a: Seq<(f64, f64)>, b: Seq<(f64, f64)>) -> bool {
    a.len() == 0 || (a.len() == b.len() && forall|i: int| 0 <= i < a.len() ==>
        #[trigger] a[i].1 == b[i].1 && no_looser(Some(a[i].0), Some(b[i].0)))
}

/// Loosening any bound, or declaring one more, never turns a difference
/// within tolerance into one beyond it.
pub proof fn loosening_keeps_within(
    d: f64, m: f64,
    absolute: (Option<f64>, Option<f64>), relative: (Option<f64>, Option<f64>),
    spreads: (Seq<(f64, f64)>, Seq<(f64, f64)>),
)
    requires
        no_looser(absolute.0, absolute.1), no_looser(relative.0, relative.1), no_looser_spreads(spreads.0, spreads.1),
        accepts(d, m, absolute.0, relative.0, spreads.0),
    ensures
        accepts(d, m, absolute.1, relative.1, spreads.1),
{
    if holds(d, absolute.0) {
        at_most_transitive(d, absolute.0.unwrap(), absolute.1.unwrap());
    } else if holds_scaled(d, relative.0, m) {
        scaling_preserves_order(d, relative.0.unwrap(), relative.1.unwrap(), m);
    } else {
        assert forall|i: int| 0 <= i < spreads.1.len() implies at_most(d, times(#[trigger] spreads.1[i].0, spreads.1[i].1)) by {
            scaling_preserves_order(d, spreads.0[i].0, spreads.1[i].0, spreads.0[i].1);
        }
    }
}

/// One declared tolerance as it applies at a concrete path: its bounds, and
/// its spreads as each spread's path `P` and factor. One declaration has at
/// most one spread; a tolerance combining several keeps them all.
#[derive(Debug, Clone, PartialEq)]
pub struct Effective<P> {
    pub absolute: Option<f64>,
    pub relative: Option<f64>,
    pub spreads: Vec<(P, f64)>,
}

/// A tolerance's spreads, each at the scale its path has in the data.
pub open spec fn scaled<P>(spreads: Seq<(P, f64)>, scale: spec_fn(P) -> f64) -> Seq<(f64, f64)> {
    spreads.map_values(|spread: (P, f64)| (spread.1, scale(spread.0)))
}

/// Whether a tolerance accepts `d`, its spreads scaled by `scale`.
pub open spec fn admits<P>(tolerance: Effective<P>, d: f64, m: f64, scale: spec_fn(P) -> f64) -> bool {
    accepts(d, m, tolerance.absolute, tolerance.relative, scaled(tolerance.spreads@, scale))
}

/// Whether a tolerance's bounds are what validation admits: finite and
/// nonnegative.
pub open spec fn admitted<P>(tolerance: Effective<P>) -> bool {
    &&& (tolerance.absolute matches Some(a) ==> nonnegative(a))
    &&& (tolerance.relative matches Some(a) ==> nonnegative(a))
    &&& forall|i: int| 0 <= i < tolerance.spreads.len() ==> nonnegative(#[trigger] tolerance.spreads@[i].1)
}

/// The smaller of two bounds when both declare one; none otherwise.
pub open spec fn tighter_bound_spec(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(least(a, b)),
        _ => None,
    }
}

fn tighter_bound(a: Option<f64>, b: Option<f64>) -> (r: Option<f64>)
    ensures r == tighter_bound_spec(a, b),
{
    match (a, b) {
        (Some(a), Some(b)) => Some(min(a, b)),
        _ => None,
    }
}

/// Whether `merged` is the tighter of `earlier` and `later`: bound by bound
/// the smaller, a bound only one declares not applying, and the spreads of
/// both, which must all hold, when both have spreads.
pub open spec fn tightens<P>(merged: Effective<P>, earlier: Effective<P>, later: Effective<P>) -> bool {
    &&& merged.absolute == tighter_bound_spec(earlier.absolute, later.absolute)
    &&& merged.relative == tighter_bound_spec(earlier.relative, later.relative)
    &&& merged.spreads@ == if earlier.spreads.len() > 0 && later.spreads.len() > 0 {
        earlier.spreads@ + later.spreads@
    } else {
        Seq::empty()
    }
}

/// The tighter of two tolerances, bound by bound: the smaller absolute and
/// relative bound, and every spread of both; a bound only one of them
/// declares doesn't apply.
pub fn tighter<P>(earlier: Effective<P>, later: Effective<P>) -> (r: Effective<P>)
    ensures tightens(r, earlier, later),
{
    let absolute = tighter_bound(earlier.absolute, later.absolute);
    let relative = tighter_bound(earlier.relative, later.relative);
    let spreads = if !earlier.spreads.is_empty() && !later.spreads.is_empty() {
        let mut spreads = earlier.spreads;
        let mut more = later.spreads;
        spreads.append(&mut more);
        spreads
    } else {
        Vec::new()
    };
    Effective { absolute, relative, spreads }
}

/// Whether both tolerances accept `d` by the same kind of bound: both
/// absolute bounds hold, both relative bounds hold, or both have spreads and
/// every one holds. Symmetric in the two.
pub open spec fn both_accept<P>(earlier: Effective<P>, later: Effective<P>, d: f64, m: f64, scale: spec_fn(P) -> f64) -> bool {
    (holds(d, earlier.absolute) && holds(d, later.absolute))
        || (holds_scaled(d, earlier.relative, m) && holds_scaled(d, later.relative, m))
        || (earlier.spreads.len() > 0 && later.spreads.len() > 0
            && all_hold(d, scaled(earlier.spreads@, scale)) && all_hold(d, scaled(later.spreads@, scale)))
}

/// The tighter of two tolerances accepts a difference exactly when both
/// accept it by the same kind of bound: so it is never looser than either,
/// and it doesn't matter which came first. `scale` gives each spread path's
/// scale in the data.
pub proof fn tighter_accepts<P>(merged: Effective<P>, earlier: Effective<P>, later: Effective<P>, d: f64, m: f64, scale: spec_fn(P) -> f64)
    requires
        admitted(earlier), admitted(later),
        tightens(merged, earlier, later),
    ensures
        admits(merged, d, m, scale) == both_accept(earlier, later, d, m, scale),
        both_accept(earlier, later, d, m, scale) == both_accept(later, earlier, d, m, scale),
        admits(merged, d, m, scale) ==> admits(earlier, d, m, scale) && admits(later, d, m, scale),
{
    if let (Some(a), Some(b)) = (earlier.absolute, later.absolute) {
        least_bounds(a, b);
        if at_most(d, least(a, b)) {
            at_most_transitive(d, least(a, b), a);
            at_most_transitive(d, least(a, b), b);
        }
    }
    if let (Some(a), Some(b)) = (earlier.relative, later.relative) {
        least_bounds(a, b);
        if at_most(d, times(least(a, b), m)) {
            scaling_preserves_order(d, least(a, b), a, m);
            scaling_preserves_order(d, least(a, b), b, m);
        }
    }
    if earlier.spreads.len() > 0 && later.spreads.len() > 0 {
        let (e, l) = (scaled(earlier.spreads@, scale), scaled(later.spreads@, scale));
        assert(scaled(merged.spreads@, scale) =~= e + l);
        if all_hold(d, e + l) {
            assert forall|i: int| 0 <= i < e.len() implies at_most(d, times(#[trigger] e[i].0, e[i].1)) by {
                assert((e + l)[i] == e[i]);
            }
            assert forall|i: int| 0 <= i < l.len() implies at_most(d, times(#[trigger] l[i].0, l[i].1)) by {
                assert((e + l)[e.len() + i] == l[i]);
            }
        }
        if all_hold(d, e) && all_hold(d, l) {
            assert forall|i: int| 0 <= i < (e + l).len() implies at_most(d, times(#[trigger] (e + l)[i].0, (e + l)[i].1)) by {
                if i < e.len() {
                    assert((e + l)[i] == e[i]);
                } else {
                    assert((e + l)[i] == l[i - e.len()]);
                }
            }
        }
    } else {
        assert(scaled(merged.spreads@, scale) =~= Seq::empty());
    }
}

/// How the declarations at one concrete path judge it: as a plain volatile
/// value with an optional tolerance (none: any difference is within), or as
/// a generated value by its bases `B`.
#[derive(Debug, Clone)]
pub enum Rule<P, B> {
    Plain(Option<Effective<P>>),
    Generated(Vec<B>),
}

/// Whether `merged` is how [`Rule::merge`] combines `earlier` and `later`.
pub open spec fn merges<P, B>(merged: Rule<P, B>, earlier: Rule<P, B>, later: Rule<P, B>) -> bool {
    match (earlier, later) {
        (Rule::Generated(a), Rule::Generated(b)) => merged matches Rule::Generated(bases) && bases@ == a@ + b@,
        (Rule::Generated(_), Rule::Plain(_)) => merged == earlier,
        (Rule::Plain(_), Rule::Generated(_)) => merged == later,
        (Rule::Plain(None), Rule::Plain(_)) => merged == later,
        (Rule::Plain(Some(_)), Rule::Plain(None)) => merged == earlier,
        (Rule::Plain(Some(a)), Rule::Plain(Some(b))) => merged matches Rule::Plain(Some(m)) && tightens(m, a, b),
    }
}

impl<P, B> Rule<P, B> {
    /// The tighter of two rules: a generated value's bases over a plain
    /// tolerance, and all the bases of two (it moved if any moved); between
    /// two tolerances, [`tighter`], and a declared tolerance over none.
    pub fn merge(earlier: Rule<P, B>, later: Rule<P, B>) -> (r: Rule<P, B>)
        ensures merges(r, earlier, later),
    {
        match (earlier, later) {
            (Rule::Generated(mut a), Rule::Generated(mut b)) => {
                a.append(&mut b);
                Rule::Generated(a)
            }
            (Rule::Generated(a), Rule::Plain(_)) => Rule::Generated(a),
            (Rule::Plain(_), Rule::Generated(b)) => Rule::Generated(b),
            (Rule::Plain(None), Rule::Plain(effective)) | (Rule::Plain(effective), Rule::Plain(None)) => Rule::Plain(effective),
            (Rule::Plain(Some(a)), Rule::Plain(Some(b))) => Rule::Plain(Some(tighter(a, b))),
        }
    }
}

/// Merging is symmetric: two rules merged in either order are generated
/// from the same bases, or accept the same differences.
pub proof fn merge_is_symmetric<P, B>(forward: Rule<P, B>, backward: Rule<P, B>, earlier: Rule<P, B>, later: Rule<P, B>, d: f64, m: f64, scale: spec_fn(P) -> f64)
    requires
        merges(forward, earlier, later),
        merges(backward, later, earlier),
        earlier matches Rule::Plain(Some(a)) ==> admitted(a),
        later matches Rule::Plain(Some(b)) ==> admitted(b),
    ensures
        forward is Generated <==> backward is Generated,
        forward matches Rule::Generated(f) ==> backward matches Rule::Generated(b) && f@.to_multiset() == b@.to_multiset(),
        forward matches Rule::Plain(f) ==> backward matches Rule::Plain(b) && match (f, b) {
            (Some(f), Some(b)) => admits(f, d, m, scale) == admits(b, d, m, scale),
            (None, None) => true,
            _ => false,
        },
{
    broadcast use vstd::seq_lib::group_to_multiset_ensures;
    match (earlier, later) {
        (Rule::Generated(a), Rule::Generated(b)) => {
            vstd::seq_lib::lemma_multiset_commutative(a@, b@);
            vstd::seq_lib::lemma_multiset_commutative(b@, a@);
        }
        (Rule::Plain(Some(a)), Rule::Plain(Some(b))) => {
            let (f, g) = (forward->Plain_0->Some_0, backward->Plain_0->Some_0);
            tighter_accepts(f, a, b, d, m, scale);
            tighter_accepts(g, b, a, d, m, scale);
        }
        _ => {}
    }
}

} // verus!
