// A type's name as a card shows it: without namespaces, with its generic arguments, each shortened the same way.

/**
 * A type name shortened for a card: its namespace dropped, and its generic arguments, however written, shortened the
 * same way and written `<…>`. Reads .NET reflection names (``IOptions`1[Workbench.Storage.InventoryOptions]``, with
 * assembly-qualified arguments in their own brackets) and source names (`IOptions<Workbench.Storage.InventoryOptions>`)
 * alike: both read `IOptions<InventoryOptions>`. A nested type's arguments go to the types that declare them
 * (``Outer`1+Inner[System.String]``: `Outer<String>+Inner`). An open generic keeps its bare name (``IRepository`1``:
 * `IRepository`), and arrays keep their brackets. A name it can't read is shortened at its last dot.
 */
export function shortTypeName(value: string): string {
  try {
    const reader = {text: value.trim(), at: 0}
    const name = readType(reader)
    if (reader.at !== reader.text.length) throw new Error('trailing text')
    return name
  } catch {
    const withoutGenerics = value.replace(/\x60\d+$/, '')
    return withoutGenerics.split('.').at(-1) ?? withoutGenerics
  }
}

interface Reader {
  text: string
  at: number
}

const peek = (reader: Reader) => reader.text[reader.at]
const skipSpaces = (reader: Reader) => {
  while (peek(reader) === ' ') reader.at++
}
function expect(reader: Reader, char: string) {
  if (peek(reader) !== char) throw new Error(`expected ${char} at ${reader.at}`)
  reader.at++
}

/**
 * A name's `+`-separated nested types, each with the generic parameters it declares (``Outer`1+Inner`1``: one each),
 * its namespace dropped.
 */
function segmentsOf(full: string): {name: string; arity: number}[] {
  const lastDot = full.lastIndexOf('.', full.indexOf('+') < 0 ? full.length : full.indexOf('+'))
  return full
    .slice(lastDot + 1)
    .split('+')
    .map(segment => {
      const arity = /\x60(\d+)$/.exec(segment)
      return {name: arity ? segment.slice(0, arity.index) : segment, arity: arity ? Number(arity[1]) : 0}
    })
}

function readType(reader: Reader): string {
  skipSpaces(reader)
  const start = reader.at
  while (reader.at < reader.text.length && !'[]<>, '.includes(peek(reader)!)) reader.at++
  const full = reader.text.slice(start, reader.at)
  if (!full) throw new Error(`no name at ${start}`)
  const segments = segmentsOf(full)
  const arity = segments.reduce((sum, segment) => sum + segment.arity, 0)
  let args: string[] = []
  if (peek(reader) === '<') {
    reader.at++
    args = readArguments(reader, '>')
  } else if (arity && peek(reader) === '[' && reader.text[reader.at + 1] !== ']' && reader.text[reader.at + 1] !== ',') {
    reader.at++
    args = readArguments(reader, ']')
  }
  let suffix = ''
  // Arrays: `[]`, `[,]`.
  while (peek(reader) === '[' && /^\[,*\]/.test(reader.text.slice(reader.at))) {
    const end = reader.text.indexOf(']', reader.at) + 1
    suffix += reader.text.slice(reader.at, end)
    reader.at = end
  }
  // A reflection name lists every nested type's arguments in order: each takes as many as it declares. Otherwise (a
  // source name's `<…>`) they are the innermost type's.
  const own = (index: number): string[] => {
    if (args.length !== arity) return index === segments.length - 1 ? args : []
    const from = segments.slice(0, index).reduce((sum, segment) => sum + segment.arity, 0)
    return args.slice(from, from + segments[index]!.arity)
  }
  const written = segments.map(({name}, index) => {
    const mine = own(index)
    return `${name}${mine.length ? `<${mine.join(', ')}>` : ''}`
  })
  return `${written.join('+')}${suffix}`
}

/** Generic arguments up to `close`: each a type, or a reflection name's assembly-qualified type in its own brackets. */
function readArguments(reader: Reader, close: '>' | ']'): string[] {
  const args: string[] = []
  for (;;) {
    skipSpaces(reader)
    if (close === ']' && peek(reader) === '[') {
      reader.at++
      args.push(readType(reader))
      // The rest is the assembly: `, mscorlib, Version=…`, up to this argument's closing bracket.
      const end = reader.text.indexOf(']', reader.at)
      if (end < 0) throw new Error('unclosed argument')
      reader.at = end + 1
    } else args.push(readType(reader))
    skipSpaces(reader)
    if (peek(reader) === ',') {
      reader.at++
      continue
    }
    expect(reader, close)
    return args
  }
}
