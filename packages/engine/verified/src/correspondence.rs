//! Correspondence shapes: how many items a change pairs on each side, and
//! what its status and correspondence may then be.
//!
//! The default comparator decides a matched group's correspondence with
//! [`group`], and the Engine checks every change any comparator claims with
//! [`shape`]. Verus proves that both are total, that nothing many-to-many is
//! ever chosen or accepted (ambiguity is an error, never a silent pick), that
//! everything [`group`] chooses passes [`shape`], and that both treat a change
//! and its mirror image, as the reverse comparison reports it, alike.

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;

verus! {

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Status {
    Added,
    Removed,
    Modified,
    Unchanged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Correspondence {
    Exact,
    Declared,
    Split,
    Merge,
    None,
}

/// The status the reverse comparison reports for the same change: an
/// addition reads as a removal and back; the rest read the same.
pub open spec fn mirrored_status(status: Status) -> Status {
    match status {
        Status::Added => Status::Removed,
        Status::Removed => Status::Added,
        Status::Modified => Status::Modified,
        Status::Unchanged => Status::Unchanged,
    }
}

/// The correspondence the reverse comparison reports for the same change: a
/// split reads as a merge and back; the rest read the same.
pub open spec fn mirrored_correspondence(correspondence: Correspondence) -> Correspondence {
    match correspondence {
        Correspondence::Split => Correspondence::Merge,
        Correspondence::Merge => Correspondence::Split,
        Correspondence::Exact => Correspondence::Exact,
        Correspondence::Declared => Correspondence::Declared,
        Correspondence::None => Correspondence::None,
    }
}

/// Whether a correspondence pairs one item with one: exact or declared.
pub open spec fn pairs_one_to_one(correspondence: Correspondence) -> bool {
    correspondence == Correspondence::Exact || correspondence == Correspondence::Declared
}

/// The shapes the Engine accepts, written as the contract states them. A
/// change pairs `before` items with `after` items; `same_id` says its one
/// before ID equals its one after ID, and is read only for one-to-one pairs.
pub open spec fn accepted(
    correspondence: Correspondence,
    status: Status,
    before: nat,
    after: nat,
    same_id: bool,
) -> bool {
    match status {
        // Additions and removals pair nothing: one item on its own side only.
        Status::Added => correspondence == Correspondence::None && before == 0 && after == 1,
        Status::Removed => correspondence == Correspondence::None && before == 1 && after == 0,
        // Everything else pairs items, by its correspondence.
        Status::Modified | Status::Unchanged => match correspondence {
            Correspondence::Exact => before == 1 && after == 1 && same_id,
            Correspondence::Declared => before == 1 && after == 1 && !same_id,
            Correspondence::Split => before == 1 && after >= 2,
            Correspondence::Merge => before >= 2 && after == 1,
            Correspondence::None => false,
        },
    }
}

impl Correspondence {
    /// Whether it pairs one item with one: exact or declared.
    pub fn one_to_one(self) -> (r: bool)
        ensures
            r == pairs_one_to_one(self),
    {
        matches!(self, Correspondence::Exact | Correspondence::Declared)
    }
}

/// Whether the Engine accepts a change's status and correspondence for the
/// number of items it pairs on each side. `same_id` says its one before ID
/// equals its one after ID; it matters only for one-to-one pairs.
pub fn shape(correspondence: Correspondence, status: Status, before: usize, after: usize, same_id: bool) -> (r: bool)
    ensures
        // Exactly the shapes the contract states.
        r == accepted(correspondence, status, before as nat, after as nat, same_id),
        // No accepted change is many-to-many: identity is one-to-one, a
        // split or a merge, never an ambiguous group.
        r ==> before <= 1 || after <= 1,
        // Every accepted change involves at least one item.
        r ==> before + after >= 1,
        // A change is accepted exactly when its mirror image, as the reverse
        // comparison reports it, is.
        r == accepted(
            mirrored_correspondence(correspondence),
            mirrored_status(status),
            after as nat,
            before as nat,
            same_id,
        ),
{
    let one_to_one = before == 1 && after == 1;
    match (correspondence, status) {
        (Correspondence::None, Status::Added) => before == 0 && after == 1,
        (Correspondence::None, Status::Removed) => before == 1 && after == 0,
        (_, Status::Added) | (_, Status::Removed) | (Correspondence::None, _) => false,
        (Correspondence::Exact, _) => one_to_one && same_id,
        (Correspondence::Declared, _) => one_to_one && !same_id,
        (Correspondence::Split, _) => before == 1 && after >= 2,
        (Correspondence::Merge, _) => before >= 2 && after == 1,
    }
}

/// The correspondence of a group an identity pass matched: `before` items
/// that correspond to `after` items. `same_id` says a one-to-one group's two
/// items share their ID. None when the group is ambiguous.
pub open spec fn grouped(before: nat, after: nat, same_id: bool) -> Option<Correspondence> {
    if before == 1 && after == 1 {
        Some(if same_id { Correspondence::Exact } else { Correspondence::Declared })
    } else if before == 1 && after >= 2 {
        Some(Correspondence::Split)
    } else if before >= 2 && after == 1 {
        Some(Correspondence::Merge)
    } else {
        None
    }
}

/// The correspondence of a group an identity pass matched, or None when the
/// group is ambiguous, which the caller reports as an error.
pub fn group(before: usize, after: usize, same_id: bool) -> (r: Option<Correspondence>)
    ensures
        r == grouped(before as nat, after as nat, same_id),
        // A group gets a correspondence exactly when it pairs at least one
        // item on each side and exactly one on some side: many-to-many is
        // ambiguous, never resolved by picking a pair.
        r is Some <==> (before >= 1 && after >= 1 && (before == 1 || after == 1)),
        // Every correspondence chosen is one the Engine accepts, whether
        // the change is modified or unchanged.
        r matches Some(c) ==> accepted(c, Status::Modified, before as nat, after as nat, same_id),
        r matches Some(c) ==> accepted(c, Status::Unchanged, before as nat, after as nat, same_id),
        // The reverse comparison groups the same items into the mirror image.
        r == mirrored(grouped(after as nat, before as nat, same_id)),
{
    if before == 1 && after == 1 {
        Some(if same_id { Correspondence::Exact } else { Correspondence::Declared })
    } else if before == 1 && after >= 2 {
        Some(Correspondence::Split)
    } else if before >= 2 && after == 1 {
        Some(Correspondence::Merge)
    } else {
        None
    }
}

/// A group's correspondence as the reverse comparison reports it.
pub open spec fn mirrored(correspondence: Option<Correspondence>) -> Option<Correspondence> {
    match correspondence {
        Some(c) => Some(mirrored_correspondence(c)),
        None => None,
    }
}

} // verus!

impl Status {
    pub const ALL: [Status; 4] = [Status::Added, Status::Removed, Status::Modified, Status::Unchanged];

    pub fn name(self) -> &'static str {
        match self {
            Status::Added => "added",
            Status::Removed => "removed",
            Status::Modified => "modified",
            Status::Unchanged => "unchanged",
        }
    }
}

impl Correspondence {
    pub const ALL: [Correspondence; 5] = [
        Correspondence::Exact,
        Correspondence::Declared,
        Correspondence::Split,
        Correspondence::Merge,
        Correspondence::None,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Correspondence::Exact => "exact",
            Correspondence::Declared => "declared",
            Correspondence::Split => "split",
            Correspondence::Merge => "merge",
            Correspondence::None => "none",
        }
    }
}
