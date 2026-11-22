// Walking and statically evaluating expressions: constants, literals, object properties and handler names.
import {symbolAt} from './symbols.mjs'

export function visit({ts}, node, callback) {
  const walk = current => {
    callback(current)
    ts.forEachChild(current, walk)
  }
  walk(node)
}

export function unwrap({ts}, node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression
  }
  return node
}

/** Follows a constant to its initializer. */
export function initializer(project, checker, node, seen = new Set()) {
  const {ts} = project
  node = unwrap(project, node)
  const symbol = symbolAt(project, checker, node)
  if (symbol && !seen.has(symbol)) {
    seen.add(symbol)
    const declaration = symbol.valueDeclaration
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return initializer(project, checker, declaration.initializer, seen)
    }
  }
  return node
}

/** The string a node statically evaluates to, if the checker knows it. */
export function literal(project, checker, node) {
  if (!node) return undefined
  const expression = initializer(project, checker, node)
  if (project.ts.isStringLiteralLike(expression)) return expression.text
  const value = checker.getTypeAtLocation(expression)
  return value.isStringLiteral() ? value.value : undefined
}

/** The expression an object literal (or spread) assigns to `key`. */
export function property(project, checker, node, key, seen = new Set()) {
  const {ts} = project
  node = initializer(project, checker, node)
  if (seen.has(node)) return undefined
  seen.add(node)
  if (!ts.isObjectLiteralExpression(node)) return undefined
  for (const member of [...node.properties].toReversed()) {
    if (ts.isSpreadAssignment(member)) {
      const found = property(project, checker, member.expression, key, seen)
      if (found) return found
    } else if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)) && member.name.text === key) {
      if (ts.isPropertyAssignment(member)) return member.initializer
      if (ts.isShorthandPropertyAssignment(member)) {
        const declaration = checker.getShorthandAssignmentValueSymbol(member)?.valueDeclaration
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return declaration.initializer
        return member.name
      }
    }
  }
  return undefined
}

/** The dotted names of the declarations enclosing a node, or `module`. */
export function enclosingName({ts}, node) {
  const names = []
  for (let cursor = node; cursor && !ts.isSourceFile(cursor); cursor = cursor.parent) {
    if (
      ts.isVariableDeclaration(cursor) ||
      ts.isFunctionDeclaration(cursor) ||
      ts.isClassDeclaration(cursor) ||
      ts.isMethodDeclaration(cursor) ||
      ts.isPropertyAssignment(cursor)
    ) {
      if (cursor.name && (ts.isIdentifier(cursor.name) || ts.isStringLiteralLike(cursor.name))) names.unshift(cursor.name.text)
    }
  }
  return names.join('.') || 'module'
}

/** A handler's identity: its declared name, or its enclosing name for inline handlers. */
export function handlerIdentity(project, checker, expression) {
  const symbol = symbolAt(project, checker, expression)
  if (symbol?.declarations?.length) {
    const declaration = symbol.valueDeclaration ?? symbol.declarations[0]
    if (project.ts.isMethodDeclaration(declaration)) return enclosingName(project, declaration)
    return symbol.name
  }
  return `${enclosingName(project, expression)}.inline`
}
