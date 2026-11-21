// Message handlers: which handlers consume which events, registered through the
// calls, registries and decorators named in inputs, and which code publishes them.
// A custom extractor sample; see README.md.
import {
  architecture,
  conventions,
  enclosingName,
  handlerIdentity,
  initializer,
  inputs,
  literal,
  main,
  matcher,
  owner,
  project,
  symbolAt,
  visit,
} from '../typescript-common/program.mjs'

await main(request => {
  const options = inputs(request)
  if (!['handlerApis', 'handlerDecorators', 'handlerRegistries'].some(key => options[key] !== undefined)) {
    throw new Error(
      'message-handlers requires inputs.handlerApis, handlerDecorators, or handlerRegistries with {module,symbol} conventions',
    )
  }
  const optional = key => (options[key] === undefined ? [] : conventions(request, key))
  const calls = optional('handlerApis'),
    decorators = optional('handlerDecorators')
  const registries = optional('handlerRegistries'),
    publishes = optional('publishApis')
  const argument = (key, fallback) => {
    const value = options[key] ?? fallback
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`inputs.${key} must be a nonnegative integer`)
    return value
  }
  const eventArgument = argument('eventArgument', 0),
    handlerArgument = argument('handlerArgument', 1),
    publishArgument = argument('publishArgument', 0)
  const program = project(request)
  const {ts} = program
  const graph = architecture(program, 'messages')
  for (const {source, checker} of program.sources) {
    const matchCall = matcher(program, checker, calls)
    const matchDecorator = matcher(program, checker, decorators)
    const matchRegistry = matcher(program, checker, registries)
    const matchPublish = matcher(program, checker, publishes)
    const bind = (event, handler, at, domain) => {
      if (!event || !handler) {
        graph.warnings.add('A known registration had a dynamic event or missing handler; it is not represented.')
        return
      }
      const pkg = owner(program, source.fileName).name
      const eventId = graph.put('event', [domain, event], event, at)
      const name = handlerIdentity(program, checker, handler)
      const declaration = symbolAt(program, checker, handler)?.valueDeclaration
      const handlerPackage = declaration ? owner(program, declaration.getSourceFile().fileName).name : pkg
      const handlerId = graph.put(
        'handler',
        [handlerPackage, name, name.endsWith('.inline') ? event : 'named'],
        name,
        declaration ?? handler,
        {package: handlerPackage},
      )
      graph.edge('consumes', handlerId, eventId, at)
      graph.edge('registers', graph.packageNode(at), handlerId, at)
    }
    visit(program, source, node => {
      if (!ts.isCallExpression(node)) return
      const convention = matchCall(node.expression)
      if (convention) {
        bind(literal(program, checker, node.arguments[eventArgument]), node.arguments[handlerArgument], node, convention.module)
      }
      if (ts.isDecorator(node.parent)) {
        const decorator = matchDecorator(node.expression)
        const named = node.parent.parent.name
        if (decorator && named && ts.isIdentifier(named)) {
          bind(literal(program, checker, node.arguments[eventArgument]), named, node, decorator.module)
        }
      }
      const publisher = matchPublish(node.expression)
      if (publisher) {
        const event = literal(program, checker, node.arguments[publishArgument])
        if (!event) graph.warnings.add('A known publish call had a dynamic event; it is not represented.')
        else {
          const pkg = owner(program, source.fileName).name
          const name = enclosingName(program, node)
          const publisherId = graph.put('publisher', [pkg, name], name, node, {package: pkg})
          graph.edge('publishes', publisherId, graph.put('event', [publisher.module, event], event, node), node)
          graph.edge('owns', graph.packageNode(node), publisherId, node)
        }
      }
      const registry = matchRegistry(node.expression)
      if (registry && node.arguments[0]) {
        const object = initializer(program, checker, node.arguments[0])
        if (!ts.isObjectLiteralExpression(object)) graph.warnings.add('A handler registry argument was not an object literal.')
        else {
          for (const member of object.properties) {
            if (ts.isPropertyAssignment(member) && (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name))) {
              bind(member.name.text, member.initializer, member, registry.module)
            } else {
              graph.warnings.add(
                'Registry spreads, methods and computed event keys are not supported; use explicit event-to-handler properties.',
              )
            }
          }
        }
      }
    })
  }
  return graph.extraction()
})
