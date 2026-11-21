// The lifecycle rule: in the hosts and integrations, flags the patterns that keep a lifecycle implicit, so it is modelled
// with @githubnext/projections-machine instead (docs/guides/state-machines.md). It warns in editors;
// tools/scripts/check-machines.mjs fails when a file has more of these than its committed baseline.

const effectHooks = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect'])
const timers = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame'])
const settlers = new Set(['then', 'catch', 'finally'])
const guide = 'docs/guides/state-machines.md'

const calleeName = callee =>
  callee.type === 'Identifier'
    ? callee.name
    : callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier'
      ? callee.property.name
      : undefined

const isFunction = node => node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression'

/** The names of the calls each enclosing function is an argument of, innermost first. */
function callbackOf(ancestors) {
  const names = []
  for (let index = ancestors.length - 1; index > 0; index--) {
    const node = ancestors[index]
    const parent = ancestors[index - 1]
    if (isFunction(node) && parent.type === 'CallExpression' && parent.arguments.includes(node)) names.push(calleeName(parent.callee))
  }
  return names
}

/** @type {import('eslint').Rule.RuleModule} */
export const lifecycleRule = {
  meta: {
    type: 'suggestion',
    docs: {description: 'Model lifecycles as explicit state machines rather than refs, effect timers and deferred setState'},
    messages: {
      booleanRef: `A boolean ref is lifecycle state React doesn't see and no transition names. Model it as a state of a machine (${guide}).`,
      timerInEffect: `A {{timer}} started from an effect is a transition nothing names. Make it an \`after\` timer or an activity of a machine (${guide}).`,
      deferredSetState: `{{setter}} from a {{callback}} callback can land after the component moved on. Send the result to a machine, whose generations drop stale results (${guide}).`,
    },
    schema: [],
  },
  create(context) {
    const {sourceCode} = context
    // The variables `useState` setters are bound to, so a call is one only when it resolves to one of them.
    const setters = new Set()
    const deferred = []
    const resolve = identifier => {
      for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
        const variable = scope.set.get(identifier.name)
        if (variable) return variable
      }
      return undefined
    }
    return {
      VariableDeclarator(node) {
        if (node.init?.type !== 'CallExpression' || calleeName(node.init.callee) !== 'useState') return
        const setter = node.id.type === 'ArrayPattern' ? node.id.elements[1] : undefined
        if (setter?.type !== 'Identifier') return
        for (const variable of sourceCode.getDeclaredVariables(node)) if (variable.name === setter.name) setters.add(variable)
      },
      CallExpression(node) {
        const name = calleeName(node.callee)
        if (name === 'useRef' && node.arguments[0]?.type === 'Literal' && typeof node.arguments[0].value === 'boolean')
          context.report({node, messageId: 'booleanRef'})
        const callbacks = callbackOf(context.sourceCode.getAncestors(node))
        if (timers.has(name) && callbacks.some(callback => effectHooks.has(callback)))
          context.report({node, messageId: 'timerInEffect', data: {timer: name}})
        if (node.callee.type === 'Identifier') {
          const callback = callbacks.find(callee => timers.has(callee) || settlers.has(callee))
          if (callback) deferred.push({node, setter: node.callee.name, callback})
        }
      },
      'Program:exit'() {
        for (const {node, setter, callback} of deferred)
          if (setters.has(resolve(node.callee))) context.report({node, messageId: 'deferredSetState', data: {setter, callback}})
      },
    }
  },
}

/** The ESLint plugin that holds it, as `machines/lifecycle`. */
export const machinesPlugin = {rules: {lifecycle: lifecycleRule}}

/** The source files the rule applies to: the hosts and the integration that run lifecycles. */
export const lifecycleFiles = ['packages/host/{core,vscode-ui,inspector}/src/**/*.{ts,tsx}', 'packages/integrations/vscode/src/**/*.ts']
