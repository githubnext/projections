// Mutants for src/correspondence.rs: one planted bug per clause of shape and group. See scripts/mutants.mjs.
export default [
  {
    name: 'shape accepts a one-to-one split',
    from: '(Correspondence::Split, _) => before == 1 && after >= 2,',
    to: '(Correspondence::Split, _) => before == 1 && after >= 1,',
    clause: 'r == accepted(correspondence, status, before as nat, after as nat, same_id),',
  },
  {
    name: 'shape accepts a many-to-many merge, in code and contract alike',
    from: 'before >= 2 && after == 1',
    to: 'before >= 2 && after >= 1',
    clause: 'r ==> before <= 1 || after <= 1,',
  },
  {
    name: 'shape accepts an empty addition, in code and contract alike',
    from: 'Status::Added => correspondence == Correspondence::None && before == 0 && after == 1,',
    to: 'Status::Added => correspondence == Correspondence::None && before == 0 && after <= 1,',
    also: [
      [
        '(Correspondence::None, Status::Added) => before == 0 && after == 1,',
        '(Correspondence::None, Status::Added) => before == 0 && after <= 1,',
      ],
    ],
    clause: 'r ==> before + after >= 1,',
  },
  {
    name: 'shape accepts a removal of several items, in code and contract alike',
    from: 'Status::Removed => correspondence == Correspondence::None && before == 1 && after == 0,',
    to: 'Status::Removed => correspondence == Correspondence::None && before >= 1 && after == 0,',
    also: [
      [
        '(Correspondence::None, Status::Removed) => before == 1 && after == 0,',
        '(Correspondence::None, Status::Removed) => before >= 1 && after == 0,',
      ],
    ],
    clause: 'mirrored_correspondence(correspondence),',
  },
  {
    name: 'group ignores whether a one-to-one pair keeps its ID',
    from: '    if before == 1 && after == 1 {\n        Some(if same_id { Correspondence::Exact } else { Correspondence::Declared })\n    } else if before == 1 && after >= 2 {\n        Some(Correspondence::Split)\n    } else if before >= 2 && after == 1 {\n        Some(Correspondence::Merge)\n    } else {\n        None\n    }\n}\n\n/// A group',
    to: '    if before == 1 && after == 1 {\n        Some(Correspondence::Exact)\n    } else if before == 1 && after >= 2 {\n        Some(Correspondence::Split)\n    } else if before >= 2 && after == 1 {\n        Some(Correspondence::Merge)\n    } else {\n        None\n    }\n}\n\n/// A group',
    clause: 'r == grouped(before as nat, after as nat, same_id),',
  },
  {
    name: 'group silently picks a merge for an ambiguous group, in code and contract alike',
    from: '    } else {\n        None\n    }',
    to: '    } else {\n        Some(Correspondence::Merge)\n    }',
    clause: 'r is Some <==> (before >= 1 && after >= 1 && (before == 1 || after == 1)),',
  },
  {
    name: 'group calls an exact pair declared, in code and contract alike',
    from: 'Some(if same_id { Correspondence::Exact } else { Correspondence::Declared })',
    to: 'Some(if same_id { Correspondence::Declared } else { Correspondence::Exact })',
    clause: 'r matches Some(c) ==> accepted(c, Status::Modified, before as nat, after as nat, same_id),',
  },
  {
    name: 'group calls a split a merge, in code and contract alike',
    from: '    } else if before == 1 && after >= 2 {\n        Some(Correspondence::Split)',
    to: '    } else if before == 1 && after >= 2 {\n        Some(Correspondence::Merge)',
    clause: 'r matches Some(c) ==> accepted(c, Status::Unchanged, before as nat, after as nat, same_id),',
  },
  {
    name: 'group reads a merge as a split in both directions, in code and contract alike',
    from: '    } else if before >= 2 && after == 1 {\n        Some(Correspondence::Merge)',
    to: '    } else if before >= 2 && after == 1 {\n        Some(Correspondence::Split)',
    also: [
      [
        'Correspondence::Split => before == 1 && after >= 2,',
        'Correspondence::Split => (before == 1 && after >= 2) || (before >= 2 && after == 1),',
      ],
    ],
    clause: 'r == mirrored(grouped(after as nat, before as nat, same_id)),',
  },
]
