//! Canonical order: the one order normalization puts every list in, so an
//! extraction's canonical bytes never depend on the order its items were
//! written in.
//!
//! A key is a list of words, each a string as UTF-16 code units: an item's
//! key is its ID; a volatile declaration's is its collection, path, whether
//! it names kinds, then its kinds. Keys compare word by word in UTF-16 code
//! unit order, as JavaScript and RFC 8785 order strings, a shorter list first
//! when one is a prefix of the other. [`sort`] returns the permutation that
//! puts keys in that order. Verus proves it is a permutation (no item is lost
//! or repeated), that it sorts, and ([`canonical`]) that the sorted keys
//! depend only on which keys there are: sorting any arrangement of the same
//! keys, including an already sorted one, gives the same sequence. Keys are
//! unique where normalization sorts, so each key is one item and the
//! normalized order is independent of the input order.

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;
#[cfg(verus_keep_ghost)]
use vstd::multiset::Multiset;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;

use alloc::vec;
use alloc::vec::Vec;
use core::cmp::Ordering;

verus! {

#[cfg(verus_keep_ghost)]
broadcast use {vstd::multiset::group_multiset_axioms, vstd::seq_lib::group_to_multiset_ensures};

/// Strict UTF-16 code unit order on words.
pub open spec fn word_less(a: Seq<u16>, b: Seq<u16>) -> bool
    decreases a.len(),
{
    if b.len() == 0 {
        false
    } else if a.len() == 0 {
        true
    } else if a[0] != b[0] {
        a[0] < b[0]
    } else {
        word_less(a.drop_first(), b.drop_first())
    }
}

/// Strict order on keys: word by word, a prefix first.
pub open spec fn key_less(a: Seq<Seq<u16>>, b: Seq<Seq<u16>>) -> bool
    decreases a.len(),
{
    if b.len() == 0 {
        false
    } else if a.len() == 0 {
        true
    } else if a[0] != b[0] {
        word_less(a[0], b[0])
    } else {
        key_less(a.drop_first(), b.drop_first())
    }
}

/// `a` comes no later than `b`.
pub open spec fn key_le(a: Seq<Seq<u16>>, b: Seq<Seq<u16>>) -> bool {
    !key_less(b, a)
}

proof fn word_irreflexive(a: Seq<u16>)
    ensures !word_less(a, a),
    decreases a.len(),
{
    if a.len() > 0 {
        word_irreflexive(a.drop_first());
    }
}

proof fn word_transitive(a: Seq<u16>, b: Seq<u16>, c: Seq<u16>)
    requires word_less(a, b), word_less(b, c),
    ensures word_less(a, c),
    decreases a.len(),
{
    if a.len() > 0 && b.len() > 0 && c.len() > 0 && a[0] == b[0] && b[0] == c[0] {
        word_transitive(a.drop_first(), b.drop_first(), c.drop_first());
    }
}

proof fn word_total(a: Seq<u16>, b: Seq<u16>)
    ensures a == b || word_less(a, b) || word_less(b, a),
    decreases a.len(),
{
    if a.len() > 0 && b.len() > 0 && a[0] == b[0] {
        word_total(a.drop_first(), b.drop_first());
        if a.drop_first() == b.drop_first() {
            assert forall|k: int| 0 <= k < a.len() implies a[k] == b[k] by {
                if k > 0 {
                    assert(a[k] == a.drop_first()[k - 1] && b[k] == b.drop_first()[k - 1]);
                }
            }
            assert(a =~= b);
        }
    }
}

proof fn word_asymmetric(a: Seq<u16>, b: Seq<u16>)
    requires word_less(a, b),
    ensures !word_less(b, a),
{
    if word_less(b, a) {
        word_transitive(a, b, a);
        word_irreflexive(a);
    }
}

proof fn key_irreflexive(a: Seq<Seq<u16>>)
    ensures !key_less(a, a),
    decreases a.len(),
{
    if a.len() > 0 {
        key_irreflexive(a.drop_first());
    }
}

proof fn key_transitive(a: Seq<Seq<u16>>, b: Seq<Seq<u16>>, c: Seq<Seq<u16>>)
    requires key_less(a, b), key_less(b, c),
    ensures key_less(a, c),
    decreases a.len(),
{
    if a.len() > 0 && b.len() > 0 && c.len() > 0 {
        if a[0] == b[0] && b[0] == c[0] {
            key_transitive(a.drop_first(), b.drop_first(), c.drop_first());
        } else if a[0] != b[0] && b[0] != c[0] {
            word_transitive(a[0], b[0], c[0]);
            if a[0] == c[0] {
                word_irreflexive(a[0]);
            }
        }
    }
}

proof fn key_total(a: Seq<Seq<u16>>, b: Seq<Seq<u16>>)
    ensures a == b || key_less(a, b) || key_less(b, a),
    decreases a.len(),
{
    if a.len() > 0 && b.len() > 0 {
        if a[0] == b[0] {
            key_total(a.drop_first(), b.drop_first());
            if a.drop_first() == b.drop_first() {
                assert forall|k: int| 0 <= k < a.len() implies a[k] == b[k] by {
                    if k > 0 {
                        assert(a[k] == a.drop_first()[k - 1] && b[k] == b.drop_first()[k - 1]);
                    }
                }
                assert(a =~= b);
            }
        } else {
            word_total(a[0], b[0]);
        }
    }
}

/// `key_le` is a total order, as vstd's sorting lemmas require.
pub proof fn key_le_total_ordering()
    ensures vstd::relations::total_ordering(|a: Seq<Seq<u16>>, b: Seq<Seq<u16>>| key_le(a, b)),
{
    let le = |a: Seq<Seq<u16>>, b: Seq<Seq<u16>>| key_le(a, b);
    assert forall|a: Seq<Seq<u16>>| #[trigger] le(a, a) by {
        key_irreflexive(a);
    }
    assert forall|a: Seq<Seq<u16>>, b: Seq<Seq<u16>>| #[trigger] le(a, b) && #[trigger] le(b, a) implies a == b by {
        key_total(a, b);
    }
    assert forall|a: Seq<Seq<u16>>, b: Seq<Seq<u16>>, c: Seq<Seq<u16>>| #[trigger] le(a, b) && #[trigger] le(b, c) implies le(a, c) by {
        if key_less(c, a) {
            key_total(a, b);
            if key_less(a, b) {
                key_transitive(c, a, b);
            }
        }
    }
    assert forall|a: Seq<Seq<u16>>, b: Seq<Seq<u16>>| #[trigger] le(a, b) || #[trigger] le(b, a) by {
        if key_less(b, a) && key_less(a, b) {
            key_transitive(a, b, a);
            key_irreflexive(a);
        }
    }
    assert(vstd::relations::reflexive(le));
    assert(vstd::relations::antisymmetric(le));
    assert(vstd::relations::transitive(le));
    assert(vstd::relations::strongly_connected(le));
}

/// The keys at `order`, in that order.
pub open spec fn arranged(keys: Seq<Seq<Seq<u16>>>, order: Seq<usize>) -> Seq<Seq<Seq<u16>>> {
    order.map_values(|i: usize| keys[i as int])
}

/// Whether `keys` are in canonical order.
pub open spec fn sorted(keys: Seq<Seq<Seq<u16>>>) -> bool {
    forall|i: int, j: int| 0 <= i < j < keys.len() ==> key_le(#[trigger] keys[i], #[trigger] keys[j])
}

/// The indices `lo..hi`, in order.
pub open spec fn range(lo: int, hi: int) -> Seq<usize> {
    Seq::new((hi - lo) as nat, |i: int| (lo + i) as usize)
}

proof fn key_le_transitive(a: Seq<Seq<u16>>, b: Seq<Seq<u16>>, c: Seq<Seq<u16>>)
    requires key_le(a, b), key_le(b, c),
    ensures key_le(a, c),
{
    if key_less(c, a) {
        key_total(a, b);
        if key_less(a, b) {
            key_transitive(c, a, b);
        }
    }
}

/// A key as words of UTF-16 code units.
pub open spec fn key_view(key: Seq<Vec<u16>>) -> Seq<Seq<u16>> {
    key.map_values(|word: Vec<u16>| word@)
}

/// Keys as words of UTF-16 code units.
pub open spec fn keys_view(keys: &[Vec<Vec<u16>>]) -> Seq<Seq<Seq<u16>>> {
    keys@.map_values(|key: Vec<Vec<u16>>| key_view(key@))
}

/// Compares two words in UTF-16 code unit order.
fn compare_words(a: &[u16], b: &[u16]) -> (r: Ordering)
    ensures
        (r == Ordering::Less) == word_less(a@, b@),
        (r == Ordering::Greater) == word_less(b@, a@),
        (r == Ordering::Equal) == (a@ == b@),
{
    proof {
        word_total(a@, b@);
        if word_less(a@, b@) { word_asymmetric(a@, b@); }
        if a@ == b@ { word_irreflexive(a@); }
    }
    let mut i: usize = 0;
    assert(a@.subrange(0, a.len() as int) =~= a@);
    assert(b@.subrange(0, b.len() as int) =~= b@);
    while i < a.len() && i < b.len()
        invariant
            i <= a.len(), i <= b.len(),
            a@.subrange(0, i as int) == b@.subrange(0, i as int),
            word_less(a@, b@) == word_less(a@.subrange(i as int, a.len() as int), b@.subrange(i as int, b.len() as int)),
            word_less(b@, a@) == word_less(b@.subrange(i as int, b.len() as int), a@.subrange(i as int, a.len() as int)),
        decreases a.len() - i,
    {
        if a[i] != b[i] {
            return if a[i] < b[i] { Ordering::Less } else { Ordering::Greater };
        }
        proof {
            let (x, y) = (a@.subrange(i as int, a.len() as int), b@.subrange(i as int, b.len() as int));
            assert(x.drop_first() =~= a@.subrange(i + 1, a.len() as int));
            assert(y.drop_first() =~= b@.subrange(i + 1, b.len() as int));
            assert(a@.subrange(0, i + 1) =~= a@.subrange(0, i as int).push(a[i as int]));
            assert(b@.subrange(0, i + 1) =~= b@.subrange(0, i as int).push(b[i as int]));
        }
        i += 1;
    }
    if a.len() < b.len() {
        Ordering::Less
    } else if a.len() > b.len() {
        Ordering::Greater
    } else {
        proof {
            assert(a@ =~= a@.subrange(0, i as int));
            assert(b@ =~= b@.subrange(0, i as int));
        }
        Ordering::Equal
    }
}

/// Compares two keys word by word, a prefix first.
pub fn compare_keys(a: &[Vec<u16>], b: &[Vec<u16>]) -> (r: Ordering)
    ensures
        (r == Ordering::Less) == key_less(key_view(a@), key_view(b@)),
        (r == Ordering::Greater) == key_less(key_view(b@), key_view(a@)),
        (r == Ordering::Equal) == (key_view(a@) == key_view(b@)),
{
    let ghost (x, y) = (key_view(a@), key_view(b@));
    proof {
        key_total(x, y);
        if key_less(x, y) && key_less(y, x) { key_transitive(x, y, x); key_irreflexive(x); }
        if x == y { key_irreflexive(x); }
    }
    let mut i: usize = 0;
    assert(x.subrange(0, x.len() as int) =~= x);
    assert(y.subrange(0, y.len() as int) =~= y);
    while i < a.len() && i < b.len()
        invariant
            x == key_view(a@), y == key_view(b@),
            x.len() == a.len(), y.len() == b.len(),
            i <= a.len(), i <= b.len(),
            x.subrange(0, i as int) == y.subrange(0, i as int),
            key_less(x, y) == key_less(x.subrange(i as int, x.len() as int), y.subrange(i as int, y.len() as int)),
            key_less(y, x) == key_less(y.subrange(i as int, y.len() as int), x.subrange(i as int, x.len() as int)),
        decreases a.len() - i,
    {
        let (wa, wb) = (a[i].as_slice(), b[i].as_slice());
        assert(wa@ == a[i as int]@ && wb@ == b[i as int]@);
        let order = compare_words(wa, wb);
        let ghost (p, q) = (x.subrange(i as int, x.len() as int), y.subrange(i as int, y.len() as int));
        assert(x[i as int] == a[i as int]@ && y[i as int] == b[i as int]@);
        assert(p[0] == x[i as int] && q[0] == y[i as int]);
        if !matches!(order, Ordering::Equal) {
            proof {
                assert(x[i as int] != y[i as int]);
                assert(x != y) by {
                    if x == y { assert(x[i as int] == y[i as int]); }
                }
            }
            return order;
        }
        proof {
            assert(p.drop_first() =~= x.subrange(i + 1, x.len() as int));
            assert(q.drop_first() =~= y.subrange(i + 1, y.len() as int));
            assert(x.subrange(0, i + 1) =~= x.subrange(0, i as int).push(x[i as int]));
            assert(y.subrange(0, i + 1) =~= y.subrange(0, i as int).push(y[i as int]));
        }
        i += 1;
    }
    if a.len() < b.len() {
        Ordering::Less
    } else if a.len() > b.len() {
        Ordering::Greater
    } else {
        proof {
            assert(x =~= x.subrange(0, i as int));
            assert(y =~= y.subrange(0, i as int));
        }
        Ordering::Equal
    }
}

/// Whether `order` holds indices of `keys` in canonical order.
pub open spec fn sorts(keys: Seq<Seq<Seq<u16>>>, order: Seq<usize>) -> bool {
    &&& forall|p: int| 0 <= p < order.len() ==> #[trigger] order[p] < keys.len()
    &&& sorted(arranged(keys, order))
}

/// Merges two orders of disjoint indices, each canonical, into one.
fn merge(keys: &[Vec<Vec<u16>>], left: Vec<usize>, right: Vec<usize>) -> (merged: Vec<usize>)
    requires
        sorts(keys_view(keys), left@),
        sorts(keys_view(keys), right@),
    ensures
        sorts(keys_view(keys), merged@),
        merged@.to_multiset() == left@.to_multiset().add(right@.to_multiset()),
        arranged(keys_view(keys), merged@).to_multiset()
            == arranged(keys_view(keys), left@).to_multiset().add(arranged(keys_view(keys), right@).to_multiset()),
{
    let ghost k = keys_view(keys);
    let mut merged: Vec<usize> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    proof {
        assert(left@.subrange(0, left.len() as int) =~= left@);
        assert(right@.subrange(0, right.len() as int) =~= right@);
        assert(merged@.to_multiset() =~= Multiset::empty());
        assert(arranged(k, merged@) =~= Seq::empty());
        assert(arranged(k, merged@).to_multiset() =~= Multiset::empty());
        assert(Multiset::<usize>::empty().add(left@.to_multiset()) =~= left@.to_multiset());
        assert(Multiset::<Seq<Seq<u16>>>::empty().add(arranged(k, left@).to_multiset()) =~= arranged(k, left@).to_multiset());
    }
    while i < left.len() || j < right.len()
        invariant
            k == keys_view(keys),
            k.len() == keys.len(),
            sorts(k, left@), sorts(k, right@),
            i <= left.len(), j <= right.len(),
            sorts(k, merged@),
            merged.len() > 0 && i < left.len() ==> key_le(k[merged@.last() as int], k[left[i as int] as int]),
            merged.len() > 0 && j < right.len() ==> key_le(k[merged@.last() as int], k[right[j as int] as int]),
            merged@.to_multiset().add(left@.subrange(i as int, left.len() as int).to_multiset())
                .add(right@.subrange(j as int, right.len() as int).to_multiset())
                == left@.to_multiset().add(right@.to_multiset()),
            arranged(k, merged@).to_multiset().add(arranged(k, left@.subrange(i as int, left.len() as int)).to_multiset())
                .add(arranged(k, right@.subrange(j as int, right.len() as int)).to_multiset())
                == arranged(k, left@).to_multiset().add(arranged(k, right@).to_multiset()),
        decreases left.len() + right.len() - i - j,
    {
        let take_left = if i == left.len() {
            false
        } else if j == right.len() {
            true
        } else {
            !matches!(compare_keys(keys[right[j]].as_slice(), keys[left[i]].as_slice()), Ordering::Less)
        };
        let next = if take_left { left[i] } else { right[j] };
        let ghost rest = if take_left { left@.subrange(i as int, left.len() as int) } else { right@.subrange(j as int, right.len() as int) };
        proof {
            assert(k[next as int] == key_view(keys@[next as int]@));
            assert(rest.drop_first() =~= if take_left { left@.subrange(i + 1, left.len() as int) } else { right@.subrange(j + 1, right.len() as int) });
            assert(rest =~= seq![next] + rest.drop_first());
            vstd::seq_lib::lemma_multiset_commutative(seq![next], rest.drop_first());
            assert(arranged(k, rest) =~= seq![k[next as int]] + arranged(k, rest.drop_first()));
            vstd::seq_lib::lemma_multiset_commutative(seq![k[next as int]], arranged(k, rest.drop_first()));
            assert(arranged(k, merged@.push(next)) =~= arranged(k, merged@).push(k[next as int]));
            // The next key comes no earlier than any merged so far.
            assert forall|p: int| 0 <= p < merged.len() implies key_le(#[trigger] arranged(k, merged@)[p], k[next as int]) by {
                assert(key_le(arranged(k, merged@)[p], k[merged@.last() as int])) by {
                    if p < merged.len() - 1 {
                        assert(arranged(k, merged@)[merged.len() - 1] == k[merged@.last() as int]);
                    } else {
                        key_irreflexive(k[merged@.last() as int]);
                    }
                }
                key_le_transitive(arranged(k, merged@)[p], k[merged@.last() as int], k[next as int]);
            }
            // And no later than what remains on the other side.
            if i < left.len() && j < right.len() {
                assert(k[right[j as int] as int] == key_view(keys@[right[j as int] as int]@));
                assert(k[left[i as int] as int] == key_view(keys@[left[i as int] as int]@));
                if !take_left {
                    assert(key_less(k[right[j as int] as int], k[left[i as int] as int]));
                    assert(!key_less(k[left[i as int] as int], k[right[j as int] as int])) by {
                        if key_less(k[left[i as int] as int], k[right[j as int] as int]) {
                            key_transitive(k[left[i as int] as int], k[right[j as int] as int], k[left[i as int] as int]);
                            key_irreflexive(k[left[i as int] as int]);
                        }
                    }
                }
            }
        }
        merged.push(next);
        if take_left {
            i += 1;
        } else {
            j += 1;
        }
        proof {
            assert(arranged(k, merged@)[merged.len() - 1] == k[next as int]);
            if take_left && i < left.len() {
                assert(key_le(k[left[i - 1] as int], k[left[i as int] as int])) by {
                    assert(arranged(k, left@)[i - 1] == k[left[i - 1] as int] && arranged(k, left@)[i as int] == k[left[i as int] as int]);
                }
            }
            if !take_left && j < right.len() {
                assert(key_le(k[right[j - 1] as int], k[right[j as int] as int])) by {
                    assert(arranged(k, right@)[j - 1] == k[right[j - 1] as int] && arranged(k, right@)[j as int] == k[right[j as int] as int]);
                }
            }
        }
    }
    proof {
        assert(left@.subrange(i as int, left.len() as int) =~= Seq::<usize>::empty());
        assert(right@.subrange(j as int, right.len() as int) =~= Seq::<usize>::empty());
        assert(arranged(k, Seq::<usize>::empty()) =~= Seq::empty());
    }
    merged
}

/// The canonical order of the keys at `lo..hi`.
fn sort_range(keys: &[Vec<Vec<u16>>], lo: usize, hi: usize) -> (order: Vec<usize>)
    requires lo <= hi <= keys.len(),
    ensures
        sorts(keys_view(keys), order@),
        order@.to_multiset() == range(lo as int, hi as int).to_multiset(),
        arranged(keys_view(keys), order@).to_multiset() == arranged(keys_view(keys), range(lo as int, hi as int)).to_multiset(),
    decreases hi - lo,
{
    let ghost k = keys_view(keys);
    if hi - lo == 0 {
        assert(range(lo as int, hi as int) =~= Seq::<usize>::empty());
        return Vec::new();
    }
    if hi - lo == 1 {
        let order = vec![lo];
        assert(order@ =~= range(lo as int, hi as int));
        return order;
    }
    let mid = lo + (hi - lo) / 2;
    let left = sort_range(keys, lo, mid);
    let right = sort_range(keys, mid, hi);
    proof {
        let (a, b) = (range(lo as int, mid as int), range(mid as int, hi as int));
        assert(range(lo as int, hi as int) =~= a + b);
        vstd::seq_lib::lemma_multiset_commutative(a, b);
        assert(arranged(k, a + b) =~= arranged(k, a) + arranged(k, b));
        vstd::seq_lib::lemma_multiset_commutative(arranged(k, a), arranged(k, b));
    }
    merge(keys, left, right)
}

/// The permutation that puts `keys` in canonical order: each index once, in
/// the order of its key. Equal keys are left in either order.
pub fn sort(keys: &[Vec<Vec<u16>>]) -> (order: Vec<usize>)
    ensures
        // A permutation: every index exactly once.
        order@.to_multiset() == range(0, keys.len() as int).to_multiset(),
        // In canonical order.
        sorted(arranged(keys_view(keys), order@)),
        // Of exactly the keys given.
        arranged(keys_view(keys), order@).to_multiset() == keys_view(keys).to_multiset(),
{
    let order = sort_range(keys, 0, keys.len());
    proof {
        assert(arranged(keys_view(keys), range(0, keys.len() as int)) =~= keys_view(keys));
    }
    order
}

/// The canonical order is canonical: two arrangements of the same keys sort
/// to the same sequence, and sorting keys already in canonical order leaves
/// them as they are.
pub proof fn canonical(first: Seq<Seq<Seq<u16>>>, second: Seq<Seq<Seq<u16>>>, sorted_first: Seq<Seq<Seq<u16>>>, sorted_second: Seq<Seq<Seq<u16>>>)
    requires
        first.to_multiset() == second.to_multiset(),
        sorted(sorted_first), sorted_first.to_multiset() == first.to_multiset(),
        sorted(sorted_second), sorted_second.to_multiset() == second.to_multiset(),
    ensures
        sorted_first == sorted_second,
        sorted(first) ==> sorted_first == first,
{
    key_le_total_ordering();
    let le = |a: Seq<Seq<u16>>, b: Seq<Seq<u16>>| key_le(a, b);
    assert(vstd::relations::sorted_by(sorted_first, le));
    assert(vstd::relations::sorted_by(sorted_second, le));
    vstd::seq_lib::lemma_sorted_unique(sorted_first, sorted_second, le);
    if sorted(first) {
        assert(vstd::relations::sorted_by(first, le));
        vstd::seq_lib::lemma_sorted_unique(sorted_first, first, le);
    }
}

} // verus!
