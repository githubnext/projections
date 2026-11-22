// Evaluates the small part of Rust the agent tool catalog is written in, without building it: string, number and
// boolean literals, `json!` values, `&[...]` slices, `format!`, `let` bindings, consts, struct literals and calls to
// the file's own `fn name(...) -> Value { json!(...) }` helpers. Anything else is an error naming its line, so a
// catalog written differently fails loudly rather than extracting less.

/** Where each key of an evaluated object was written, by object. */
export const keyLines = new WeakMap()

/** Rust source as tokens, each with its line: strings, numbers, identifiers, lifetimes and punctuation. */
export function tokenize(text, firstLine = 1) {
  const tokens = []
  let line = firstLine
  let at = 0
  const push = (type, value, start) => tokens.push({type, value, line: start})
  while (at < text.length) {
    const char = text[at]
    if (char === '\n') {
      line++
      at++
    } else if (/\s/.test(char)) at++
    else if (text.startsWith('//', at)) at = text.includes('\n', at) ? text.indexOf('\n', at) : text.length
    else if (text.startsWith('/*', at)) {
      const end = text.indexOf('*/', at + 2)
      line += text.slice(at, end).split('\n').length - 1
      at = end + 2
    } else if (char === '"' || /^r#*"/.test(text.slice(at, at + 8))) {
      const start = line
      const {value, end} = char === '"' ? quoted(text, at) : raw(text, at)
      line += text.slice(at, end).split('\n').length - 1
      push('string', value, start)
      at = end
    } else if (char === "'") at = quote(text, at, line, push)
    else if (/[0-9]/.test(char)) {
      const number = /^[0-9][0-9_]*(\.[0-9][0-9_]*)?([a-z][a-z0-9]*)?/.exec(text.slice(at))[0]
      push('number', Number(number.replace(/_/g, '').replace(/[a-z][a-z0-9]*$/, '')), line)
      at += number.length
    } else if (/[A-Za-z_]/.test(char)) {
      const name = /^[A-Za-z_]\w*/.exec(text.slice(at))[0]
      push('ident', name, line)
      at += name.length
    } else {
      const two = text.slice(at, at + 2)
      const punct = ['::', '->', '=>', '==', '!=', '&&', '||'].includes(two) ? two : char
      push('punct', punct, line)
      at += punct.length
    }
  }
  return tokens
}

/** A character literal or a lifetime at `at`; returns where it ends. */
function quote(text, at, line, push) {
  const close = text[at + 1] === '\\' ? text.indexOf("'", at + 2) : at + 2
  if (text[close] === "'") {
    push('char', text.slice(at + 1, close), line)
    return close + 1
  }
  const name = /^'[A-Za-z_]\w*/.exec(text.slice(at))[0]
  push('lifetime', name, line)
  return at + name.length
}

const escapes = {n: '\n', t: '\t', r: '\r', 0: '\0', '\\': '\\', '"': '"', "'": "'"}

/** The string literal starting at `start`, unescaped. */
export function quoted(text, start) {
  let value = ''
  let at = start + 1
  while (text[at] !== '"') {
    if (at >= text.length) throw new Error('unterminated string')
    if (text[at] !== '\\') {
      value += text[at++]
      continue
    }
    const next = text[at + 1]
    if (next === '\n') {
      at += 2
      while (/\s/.test(text[at])) at++
    } else if (next === 'u') {
      const close = text.indexOf('}', at)
      value += String.fromCodePoint(Number.parseInt(text.slice(at + 3, close), 16))
      at = close + 1
    } else {
      value += escapes[next] ?? next
      at += 2
    }
  }
  return {value, end: at + 1}
}

function raw(text, start) {
  const hashes = /^r(#*)"/.exec(text.slice(start))[1]
  const open = start + 2 + hashes.length
  const close = text.indexOf(`"${hashes}`, open)
  return {value: text.slice(open, close), end: close + 1 + hashes.length}
}

/** The text between the bracket at `open` and its match, skipping strings and comments. */
export function balanced(text, open) {
  const pairs = {'(': ')', '[': ']', '{': '}'}
  const stack = []
  for (let at = open; at < text.length; at++) {
    const char = text[at]
    if (char === '"') at = quoted(text, at).end - 1
    else if (text.startsWith('//', at)) at = text.indexOf('\n', at)
    else if (pairs[char]) stack.push(pairs[char])
    else if (char === stack.at(-1)) {
      stack.pop()
      if (!stack.length) return {inner: text.slice(open + 1, at), end: at + 1}
    }
  }
  throw new Error(`unbalanced ${text[open]} at offset ${open}`)
}

/** The line `offset` is on. */
export const lineAt = (text, offset) => text.slice(0, offset).split('\n').length

/** A file's `fn name(params) -> Value { body }` helpers and string consts, and an evaluator over them. */
export function rustModule(text, file) {
  const helpers = new Map()
  for (const match of text.matchAll(/fn (\w+)\(([^)]*)\) -> Value \{/g)) {
    const open = match.index + match[0].length - 1
    const params = match[2]
      .split(',')
      .map(param => param.split(':')[0].trim())
      .filter(Boolean)
    helpers.set(match[1], {params, tokens: tokenize(balanced(text, open).inner, lineAt(text, open))})
  }
  const consts = new Map()
  for (const match of text.matchAll(/const (\w+): &(?:'static )?str = ("(?:[^"\\]|\\.)*");/g)) {
    consts.set(match[1], quoted(match[2], 0).value)
  }

  /** Evaluates the tokens of one expression, with `scope` binding names. */
  function evaluate(tokens, scope = new Map()) {
    const call = (name, args, line) => {
      const helper = helpers.get(name)
      if (!helper) throw new Error(`${file}:${line}: unknown function ${name}`)
      return evaluate(helper.tokens, new Map(helper.params.map((param, index) => [param, args[index]])))
    }
    const parser = new Parser(tokens, file, call, new Map([...consts, ...scope]))
    const value = parser.expression()
    parser.finish()
    return value
  }
  return {evaluate}
}

class Parser {
  constructor(tokens, file, call, scope) {
    this.tokens = tokens
    this.at = 0
    this.file = file
    this.call = call
    this.scope = scope
  }

  peek(offset = 0) {
    return this.tokens[this.at + offset]
  }

  fail(message, token = this.peek() ?? this.tokens.at(-1)) {
    throw new Error(`${this.file}:${token?.line ?? '?'}: ${message}`)
  }

  is(value, offset = 0) {
    const token = this.peek(offset)
    return token?.type === 'punct' && token.value === value
  }

  take(value) {
    if (!this.is(value)) this.fail(`expected ${value}, found ${this.peek()?.value ?? 'the end'}`)
    return this.tokens[this.at++]
  }

  finish() {
    if (this.is(';')) this.at++
    if (this.at < this.tokens.length) this.fail(`unexpected ${this.peek().value}`)
  }

  list(close, item) {
    const values = []
    while (!this.is(close)) {
      values.push(item())
      if (!this.is(close)) this.take(',')
    }
    this.take(close)
    return values
  }

  /** A block of `let`s ending in a value, or a value. */
  expression() {
    while (this.peek()?.type === 'ident' && this.peek().value === 'let') {
      const name = this.peek(1).value
      this.at += 2
      this.take('=')
      this.scope.set(name, this.value())
      this.take(';')
    }
    return this.value()
  }

  value() {
    const token = this.peek()
    if (!token) this.fail('expected a value')
    if (this.is('&')) {
      this.at++
      return this.value()
    }
    if (this.is('-')) {
      this.at++
      return -this.value()
    }
    if (this.is('[')) {
      this.at++
      return this.list(']', () => this.value())
    }
    if (token.type === 'string' || token.type === 'number') {
      this.at++
      return token.value
    }
    if (token.type !== 'ident') this.fail(`unexpected ${token.value}`)
    if (token.value === 'true' || token.value === 'false') {
      this.at++
      return token.value === 'true'
    }
    if (this.is('!', 1)) return this.macro()
    return this.named(token)
  }

  /** A name: a path (`Trust::Extract`), a call, a struct literal or a binding. */
  named(token) {
    let path = token.value
    this.at++
    while (this.is('::')) {
      path += `::${this.peek(1).value}`
      this.at += 2
    }
    if (this.is('(')) {
      this.at++
      return this.call(
        path,
        this.list(')', () => this.value()),
        token.line,
      )
    }
    if (this.is('{') && /^[A-Z]/.test(path)) return this.struct()
    if (path.includes('::')) return path
    if (!this.scope.has(path)) this.fail(`unknown name ${path}`, token)
    return this.scope.get(path)
  }

  /** `Name { field: value, ... }`, with each field's line. */
  struct() {
    this.take('{')
    const value = {}
    const lines = {}
    this.list('}', () => {
      const field = this.peek()
      this.at++
      this.take(':')
      lines[field.value] = field.line
      value[field.value] = this.value()
    })
    keyLines.set(value, lines)
    return value
  }

  macro() {
    const name = this.peek().value
    this.at += 2
    const close = {'(': ')', '[': ']', '{': '}'}[this.peek().value]
    this.at++
    if (name === 'json') {
      const value = this.json()
      this.take(close)
      return value
    }
    if (name === 'vec') return this.list(close, () => this.value())
    if (name === 'format') {
      return format(
        this.list(close, () => this.argument()),
        this.scope,
      )
    }
    return this.fail(`unsupported macro ${name}!`)
  }

  /** A `format!` argument: `value` or `name = value`. */
  argument() {
    if (this.peek().type === 'ident' && this.is('=', 1)) {
      const key = this.peek().value
      this.at += 2
      return {key, value: this.value()}
    }
    return {value: this.value()}
  }

  /** A `json!` value: objects with string keys, arrays, `null`, literals and Rust expressions. */
  json() {
    if (this.is('{')) {
      this.at++
      const value = {}
      const lines = {}
      this.list('}', () => {
        const key = this.peek()
        if (key.type !== 'string') this.fail('expected a string key')
        this.at++
        this.take(':')
        lines[key.value] = key.line
        value[key.value] = this.json()
      })
      keyLines.set(value, lines)
      return value
    }
    if (this.is('[')) {
      this.at++
      return this.list(']', () => this.json())
    }
    if (this.peek()?.type === 'ident' && this.peek().value === 'null') {
      this.at++
      return null
    }
    return this.value()
  }
}

/** `format!`'s result, for `{name}`, `{}` and `{{`/`}}`. */
function format([template, ...args], scope) {
  const named = new Map(args.filter(arg => arg.key).map(arg => [arg.key, arg.value]))
  const positional = args.filter(arg => !arg.key).map(arg => arg.value)
  let next = 0
  return template.value.replace(/\{\{|\}\}|\{(\w*)\}/g, (all, name) => {
    if (all === '{{') return '{'
    if (all === '}}') return '}'
    if (!name) return String(positional[next++])
    return String(named.has(name) ? named.get(name) : scope.get(name))
  })
}
