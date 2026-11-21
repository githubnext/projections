// HTTP routes: local method and path registrations on routers made by the
// factories in inputs.routeFactories (default Express and Fastify), and their
// handlers. A custom extractor sample; see README.md.
import {
  architecture,
  conventions,
  handlerIdentity,
  initializer,
  literal,
  main,
  matcher,
  owner,
  project,
  property,
  symbolAt,
  visit,
} from '../typescript-common/program.mjs'

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'])

await main(request => {
  const known = conventions(request, 'routeFactories', [
    {module: 'express', symbol: 'default'},
    {module: 'express', symbol: 'Router'},
    {module: 'fastify', symbol: 'default'},
  ])
  const program = project(request)
  const {ts} = program
  const graph = architecture(program, 'http')
  const receivers = new Set()
  for (const {source, checker} of program.sources) {
    const matches = matcher(program, checker, known)
    visit(program, source, node => {
      if (!ts.isVariableDeclaration(node) || !node.initializer) return
      const expression = initializer(program, checker, node.initializer)
      if (ts.isCallExpression(expression) && matches(expression.expression)) {
        const symbol = symbolAt(program, checker, node.name)
        if (symbol) receivers.add(symbol)
      }
    })
  }
  for (const {source, checker} of program.sources) {
    const matches = matcher(program, checker, known)
    const isReceiver = (expression, seen = new Set()) => {
      if (seen.has(expression)) return false
      seen.add(expression)
      const symbol = symbolAt(program, checker, expression)
      if (symbol && receivers.has(symbol)) return true
      const value = initializer(program, checker, expression)
      if (ts.isCallExpression(value) && matches(value.expression)) return true
      if (
        ts.isCallExpression(value) &&
        ts.isPropertyAccessExpression(value.expression) &&
        (methods.has(value.expression.name.text.toLowerCase()) || value.expression.name.text === 'route')
      ) {
        return isReceiver(value.expression.expression, seen)
      }
      return false
    }
    const addRoute = (method, route, handler, at) => {
      if (!route || !handler) {
        graph.warnings.add('A recognized route has a dynamic URL or missing handler and is not represented.')
        return
      }
      const pkg = owner(program, source.fileName).name
      const verb = method.toUpperCase()
      const routeId = graph.put('route', [pkg, verb, route], `${verb} ${route}`, at, {package: pkg, method: verb, path: route}, 'inferred')
      graph.edge('owns', graph.packageNode(at), routeId, at)
      const name = handlerIdentity(program, checker, handler)
      const declaration = symbolAt(program, checker, handler)?.valueDeclaration
      const handlerPackage = declaration ? owner(program, declaration.getSourceFile().fileName).name : pkg
      const handlerId = graph.put(
        'handler',
        [handlerPackage, name, name.endsWith('.inline') ? `${method}:${route}` : 'named'],
        name,
        declaration ?? handler,
        {package: handlerPackage},
      )
      graph.edge('handled-by', routeId, handlerId, at)
    }
    visit(program, source, node => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !isReceiver(node.expression.expression)) return
      const method = node.expression.name.text.toLowerCase()
      if (methods.has(method)) {
        let receiver = node.expression.expression
        let chainedPath
        while (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
          if (receiver.expression.name.text === 'route') {
            chainedPath = literal(program, checker, receiver.arguments[0])
            break
          }
          receiver = receiver.expression.expression
        }
        addRoute(method, chainedPath ?? literal(program, checker, node.arguments[0]), node.arguments.at(-1), node)
      } else if (method === 'route' && node.arguments[0]) {
        const configuration = node.arguments[0]
        const url = property(program, checker, configuration, 'url')
        if (!url) return // Express .route("/path") is handled by the chained method.
        const methodExpression = property(program, checker, configuration, 'method')
        const value = methodExpression && initializer(program, checker, methodExpression)
        const verbs =
          value && ts.isArrayLiteralExpression(value)
            ? value.elements.map(item => literal(program, checker, item))
            : [literal(program, checker, value)]
        for (const verb of verbs) {
          if (verb) addRoute(verb, literal(program, checker, url), property(program, checker, configuration, 'handler'), node)
          else graph.warnings.add('A Fastify route used a dynamic method and is not represented.')
        }
      } else if (method === 'use' || method === 'register') {
        graph.warnings.add('Router mounting, middleware and Fastify plugin prefixes are not composed; paths are local registration paths.')
      }
    })
  }
  return graph.extraction()
})
