//! What "unchanged" means: a comparison never calls a pair unchanged, or
//! leaves an item out, while something about it differs beyond declared
//! variation.
//!
//! A matched pair's assessment (the Engine's `Declarations::assess`) gives
//! its residual differences (content outside its volatile paths) and its
//! volatile differences, each within tolerance or not. [`unchanged`] decides
//! from them, [`status`] is the status the default comparator gives a pair,
//! [`listed`] whether it lists the pair, [`status_accepted`] whether the
//! Engine accepts a status any comparator claims, and [`hides`] whether an
//! item a comparison leaves out hides a change. Verus proves the comparator
//! and the Engine agree, and ([`unchanged_means_no_reported_difference`])
//! that an accepted unchanged status, an unlisted pair or an accepted
//! omission always means there is no difference outside declared variation
//! within tolerance.

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;

use crate::correspondence::{Correspondence, Status};

verus! {

/// Content is equal modulo expected variation: nothing differs outside the
/// volatile paths, and every volatile difference is within tolerance.
pub fn unchanged(residual_empty: bool, all_within: bool) -> (r: bool)
    ensures r == (residual_empty && all_within),
{
    residual_empty && all_within
}

/// The status of a one-to-one pair whose content is `unchanged` or not.
pub open spec fn status_of(unchanged: bool) -> Status {
    if unchanged { Status::Unchanged } else { Status::Modified }
}

/// The status the default comparator gives a one-to-one pair.
pub fn status(unchanged: bool) -> (r: Status)
    ensures r == status_of(unchanged),
{
    if unchanged { Status::Unchanged } else { Status::Modified }
}

/// Whether the Engine accepts the status a comparator claims for a
/// one-to-one pair whose content is `unchanged` or not.
pub fn status_accepted(claimed: Status, unchanged: bool) -> (r: bool)
    ensures r == (claimed == status_of(unchanged)),
{
    match claimed {
        Status::Unchanged => unchanged,
        Status::Modified => !unchanged,
        Status::Added | Status::Removed => false,
    }
}

/// Whether the default comparator lists a matched group's change: every one
/// except an exact pair with no difference at all.
pub fn listed(correspondence: Correspondence, status: Status, varied_empty: bool) -> (r: bool)
    ensures !r <==> (correspondence == Correspondence::Exact && status == Status::Unchanged && varied_empty),
{
    !(matches!(correspondence, Correspondence::Exact) && matches!(status, Status::Unchanged) && varied_empty)
}

/// Whether an item a comparison leaves out hides a change: it does unless
/// the other side has an item with its ID, itself left out, whose content is
/// the same in every respect, volatile values included.
/// `counterpart_same` is that content comparison, or none without such an item.
pub fn hides(counterpart_same: Option<bool>) -> (r: bool)
    ensures !r <==> counterpart_same == Some(true),
{
    !matches!(counterpart_same, Some(true))
}

/// Whether the Engine accepts `claimed` for a pair whose content is
/// `unchanged` or not ([`status_accepted`]).
pub open spec fn accepted(claimed: Status, unchanged: bool) -> bool {
    claimed == status_of(unchanged)
}

/// Whether the default comparator lists a change ([`listed`]).
pub open spec fn is_listed(correspondence: Correspondence, status: Status, varied_empty: bool) -> bool {
    !(correspondence == Correspondence::Exact && status == Status::Unchanged && varied_empty)
}

/// "Unchanged" means no reported difference, for a one-to-one pair with
/// residual differences or not, volatile differences all within or not, and
/// any volatile difference or none:
/// - the default comparator's status is the one status the Engine accepts;
/// - a status the Engine accepts as unchanged means no residual difference
///   and every volatile difference within tolerance;
/// - a pair the default comparator leaves unlisted is exact and has no
///   difference at all.
/// An item the Engine lets a comparison leave out has a counterpart whose
/// content is the same: [`hides`]' own contract.
pub proof fn unchanged_means_no_reported_difference(
    residual_empty: bool, all_within: bool, varied_empty: bool,
    claimed: Status, correspondence: Correspondence,
)
    ensures
        accepted(status_of(residual_empty && all_within), residual_empty && all_within),
        accepted(claimed, residual_empty && all_within) ==> claimed == status_of(residual_empty && all_within),
        accepted(Status::Unchanged, residual_empty && all_within) ==> residual_empty && all_within,
        !is_listed(correspondence, status_of(residual_empty && all_within), varied_empty)
            ==> correspondence == Correspondence::Exact && residual_empty && all_within && varied_empty,
{
}

} // verus!
