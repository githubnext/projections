// Mutants for src/tolerance.rs: one planted bug per clause of within, tighter, Rule::merge and the theorems, including
// the asymmetric rules the symmetric ones replaced. See scripts/mutants.mjs.
export default [
  {
    name: 'within ignores the magnitude for the relative bound',
    from: '        if le(d, mul(bound, largest(before, after))) {',
    to: '        if le(d, bound) {',
    clause: 'r == accepts(difference(before, after), magnitude(before, after), absolute, relative, spreads@),',
  },
  {
    name: 'within accepts when any one spread holds',
    from: '        if !le(d, mul(factor, scale)) {\n            return false;\n        }',
    to: '        if le(d, mul(factor, scale)) {\n            return true;\n        }',
    clause: 'r == accepts(difference(before, after), magnitude(before, after), absolute, relative, spreads@),',
  },
  {
    name: 'within accepts with no bound at all',
    from: '    if spreads.is_empty() {\n        return false;\n    }',
    to: '    if spreads.is_empty() {\n        return true;\n    }',
    clause: 'r == accepts(difference(before, after), magnitude(before, after), absolute, relative, spreads@),',
  },
  {
    name: 'a bound holds when the difference exceeds it, in code and contract alike',
    from: '        Some(bound) => at_most(d, bound),',
    to: '        Some(bound) => at_most(bound, d),',
    also: [['        if le(d, bound) {', '        if le(bound, d) {']],
    clause: 'accepts(d, m, absolute.1, relative.1, spreads.1),',
  },
  {
    name: 'tighter keeps the earlier bound',
    from: '        (Some(a), Some(b)) => Some(min(a, b)),',
    to: '        (Some(a), Some(b)) => Some(a),',
    clause: 'ensures r == tighter_bound_spec(a, b),',
  },
  {
    name: 'tighter keeps the earlier bound, in code and contract alike',
    from: '        (Some(a), Some(b)) => Some(least(a, b)),',
    to: '        (Some(a), Some(b)) => Some(a),',
    also: [['        (Some(a), Some(b)) => Some(min(a, b)),', '        (Some(a), Some(b)) => Some(a),']],
    clause: 'admits(merged, d, m, scale) == both_accept(earlier, later, d, m, scale),',
  },
  {
    name: 'tighter keeps the spreads only one side declares, in code and contract alike',
    from: 'merged.spreads@ == if earlier.spreads.len() > 0 && later.spreads.len() > 0 {',
    to: 'merged.spreads@ == if earlier.spreads.len() > 0 || later.spreads.len() > 0 {',
    also: [
      ['if !earlier.spreads.is_empty() && !later.spreads.is_empty() {', 'if !earlier.spreads.is_empty() || !later.spreads.is_empty() {'],
    ],
    clause: 'admits(merged, d, m, scale) == both_accept(earlier, later, d, m, scale),',
    step: 'assert(scaled(merged.spreads@, scale) =~= Seq::empty());',
  },
  {
    name: "tighter lets the after side's spreads win, in code and contract alike",
    from: '        earlier.spreads@ + later.spreads@',
    to: '        later.spreads@',
    also: [
      [
        '        let mut spreads = earlier.spreads;\n        let mut more = later.spreads;\n        spreads.append(&mut more);\n        spreads',
        '        later.spreads',
      ],
    ],
    clause: 'admits(merged, d, m, scale) == both_accept(earlier, later, d, m, scale),',
    step: 'assert(scaled(merged.spreads@, scale) =~= e + l);',
  },
  {
    name: "merge lets the after side's basis win",
    from: '            (Rule::Generated(mut a), Rule::Generated(mut b)) => {\n                a.append(&mut b);\n                Rule::Generated(a)\n            }',
    to: '            (Rule::Generated(_), Rule::Generated(b)) => Rule::Generated(b),',
    clause: 'ensures merges(r, earlier, later),',
  },
  {
    name: "merge lets the after side's basis win, in code and contract alike",
    from: 'merged matches Rule::Generated(bases) && bases@ == a@ + b@,',
    to: 'merged matches Rule::Generated(bases) && bases@ == b@,',
    also: [
      [
        '            (Rule::Generated(mut a), Rule::Generated(mut b)) => {\n                a.append(&mut b);\n                Rule::Generated(a)\n            }',
        '            (Rule::Generated(_), Rule::Generated(b)) => Rule::Generated(b),',
      ],
    ],
    clause: 'forward matches Rule::Generated(f) ==> backward matches Rule::Generated(b) && f@.to_multiset() == b@.to_multiset(),',
  },
  {
    name: 'merge drops a declared tolerance when the other side declares none',
    from: '(Rule::Plain(None), Rule::Plain(effective)) | (Rule::Plain(effective), Rule::Plain(None)) => Rule::Plain(effective),',
    to: '(Rule::Plain(None), Rule::Plain(_)) | (Rule::Plain(_), Rule::Plain(None)) => Rule::Plain(None),',
    clause: 'ensures merges(r, earlier, later),',
  },
]
