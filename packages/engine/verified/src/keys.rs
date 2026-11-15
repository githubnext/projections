//! Key identity passes: items whose key is unique on both sides correspond.
//!
//! An identity pass may answer each unmatched item with a key; the default
//! comparator's exact-ID pass and rules comparators' key passes do. The
//! caller numbers the distinct keys from 0 and gives [`unique_pairs`] each
//! side's keys in item order. Verus proves the pairs it returns are exactly
//! the items whose key no other item on either side shares, so a key two
//! items share on one side matches nothing there instead of picking one, and
//! no item is paired twice.

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;

use alloc::vec::Vec;

verus! {

/// Whether the key at `index` is held by no other position of `keys`.
pub open spec fn unique(keys: Seq<usize>, index: int) -> bool {
    forall|other: int| 0 <= other < keys.len() && other != index ==> #[trigger] keys[other] != keys[index]
}

/// Whether every key is below `count`.
pub open spec fn bounded(keys: Seq<usize>, count: usize) -> bool {
    forall|index: int| 0 <= index < keys.len() ==> #[trigger] keys[index] < count
}

/// How often each key below `count` occurs in `keys`, as 1 for once and 2
/// for more (0 for never), and where a key that occurs once occurs.
fn tally(keys: &[usize], count: usize) -> (r: (Vec<u8>, Vec<usize>))
    requires
        bounded(keys@, count),
    ensures
        r.0.len() == count,
        r.1.len() == count,
        forall|key: int| 0 <= key < count ==> #[trigger] r.0[key] <= 2,
        // Every key that occurs is counted.
        forall|index: int| 0 <= index < keys.len() ==> r.0[#[trigger] keys[index] as int] >= 1,
        // A key counted once occurs at its recorded position, and nowhere else.
        forall|key: int| 0 <= key < count && #[trigger] r.0[key] == 1 ==> r.1[key] < keys.len() && keys[r.1[key] as int] == key,
        forall|index: int| 0 <= index < keys.len() && r.0[#[trigger] keys[index] as int] == 1 ==> r.1[keys[index] as int] == index,
        // A key counted twice is not unique wherever it occurs.
        forall|index: int| 0 <= index < keys.len() && r.0[#[trigger] keys[index] as int] == 2 ==> !unique(keys@, index),
{
    let mut seen: Vec<u8> = Vec::new();
    let mut at: Vec<usize> = Vec::new();
    while seen.len() < count
        invariant
            seen.len() == at.len(),
            seen.len() <= count,
            forall|key: int| 0 <= key < seen.len() ==> #[trigger] seen[key] == 0,
        decreases count - seen.len(),
    {
        seen.push(0);
        at.push(0);
    }
    let mut index = 0;
    // A key counted twice also occurs at `again[key]`, besides `at[key]`.
    let ghost mut again: Seq<int> = Seq::new(count as nat, |key: int| 0);
    while index < keys.len()
        invariant
            bounded(keys@, count),
            seen.len() == count,
            at.len() == count,
            again.len() == count,
            index <= keys.len(),
            forall|key: int| 0 <= key < count ==> #[trigger] seen[key] <= 2,
            forall|earlier: int| 0 <= earlier < index ==> seen[#[trigger] keys[earlier] as int] >= 1,
            forall|key: int| 0 <= key < count && #[trigger] seen[key] >= 1 ==> at[key] < index && keys[at[key] as int] == key,
            forall|earlier: int| 0 <= earlier < index && seen[#[trigger] keys[earlier] as int] == 1 ==> at[keys[earlier] as int] == earlier,
            forall|key: int| 0 <= key < count && #[trigger] seen[key] == 2 ==>
                0 <= again[key] < index && again[key] != at[key] && keys[again[key]] == key,
        decreases keys.len() - index,
    {
        let key = keys[index];
        if seen[key] == 0 {
            seen[key] = 1;
            at[key] = index;
        } else if seen[key] == 1 {
            seen[key] = 2;
            proof {
                again = again.update(key as int, index as int);
            }
        }
        index += 1;
    }
    proof {
        assert forall|index: int| 0 <= index < keys.len() && seen[#[trigger] keys[index] as int] == 2 implies !unique(keys@, index) by {
            let key = keys[index] as int;
            let other = if index == at[key] as int { again[key] } else { at[key] as int };
            assert(keys@[other] == keys@[index]);
        }
    }
    (seen, at)
}

/// The pairs `(i, j)` of a before item `i` and an after item `j` that share a
/// key no other item on either side has, in before order. Every key must be
/// below `count`.
pub fn unique_pairs(before: &[usize], after: &[usize], count: usize) -> (pairs: Vec<(usize, usize)>)
    requires
        bounded(before@, count),
        bounded(after@, count),
    ensures
        // Every pair joins a before item and an after item with the same key,
        // which no other item on either side has.
        forall|p: int| 0 <= p < pairs.len() ==> {
            let (i, j) = #[trigger] pairs[p];
            &&& i < before.len() && j < after.len()
            &&& before[i as int] == after[j as int]
            &&& unique(before@, i as int) && unique(after@, j as int)
        },
        // Every two such items are paired.
        forall|i: int, j: int|
            0 <= i < before.len() && 0 <= j < after.len() && #[trigger] before[i] == #[trigger] after[j]
                && unique(before@, i) && unique(after@, j)
                ==> exists|p: int| 0 <= p < pairs.len() && #[trigger] pairs[p] == (i as usize, j as usize),
        // No item is in two pairs: matching is one-to-one.
        forall|p: int, q: int| 0 <= p < q < pairs.len() ==> (#[trigger] pairs[p]).0 != (#[trigger] pairs[q]).0 && pairs[p].1 != pairs[q].1,
{
    let (before_seen, _before_first) = tally(before, count);
    let (after_seen, after_at) = tally(after, count);
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < before.len()
        invariant
            bounded(before@, count),
            bounded(after@, count),
            i <= before.len(),
            before_seen.len() == count,
            _before_first.len() == count,
            after_seen.len() == count,
            after_at.len() == count,
            forall|key: int| 0 <= key < count ==> #[trigger] before_seen[key] <= 2,
            forall|key: int| 0 <= key < count ==> #[trigger] after_seen[key] <= 2,
            forall|index: int| 0 <= index < before.len() ==> before_seen[#[trigger] before[index] as int] >= 1,
            forall|index: int| 0 <= index < after.len() ==> after_seen[#[trigger] after[index] as int] >= 1,
            forall|key: int| 0 <= key < count && #[trigger] before_seen[key] == 1 ==> _before_first[key] < before.len() && before[_before_first[key] as int] == key,
            forall|key: int| 0 <= key < count && #[trigger] after_seen[key] == 1 ==> after_at[key] < after.len() && after[after_at[key] as int] == key,
            forall|index: int| 0 <= index < before.len() && before_seen[#[trigger] before[index] as int] == 1 ==> _before_first[before[index] as int] == index,
            forall|index: int| 0 <= index < after.len() && after_seen[#[trigger] after[index] as int] == 1 ==> after_at[after[index] as int] == index,
            forall|index: int| 0 <= index < before.len() && before_seen[#[trigger] before[index] as int] == 2 ==> !unique(before@, index),
            forall|index: int| 0 <= index < after.len() && after_seen[#[trigger] after[index] as int] == 2 ==> !unique(after@, index),
            forall|p: int| 0 <= p < pairs.len() ==> {
                let (pi, pj) = #[trigger] pairs[p];
                &&& pi < i && pj < after.len()
                &&& before[pi as int] == after[pj as int]
                &&& unique(before@, pi as int) && unique(after@, pj as int)
            },
            forall|pi: int, j: int|
                0 <= pi < i && 0 <= j < after.len() && #[trigger] before[pi] == #[trigger] after[j]
                    && unique(before@, pi) && unique(after@, j)
                    ==> exists|p: int| 0 <= p < pairs.len() && #[trigger] pairs[p] == (pi as usize, j as usize),
            forall|p: int, q: int| 0 <= p < q < pairs.len() ==> (#[trigger] pairs[p]).0 < (#[trigger] pairs[q]).0,
        decreases before.len() - i,
    {
        let key = before[i];
        let ghost old_pairs = pairs@;
        if before_seen[key] == 1 && after_seen[key] == 1 {
            let j = after_at[key];
            proof {
                assert(_before_first[key as int] == i);
                assert forall|other: int| 0 <= other < before.len() && other != i implies #[trigger] before[other] != before[i as int] by {
                    if before[other] == key {
                        assert(_before_first[before[other] as int] == other);
                    }
                }
                assert forall|other: int| 0 <= other < after.len() && other != j implies #[trigger] after[other] != after[j as int] by {
                    if after[other] == key {
                        assert(after_at[after[other] as int] == other);
                    }
                }
            }
            pairs.push((i, j));
            proof {
                assert(pairs[pairs.len() - 1] == (i, j));
            }
        }
        proof {
            assert forall|pi: int, j: int|
                0 <= pi <= i && 0 <= j < after.len() && #[trigger] before[pi] == #[trigger] after[j]
                    && unique(before@, pi) && unique(after@, j)
                    implies exists|p: int| 0 <= p < pairs.len() && #[trigger] pairs[p] == (pi as usize, j as usize) by {
                if pi == i {
                    assert(before_seen[before[pi] as int] >= 1);
                    assert(after_seen[after[j] as int] >= 1);
                    assert(before_seen[key as int] == 1);
                    assert(after_seen[after[j] as int] == 1);
                    assert(after_at[after[j] as int] == j);
                    assert(pairs[pairs.len() - 1] == (pi as usize, j as usize));
                } else {
                    let p = choose|p: int| 0 <= p < old_pairs.len() && #[trigger] old_pairs[p] == (pi as usize, j as usize);
                    assert(pairs[p] == old_pairs[p]);
                }
            }
        }
        i += 1;
    }
    pairs
}

} // verus!
