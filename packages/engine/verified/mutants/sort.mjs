// Mutants for src/sort.rs: one planted bug per clause of the comparisons, merge, sort and the canonical theorem. See
// scripts/mutants.mjs.
export default [
  {
    name: 'compare_words orders differing code units backwards',
    from: '            return if a[i] < b[i] { Ordering::Less } else { Ordering::Greater };',
    to: '            return if a[i] < b[i] { Ordering::Greater } else { Ordering::Less };',
    clause: '(r == Ordering::Less) == word_less(a@, b@),',
  },
  {
    name: 'compare_keys treats a later word as equal',
    from: '        if !matches!(order, Ordering::Equal) {',
    to: '        if matches!(order, Ordering::Less) {',
    clause: '(r == Ordering::Greater) == key_less(key_view(b@), key_view(a@)),',
    step: 'x.subrange(0, i as int) == y.subrange(0, i as int),',
  },
  {
    name: 'merge takes the later key first',
    from: '!matches!(compare_keys(keys[right[j]].as_slice(), keys[left[i]].as_slice()), Ordering::Less)',
    to: 'matches!(compare_keys(keys[right[j]].as_slice(), keys[left[i]].as_slice()), Ordering::Less)',
    clause: 'sorts(keys_view(keys), merged@),',
    step: 'merged.len() > 0 && j < right.len() ==> key_le(k[merged@.last() as int], k[right[j as int] as int]),',
  },
  {
    name: 'merge drops the first item',
    from: '        merged.push(next);',
    to: '        if i + j > 0 {\n            merged.push(next);\n        }',
    clause: 'merged@.to_multiset() == left@.to_multiset().add(right@.to_multiset()),',
    step: 'merged@.to_multiset().add(left@.subrange(i as int, left.len() as int).to_multiset())',
  },
  {
    name: 'sort_range skips an item between the halves',
    from: '    let right = sort_range(keys, mid, hi);',
    to: '    let right = sort_range(keys, mid + 1, hi);',
    clause: 'order@.to_multiset() == range(lo as int, hi as int).to_multiset(),',
  },
  {
    name: 'sort sorts only the first half',
    from: '    let order = sort_range(keys, 0, keys.len());',
    to: '    let order = sort_range(keys, 0, keys.len() / 2);',
    clause: 'order@.to_multiset() == range(0, keys.len() as int).to_multiset(),',
  },
  {
    name: 'key order is not strict, in code and contract alike',
    from: '        word_less(a[0], b[0])\n    } else {\n        key_less(a.drop_first(), b.drop_first())',
    to: '        !word_less(b[0], a[0])\n    } else {\n        key_less(a.drop_first(), b.drop_first())',
    clause: 'ensures vstd::relations::total_ordering(|a: Seq<Seq<u16>>, b: Seq<Seq<u16>>| key_le(a, b)),',
    step: 'ensures key_less(a, c),',
  },
  {
    name: 'canonical claims any two key sequences sort alike',
    from: '        first.to_multiset() == second.to_multiset(),\n',
    to: '',
    clause: 'sorted_first == sorted_second,',
    step: 'vstd::seq_lib::lemma_sorted_unique(sorted_first, sorted_second, le);',
  },
]
