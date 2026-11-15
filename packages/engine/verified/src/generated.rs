//! Generated values: a value an extractor generates from a basis, such as a
//! summary a model wrote from some inputs, is judged by its basis, never by
//! its text.
//!
//! [`moved_parts`] finds the basis parts that differ between two bases, and
//! [`judge`] decides a generated value from its two values and its bases (one
//! pair per basis path its declarations give; it moved if any moved). Verus
//! proves that a basis moves exactly when the two bases differ, so equal
//! bases mean the value is unchanged however its text varies, and a moved
//! basis, or a value on one side only, is always beyond tolerance.
//!
//! Part names `K` and values `V` are the Engine's strings and data. The proofs
//! assume what the types promise: `K`'s order is a lawful total order, so a
//! `BTreeMap` lookup finds what the map holds, and two values are equal when
//! `V`'s `==` says so.

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;
#[cfg(verus_keep_ghost)]
use vstd::std_specs::cmp::PartialEqSpec;

use alloc::collections::BTreeMap;
use alloc::vec::Vec;

verus! {

#[cfg(verus_keep_ghost)]
broadcast use vstd::std_specs::btree::group_btree_axioms;

/// A basis part's value, if the basis has the part. A basis that isn't an
/// object of parts (`None`) has none.
pub open spec fn part<K, V>(basis: Option<Map<K, V>>, name: K) -> Option<V> {
    match basis {
        Some(parts) if parts.contains_key(name) => Some(parts[name]),
        _ => None,
    }
}

/// Whether part `name` moved between two bases: its values differ, or one
/// basis has it and the other doesn't.
pub open spec fn moved<K, V: PartialEq>(before: Option<Map<K, V>>, after: Option<Map<K, V>>, name: K) -> bool {
    match (part(before, name), part(after, name)) {
        (Some(a), Some(b)) => !a.eq_spec(&b),
        (None, None) => false,
        _ => true,
    }
}

/// Whether two bases are equal: every part has equal values on both sides.
pub open spec fn equal_bases<K, V: PartialEq>(before: Option<Map<K, V>>, after: Option<Map<K, V>>) -> bool {
    forall|name: K| !#[trigger] moved(before, after, name)
}

/// Whether `names` lists `name`.
pub open spec fn listed<K>(names: Seq<&K>, name: K) -> bool {
    exists|i: int| 0 <= i < names.len() && *#[trigger] names[i] == name
}

/// Whether `names` lists each name once.
pub open spec fn distinct<K>(names: Seq<&K>) -> bool {
    forall|i: int, j: int| 0 <= i < j < names.len() ==> *#[trigger] names[i] != *#[trigger] names[j]
}

pub open spec fn view<K, V>(basis: Option<&BTreeMap<K, V>>) -> Option<Map<K, V>> {
    match basis {
        Some(parts) => Some(parts@),
        None => None,
    }
}

/// The names of the basis parts that moved, each once: the before basis's in
/// its order, then those only the after basis has.
pub fn moved_parts<'a, K: Ord, V: PartialEq>(before: Option<&'a BTreeMap<K, V>>, after: Option<&'a BTreeMap<K, V>>) -> (names: Vec<&'a K>)
    requires
        vstd::laws_cmp::obeys_cmp::<K>(),
        V::obeys_eq_spec(),
    ensures
        forall|name: K| #[trigger] listed(names@, name) <==> moved(view(before), view(after), name),
        distinct(names@),
{
    broadcast use {vstd::std_specs::btree::axiom_key_obeys_cmp_spec_meaning, vstd::std_specs::btree::axiom_deref_key_ordering_matches};
    let mut names: Vec<&'a K> = Vec::new();
    if let Some(parts) = before {
        let iter = parts.iter();
        let ghost all = vstd::std_specs::iter::IteratorSpec::remaining(&iter);
        assert(vstd::std_specs::btree::key_obeys_cmp_spec::<K>());
        for (name, value) in it: iter
            invariant
                it.seq() == all,
                vstd::laws_cmp::obeys_cmp::<K>(),
                V::obeys_eq_spec(),
                before == Some(parts),
                all.no_duplicates(),
                forall|k: K| #[trigger] parts@.contains_key(k) ==> all.contains((&k, &parts@[k])),
                forall|i: int| 0 <= i < all.len() ==> parts@.contains_key(*(#[trigger] all[i]).0) && parts@[*all[i].0] == *all[i].1,
                forall|k: K| #[trigger] listed(names@, k) <==>
                    exists|i: int| 0 <= i < it.index() && *(#[trigger] all[i]).0 == k && moved(view(before), view(after), k),
                distinct(names@),
        {
            let ghost at = it.index();
            assert(*all[at].0 == *name && *all[at].1 == *value);
            let differs = match after {
                Some(other) => match other.get(name) {
                    Some(counterpart) => !value.eq(counterpart),
                    None => true,
                },
                None => true,
            };
            assert(differs == moved(view(before), view(after), *name));
            let ghost old_names = names@;
            if differs {
                names.push(name);
            }
            proof {
                assert forall|k: K| #[trigger] listed(names@, k) <==>
                    exists|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && moved(view(before), view(after), k) by {
                    if listed(names@, k) && !listed(old_names, k) {
                        assert(*all[at].0 == k);
                    }
                    if listed(old_names, k) {
                        let p = choose|p: int| 0 <= p < old_names.len() && *#[trigger] old_names[p] == k;
                        assert(names@[p] == old_names[p]);
                    }
                    if exists|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && moved(view(before), view(after), k) {
                        let i = choose|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && moved(view(before), view(after), k);
                        if i == at {
                            assert(names@[names.len() - 1] == name);
                        } else {
                            assert(listed(old_names, k));
                            let p = choose|p: int| 0 <= p < old_names.len() && *#[trigger] old_names[p] == k;
                            assert(names@[p] == old_names[p]);
                        }
                    }
                }
                if differs && listed(old_names, *name) {
                    let i = choose|i: int| 0 <= i < at && *(#[trigger] all[i]).0 == *name && moved(view(before), view(after), *name);
                    assert(all[i] == all[at]);
                }
                assert forall|i: int, j: int| 0 <= i < j < names.len() implies *#[trigger] names@[i] != *#[trigger] names@[j] by {
                    if j == old_names.len() {
                        assert(listed(old_names, *names@[i]));
                    } else {
                        assert(names@[i] == old_names[i] && names@[j] == old_names[j]);
                    }
                }
            }
        }
        proof {
            assert forall|k: K| #[trigger] listed(names@, k) <==> (part(view(before), k) is Some && moved(view(before), view(after), k)) by {
                if parts@.contains_key(k) && moved(view(before), view(after), k) {
                    let i = choose|i: int| 0 <= i < all.len() && all[i] == (&k, &parts@[k]);
                    assert(*all[i].0 == k);
                }
            }
        }
    }
    // A name is listed exactly when the before basis has it and it moved.
    assert(forall|k: K| #[trigger] listed(names@, k) <==> (part(view(before), k) is Some && moved(view(before), view(after), k)));
    if let Some(parts) = after {
        let iter = parts.iter();
        let ghost all = vstd::std_specs::iter::IteratorSpec::remaining(&iter);
        assert(vstd::std_specs::btree::key_obeys_cmp_spec::<K>());
        for (name, _value) in it: iter
            invariant
                it.seq() == all,
                vstd::laws_cmp::obeys_cmp::<K>(),
                after == Some(parts),
                all.no_duplicates(),
                forall|k: K| #[trigger] parts@.contains_key(k) ==> all.contains((&k, &parts@[k])),
                forall|i: int| 0 <= i < all.len() ==> parts@.contains_key(*(#[trigger] all[i]).0) && parts@[*all[i].0] == *all[i].1,
                forall|k: K| #[trigger] listed(names@, k) <==>
                    ((part(view(before), k) is Some && moved(view(before), view(after), k))
                    || exists|i: int| 0 <= i < it.index() && *(#[trigger] all[i]).0 == k && part(view(before), k) is None),
                distinct(names@),
        {
            let ghost at = it.index();
            assert(*all[at].0 == *name);
            let shared = match before {
                Some(other) => other.contains_key(name),
                None => false,
            };
            assert(shared == part(view(before), *name) is Some);
            let ghost old_names = names@;
            if !shared {
                names.push(name);
            }
            proof {
                assert forall|k: K| #[trigger] listed(names@, k) <==>
                    ((part(view(before), k) is Some && moved(view(before), view(after), k))
                    || exists|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && part(view(before), k) is None) by {
                    if listed(names@, k) && !listed(old_names, k) {
                        assert(*all[at].0 == k);
                    }
                    if listed(old_names, k) {
                        let p = choose|p: int| 0 <= p < old_names.len() && *#[trigger] old_names[p] == k;
                        assert(names@[p] == old_names[p]);
                    }
                    if exists|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && part(view(before), k) is None {
                        let i = choose|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && part(view(before), k) is None;
                        if i == at {
                            assert(names@[names.len() - 1] == name);
                        } else {
                            assert(listed(old_names, k));
                            let p = choose|p: int| 0 <= p < old_names.len() && *#[trigger] old_names[p] == k;
                            assert(names@[p] == old_names[p]);
                        }
                    }
                }
                if !shared && listed(old_names, *name) {
                    let i = choose|i: int| 0 <= i < at && *(#[trigger] all[i]).0 == *name && part(view(before), *name) is None;
                    assert(all[i] == all[at]);
                }
                assert forall|i: int, j: int| 0 <= i < j < names.len() implies *#[trigger] names@[i] != *#[trigger] names@[j] by {
                    if j == old_names.len() {
                        assert(listed(old_names, *names@[i]));
                    } else {
                        assert(names@[i] == old_names[i] && names@[j] == old_names[j]);
                    }
                }
            }
        }
        proof {
            assert forall|k: K| #[trigger] listed(names@, k) <==> moved(view(before), view(after), k) by {
                if parts@.contains_key(k) && part(view(before), k) is None {
                    let i = choose|i: int| 0 <= i < all.len() && all[i] == (&k, &parts@[k]);
                    assert(*all[i].0 == k);
                }
            }
        }
    }
    names
}

/// Which side a generated value appears on, when only one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Only {
    Before,
    After,
}

/// How a generated value differs: within tolerance or beyond, the basis
/// parts that moved, and the side it is on when only one.
pub struct Judged<'a, K> {
    pub within: bool,
    pub because: Vec<&'a K>,
    pub only: Option<Only>,
}

/// A generated value's pairs of bases, before and after, one per basis path
/// the declarations give it.
pub type Bases<'a, K, V> = [(Option<&'a BTreeMap<K, V>>, Option<&'a BTreeMap<K, V>>)];

/// Whether every pair of bases is equal.
pub open spec fn all_equal<K, V: PartialEq>(bases: Seq<(Option<&BTreeMap<K, V>>, Option<&BTreeMap<K, V>>)>) -> bool {
    forall|i: int| 0 <= i < bases.len() ==> equal_bases(view(#[trigger] bases[i].0), view(bases[i].1))
}

/// Whether part `name` moved in some pair of bases.
pub open spec fn moved_in_any<K, V: PartialEq>(bases: Seq<(Option<&BTreeMap<K, V>>, Option<&BTreeMap<K, V>>)>, name: K) -> bool {
    exists|i: int| 0 <= i < bases.len() && moved(view(#[trigger] bases[i].0), view(bases[i].1), name)
}

/// Judges one generated value by its bases: none when its values and every
/// pair of bases are equal; otherwise equal bases make any rewording within,
/// and a moved basis (any, where the declarations give several), or a value
/// on one side only, are beyond.
pub fn judge<'a, K: Ord, V: PartialEq>(values: (Option<&V>, Option<&V>), bases: &Bases<'a, K, V>) -> (r: Option<Judged<'a, K>>)
    requires
        vstd::laws_cmp::obeys_cmp::<K>(),
        V::obeys_eq_spec(),
    ensures
        // Equal bases: a value on both sides is unchanged, its text within.
        all_equal(bases@) && values.0 is Some && values.1 is Some
            ==> (r matches Some(judged) ==> judged.within && judged.because@.len() == 0 && judged.only is None),
        all_equal(bases@) && values.0 is Some && values.1 is Some && values.0.unwrap().eq_spec(values.1.unwrap())
            ==> r is None,
        // Nothing else goes unreported: no difference only when the values
        // and the bases are equal.
        r is None ==> values.0 is Some && values.1 is Some && values.0.unwrap().eq_spec(values.1.unwrap())
            && all_equal(bases@),
        // A moved basis: beyond, naming exactly the parts that moved.
        !all_equal(bases@) && values.0 is Some && values.1 is Some
            ==> (r matches Some(judged) && !judged.within && judged.only is None
                && forall|name: K| #[trigger] listed(judged.because@, name) <==> moved_in_any(bases@, name)),
        // A value on one side only: beyond, saying which side.
        values.0 is Some && values.1 is None ==> (r matches Some(judged) && !judged.within && judged.only == Some(Only::Before)
            && judged.because@.len() == 0),
        values.0 is None && values.1 is Some ==> (r matches Some(judged) && !judged.within && judged.only == Some(Only::After)
            && judged.because@.len() == 0),
{
    let mut because: Vec<&'a K> = Vec::new();
    let mut i = 0;
    while i < bases.len()
        invariant
            vstd::laws_cmp::obeys_cmp::<K>(),
            V::obeys_eq_spec(),
            i <= bases.len(),
            forall|name: K| #[trigger] listed(because@, name) <==>
                exists|j: int| 0 <= j < i && moved(view(#[trigger] bases@[j].0), view(bases@[j].1), name),
        decreases bases.len() - i,
    {
        let (before, after) = bases[i];
        let mut parts = moved_parts(before, after);
        let ghost (old_because, found) = (because@, parts@);
        because.append(&mut parts);
        proof {
            assert forall|name: K| #[trigger] listed(because@, name) <==>
                exists|j: int| 0 <= j <= i && moved(view(#[trigger] bases@[j].0), view(bases@[j].1), name) by {
                if listed(because@, name) {
                    let p = choose|p: int| 0 <= p < because.len() && *#[trigger] because@[p] == name;
                    if p < old_because.len() {
                        assert(old_because[p] == because@[p]);
                        assert(listed(old_because, name));
                    } else {
                        assert(found[p - old_because.len()] == because@[p]);
                        assert(listed(found, name));
                    }
                }
                if exists|j: int| 0 <= j <= i && moved(view(#[trigger] bases@[j].0), view(bases@[j].1), name) {
                    let j = choose|j: int| 0 <= j <= i && moved(view(#[trigger] bases@[j].0), view(bases@[j].1), name);
                    if j < i {
                        assert(listed(old_because, name));
                        let p = choose|p: int| 0 <= p < old_because.len() && *#[trigger] old_because[p] == name;
                        assert(because@[p] == old_because[p]);
                    } else {
                        assert(listed(found, name));
                        let p = choose|p: int| 0 <= p < found.len() && *#[trigger] found[p] == name;
                        assert(because@[old_because.len() + p] == found[p]);
                    }
                }
            }
        }
        i += 1;
    }
    let only = match values {
        (Some(_), None) => Some(Only::Before),
        (None, Some(_)) => Some(Only::After),
        _ => None,
    };
    let unchanged = match values {
        (Some(a), Some(b)) => a.eq(b) && because.is_empty(),
        _ => false,
    };
    proof {
        if !all_equal(bases@) {
            let j = choose|j: int| 0 <= j < bases.len() && !equal_bases(view(#[trigger] bases@[j].0), view(bases@[j].1));
            let name = choose|name: K| #[trigger] moved(view(bases@[j].0), view(bases@[j].1), name);
            assert(listed(because@, name));
        }
        if because.len() > 0 {
            assert(listed(because@, *because@[0]));
        }
    }
    if unchanged {
        return None;
    }
    let within = only.is_none() && because.is_empty();
    Some(Judged { within, because: if only.is_some() { Vec::new() } else { because }, only })
}

} // verus!
