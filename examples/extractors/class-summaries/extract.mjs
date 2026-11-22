// Class summaries: every TypeScript class, with a one-line summary of what it does that a model writes, marked as a
// generated value so comparisons judge it by what it was generated from rather than by its wording. A custom
// extractor sample; see README.md. Its model is a deterministic stand-in (fake-summarizer), so the sample makes no
// network or paid calls: replace `summarize` with a call to your model.
import {createHash} from 'node:crypto'
import path from 'node:path'
import {basis, generations} from '@githubnext/projections/extractor'
import {architecture, inputs, main, project, visit} from '../typescript-common/program.mjs'

/** The system prompt. A change to it regenerates every summary, as a prompt change should. */
const PROMPT = 'Summarize what this TypeScript class is responsible for in one sentence. Name its main operations.'

/** The declared path of the generated summary: half of the generation store's key. */
const SUMMARY = '/data/summary'

/**
 * A stand-in for a language model: a sentence about the class built from its members, worded one of a few ways. The
 * wording depends on the input and on `FAKE_SUMMARIZER_SAMPLE`, as a real model's depends on sampling, so tests can
 * reword a summary from the same inputs without randomness.
 */
function summarize(model, name, members) {
  const operations = members.length ? members.join(', ') : 'nothing yet'
  const phrasings = [`${name} handles ${operations}.`, `${name} is responsible for ${operations}.`, `${name} provides ${operations}.`]
  const sample = process.env.FAKE_SUMMARIZER_SAMPLE ?? ''
  const pick = createHash('sha256').update(`${model}\0${name}\0${operations}\0${sample}`).digest()[0] % phrasings.length
  return phrasings[pick]
}

await main(async request => {
  const model = inputs(request).model ?? 'fake-summarizer@1'
  const store = await generations(request)
  const program = project(request)
  const {ts} = program
  const graph = architecture(program, 'classes')
  for (const {source} of program.sources) {
    const classes = []
    visit(program, source, node => {
      if (ts.isClassDeclaration(node) && node.name) classes.push(node)
    })
    for (const node of classes) {
      const name = node.name.text
      const members = node.members
        .filter(
          member => (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) && member.name && ts.isIdentifier(member.name),
        )
        .map(member => member.name.text)
      // What the model reads: the class's own source, not its file, so an edit elsewhere doesn't regenerate it.
      const input = node.getText(source).replace(/\r\n?/gu, '\n')
      const summaryBasis = basis({input, prompt: PROMPT, model})
      const summary = await store.generate(SUMMARY, summaryBasis, () => summarize(model, name, members))
      const file = path.relative(program.root, node.getSourceFile().fileName).split(path.sep).join('/')
      const pkg = graph.packageNode(node)
      const id = graph.put('class', [file, name], name, node, {summary, summaryBasis})
      graph.edge('contains', pkg, id, node)
    }
  }
  return {
    ...graph.extraction(),
    volatile: [{kinds: ['class'], path: SUMMARY, generated: true, basis: '/data/summaryBasis'}],
  }
})
