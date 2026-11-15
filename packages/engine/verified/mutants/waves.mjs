// Mutants for src/waves.rs: one planted bug per clause of wave_sizes, place, phases and the two mirror theorems. See
// scripts/mutants.mjs.
export default [
  {
    name: 'wave_sizes rounds the wave size down',
    from: '    let size = layers / waves + if layers % waves == 0 { 0 } else { 1 };',
    to: '    let size = layers / waves;',
    clause: 'sizes.len() <= MAX_WAVES,',
    step: 'requires 1 <= waves <= layers, size == layers / waves',
  },
  {
    name: 'wave_sizes makes a wave of every layer',
    from: '    let waves = if layers < MAX_WAVES { layers } else { MAX_WAVES };',
    to: '    let waves = layers;',
    clause: 'sizes.len() <= MAX_WAVES,',
    step: '1 <= waves <= MAX_WAVES,',
  },
  {
    name: 'wave_sizes drops the last layer',
    from: '    while left > 0\n',
    to: '    while left > 1\n',
    clause: 'total(sizes@) == layers,',
  },
  {
    name: 'place leaves with the first departing wave',
    from: '        Placement::Remove(latest(departing))',
    to: '        Placement::Remove(departing[0])',
    clause: 'ensures r == placed(arriving@, departing@),',
  },
  {
    name: 'place prefers departing to arriving, in code and contract alike',
    from: '    if arriving.len() > 0 {\n        Placement::Add(last(arriving) as usize)\n    } else if departing.len() > 0 {\n        Placement::Remove(last(departing) as usize)',
    to: '    if departing.len() > 0 {\n        Placement::Remove(last(departing) as usize)\n    } else if arriving.len() > 0 {\n        Placement::Add(last(arriving) as usize)',
    also: [
      [
        '    if !arriving.is_empty() {\n        Placement::Add(latest(arriving))\n    } else if !departing.is_empty() {\n        Placement::Remove(latest(departing))',
        '    if !departing.is_empty() {\n        Placement::Remove(latest(departing))\n    } else if !arriving.is_empty() {\n        Placement::Add(latest(arriving))',
      ],
    ],
    clause: 'arriving.len() > 0 && departing.len() > 0 ==> placed(arriving, departing) is Add && placed(departing, arriving) is Add,',
  },
  {
    name: 'latest keeps the first wave',
    from: '        if waves[i] > best {',
    to: '        if waves[i] > best && false {',
    clause: 'ensures r as int == last(waves@),',
    step: 'best as int == last(waves@.subrange(0, i as int)),',
  },
  {
    name: 'removals play roots first, in the contract',
    from: 'removals.reverse().map_values(|wave: T| (Phase::Remove, wave))',
    to: 'removals.map_values(|wave: T| (Phase::Remove, wave))',
    clause: 'ensures steps_of(additions, restructure, removals) == played_backwards(steps_of(removals, restructure, additions)),',
    step: 'assert(backward[i] == (Phase::Remove, additions[na - 1 - i]));',
  },
  {
    name: 'phases drops the restructure step',
    from: '    if let Some(step) = restructure {\n        steps.push((Phase::Restructure, step));\n    }',
    to: '',
    clause: 'ensures steps@ == steps_of(removals@, restructure, additions@),',
    step: 'assert(steps@ =~= steps_of(r, restructure, a));',
  },
]
