// Mutants for src/unchanged.rs: one planted bug per clause of unchanged, status, status_accepted, listed, hides and
// the theorem. See scripts/mutants.mjs.
export default [
  {
    name: 'unchanged ignores a volatile difference beyond tolerance',
    from: '    residual_empty && all_within\n}',
    to: '    residual_empty\n}',
    clause: 'ensures r == (residual_empty && all_within),',
  },
  {
    name: 'status calls every pair unchanged',
    from: '    if unchanged { Status::Unchanged } else { Status::Modified }\n}\n\n/// Whether the Engine',
    to: '    Status::Unchanged\n}\n\n/// Whether the Engine',
    clause: 'ensures r == status_of(unchanged),',
  },
  {
    name: 'status_accepted accepts unchanged for a modified pair',
    from: '        Status::Unchanged => unchanged,',
    to: '        Status::Unchanged => true,',
    clause: 'ensures r == (claimed == status_of(unchanged)),',
  },
  {
    name: 'listed leaves out an exact pair whose values varied',
    from: '    !(matches!(correspondence, Correspondence::Exact) && matches!(status, Status::Unchanged) && varied_empty)',
    to: '    !(matches!(correspondence, Correspondence::Exact) && matches!(status, Status::Unchanged))',
    clause: 'ensures !r <==> (correspondence == Correspondence::Exact && status == Status::Unchanged && varied_empty),',
  },
  {
    name: 'hides lets an item with a changed counterpart be left out',
    from: '    !matches!(counterpart_same, Some(true))',
    to: '    !matches!(counterpart_same, Some(_))',
    clause: 'ensures !r <==> counterpart_same == Some(true),',
  },
  {
    name: 'an unchanged status ignores volatile differences, in code and contract alike',
    from: 'if unchanged { Status::Unchanged } else { Status::Modified }',
    to: 'if unchanged || true { Status::Unchanged } else { Status::Modified }',
    clause: 'accepted(Status::Unchanged, residual_empty && all_within) ==> residual_empty && all_within,',
  },
]
