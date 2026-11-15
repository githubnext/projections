//! Residual differences: what differs between two items' data outside the
//! paths their volatile declarations cover.
//!
//! [`residual_keys`] lists the data keys whose values differ anywhere outside
//! the skipped paths ([`Skip`], a trie of the volatile and basis paths), and
//! [`differs`] decides one pair of values. Verus proves both exact: a key is
//! listed, and a pair differs, exactly when the values are not [`alike`],
//! equal everywhere outside the skipped paths. So an assessment with no
//! residual difference means the data is equal outside declared variation.
//!
//! The proofs trust what the types promise: `Datum`'s `==` decides equality
//! of values that aren't both objects or both arrays (numbers by value), an
//! array index's key is its decimal digits, and `String`'s order is a lawful
//! total order, so a `BTreeMap` lookup finds what the map holds.

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;

use crate::datum::{Datum, Fields};
use alloc::collections::BTreeMap;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

verus! {

#[cfg(verus_keep_ghost)]
broadcast use vstd::std_specs::btree::group_btree_axioms;

/// Paths to skip, as a trie of keys: a node marked `here` skips everything
/// below it.
pub struct Skip {
    pub here: bool,
    pub below: BTreeMap<String, Skip>,
}

/// `Datum`'s `==`: structural, numbers by value.
pub uninterp spec fn same_value(a: Datum, b: Datum) -> bool;

/// An array index's key: its decimal digits.
pub uninterp spec fn decimal(index: int) -> String;

#[verifier::external_body]
fn equal(a: &Datum, b: &Datum) -> (r: bool)
    ensures r == same_value(*a, *b),
{
    a == b
}

#[verifier::external_body]
fn index_key(index: usize) -> (r: String)
    ensures r == decimal(index as int),
{
    index.to_string()
}

pub open spec fn view(skip: Option<&Skip>) -> Option<Skip> {
    match skip {
        Some(skip) => Some(*skip),
        None => None,
    }
}

/// The skip trie one key down.
pub open spec fn below(skip: Option<Skip>, key: String) -> Option<Skip> {
    match skip {
        Some(skip) if skip.below@.contains_key(key) => Some(skip.below@[key]),
        _ => None,
    }
}

/// Whether the trie skips everything here.
pub open spec fn skipped(skip: Option<Skip>) -> bool {
    skip matches Some(skip) && skip.here
}

/// Whether `a` and `b` are equal everywhere outside the skipped paths: an
/// object's or array's entries pairwise, an entry on one side only only if
/// its path is skipped, and other values by `Datum`'s `==`.
pub open spec fn alike(a: Datum, b: Datum, skip: Option<Skip>) -> bool
    decreases a,
{
    if skipped(skip) {
        true
    } else {
        match (a, b) {
            (Datum::Object(x), Datum::Object(y)) => forall|k: String| #![trigger below(skip, k)]
                (x@.contains_key(k) && y@.contains_key(k) ==> alike(x@[k], y@[k], below(skip, k)))
                && (x@.contains_key(k) != y@.contains_key(k) ==> skipped(below(skip, k))),
            (Datum::Array(x), Datum::Array(y)) => forall|i: int| #![trigger below(skip, decimal(i))]
                (0 <= i < x.len() && 0 <= i < y.len() ==> alike(x[i], y[i], below(skip, decimal(i))))
                && ((0 <= i < x.len()) != (0 <= i < y.len()) ==> skipped(below(skip, decimal(i)))),
            _ => same_value(a, b),
        }
    }
}

/// Whether `keys` lists `key`.
pub open spec fn has_key(keys: Seq<&String>, key: String) -> bool {
    exists|p: int| 0 <= p < keys.len() && *#[trigger] keys[p] == key
}

/// Whether key `k` of two objects' fields is alike: both present and alike,
/// one present and skipped, or neither.
pub open spec fn key_alike(x: Map<String, Datum>, y: Map<String, Datum>, skip: Option<Skip>, k: String) -> bool {
    &&& (x.contains_key(k) && y.contains_key(k) ==> alike(x[k], y[k], below(skip, k)))
    &&& (x.contains_key(k) != y.contains_key(k) ==> skipped(below(skip, k)))
}

fn below_exec<'a>(skip: Option<&'a Skip>, key: &String) -> (r: Option<&'a Skip>)
    requires vstd::laws_cmp::obeys_cmp::<String>(),
    ensures view(r) == below(view(skip), *key),
{
    broadcast use {vstd::std_specs::btree::axiom_key_obeys_cmp_spec_meaning, vstd::std_specs::btree::axiom_deref_key_ordering_matches};
    match skip {
        Some(skip) => skip.below.get(key),
        None => None,
    }
}

fn skipped_exec(skip: Option<&Skip>) -> (r: bool)
    ensures r == skipped(view(skip)),
{
    match skip {
        Some(skip) => skip.here,
        None => false,
    }
}

/// Whether two objects' fields differ at some key outside the skipped paths.
fn fields_differ(object: &Datum, y: &Fields, skip: Option<&Skip>) -> (r: bool)
    requires
        vstd::laws_cmp::obeys_cmp::<String>(),
        object is Object,
    ensures r == !(forall|k: String| #[trigger] key_alike(object->Object_0@, y@, view(skip), k)),
    decreases *object, 0nat,
{
    let x = match object {
        Datum::Object(x) => x,
        _ => return false,
    };
    assert(*x == object->Object_0);
    broadcast use {vstd::std_specs::btree::axiom_key_obeys_cmp_spec_meaning, vstd::std_specs::btree::axiom_deref_key_ordering_matches};
    let iter = x.iter();
    let ghost all = vstd::std_specs::iter::IteratorSpec::remaining(&iter);
    assert(vstd::std_specs::btree::key_obeys_cmp_spec::<String>());
    for (key, value) in it: iter
        invariant
            it.seq() == all,
            vstd::laws_cmp::obeys_cmp::<String>(),
            object is Object, *x == object->Object_0,
            forall|k: String| #[trigger] x@.contains_key(k) ==> all.contains((&k, &x@[k])),
            forall|i: int| 0 <= i < all.len() ==> x@.contains_key(*(#[trigger] all[i]).0) && x@[*all[i].0] == *all[i].1,
            forall|i: int| 0 <= i < it.index() ==> #[trigger] key_alike(x@, y@, view(skip), *all[i].0),
    {
        let ghost at = it.index();
        assert(*all[at].0 == *key && *all[at].1 == *value);
        let child = below_exec(skip, key);
        let differs_here = match y.get(key) {
            Some(other) => {
                proof {
                    assert(decreases_to!(*object => object->Object_0));
                    vstd::std_specs::btree::axiom_btree_map_decreases(*x);
                    vstd::map::axiom_map_index_decreases(x@, *key);
                }
                differs(value, other, child)
            }
            None => !skipped_exec(child),
        };
        assert(differs_here == !key_alike(x@, y@, view(skip), *key));
        if differs_here {
            return true;
        }
    }
    let iter = y.iter();
    let ghost others = vstd::std_specs::iter::IteratorSpec::remaining(&iter);
    for (key, _value) in it: iter
        invariant
            it.seq() == others,
            vstd::laws_cmp::obeys_cmp::<String>(),
            object is Object, *x == object->Object_0,
            forall|k: String| #[trigger] y@.contains_key(k) ==> others.contains((&k, &y@[k])),
            forall|i: int| 0 <= i < others.len() ==> y@.contains_key(*(#[trigger] others[i]).0),
            forall|k: String| x@.contains_key(k) ==> #[trigger] key_alike(x@, y@, view(skip), k),
            forall|i: int| 0 <= i < it.index() ==> #[trigger] key_alike(x@, y@, view(skip), *others[i].0),
    {
        let ghost at = it.index();
        assert(*others[at].0 == *key);
        if !x.contains_key(key) && !skipped_exec(below_exec(skip, key)) {
            assert(!key_alike(x@, y@, view(skip), *key));
            return true;
        }
    }
    proof {
        assert forall|k: String| #[trigger] key_alike(x@, y@, view(skip), k) by {
            if y@.contains_key(k) && !x@.contains_key(k) {
                let i = choose|i: int| 0 <= i < others.len() && others[i] == (&k, &y@[k]);
                assert(*others[i].0 == k);
            }
        }
    }
    false
}

/// Whether two values differ anywhere outside the skipped paths: exactly
/// when they are not [`alike`].
pub fn differs(a: &Datum, b: &Datum, skip: Option<&Skip>) -> (r: bool)
    requires vstd::laws_cmp::obeys_cmp::<String>(),
    ensures r == !alike(*a, *b, view(skip)),
    decreases *a, 1nat,
{
    if skipped_exec(skip) {
        return false;
    }
    match (a, b) {
        (Datum::Object(_), Datum::Object(y)) => {
            let r = fields_differ(a, y, skip);
            proof {
                if !r {
                    assert forall|k: String| #![trigger below(view(skip), k)]
                        (a->Object_0@.contains_key(k) && y@.contains_key(k) ==> alike(a->Object_0@[k], y@[k], below(view(skip), k)))
                        && (a->Object_0@.contains_key(k) != y@.contains_key(k) ==> skipped(below(view(skip), k))) by {
                        assert(key_alike(a->Object_0@, y@, view(skip), k));
                    }
                } else {
                    let k = choose|k: String| !#[trigger] key_alike(a->Object_0@, y@, view(skip), k);
                    assert(!((a->Object_0@.contains_key(k) && y@.contains_key(k) ==> alike(a->Object_0@[k], y@[k], below(view(skip), k)))
                        && (a->Object_0@.contains_key(k) != y@.contains_key(k) ==> skipped(below(view(skip), k)))));
                }
            }
            r
        }
        (Datum::Array(x), Datum::Array(y)) => {
            let longest = if x.len() > y.len() { x.len() } else { y.len() };
            let mut i = 0;
            while i < longest
                invariant
                    vstd::laws_cmp::obeys_cmp::<String>(),
                    !skipped(view(skip)),
                    *a == Datum::Array(*x), *b == Datum::Array(*y),
                    longest >= x.len(), longest >= y.len(), longest == x.len() || longest == y.len(),
                    i <= longest,
                    forall|j: int| #![trigger below(view(skip), decimal(j))] 0 <= j < i ==>
                        (0 <= j < x.len() && 0 <= j < y.len() ==> alike(x[j], y[j], below(view(skip), decimal(j))))
                        && ((0 <= j < x.len()) != (0 <= j < y.len()) ==> skipped(below(view(skip), decimal(j)))),
                decreases longest - i,
            {
                let key = index_key(i);
                let child = below_exec(skip, &key);
                let differs_here = if i < x.len() && i < y.len() {
                    proof {
                        assert(decreases_to!(*a => a->Array_0));
                        vstd::std_specs::vec::axiom_vec_index_decreases(*x, i as int);
                    }
                    differs(&x[i], &y[i], child)
                } else {
                    !skipped_exec(child)
                };
                if differs_here {
                    proof {
                        let j = i as int;
                        assert(!((0 <= j < x.len() && 0 <= j < y.len() ==> alike(x[j], y[j], below(view(skip), decimal(j))))
                            && ((0 <= j < x.len()) != (0 <= j < y.len()) ==> skipped(below(view(skip), decimal(j))))));
                    }
                    return true;
                }
                i += 1;
            }
            proof {
                assert forall|j: int| #![trigger below(view(skip), decimal(j))]
                    (0 <= j < x.len() && 0 <= j < y.len() ==> alike(x[j], y[j], below(view(skip), decimal(j))))
                    && ((0 <= j < x.len()) != (0 <= j < y.len()) ==> skipped(below(view(skip), decimal(j)))) by {
                }
            }
            false
        }
        _ => !equal(a, b),
    }
}

/// The keys of two items' data whose values differ anywhere outside the
/// skipped paths, each once: the before item's in order, then those only
/// the after item has.
pub fn residual_keys<'a>(before: &'a Fields, after: &'a Fields, skip: &Skip) -> (keys: Vec<&'a String>)
    requires vstd::laws_cmp::obeys_cmp::<String>(),
    ensures
        forall|k: String| #[trigger] has_key(keys@, k)
            <==> !key_alike(before@, after@, Some(*skip), k),
{
    broadcast use {vstd::std_specs::btree::axiom_key_obeys_cmp_spec_meaning, vstd::std_specs::btree::axiom_deref_key_ordering_matches};
    let mut keys: Vec<&'a String> = Vec::new();
    let iter = before.iter();
    let ghost all = vstd::std_specs::iter::IteratorSpec::remaining(&iter);
    assert(vstd::std_specs::btree::key_obeys_cmp_spec::<String>());
    for (key, value) in it: iter
        invariant
            it.seq() == all,
            vstd::laws_cmp::obeys_cmp::<String>(),
            all.no_duplicates(),
            forall|k: String| #[trigger] before@.contains_key(k) ==> all.contains((&k, &before@[k])),
            forall|i: int| 0 <= i < all.len() ==> before@.contains_key(*(#[trigger] all[i]).0) && before@[*all[i].0] == *all[i].1,
            forall|k: String| #[trigger] has_key(keys@, k) <==>
                (exists|i: int| 0 <= i < it.index() && *(#[trigger] all[i]).0 == k && !key_alike(before@, after@, Some(*skip), k)),
    {
        let ghost at = it.index();
        assert(*all[at].0 == *key && *all[at].1 == *value);
        let child = below_exec(Some(skip), key);
        let differs_here = match after.get(key) {
            Some(other) => differs(value, other, child),
            None => !skipped_exec(child),
        };
        assert(differs_here == !key_alike(before@, after@, Some(*skip), *key));
        let ghost old_keys = keys@;
        if differs_here {
            keys.push(key);
        }
        proof {
            assert forall|k: String| #[trigger] has_key(keys@, k) <==>
                (exists|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && !key_alike(before@, after@, Some(*skip), k)) by {
                if has_key(keys@, k) {
                    let p = choose|p: int| 0 <= p < keys.len() && *#[trigger] keys@[p] == k;
                    if p < old_keys.len() {
                        assert(old_keys[p] == keys@[p]);
                        assert(has_key(old_keys, k));
                    } else {
                        assert(*all[at].0 == k && !key_alike(before@, after@, Some(*skip), k));
                    }
                }
                if exists|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && !key_alike(before@, after@, Some(*skip), k) {
                    let i = choose|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && !key_alike(before@, after@, Some(*skip), k);
                    if i == at {
                        assert(keys@[keys.len() - 1] == key);
                    } else {
                        assert(has_key(old_keys, k));
                        let p = choose|p: int| 0 <= p < old_keys.len() && *#[trigger] old_keys[p] == k;
                        assert(keys@[p] == old_keys[p]);
                    }
                }
            }
        }
    }
    let iter = after.iter();
    let ghost others = vstd::std_specs::iter::IteratorSpec::remaining(&iter);
    for (key, _value) in it: iter
        invariant
            it.seq() == others,
            vstd::laws_cmp::obeys_cmp::<String>(),
            forall|k: String| #[trigger] after@.contains_key(k) ==> others.contains((&k, &after@[k])),
            forall|i: int| 0 <= i < others.len() ==> after@.contains_key(*(#[trigger] others[i]).0),
            forall|k: String| #[trigger] has_key(keys@, k) <==>
                ((before@.contains_key(k) && !key_alike(before@, after@, Some(*skip), k))
                || (exists|i: int| 0 <= i < it.index() && *(#[trigger] others[i]).0 == k && !before@.contains_key(k)
                    && !key_alike(before@, after@, Some(*skip), k))),
    {
        let ghost at = it.index();
        assert(*others[at].0 == *key);
        let ghost old_keys = keys@;
        let differs_here = !before.contains_key(key) && !skipped_exec(below_exec(Some(skip), key));
        if differs_here {
            keys.push(key);
        }
        proof {
            assert forall|k: String| #[trigger] has_key(keys@, k) <==>
                ((before@.contains_key(k) && !key_alike(before@, after@, Some(*skip), k))
                || (exists|i: int| 0 <= i <= at && *(#[trigger] others[i]).0 == k && !before@.contains_key(k)
                    && !key_alike(before@, after@, Some(*skip), k))) by {
                if has_key(keys@, k) {
                    let p = choose|p: int| 0 <= p < keys.len() && *#[trigger] keys@[p] == k;
                    if p < old_keys.len() {
                        assert(old_keys[p] == keys@[p]);
                        assert(has_key(old_keys, k));
                    } else {
                        assert(*others[at].0 == k && after@.contains_key(k) && !before@.contains_key(k));
                        assert(!key_alike(before@, after@, Some(*skip), k));
                    }
                }
                if (before@.contains_key(k) && !key_alike(before@, after@, Some(*skip), k))
                    || (exists|i: int| 0 <= i <= at && *(#[trigger] others[i]).0 == k && !before@.contains_key(k)
                        && !key_alike(before@, after@, Some(*skip), k)) {
                    if before@.contains_key(k) && !key_alike(before@, after@, Some(*skip), k) {
                        assert(has_key(old_keys, k));
                        let p = choose|p: int| 0 <= p < old_keys.len() && *#[trigger] old_keys[p] == k;
                        assert(keys@[p] == old_keys[p]);
                    } else {
                        let i = choose|i: int| 0 <= i <= at && *(#[trigger] others[i]).0 == k && !before@.contains_key(k)
                            && !key_alike(before@, after@, Some(*skip), k);
                        if i == at {
                            assert(keys@[keys.len() - 1] == key);
                        } else {
                            assert(has_key(old_keys, k));
                            let p = choose|p: int| 0 <= p < old_keys.len() && *#[trigger] old_keys[p] == k;
                            assert(keys@[p] == old_keys[p]);
                        }
                    }
                }
            }
        }
    }
    proof {
        assert forall|k: String| #[trigger] has_key(keys@, k)
            <==> !key_alike(before@, after@, Some(*skip), k) by {
            if !key_alike(before@, after@, Some(*skip), k) && !before@.contains_key(k) {
                let i = choose|i: int| 0 <= i < others.len() && others[i] == (&k, &after@[k]);
                assert(*others[i].0 == k);
            }
        }
    }
    keys
}

} // verus!

impl Skip {
    /// A trie that skips nothing.
    pub fn new() -> Skip {
        Skip {
            here: false,
            below: BTreeMap::new(),
        }
    }

    /// Skips everything at and below `keys`.
    pub fn insert(&mut self, keys: &[String]) {
        match keys.split_first() {
            None => self.here = true,
            Some((first, rest)) => self.below.entry(first.clone()).or_default().insert(rest),
        }
    }
}

impl Default for Skip {
    fn default() -> Skip {
        Skip::new()
    }
}
