// A tiny WebAssembly binary builder for runtime tests, so they need no WAT toolchain.

const encoder = new TextEncoder()

export function unsigned(value) {
  const out = []
  let rest = value
  do {
    let byte = rest & 0x7f
    rest = Math.floor(rest / 128)
    if (rest) byte |= 0x80
    out.push(byte)
  } while (rest)
  return out
}

export function signed(value) {
  let rest = BigInt(value)
  const out = []
  while (true) {
    const byte = Number(rest & 0x7fn)
    rest >>= 7n
    if ((rest === 0n && (byte & 0x40) === 0) || (rest === -1n && (byte & 0x40) !== 0)) {
      out.push(byte)
      return out
    }
    out.push(byte | 0x80)
  }
}

const name = text => {
  const bytes = [...encoder.encode(text)]
  return [...unsigned(bytes.length), ...bytes]
}
const vector = items => [...unsigned(items.length), ...items.flat()]
const section = (id, content) => (content === undefined ? [] : [id, ...unsigned(content.length), ...content])

export const i32 = 0x7f
export const i64 = 0x7e
export const op = {
  unreachable: [0x00],
  drop: [0x1a],
  end: [0x0b],
  loop: [0x03, 0x40],
  if: [0x04, 0x40],
  br: depth => [0x0c, ...unsigned(depth)],
  brIf: depth => [0x0d, ...unsigned(depth)],
  localGet: index => [0x20, ...unsigned(index)],
  i32Const: value => [0x41, ...signed(value)],
  i64Const: value => [0x42, ...signed(value)],
  i32Ne: [0x47],
  i32Add: [0x6a],
  memoryGrow: [0x40, 0x00],
}

/**
 * Builds a module. `functions`: [{type, body: number[]}], `exports`: [{name, kind, index}]
 * with kind 0 function, 1 table, 2 memory, 3 global. `imports`: [{module, name, type}] functions.
 */
export function wasm({types = [], imports = [], functions = [], memories = [], globals = [], exports = [], start, data = []}) {
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, types.length ? vector(types.map(([params, results]) => [0x60, ...vector(params), ...vector(results)])) : undefined),
    ...section(
      2,
      imports.length ? vector(imports.map(item => [...name(item.module), ...name(item.name), 0x00, ...unsigned(item.type)])) : undefined,
    ),
    ...section(3, functions.length ? vector(functions.map(fn => unsigned(fn.type))) : undefined),
    ...section(
      5,
      memories.length
        ? vector(memories.map(({min, max}) => (max === undefined ? [0x00, ...unsigned(min)] : [0x01, ...unsigned(min), ...unsigned(max)])))
        : undefined,
    ),
    ...section(6, globals.length ? vector(globals.map(value => [i32, 0x00, ...op.i32Const(value), ...op.end])) : undefined),
    ...section(7, exports.length ? vector(exports.map(item => [...name(item.name), item.kind, ...unsigned(item.index)])) : undefined),
    ...section(8, start === undefined ? undefined : unsigned(start)),
    ...section(
      10,
      functions.length
        ? vector(
            functions.map(fn => {
              const body = [0x00, ...fn.body, ...op.end]
              return [...unsigned(body.length), ...body]
            }),
          )
        : undefined,
    ),
    ...section(
      11,
      data.length
        ? vector(data.map(({offset, bytes}) => [0x00, ...op.i32Const(offset), ...op.end, ...vector([...bytes].map(byte => [byte]))]))
        : undefined,
    ),
  ])
}

/**
 * A comparator whose `projections_compare` runs `body` and returns the packed
 * pointer and length of `output`, stored at address 0. Input is written at 4096.
 */
export function comparator(output, {body = [], memory = {min: 2}, extraFunctions = [], start, packed} = {}) {
  const bytes = typeof output === 'string' ? encoder.encode(output) : output
  return wasm({
    types: [
      [[i32], [i32]],
      [[i32, i32], [i64]],
      [[], []],
    ],
    functions: [{type: 0, body: op.i32Const(4096)}, {type: 1, body: [...body, ...op.i64Const(packed ?? bytes.length)]}, ...extraFunctions],
    memories: [memory],
    exports: [
      {name: 'memory', kind: 2, index: 0},
      {name: 'projections_alloc', kind: 0, index: 0},
      {name: 'projections_compare', kind: 0, index: 1},
    ],
    start,
    data: [{offset: 0, bytes}],
  })
}
