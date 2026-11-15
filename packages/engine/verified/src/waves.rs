//! Presentation waves: how the default comparator orders a comparison's
//! steps so that playing it backwards is the reverse comparison.
//!
//! Removed entities change leaves first and added ones roots first. Both are
//! layered by depth and grouped into at most five waves ([`wave_sizes`]),
//! roots first, without ever splitting a layer. A changed relationship goes
//! with the wave its last arriving endpoint arrives in, or else the one its
//! last departing endpoint leaves in, or else restructures ([`place`]); and
//! the steps are the removal waves, last first, then one restructure step,
//! then the addition waves ([`phases`]).
//!
//! The reverse comparison swaps what is removed and what is added, so its
//! removal waves are this comparison's addition waves and the other way
//! round. Verus proves the two halves of mirroring that this file decides:
//! [`phases_mirror`], that the reverse comparison's steps are exactly these
//! steps reversed, removals and additions swapped; and [`place_mirror`], that
//! swapping a relationship's arriving and departing endpoints mirrors its
//! placement, except for a relationship with both, which arrives with its
//! last arriving endpoint in either direction. Which entities are removed or
//! added, and their layers, come from the matching and the entity graph and
//! are tested, not proved, to mirror.

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;

use alloc::vec::Vec;

verus! {

/// The most waves one phase of removals or additions has.
pub const MAX_WAVES: usize = 5;

/// The layers some waves hold in all.
pub open spec fn total(sizes: Seq<usize>) -> int
    decreases sizes.len(),
{
    if sizes.len() == 0 { 0 } else { total(sizes.drop_last()) + sizes.last() }
}

/// How many of `layers` layers each wave holds, in order: at most
/// [`MAX_WAVES`] waves holding every layer, each at least one, all the same
/// number but the last, which may hold fewer.
pub fn wave_sizes(layers: usize) -> (sizes: Vec<usize>)
    ensures
        sizes.len() <= MAX_WAVES,
        total(sizes@) == layers,
        forall|i: int| 0 <= i < sizes.len() ==> #[trigger] sizes[i] >= 1,
        forall|i: int| 0 <= i < sizes.len() - 1 ==> #[trigger] sizes[i] == sizes[0],
        sizes.len() > 0 ==> sizes[sizes.len() - 1] <= sizes[0],
{
    let mut sizes: Vec<usize> = Vec::new();
    if layers == 0 {
        return sizes;
    }
    let waves = if layers < MAX_WAVES { layers } else { MAX_WAVES };
    // ceil(layers / waves): `waves` waves of this size cover every layer.
    let size = layers / waves + if layers % waves == 0 { 0 } else { 1 };
    assert(size >= 1 && size * waves >= layers && size <= layers) by (nonlinear_arith)
        requires 1 <= waves <= layers, size == layers / waves + if layers % waves == 0 { 0int } else { 1int };
    let mut left = layers;
    while left > 0
        invariant
            1 <= size <= layers,
            size * waves >= layers,
            1 <= waves <= MAX_WAVES,
            left <= layers,
            total(sizes@) + left == layers,
            sizes.len() <= waves,
            left > 0 ==> sizes.len() < waves && sizes.len() * size + left == layers,
            left > 0 ==> forall|i: int| 0 <= i < sizes.len() ==> #[trigger] sizes[i] == size,
            forall|i: int| 0 <= i < sizes.len() - 1 ==> #[trigger] sizes[i] == size,
            forall|i: int| 0 <= i < sizes.len() ==> 1 <= #[trigger] sizes[i] <= size,
            sizes.len() > 0 ==> sizes[0] == size,
        decreases left,
    {
        let next = if left < size { left } else { size };
        proof {
            if left > size {
                assert(sizes.len() + 1 < waves) by (nonlinear_arith)
                    requires sizes.len() * size + left == layers, left > size, size * waves >= layers, size >= 1;
            }
        }
        let ghost before = sizes@;
        sizes.push(next);
        left -= next;
        proof {
            assert(sizes@.drop_last() =~= before);
            if left > 0 {
                assert(next == size);
                assert((sizes.len() - 1) * size + size == sizes.len() * size) by (nonlinear_arith);
            }
        }
    }
    sizes
}

/// Where a changed relationship goes: the addition wave it arrives in, the
/// removal wave it leaves in, or the restructure step. Waves are counted
/// roots first, as [`wave_sizes`] makes them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    Add(usize),
    Remove(usize),
    Restructure,
}

/// The largest of some wave indices.
pub open spec fn last(waves: Seq<usize>) -> int
    decreases waves.len(),
{
    if waves.len() == 0 {
        -1
    } else {
        let rest = last(waves.drop_last());
        if waves.last() as int > rest { waves.last() as int } else { rest }
    }
}

/// [`place`]'s rule: with the last wave an arriving endpoint arrives in, or
/// else the last a departing endpoint leaves in, or else it restructures.
pub open spec fn placed(arriving: Seq<usize>, departing: Seq<usize>) -> Placement {
    if arriving.len() > 0 {
        Placement::Add(last(arriving) as usize)
    } else if departing.len() > 0 {
        Placement::Remove(last(departing) as usize)
    } else {
        Placement::Restructure
    }
}

fn latest(waves: &[usize]) -> (r: usize)
    requires waves.len() > 0,
    ensures r as int == last(waves@),
{
    let mut best = waves[0];
    let mut i = 1;
    assert(waves@.subrange(0, 1).drop_last() =~= Seq::<usize>::empty());
    assert(waves@.subrange(0, 1).last() == waves[0]);
    assert(last(Seq::<usize>::empty()) == -1);
    assert(last(waves@.subrange(0, 1)) == waves[0] as int);
    while i < waves.len()
        invariant
            1 <= i <= waves.len(),
            best as int == last(waves@.subrange(0, i as int)),
        decreases waves.len() - i,
    {
        assert(waves@.subrange(0, i + 1).drop_last() =~= waves@.subrange(0, i as int));
        if waves[i] > best {
            best = waves[i];
        }
        i += 1;
    }
    assert(waves@.subrange(0, waves.len() as int) =~= waves@);
    best
}

/// Where a changed relationship goes, given the waves its arriving
/// endpoints arrive in and its departing endpoints leave in.
pub fn place(arriving: &[usize], departing: &[usize]) -> (r: Placement)
    ensures r == placed(arriving@, departing@),
{
    if !arriving.is_empty() {
        Placement::Add(latest(arriving))
    } else if !departing.is_empty() {
        Placement::Remove(latest(departing))
    } else {
        Placement::Restructure
    }
}

/// A placement as the reverse comparison sees it: an addition is a removal
/// from the same wave and the other way round.
pub open spec fn mirrored(placement: Placement) -> Placement {
    match placement {
        Placement::Add(wave) => Placement::Remove(wave),
        Placement::Remove(wave) => Placement::Add(wave),
        Placement::Restructure => Placement::Restructure,
    }
}

/// The reverse comparison places a relationship as the mirror image, unless
/// it has both arriving and departing endpoints: then it arrives, in either
/// direction, with its last arriving endpoint.
pub proof fn place_mirror(arriving: Seq<usize>, departing: Seq<usize>)
    ensures
        !(arriving.len() > 0 && departing.len() > 0) ==> placed(departing, arriving) == mirrored(placed(arriving, departing)),
        arriving.len() > 0 && departing.len() > 0 ==> placed(arriving, departing) is Add && placed(departing, arriving) is Add,
{
}

/// The kind of a step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Remove,
    Restructure,
    Add,
}

/// The kind the reverse comparison gives the same step.
pub open spec fn reversed(phase: Phase) -> Phase {
    match phase {
        Phase::Remove => Phase::Add,
        Phase::Add => Phase::Remove,
        Phase::Restructure => Phase::Restructure,
    }
}

/// [`phases`]'s steps: the removal waves last first, the restructure step if
/// any, then the addition waves.
pub open spec fn steps_of<T>(removals: Seq<T>, restructure: Option<T>, additions: Seq<T>) -> Seq<(Phase, T)> {
    removals.reverse().map_values(|wave: T| (Phase::Remove, wave))
        + match restructure {
            Some(step) => seq![(Phase::Restructure, step)],
            None => Seq::empty(),
        }
        + additions.map_values(|wave: T| (Phase::Add, wave))
}

/// A list of steps as the reverse comparison plays it: backwards, each
/// removal an addition and each addition a removal.
pub open spec fn played_backwards<T>(steps: Seq<(Phase, T)>) -> Seq<(Phase, T)> {
    steps.reverse().map_values(|step: (Phase, T)| (reversed(step.0), step.1))
}

/// The steps of a comparison: its removal waves, given roots first, play
/// last first, so leaves go first; then its restructure step, if any; then
/// its addition waves, roots first.
// `while let` can't carry the loop invariants Verus needs.
#[allow(clippy::manual_while_let_some)]
pub fn phases<T>(removals: Vec<T>, restructure: Option<T>, additions: Vec<T>) -> (steps: Vec<(Phase, T)>)
    ensures steps@ == steps_of(removals@, restructure, additions@),
{
    let ghost (r, a) = (removals@, additions@);
    let mut steps: Vec<(Phase, T)> = Vec::new();
    let mut removals = removals;
    while !removals.is_empty()
        invariant
            removals@.len() <= r.len(),
            removals@ == r.subrange(0, removals.len() as int),
            steps@ == r.subrange(removals.len() as int, r.len() as int).reverse().map_values(|wave: T| (Phase::Remove, wave)),
        decreases removals.len(),
    {
        let wave = removals.pop().unwrap();
        proof {
            let n = removals.len() as int;
            assert(r.subrange(n, r.len() as int).reverse() =~= r.subrange(n + 1, r.len() as int).reverse().push(r[n]));
        }
        steps.push((Phase::Remove, wave));
        assert(removals@ =~= r.subrange(0, removals.len() as int));
    }
    if let Some(step) = restructure {
        steps.push((Phase::Restructure, step));
    }
    let ghost before_additions = steps@;
    let mut additions = additions;
    additions.reverse();
    let mut added: Vec<(Phase, T)> = Vec::new();
    while !additions.is_empty()
        invariant
            additions@.len() <= a.len(),
            additions@ == a.subrange(a.len() - additions.len(), a.len() as int).reverse(),
            added@ == a.subrange(0, a.len() - additions.len()).map_values(|wave: T| (Phase::Add, wave)),
        decreases additions.len(),
    {
        let wave = additions.pop().unwrap();
        proof {
            let n = a.len() - additions.len() - 1;
            assert(a.subrange(0, n + 1) =~= a.subrange(0, n).push(a[n]));
            assert(additions@ =~= a.subrange(n + 1, a.len() as int).reverse());
        }
        added.push((Phase::Add, wave));
    }
    steps.append(&mut added);
    proof {
        assert(r.subrange(0, r.len() as int) =~= r);
        assert(a.subrange(0, a.len() as int) =~= a);
        assert(steps@ =~= steps_of(r, restructure, a));
    }
    steps
}

/// The reverse comparison's steps are these steps played backwards: its
/// removals are these additions and its additions these removals, so its
/// steps are these in reverse order, each removal an addition and each
/// addition a removal.
pub proof fn phases_mirror<T>(removals: Seq<T>, restructure: Option<T>, additions: Seq<T>)
    ensures steps_of(additions, restructure, removals) == played_backwards(steps_of(removals, restructure, additions)),
{
    let forward = steps_of(removals, restructure, additions);
    let backward = steps_of(additions, restructure, removals);
    let middle: Seq<(Phase, T)> = match restructure {
        Some(step) => seq![(Phase::Restructure, step)],
        None => Seq::empty(),
    };
    let (nr, nm, na) = (removals.len() as int, middle.len() as int, additions.len() as int);
    assert(forward.len() == nr + nm + na);
    assert(backward.len() == na + nm + nr);
    assert forall|i: int| 0 <= i < backward.len() implies #[trigger] backward[i] == played_backwards(forward)[i] by {
        let j = forward.len() - 1 - i;
        if i < na {
            assert(backward[i] == (Phase::Remove, additions[na - 1 - i]));
            assert(forward[j] == (Phase::Add, additions[na - 1 - i]));
        } else if i < na + nm {
            assert(backward[i] == middle[i - na]);
            assert(forward[j] == middle[j - nr]);
        } else {
            let k = i - na - nm;
            assert(backward[i] == (Phase::Add, removals[k]));
            assert(forward[j] == (Phase::Remove, removals[nr - 1 - (nr - 1 - k)]));
        }
    }
    assert(backward =~= played_backwards(forward));
}

} // verus!
