// Symbols through the checker: owning packages, evidence, aliases and the configured API conventions.
import path from 'node:path'
import {inputs, slash} from './basics.mjs'

/** The package whose directory contains `file`. */
export function owner(project, file) {
  const relative = slash(path.relative(project.root, file))
  return project.packages.find(pkg => !pkg.directory || relative.startsWith(`${pkg.directory}/`))
}

export function evidence(project, node) {
  const source = node.getSourceFile()
  const position = source.getLineAndCharacterOfPosition(node.getStart(source))
  return [
    {
      kind: 'typescript',
      source: slash(path.relative(project.root, source.fileName)),
      location: {line: position.line + 1, column: position.character + 1},
    },
  ]
}

/** Follows import and export aliases to the declared symbol. */
export function resolve({ts}, checker, symbol) {
  const visited = new Set()
  while (symbol && symbol.flags & ts.SymbolFlags.Alias && !visited.has(symbol)) {
    visited.add(symbol)
    symbol = checker.getAliasedSymbol(symbol)
  }
  return symbol
}

export function symbolAt(project, checker, node) {
  const {ts} = project
  if (ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) {
    return resolve(project, checker, checker.getShorthandAssignmentValueSymbol(node.parent))
  }
  return resolve(project, checker, checker.getSymbolAtLocation(node))
}

/**
 * `inputs[key]`: an array of `{module, symbol}` conventions naming the APIs that
 * matter, matched by resolved symbol identity rather than spelling.
 */
export function conventions(request, key, defaults) {
  const value = inputs(request)[key]
  if (value === undefined) {
    if (defaults) return defaults
    throw new Error(`inputs.${key} is required: supply [{ "module": "package-or-relative-module", "symbol": "exportedName" }]`)
  }
  if (!Array.isArray(value) || !value.length) throw new Error(`inputs.${key} must be a nonempty array of {module,symbol}`)
  return value.map((item, index) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.module !== 'string' ||
      !item.module.trim() ||
      typeof item.symbol !== 'string' ||
      !item.symbol.trim()
    ) {
      throw new Error(`inputs.${key}[${index}] requires nonempty module and symbol strings`)
    }
    return {module: item.module, symbol: item.symbol}
  })
}

/**
 * A function from a node to the convention its symbol resolves to. A
 * convention's `symbol` is an export name, `default` (including `export =`), or
 * a member path such as `client.variation`.
 */
export function matcher(project, checker, known) {
  const {ts} = project
  if (!known.length) return () => undefined
  const symbols = new Map()
  const inspect = module => {
    const requested = known.filter(convention => convention.module === module.text)
    if (!requested.length) return
    const moduleSymbol = symbolAt(project, checker, module)
    if (!moduleSymbol) return
    for (const convention of requested) {
      const [first, ...rest] = convention.symbol.split('.')
      let target = resolve(
        project,
        checker,
        checker.getExportsOfModule(moduleSymbol).find(exported => exported.name === first) ??
          (first === 'default' ? moduleSymbol.exports?.get(ts.InternalSymbolName.ExportEquals) : undefined),
      )
      for (const part of rest) {
        const at = target?.valueDeclaration ?? target?.declarations?.[0]
        target =
          at && target
            ? resolve(project, checker, checker.getPropertyOfType(checker.getTypeOfSymbolAtLocation(target, at), part))
            : undefined
      }
      if (target?.declarations?.length) {
        const previous = symbols.get(target)
        if (!previous || `${convention.module}:${convention.symbol}` < `${previous.module}:${previous.symbol}`)
          symbols.set(target, convention)
      }
    }
  }
  const visitModules = node => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      inspect(node.moduleSpecifier)
    if (ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isModuleDeclaration(node)) ts.forEachChild(node, visitModules)
  }
  for (const program of project.programs) {
    if (program.getTypeChecker() === checker) for (const source of program.getSourceFiles()) visitModules(source)
  }
  return node => {
    const target = symbolAt(project, checker, node)
    return target ? symbols.get(target) : undefined
  }
}
