// The CLI's commands and their arguments as api/v0 declarations, read from the CLI reference
// (docs/reference/cli.md). The reference is generated from the CLI's own command definitions
// (`projections __reference`) and CI fails when it is stale, so each commit's copy is that commit's CLI, readable
// without building it. Help prose is left out; what a script or an agent relies on is kept: each argument's flags,
// value names, possible values, literal default, and whether it is required or repeatable.

const cell = text => text.replaceAll('\\|', '|')
const codeSpans = text => [...text.matchAll(/\x60([^\x60]+)\x60/g)].map(match => match[1])

/** The possible values an argument's description lists after `One of`. */
function possibleValues(description) {
  const at = description.indexOf('One of')
  if (at < 0) return []
  const rest = description.slice(at)
  // `One of: `a` — help; `b` — help.` names each value at the start of its part; `One of `a`, `b`.` lists them.
  if (rest.startsWith('One of:')) {
    return rest
      .slice('One of:'.length)
      .split(/;\s+(?=\x60)/)
      .map(part => codeSpans(part)[0])
      .filter(Boolean)
  }
  return codeSpans(rest.slice(0, rest.search(/\x60\.(\s|$)/) + 2))
}

/** One argument's signature: `-p, --projection <ID>...: "a" | "b" = default (required)`. */
export function argumentSignature(display, description) {
  const repeatable = /(^|\s)Repeatable\.(\s|$)/.test(description) && !display.endsWith('...')
  const values = possibleValues(description)
  const defaults = /(?:^|\s)Default: \x60([^\x60]*)\x60\./.exec(description)
  return [
    display,
    repeatable ? '...' : '',
    values.length ? `: ${values.map(value => JSON.stringify(value)).join(' | ')}` : '',
    defaults ? ` = ${defaults[1]}` : '',
    /(^|\s)Required\.(\s|$)/.test(description) ? ' (required)' : '',
  ].join('')
}

/** An argument's name: its long flag, else its short one, else (a positional argument) its value names. */
const argumentName = display => /--[\w-]+/.exec(display)?.[0] ?? /^-\w/.exec(display)?.[0] ?? display

/**
 * The commands and arguments of the CLI reference's text, without the commands `exclude` names (a command and its
 * subcommands).
 */
export function cliDeclarations({text, source, exclude = []}) {
  const entities = []
  const relationships = []
  const excluded = path => path !== '' && exclude.some(name => path === name || path.startsWith(`${name} `))
  let command
  let usage = false
  text.split('\n').forEach((line, index) => {
    const location = {line: index + 1}
    const heading = /^## (?:\x60projections(?: (.+))?\x60|(Global options))$/.exec(line)
    if (heading) {
      const path = heading[1] ?? ''
      command = excluded(path) ? undefined : {path, id: `cli:projections${path ? ` ${path}` : ''}`, global: Boolean(heading[2])}
      if (command && !command.global) {
        entities.push({
          id: command.id,
          kind: 'command',
          label: `projections ${path}`,
          data: {},
          evidence: [{kind: 'reference', source, location}],
        })
      }
      return
    }
    if (line.startsWith('## ')) {
      command = undefined
      return
    }
    if (!command) return
    if (line === '```sh') {
      usage = true
      return
    }
    if (usage) {
      usage = false
      const entity = entities.find(item => item.id === command.id)
      if (entity) entity.data.signature = line.trim()
      return
    }
    const row = /^\| \x60((?:[^\x60\\]|\\.)+)\x60 \| (.*) \|$/.exec(line)
    if (!row) return
    const display = cell(row[1])
    const description = cell(row[2])
    const name = argumentName(display)
    const id = `${command.id} ${name}`
    entities.push({
      id,
      kind: display.startsWith('-') ? 'option' : 'argument',
      label: `${command.global ? 'projections' : command.path} ${name}`,
      data: {signature: argumentSignature(display, description)},
      evidence: [{kind: 'reference', source, location}],
    })
    // Not `contains`: an argument's label already names its command, which a qualified name would repeat.
    if (!command.global) relationships.push({id: `takes:${command.id}->${id}`, kind: 'takes', from: command.id, to: id})
  })
  for (const entity of entities) entity.data.signature ??= entity.label
  return {entities, relationships}
}
