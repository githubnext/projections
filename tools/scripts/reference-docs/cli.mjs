// The CLI reference, from the CLI's own command definitions.
import {code, header, outDir, projections, run, sentence, table, to} from './shared.mjs'

export async function cli() {
  const tree = JSON.parse(run(projections(), ['__reference']))
  const commands = []
  const walk = command => {
    for (const child of command.commands) {
      commands.push(child)
      walk(child)
    }
  }
  walk(tree)
  const paragraphs = text => (text ?? '').trim().replaceAll(/\n(?=\S)/gu, '\n\n')
  const display = argument => {
    const values = argument.valueNames.map(name => `<${name}>`).join(' ')
    if (argument.positional) return code(argument.multiple ? `${values}...` : values)
    const flags = [argument.short && `-${argument.short}`, argument.long && `--${argument.long}`].filter(Boolean).join(', ')
    return code(`${flags}${values ? ` ${values}` : ''}`)
  }
  const describe = argument => {
    // A default the help describes in words, such as `[default: every one the working tree defines]`.
    const help = (argument.longHelp ?? argument.help ?? '').replace(/\s*\[default: ([^\]]*)\]\s*$/u, (_, value) => `. Default: ${value}`)
    const parts = [sentence(help)]
    if (argument.possibleValues.length) {
      parts.push(
        argument.possibleValues.some(value => value.help)
          ? `One of: ${argument.possibleValues.map(value => `${code(value.name)}${value.help ? ` — ${value.help.replace(/\.$/u, '')}` : ''}`).join('; ')}.`
          : `One of ${argument.possibleValues.map(value => code(value.name)).join(', ')}.`,
      )
    }
    if (argument.defaults.length && argument.valueNames.length) parts.push(`Default: ${argument.defaults.map(code).join(', ')}.`)
    if (argument.required) parts.push('Required.')
    if (argument.multiple && !argument.positional) parts.push('Repeatable.')
    return parts.filter(Boolean).join(' ')
  }
  const argumentsTable = list =>
    table(
      ['Argument', 'Description'],
      list.map(argument => [display(argument), describe(argument)]),
    )
  const anchor = command =>
    command.path
      .toLowerCase()
      .replaceAll(/[^a-z0-9 _-]/gu, '')
      .replaceAll(' ', '-')
  const page = `${header(['the CLI’s command definitions (projections __reference)'])}# CLI reference

${[
  `${sentence(tree.about)} Every command, its arguments and their help, as \`projections help COMMAND\` prints them.
[Run projections locally](${to('docs/runner/commands.md')}) shows how they fit together.`,
  paragraphs(tree.longAbout),
]
  .filter(Boolean)
  .join('\n\n')}

## Global options

These apply to every command.

${argumentsTable(tree.arguments)}

## Commands

${table(
  ['Command', 'Description'],
  commands.map(command => [`[${code(command.path)}](#${anchor(command)})`, sentence(command.about)]),
)}

${commands
  .map(command =>
    [
      `## ${code(command.path)}`,
      paragraphs(command.longAbout ?? sentence(command.about)),
      `\`\`\`sh\n${command.usage}\n\`\`\``,
      command.aliases.length ? `Also: ${command.aliases.map(alias => code(alias)).join(', ')}.` : '',
      command.arguments.length ? argumentsTable(command.arguments) : '',
      command.commands.length
        ? `Its commands: ${command.commands.map(child => `[${code(child.path)}](#${anchor(child)})`).join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  )
  .join('\n\n')}
`
  return {[`${outDir}/cli.md`]: page}
}
