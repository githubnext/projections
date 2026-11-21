// Redux slices: slices made by the slice factories in inputs.sliceApis (default
// @reduxjs/toolkit createSlice), their actions and selectors, the slices they
// depend on and the packages that import them. A custom extractor sample; see README.md.
import {
  architecture,
  conventions,
  literal,
  main,
  matcher,
  owner,
  project,
  property,
  symbolAt,
  unwrap,
  visit,
} from '../typescript-common/program.mjs'

await main(request => {
  const known = conventions(request, 'sliceApis', [{module: '@reduxjs/toolkit', symbol: 'createSlice'}])
  const program = project(request)
  const {ts} = program
  const graph = architecture(program, 'redux')
  const slices = []
  const symbolSlices = new Map()
  for (const {source, checker} of program.sources) {
    const matches = matcher(program, checker, known)
    visit(program, source, node => {
      if (!ts.isCallExpression(node) || !matches(node.expression)) return
      const options = node.arguments[0]
      const name = options && literal(program, checker, property(program, checker, options, 'name'))
      if (!name) {
        graph.warnings.add('A createSlice name could not be reduced to a string literal.')
        return
      }
      const pkg = owner(program, source.fileName).name
      const identity = graph.put('slice', [pkg, name], name, node, {package: pkg})
      graph.edge('owns', graph.packageNode(node), identity, node)
      let parent = node.parent
      while (
        ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isSatisfiesExpression(parent) ||
        ts.isNonNullExpression(parent)
      ) {
        parent = parent.parent
      }
      const variable = ts.isVariableDeclaration(parent) ? symbolAt(program, checker, parent.name) : undefined
      if (variable) symbolSlices.set(variable, identity)
      slices.push({node, checker, identity})
      for (const [field, kind] of [
        ['reducers', 'action'],
        ['selectors', 'selector'],
      ]) {
        const collection = options && property(program, checker, options, field)
        if (!collection) continue
        for (const symbol of checker.getTypeAtLocation(collection).getProperties()) {
          const memberId = graph.put(kind, [pkg, name, symbol.name], symbol.name, symbol.valueDeclaration ?? node, {slice: name})
          graph.edge('defines', identity, memberId, node)
        }
      }
    })
  }
  // Track destructured exports such as `export const { selectTotal } = slice.selectors`.
  for (const {source, checker} of program.sources) {
    visit(program, source, node => {
      if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isObjectBindingPattern(node.name)) return
      let expression = unwrap(program, node.initializer)
      while (ts.isPropertyAccessExpression(expression)) expression = expression.expression
      const sourceSymbol = symbolAt(program, checker, expression)
      const slice = sourceSymbol && symbolSlices.get(sourceSymbol)
      if (!slice) return
      for (const element of node.name.elements) {
        const symbol = symbolAt(program, checker, element.name)
        if (symbol) symbolSlices.set(symbol, slice)
      }
    })
  }
  for (const {node, checker, identity} of slices) {
    visit(program, node, reference => {
      if (!ts.isIdentifier(reference) && !ts.isPropertyAccessExpression(reference)) return
      const symbol = symbolAt(program, checker, reference)
      const other = symbol && symbolSlices.get(symbol)
      if (other && other !== identity) graph.edge('depends-on', identity, other, reference)
    })
  }
  for (const {source, checker} of program.sources) {
    visit(program, source, node => {
      if (!ts.isImportDeclaration(node) || !node.importClause) return
      visit(program, node.importClause, reference => {
        if (!ts.isIdentifier(reference)) return
        const symbol = symbolAt(program, checker, reference)
        const slice = symbol && symbolSlices.get(symbol)
        if (slice) graph.edge('imports', graph.packageNode(node), slice, node)
      })
    })
  }
  return graph.extraction()
})
