// Mutants for src/keys.rs: one planted bug per clause of tally and unique_pairs. See scripts/mutants.mjs.
export default [
  {
    name: 'unique_pairs pairs a key two after items share',
    from: 'if before_seen[key] == 1 && after_seen[key] == 1 {',
    to: 'if before_seen[key] == 1 && after_seen[key] >= 1 {',
    clause: '&&& unique(before@, i as int) && unique(after@, j as int)',
    step: 'other != j implies #[trigger] after[other] != after[j as int]',
  },
  {
    name: 'unique_pairs skips the first before item',
    from: 'if before_seen[key] == 1 && after_seen[key] == 1 {',
    to: 'if before_seen[key] == 1 && after_seen[key] == 1 && i > 0 {',
    clause: '==> exists|p: int| 0 <= p < pairs.len() && #[trigger] pairs[p] == (i as usize, j as usize),',
    step: 'implies exists|p: int| 0 <= p < pairs.len() && #[trigger] pairs[p] == (pi as usize, j as usize)',
  },
  {
    name: 'unique_pairs pairs an item twice',
    from: '            pairs.push((i, j));\n',
    to: '            pairs.push((i, j));\n            pairs.push((i, j));\n',
    clause: 'forall|p: int, q: int| 0 <= p < q < pairs.len() ==> (#[trigger] pairs[p]).0 != (#[trigger] pairs[q]).0',
    step: 'forall|p: int, q: int| 0 <= p < q < pairs.len() ==> (#[trigger] pairs[p]).0 < (#[trigger] pairs[q]).0',
  },
  {
    name: 'tally never counts a key twice',
    from: '            seen[key] = 2;',
    to: '            seen[key] = 1;',
    clause: 'r.0[#[trigger] keys[index] as int] == 1 ==> r.1[keys[index] as int] == index,',
    step: 'seen[#[trigger] keys[earlier] as int] == 1 ==> at[keys[earlier] as int] == earlier,',
  },
  {
    name: 'tally counts a key twice the first time it sees it',
    from: '            seen[key] = 1;\n            at[key] = index;',
    to: '            seen[key] = 2;\n            at[key] = index;',
    clause: '!unique(keys@, index),',
    step: '0 <= again[key] < index && again[key] != at[key] && keys[again[key]] == key,',
  },
]
