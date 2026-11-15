// Mutants for src/content.rs: one planted bug per clause of differs, fields_differ and residual_keys. See
// scripts/mutants.mjs.
export default [
  {
    name: 'differs ignores the skipped paths',
    from: '    if skipped_exec(skip) {\n        return false;\n    }\n    match (a, b) {',
    to: '    match (a, b) {',
    clause: 'ensures r == !alike(*a, *b, view(skip)),',
  },
  {
    name: 'differs compares arrays only as far as the shorter',
    from: 'let longest = if x.len() > y.len() { x.len() } else { y.len() };',
    to: 'let longest = if x.len() < y.len() { x.len() } else { y.len() };',
    clause: 'ensures r == !alike(*a, *b, view(skip)),',
    step: 'longest >= x.len(), longest >= y.len(),',
  },
  {
    name: 'differs calls any two plain values equal',
    from: '        _ => !equal(a, b),',
    to: '        _ => false,',
    clause: 'ensures r == !alike(*a, *b, view(skip)),',
  },
  {
    name: 'fields_differ ignores a key the after object lacks',
    from: '            None => !skipped_exec(child),\n        };\n        assert(differs_here == !key_alike(x@, y@, view(skip), *key));',
    to: '            None => false,\n        };\n        assert(differs_here == !key_alike(x@, y@, view(skip), *key));',
    clause: 'ensures r == !(forall|k: String| #[trigger] key_alike(object->Object_0@, y@, view(skip), k)),',
    step: 'assert(differs_here == !key_alike(x@, y@, view(skip), *key));',
  },
  {
    name: 'fields_differ ignores keys only the after object has',
    from: '        if !x.contains_key(key) && !skipped_exec(below_exec(skip, key)) {',
    to: '        if false {',
    clause: 'ensures r == !(forall|k: String| #[trigger] key_alike(object->Object_0@, y@, view(skip), k)),',
    step: 'forall|i: int| 0 <= i < it.index() ==> #[trigger] key_alike(x@, y@, view(skip), *others[i].0),',
  },
  {
    name: 'residual_keys misses keys only the after item has',
    from: 'let differs_here = !before.contains_key(key) && !skipped_exec(below_exec(Some(skip), key));',
    to: 'let differs_here = false;',
    clause: '<==> !key_alike(before@, after@, Some(*skip), k),',
    step: '|| (exists|i: int| 0 <= i <= at && *(#[trigger] others[i]).0 == k && !before@.contains_key(k)',
  },
  {
    name: 'residual_keys skips by the whole trie instead of the key',
    from: '        let child = below_exec(Some(skip), key);',
    to: '        let child = Some(skip);',
    clause: '<==> !key_alike(before@, after@, Some(*skip), k),',
    step: 'assert(differs_here == !key_alike(before@, after@, Some(*skip), *key));',
  },
]
