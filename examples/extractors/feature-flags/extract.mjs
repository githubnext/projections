// Feature flags: which code checks which flag, through the flag APIs named in
// inputs.flagApis. A custom extractor sample; see README.md.
import {
  architecture,
  conventions,
  enclosingName,
  inputs,
  literal,
  main,
  matcher,
  owner,
  project,
  visit,
} from '../typescript-common/program.mjs'

await main(request => {
  const known = conventions(request, 'flagApis')
  const index = inputs(request).flagArgument ?? 0
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('inputs.flagArgument must be a nonnegative integer')
  const program = project(request)
  const {ts} = program
  const graph = architecture(program, 'flags')
  for (const {source, checker} of program.sources) {
    const matches = matcher(program, checker, known)
    visit(program, source, node => {
      if (!ts.isCallExpression(node)) return
      const convention = matches(node.expression)
      if (!convention) return
      const flag = literal(program, checker, node.arguments[index])
      if (!flag) {
        graph.warnings.add('A known flag API used a dynamic flag key; that call is not represented.')
        return
      }
      const flagId = graph.put('flag', [convention.module, flag], flag, node, {provider: convention.module})
      const pkg = owner(program, source.fileName).name
      const consumer = graph.put('consumer', [pkg, enclosingName(program, node)], enclosingName(program, node), node, {package: pkg})
      graph.edge('owns', graph.packageNode(node), consumer, node)
      graph.edge('checks', consumer, flagId, node)
    })
  }
  return graph.extraction()
})
