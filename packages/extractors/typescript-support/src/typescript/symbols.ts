import ts from 'typescript'

export function resolve(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  const visited = new Set<ts.Symbol>()
  while (symbol && symbol.flags & ts.SymbolFlags.Alias && !visited.has(symbol)) {
    visited.add(symbol)
    symbol = checker.getAliasedSymbol(symbol)
  }
  return symbol
}

/** Whether a declaration (or modifier-bearing node) carries a modifier of `kind`. */
export function declares(declaration: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(declaration) && ts.getModifiers(declaration)?.some(modifier => modifier.kind === kind))
}

export function privateMember(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some(declaration => {
    const name = (declaration as ts.NamedDeclaration).name
    return (name !== undefined && ts.isPrivateIdentifier(name)) || declares(declaration, ts.SyntaxKind.PrivateKeyword)
  })
}

export function hasModifier(symbol: ts.Symbol, kind: ts.SyntaxKind): boolean {
  return (symbol.declarations ?? []).some(declaration => declares(declaration, kind))
}

/** A member with a getter and no setter is read-only. */
export function getterOnly(symbol: ts.Symbol): boolean | undefined {
  return symbol.declarations?.some(ts.isGetAccessorDeclaration) && !symbol.declarations.some(ts.isSetAccessorDeclaration)
}

export function modifiers(symbol: ts.Symbol): string {
  const kinds = new Set(
    (symbol.declarations ?? []).flatMap(declaration =>
      ts.canHaveModifiers(declaration) ? (ts.getModifiers(declaration) ?? []).map(modifier => modifier.kind) : [],
    ),
  )
  return [
    kinds.has(ts.SyntaxKind.ProtectedKeyword) ? 'protected' : '',
    kinds.has(ts.SyntaxKind.AbstractKeyword) ? 'abstract' : '',
    kinds.has(ts.SyntaxKind.ReadonlyKeyword) || getterOnly(symbol) ? 'readonly' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function memberName(symbol: ts.Symbol): string {
  const name = ts.getNameOfDeclaration(symbol.declarations?.[0])
  if (!name || !ts.isComputedPropertyName(name) || !symbol.name.startsWith('__@')) return symbol.name
  const printed = ts.createPrinter({removeComments: true}).printNode(ts.EmitHint.Unspecified, name, name.getSourceFile())
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, printed)
  const tokens: string[] = []
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push(scanner.getTokenText())
  return tokens.join(' ')
}
