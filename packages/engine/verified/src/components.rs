//! Connected components: which items a set of links joins into one group.
//!
//! The default comparator groups identity claims this way (a connected group
//! of claims is one change) and groups changed entities joined by changed
//! relationships for presentation. [`components`] labels every item with a
//! representative of its group. Verus proves two items share a label exactly
//! when a chain of links joins them: every link's two items are grouped
//! together, and nothing else is, so no group is merged silently. A link has
//! no direction, so the groups of a reversed comparison's claims are the same.

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;

use alloc::vec;
use alloc::vec::Vec;

verus! {

/// Whether `link` joins `a` and `b`, in either direction.
pub open spec fn joins(link: (usize, usize), a: int, b: int) -> bool {
    (link.0 as int == a && link.1 as int == b) || (link.0 as int == b && link.1 as int == a)
}

/// Whether `path` is a chain of links: each step stays put or crosses a link.
pub open spec fn chain(links: Seq<(usize, usize)>, path: Seq<int>) -> bool {
    path.len() >= 1 && forall|i: int| 0 <= i < path.len() - 1 ==>
        #[trigger] path[i] == path[i + 1] || exists|k: int| 0 <= k < links.len() && joins(#[trigger] links[k], path[i], path[i + 1])
}

/// Whether a chain of links joins `x` and `y`.
#[verifier::opaque]
pub open spec fn linked(links: Seq<(usize, usize)>, x: int, y: int) -> bool {
    exists|path: Seq<int>| #[trigger] chain(links, path) && path[0] == x && path.last() == y
}

proof fn linked_itself(links: Seq<(usize, usize)>, x: int)
    ensures linked(links, x, x),
{
    reveal(linked);
    assert(chain(links, seq![x]));
}

proof fn linked_by(links: Seq<(usize, usize)>, k: int)
    requires 0 <= k < links.len(),
    ensures linked(links, links[k].0 as int, links[k].1 as int),
{
    reveal(linked);
    let path = seq![links[k].0 as int, links[k].1 as int];
    assert(joins(links[k], path[0], path[1]));
    assert(chain(links, path));
}

proof fn linked_back(links: Seq<(usize, usize)>, x: int, y: int)
    requires linked(links, x, y),
    ensures linked(links, y, x),
{
    reveal(linked);
    let path = choose|path: Seq<int>| #[trigger] chain(links, path) && path[0] == x && path.last() == y;
    let back = path.reverse();
    assert forall|i: int| 0 <= i < back.len() - 1 implies #[trigger] back[i] == back[i + 1]
        || exists|k: int| 0 <= k < links.len() && joins(#[trigger] links[k], back[i], back[i + 1]) by {
        let j = path.len() - 2 - i;
        assert(back[i] == path[j + 1] && back[i + 1] == path[j]);
        assert(path[j] == path[j + 1] || exists|k: int| 0 <= k < links.len() && joins(#[trigger] links[k], path[j], path[j + 1]));
    }
    assert(chain(links, back));
}

proof fn linked_through(links: Seq<(usize, usize)>, x: int, y: int, z: int)
    requires linked(links, x, y), linked(links, y, z),
    ensures linked(links, x, z),
{
    reveal(linked);
    let a = choose|path: Seq<int>| #[trigger] chain(links, path) && path[0] == x && path.last() == y;
    let b = choose|path: Seq<int>| #[trigger] chain(links, path) && path[0] == y && path.last() == z;
    let joined = a + b.drop_first();
    assert forall|i: int| 0 <= i < joined.len() - 1 implies #[trigger] joined[i] == joined[i + 1]
        || exists|k: int| 0 <= k < links.len() && joins(#[trigger] links[k], joined[i], joined[i + 1]) by {
        if i < a.len() - 1 {
            assert(joined[i] == a[i] && joined[i + 1] == a[i + 1]);
        } else {
            let j = i - (a.len() - 1);
            assert(joined[i] == b[j] && joined[i + 1] == b[j + 1]);
        }
    }
    assert(chain(links, joined));
    assert(joined.last() == z) by {
        if b.len() == 1 { assert(joined =~= a); }
    }
}

/// A chain stays within one group when every link does, and below `count`
/// when its start does.
proof fn chain_keeps_label(links: Seq<(usize, usize)>, labels: Seq<usize>, path: Seq<int>, i: int)
    requires
        chain(links, path),
        0 <= i < path.len(),
        0 <= path[0] < labels.len(),
        forall|k: int| 0 <= k < links.len() ==> #[trigger] links[k].0 < labels.len() && links[k].1 < labels.len()
            && labels[links[k].0 as int] == labels[links[k].1 as int],
    ensures 0 <= path[i] < labels.len(), labels[path[i]] == labels[path[0]],
    decreases i,
{
    if i > 0 {
        chain_keeps_label(links, labels, path, i - 1);
        if path[i - 1] != path[i] {
            let k = choose|k: int| 0 <= k < links.len() && joins(#[trigger] links[k], path[i - 1], path[i]);
            assert(labels[links[k].0 as int] == labels[links[k].1 as int]);
        }
    }
}

/// The groups the labels describe: each item is linked to its label, and
/// each group's members, at their slots, are exactly the items with its label.
pub open spec fn grouped(links: Seq<(usize, usize)>, labels: Seq<usize>, members: Seq<Seq<usize>>, slot: Seq<int>) -> bool {
    let count = labels.len();
    &&& members.len() == count && slot.len() == count
    &&& forall|x: int| 0 <= x < count ==> #[trigger] labels[x] < count && linked(links, x, labels[x] as int)
    &&& forall|l: int, i: int| 0 <= l < count && 0 <= i < members[l].len() ==> #[trigger] members[l][i] < count && labels[members[l][i] as int] == l
    &&& forall|x: int| 0 <= x < count ==> 0 <= #[trigger] slot[x] < members[labels[x] as int].len() && members[labels[x] as int][slot[x]] == x
}

/// `a` followed by `b`.
fn appended(a: &[usize], b: &[usize]) -> (r: Vec<usize>)
    ensures r@ == a@ + b@,
{
    let mut r: Vec<usize> = Vec::new();
    let mut i = 0;
    while i < a.len()
        invariant i <= a.len(), r@ == a@.subrange(0, i as int),
        decreases a.len() - i,
    {
        r.push(a[i]);
        i += 1;
    }
    let mut j = 0;
    while j < b.len()
        invariant j <= b.len(), r@ == a@ + b@.subrange(0, j as int),
        decreases b.len() - j,
    {
        r.push(b[j]);
        j += 1;
    }
    assert(a@.subrange(0, a.len() as int) =~= a@);
    assert(b@.subrange(0, b.len() as int) =~= b@);
    r
}

/// Relabels every item of the `small` group `big`. `small` and `links` are
/// read only by the specification.
#[allow(unused_variables)]
fn relabel(labels: &mut [usize], moved: &[usize], small: usize, big: usize, links: &[(usize, usize)])
    requires
        small < old(labels).len(), big < old(labels).len(), small != big,
        linked(links@, small as int, big as int),
        forall|j: int| 0 <= j < moved.len() ==> #[trigger] moved[j] < old(labels).len() && old(labels)[moved[j] as int] == small,
        forall|x: int| 0 <= x < old(labels).len() ==> linked(links@, x, #[trigger] old(labels)[x] as int),
    ensures
        final(labels).len() == old(labels).len(),
        forall|j: int| 0 <= j < moved.len() ==> final(labels)[#[trigger] moved[j] as int] == big,
        forall|x: int| 0 <= x < final(labels).len() ==> #[trigger] final(labels)[x] == old(labels)[x] || (old(labels)[x] == small && final(labels)[x] == big),
        forall|x: int| 0 <= x < final(labels).len() ==> linked(links@, x, #[trigger] final(labels)[x] as int),
{
    let mut i = 0;
    while i < moved.len()
        invariant
            labels.len() == old(labels).len(),
            i <= moved.len(),
            small < labels.len(), big < labels.len(),
            linked(links@, small as int, big as int),
            forall|j: int| 0 <= j < moved.len() ==> #[trigger] moved[j] < old(labels).len() && old(labels)[moved[j] as int] == small,
            forall|j: int| 0 <= j < i ==> labels[#[trigger] moved[j] as int] == big,
            forall|x: int| 0 <= x < labels.len() ==> #[trigger] labels[x] == old(labels)[x] || (old(labels)[x] == small && labels[x] == big),
            forall|x: int| 0 <= x < labels.len() ==> linked(links@, x, #[trigger] labels[x] as int),
        decreases moved.len() - i,
    {
        let x = moved[i];
        proof {
            if labels[x as int] == small {
                linked_through(links@, x as int, small as int, big as int);
            }
        }
        labels[x] = big;
        i += 1;
    }
}

/// The group of each of `count` items under `links`, as one of its members:
/// two items share a label exactly when a chain of links joins them. Every
/// link must join items below `count`.
pub fn components(count: usize, links: &[(usize, usize)]) -> (labels: Vec<usize>)
    requires
        forall|k: int| 0 <= k < links.len() ==> #[trigger] links[k].0 < count && links[k].1 < count,
    ensures
        labels.len() == count,
        forall|x: int| 0 <= x < count ==> #[trigger] labels[x] < count,
        // Every link's two items are in one group.
        forall|k: int| 0 <= k < links.len() ==> labels[#[trigger] links[k].0 as int] == labels[links[k].1 as int],
        // Two items are in one group exactly when a chain of links joins them.
        forall|x: int, y: int| 0 <= x < count && 0 <= y < count ==> (#[trigger] labels[x] == #[trigger] labels[y] <==> linked(links@, x, y)),
{
    let mut labels: Vec<usize> = Vec::new();
    let mut members: Vec<Vec<usize>> = Vec::new();
    let ghost mut slot: Seq<int> = Seq::empty();
    while labels.len() < count
        invariant
            labels.len() == members.len(),
            labels.len() == slot.len(),
            labels.len() <= count,
            forall|x: int| 0 <= x < labels.len() ==> #[trigger] labels[x] == x,
            forall|x: int| 0 <= x < labels.len() ==> #[trigger] members[x]@ == seq![x as usize],
            forall|x: int| 0 <= x < labels.len() ==> #[trigger] slot[x] == 0,
        decreases count - labels.len(),
    {
        let next = labels.len();
        labels.push(next);
        let one: Vec<usize> = vec![next];
        assert(one@ =~= seq![next]);
        let ghost before = members@;
        members.push(one);
        assert forall|x: int| 0 <= x < labels.len() implies #[trigger] members[x]@ == seq![x as usize] by {
            if x < next as int { assert(members[x] == before[x]); }
        }
        proof {
            slot = slot.push(0);
        }
    }
    proof {
        assert forall|x: int| 0 <= x < count implies linked(links@, x, #[trigger] labels[x] as int) by {
            linked_itself(links@, x);
        }
        let now = members@.map_values(|m: Vec<usize>| m@);
        assert forall|l: int, i: int| 0 <= l < count && 0 <= i < now[l].len() implies #[trigger] now[l][i] < count && labels[now[l][i] as int] == l by {
            assert(now[l] == members[l]@);
            assert(members[l]@ == seq![l as usize]);
            assert(now[l][i] == l);
        }
        assert forall|x: int| 0 <= x < count implies 0 <= #[trigger] slot[x] < now[labels[x] as int].len() && now[labels[x] as int][slot[x]] == x by {
            assert(now[x] == members[x]@);
        }
        assert(grouped(links@, labels@, now, slot));
    }
    let mut k = 0;
    while k < links.len()
        invariant
            forall|k: int| 0 <= k < links.len() ==> #[trigger] links[k].0 < count && links[k].1 < count,
            labels.len() == count,
            k <= links.len(),
            grouped(links@, labels@, members@.map_values(|m: Vec<usize>| m@), slot),
            forall|j: int| 0 <= j < k ==> labels[#[trigger] links[j].0 as int] == labels[links[j].1 as int],
        decreases links.len() - k,
    {
        let (u, v) = links[k];
        let (left, right) = (labels[u], labels[v]);
        if left != right {
            let (small, big) = if members[left].len() <= members[right].len() { (left, right) } else { (right, left) };
            proof {
                // The two groups' labels are linked through this link.
                linked_by(links@, k as int);
                linked_back(links@, u as int, left as int);
                linked_through(links@, left as int, u as int, v as int);
                linked_through(links@, left as int, v as int, right as int);
                if small == right {
                    linked_back(links@, left as int, right as int);
                }
            }
            let moved = appended(&Vec::new(), &members[small]);
            let ghost old_labels = labels@;
            let ghost old_members = members@.map_values(|m: Vec<usize>| m@);
            proof {
                assert(moved@ =~= old_members[small as int]);
                assert forall|j: int| 0 <= j < moved.len() implies #[trigger] moved[j] < labels.len() && labels[moved[j] as int] == small by {
                    assert(old_members[small as int][j] == moved[j]);
                }
            }
            let ghost big_len = members[big as int].len() as int;
            relabel(&mut labels, &moved, small, big, links);
            let grown = appended(&members[big], &moved);
            members[big] = grown;
            members[small] = Vec::new();
            let ghost old_slot = slot;
            proof {
                // Items of the small group now sit after the big group's.
                slot = Seq::new(count as nat, |x: int| if old_labels[x] == small { big_len + old_slot[x] } else { old_slot[x] });
                let now = members@.map_values(|m: Vec<usize>| m@);
                assert(now[big as int] == old_members[big as int] + moved@);
                assert(now[small as int] == Seq::<usize>::empty());
                assert forall|l: int| 0 <= l < count && l != big && l != small implies #[trigger] now[l] == old_members[l] by {}
                // Every item of the small group moved.
                assert forall|x: int| 0 <= x < count && old_labels[x] == small implies #[trigger] labels[x] == big by {
                    assert(moved[old_slot[x]] == x);
                }
                assert forall|x: int| 0 <= x < count implies 0 <= #[trigger] slot[x] < now[labels[x] as int].len() && now[labels[x] as int][slot[x]] == x by {
                    if old_labels[x] == small {
                        assert(moved[old_slot[x]] == x);
                        assert(labels[moved[old_slot[x]] as int] == big);
                        assert(now[big as int][big_len + old_slot[x]] == moved[old_slot[x]]);
                    } else {
                        assert(labels[x] == old_labels[x]);
                    }
                }
                assert forall|l: int, i: int| 0 <= l < count && 0 <= i < now[l].len() implies #[trigger] now[l][i] < count && labels[now[l][i] as int] == l by {
                    if l == big && i >= big_len {
                        assert(now[l][i] == moved[i - big_len]);
                    }
                }
                assert(grouped(links@, labels@, now, slot));
            }
        }
        k += 1;
    }
    proof {
        assert forall|x: int, y: int| 0 <= x < count && 0 <= y < count implies (#[trigger] labels[x] == #[trigger] labels[y] <==> linked(links@, x, y)) by {
            if labels[x] == labels[y] {
                linked_back(links@, y, labels[y] as int);
                linked_through(links@, x, labels[x] as int, y);
            }
            if linked(links@, x, y) {
                reveal(linked);
                let path = choose|path: Seq<int>| #[trigger] chain(links@, path) && path[0] == x && path.last() == y;
                chain_keeps_label(links@, labels@, path, path.len() - 1);
            }
        }
    }
    labels
}

} // verus!
