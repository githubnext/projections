// The built-in extractors reference, from the CLI's extractor catalog.
import {code, header, json, outDir, projections, run, sentence, table, to, trustText} from './shared.mjs'

export async function extractors() {
  const bin = projections()
  const catalog = JSON.parse(run(bin, ['extractor', 'list', '--json']))
  const entries = catalog.extractors
  const page = `${header(['the CLI’s extractor catalog'])}# Built-in extractors

The extractors built into the CLI, in the order it lists them. A projection names one in \`extractor\`; any program
can be an extractor instead (see [Write your first extractor](${to('docs/guides/first-extractor.md')})).
\`projections extractor list --json\` prints this catalog as JSON.

An input that names a file, folder or glob the examined revision doesn't have (a revision before it was added, or after
it was removed) isn't an error: the extractor describes that revision without it and lists it in the extraction's
\`missingInputs\`, so a comparison shows its contents as added or removed, with a notice (see
[Output](${to('docs/runner/commands.md')}#output)). One that exists but can't be parsed still fails, and so does
\`projections check\`.

${table(
  ['Extractor', 'Schema', 'Default renderer', 'Needs `--trust`'],
  entries.map(entry => [
    `[${code(entry.id)}](#${entry.id})`,
    code(entry.schema),
    code(entry.renderer),
    trustText[entry.trust] ?? code(entry.trust),
  ]),
)}

${entries
  .map(
    entry => `## ${code(entry.id)}

**${entry.title}.** ${sentence(entry.description)} See [its page](${to(`docs/builtins/extractors/${entry.id}.md`)}).

- Schema: ${code(entry.schema)}
- Default renderer: ${code(entry.renderer)}
- Needs \`--trust\`: ${trustText[entry.trust] ?? code(entry.trust)}

${
  Object.keys(entry.inputs ?? {}).length
    ? table(
        ['Input', 'Meaning'],
        Object.entries(entry.inputs).map(([name, meaning]) => [code(name), sentence(meaning)]),
      )
    : 'It takes no inputs.'
}

A definition to start from:

${json(entry.template)}`,
  )
  .join('\n\n')}
`
  return {[`${outDir}/extractors.md`]: page}
}
