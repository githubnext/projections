// Mutants for src/generated.rs: one planted bug per clause of moved_parts and judge. See scripts/mutants.mjs.
export default [
  {
    name: 'moved_parts reports a part whose values are equal',
    from: '                    Some(counterpart) => !value.eq(counterpart),',
    to: '                    Some(counterpart) => true,',
    clause: 'forall|name: K| #[trigger] listed(names@, name) <==> moved(view(before), view(after), name),',
    step: 'assert(differs == moved(view(before), view(after), *name));',
  },
  {
    name: 'moved_parts misses a part the after basis lacks',
    from: '                    Some(counterpart) => !value.eq(counterpart),\n                    None => true,',
    to: '                    Some(counterpart) => !value.eq(counterpart),\n                    None => false,',
    clause: 'forall|name: K| #[trigger] listed(names@, name) <==> moved(view(before), view(after), name),',
    step: 'assert(differs == moved(view(before), view(after), *name));',
  },
  {
    name: 'moved_parts misses a part only the after basis has',
    from: '            if !shared {',
    to: '            if !shared && false {',
    clause: 'forall|name: K| #[trigger] listed(names@, name) <==> moved(view(before), view(after), name),',
    step: '|| exists|i: int| 0 <= i <= at && *(#[trigger] all[i]).0 == k && part(view(before), k) is None) by {',
  },
  {
    name: 'moved_parts lists a part both bases have twice',
    from: '            if !shared {',
    to: '            if true {',
    clause: 'distinct(names@),',
    step: 'implies *#[trigger] names@[i] != *#[trigger] names@[j] by {',
  },
  {
    name: 'judge hides a reworded value whose basis is equal',
    from: 'a.eq(b) && because.is_empty()',
    to: 'because.is_empty()',
    clause: 'r is None ==> values.0 is Some && values.1 is Some && values.0.unwrap().eq_spec(values.1.unwrap())',
  },
  {
    name: 'judge calls a value within although its basis moved',
    from: 'let within = only.is_none() && because.is_empty();',
    to: 'let within = only.is_none();',
    clause: '==> (r matches Some(judged) && !judged.within && judged.only is None',
  },
  {
    name: 'judge calls a value within although its basis is equal and it is on one side',
    from: 'let within = only.is_none() && because.is_empty();',
    to: 'let within = because.is_empty();',
    clause: 'values.0 is Some && values.1 is None ==> (r matches Some(judged) && !judged.within && judged.only == Some(Only::Before)',
  },
  {
    name: 'judge reports the wrong side',
    from: '        (Some(_), None) => Some(Only::Before),',
    to: '        (Some(_), None) => Some(Only::After),',
    clause: 'values.0 is Some && values.1 is None ==> (r matches Some(judged) && !judged.within && judged.only == Some(Only::Before)',
  },
  {
    name: 'judge names moved parts for a value on one side',
    from: 'because: if only.is_some() { Vec::new() } else { because }',
    to: 'because',
    clause: '&& judged.because@.len() == 0),',
  },
  {
    name: 'judge calls a value with an equal basis beyond',
    from: 'let within = only.is_none() && because.is_empty();',
    to: 'let within = only.is_none() && because.is_empty() && false;',
    clause: '==> (r matches Some(judged) ==> judged.within && judged.because@.len() == 0 && judged.only is None),',
  },
  {
    name: 'judge looks only at the first basis',
    from: '    while i < bases.len()\n',
    to: '    while i < bases.len() && i < 1\n',
    clause: 'forall|name: K| #[trigger] listed(judged.because@, name) <==> moved_in_any(bases@, name)),',
  },
]
