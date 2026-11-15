// Mutants for src/components.rs: one planted bug per clause of components, relabel and appended. See scripts/mutants.mjs.
export default [
  {
    name: 'components ignores the first link',
    from: '        if left != right {',
    to: '        if left != right && k > 0 {',
    clause: 'forall|k: int| 0 <= k < links.len() ==> labels[#[trigger] links[k].0 as int] == labels[links[k].1 as int],',
    step: 'forall|j: int| 0 <= j < k ==> labels[#[trigger] links[j].0 as int] == labels[links[j].1 as int],',
  },
  {
    name: 'components starts every item in one group',
    from: '        labels.push(next);',
    to: '        labels.push(0);',
    clause:
      'forall|x: int, y: int| 0 <= x < count && 0 <= y < count ==> (#[trigger] labels[x] == #[trigger] labels[y] <==> linked(links@, x, y)),',
    step: 'forall|x: int| 0 <= x < labels.len() ==> #[trigger] labels[x] == x,',
  },
  {
    name: 'components forgets the small group after moving it',
    from: '            members[small] = Vec::new();',
    to: '            members[small] = Vec::new();\n            members[big] = Vec::new();',
    clause:
      'forall|x: int, y: int| 0 <= x < count && 0 <= y < count ==> (#[trigger] labels[x] == #[trigger] labels[y] <==> linked(links@, x, y)),',
    step: 'assert(now[big as int] == old_members[big as int] + moved@);',
  },
  {
    name: 'relabel leaves the last item of the small group behind',
    from: '    while i < moved.len()\n',
    to: '    while i + 1 < moved.len()\n',
    clause: 'forall|j: int| 0 <= j < moved.len() ==> final(labels)[#[trigger] moved[j] as int] == big,',
  },
  {
    name: 'relabel moves an item to a group it is not linked to',
    from: '        labels[x] = big;',
    to: '        labels[x] = if x == 0 { small } else { big };',
    clause: 'forall|x: int| 0 <= x < final(labels).len() ==> linked(links@, x, #[trigger] final(labels)[x] as int),',
    step: 'forall|x: int| 0 <= x < labels.len() ==> linked(links@, x, #[trigger] labels[x] as int),',
  },
  {
    name: 'appended drops the last item of b',
    from: '    while j < b.len()\n',
    to: '    while j + 1 < b.len()\n',
    clause: 'ensures r@ == a@ + b@,',
  },
]
