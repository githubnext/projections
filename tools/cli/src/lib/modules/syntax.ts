// Reading a module's syntax: its imports and re-exports, the names it exports, and relative specifiers' files.
import {existsSync, readFileSync} from 'node:fs'
import {join, posix} from 'node:path'
import ts from 'typescript'

export const sources = /\.(?:[cm]?[jt]sx?)$/
export const skipped = /(?:^|\/)(?:node_modules|dist|fixtures|test-results|playwright-report|storybook-static)(?:\/|$)/

export type Import = {specifier: string; names: string[] | '*'; typeOnly?: boolean}

/** Every import and re-export of a module, with the names it takes ('*' for a namespace or side-effect-free use of all). */
export function importsOf(path: string, text: string): Import[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false)
  const found: Import[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const names: string[] | '*' =
        bindings && ts.isNamespaceImport(bindings)
          ? '*'
          : [
              ...(clause?.name ? ['default'] : []),
              ...(bindings && ts.isNamedImports(bindings) ? bindings.elements.map(item => (item.propertyName ?? item.name).text) : []),
            ]
      const typeOnly =
        !!clause?.isTypeOnly ||
        (!!clause && !clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.every(item => item.isTypeOnly))
      found.push({specifier: node.moduleSpecifier.text, names, typeOnly})
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause
      found.push({
        specifier: node.moduleSpecifier.text,
        names: clause && ts.isNamedExports(clause) ? clause.elements.map(item => (item.propertyName ?? item.name).text) : '*',
        typeOnly: node.isTypeOnly || (!!clause && ts.isNamedExports(clause) && clause.elements.every(item => item.isTypeOnly)),
      })
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({specifier: node.arguments[0].text, names: '*'})
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push({
        specifier: node.argument.literal.text,
        names: node.qualifier && ts.isIdentifier(node.qualifier) ? [node.qualifier.text] : '*',
        typeOnly: true,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** The source file a relative specifier names, trying the TypeScript extensions an emitted `.js` stands for. */
export function resolveRelative(root: string, from: string, specifier: string): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier))
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, '')
  const candidates = [
    base,
    ...['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx'].map(extension => stem + extension),
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]
  return candidates.find(candidate => sources.test(candidate) && existsSync(join(root, candidate)))
}

/** The names a module exports, following `export *` and `export {…} from` through relative modules. */
export function exportedNames(root: string, path: string, seen = new Set<string>()): string[] {
  if (seen.has(path)) return []
  seen.add(path)
  const source = ts.createSourceFile(path, readFileSync(join(root, path), 'utf8'), ts.ScriptTarget.Latest, false)
  const names: string[] = []
  const exported = (node: ts.Node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause
      if (clause && ts.isNamedExports(clause)) names.push(...clause.elements.map(item => item.name.text))
      else if (clause && ts.isNamespaceExport(clause)) names.push(clause.name.text)
      else if (
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.startsWith('.')
      ) {
        const target = resolveRelative(root, path, statement.moduleSpecifier.text)
        if (target) names.push(...exportedNames(root, target, seen).filter(name => name !== 'default'))
      }
    } else if (ts.isExportAssignment(statement)) names.push('default')
    else if (exported(statement)) {
      const isDefault = (ts.getModifiers(statement as ts.HasModifiers) ?? []).some(
        modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      )
      if (isDefault) names.push('default')
      else if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text)
        }
      else {
        const name = (statement as ts.DeclarationStatement).name
        if (name && ts.isIdentifier(name)) names.push(name.text)
      }
    }
  }
  return [...new Set(names)]
}
