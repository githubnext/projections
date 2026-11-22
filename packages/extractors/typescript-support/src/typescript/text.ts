import path from 'node:path'
import ts from 'typescript'
import {memberName, modifiers, privateMember} from './symbols.js'

/**
 * Renders types, signatures and members as stable declaration text. Exported
 * symbols and declaration-file types are named; other object types are expanded.
 */
export function typeText(checker: ts.TypeChecker, exported: Set<ts.Symbol>) {
  const typeParameters = (parameters: readonly ts.TypeParameterDeclaration[] | undefined, seen: Set<ts.Type>): string =>
    parameters?.length
      ? `<${parameters.map(parameter => `${parameter.name.text}${parameter.constraint ? ` extends ${type(checker.getTypeFromTypeNode(parameter.constraint), seen)}` : ''}${parameter.default ? ` = ${type(checker.getTypeFromTypeNode(parameter.default), seen)}` : ''}`).join(', ')}>`
      : ''
  const returns = (value: ts.Signature, seen = new Set<ts.Type>()): string => {
    const predicate = checker.getTypePredicateOfSignature(value)
    return predicate
      ? `${predicate.kind === ts.TypePredicateKind.AssertsIdentifier || predicate.kind === ts.TypePredicateKind.AssertsThis ? 'asserts ' : ''}${predicate.kind === ts.TypePredicateKind.This || predicate.kind === ts.TypePredicateKind.AssertsThis ? 'this' : predicate.parameterName}${predicate.type ? ` is ${type(predicate.type, seen)}` : ''}`
      : type(checker.getReturnTypeOfSignature(value), seen)
  }
  const signature = (value: ts.Signature, seen = new Set<ts.Type>()): string => {
    const declaration = value.getDeclaration()
    const parameters = [...(value.thisParameter ? [value.thisParameter] : []), ...value.getParameters()]
    const returnType = returns(value, seen)
    return `${typeParameters(declaration?.typeParameters, seen)}(${parameters
      .map(parameter => {
        const at = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? declaration
        if (!at) return parameter.name
        const parameterDeclaration = ts.isParameter(at) ? at : undefined
        return `${parameterDeclaration?.dotDotDotToken ? '...' : ''}${parameter.name}${parameter.flags & ts.SymbolFlags.Optional || parameterDeclaration?.questionToken || parameterDeclaration?.initializer ? '?' : ''}: ${type(checker.getTypeOfSymbolAtLocation(parameter, at), seen)}`
      })
      .join(', ')}): ${returnType}`
  }
  const member = (symbol: ts.Symbol, seen = new Set<ts.Type>()): string => {
    const at = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!at) return symbol.name
    const value = checker.getTypeOfSymbolAtLocation(symbol, at)
    const calls = value.getCallSignatures()
    const prefix = `${modifiers(symbol)} ${JSON.stringify(memberName(symbol))}${symbol.flags & ts.SymbolFlags.Optional ? '?' : ''}`.trim()
    return calls.length && symbol.flags & ts.SymbolFlags.Method
      ? calls.map(call => `${prefix}${signature(call, seen)}`).join('; ')
      : `${prefix}: ${type(value, seen)}`
  }
  const tuple = (value: ts.Type, next: Set<ts.Type>): string => {
    const reference = value as ts.TypeReference
    const target = reference.target as ts.TupleType
    return `${target.readonly ? 'readonly ' : ''}[${checker
      .getTypeArguments(reference)
      .map((argument, index) => {
        const flag = target.elementFlags[index] ?? ts.ElementFlags.Required
        return `${flag & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic) ? '...' : ''}${type(argument, next)}${flag & ts.ElementFlags.Optional ? '?' : ''}${flag & ts.ElementFlags.Rest ? '[]' : ''}`
      })
      .join(', ')}]`
  }
  /** The symbol a type is spelled by, when it is exported or comes from a declaration file. */
  const nameOf = (value: ts.Type, expand: ts.Symbol | undefined): ts.Symbol | undefined => {
    const named = value.aliasSymbol ?? value.symbol
    return named &&
      named !== expand &&
      named.name !== '__type' &&
      named.name !== '__object' &&
      (exported.has(named) || named.declarations?.some(declaration => declaration.getSourceFile().isDeclarationFile))
      ? named
      : undefined
  }
  const reference = (value: ts.Type, named: ts.Symbol, next: Set<ts.Type>): string => {
    const arguments_ =
      value.aliasTypeArguments ??
      (value.flags & ts.TypeFlags.Object && (value as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
        ? checker.getTypeArguments(value as ts.TypeReference)
        : [])
    return `${named.name}${arguments_.length ? `<${arguments_.map(argument => type(argument, next)).join(', ')}>` : ''}`
  }
  const object = (value: ts.Type, next: Set<ts.Type>): string => {
    const parts = value
      .getProperties()
      .filter(symbol => !privateMember(symbol))
      .map(symbol => member(symbol, next))
    parts.push(
      ...checker
        .getIndexInfosOfType(value)
        .map(info => `${info.isReadonly ? 'readonly ' : ''}[key: ${type(info.keyType, next)}]: ${type(info.type, next)}`),
    )
    // Property order is irrelevant, but overload order controls resolution and inference.
    const calls = value.getCallSignatures().map(call => signature(call, next))
    const constructs = value.getConstructSignatures().map(call => `new ${signature(call, next)}`)
    return `{ ${[...parts.sort(), ...calls, ...constructs].join('; ')} }`
  }
  // The compiler printer handles conditional/mapped/template-literal and primitive types.
  // It is tokenized to erase formatting; quoted import paths are normalized separately.
  const printed = (value: ts.Type): string =>
    checker
      .typeToString(value, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias)
      .replace(
        /import\("([^"]+)"\)/gu,
        (_match, module: string) =>
          `import(${JSON.stringify(path.isAbsolute(module) ? path.basename(module).replace(/\.[cm]?[jt]sx?$/u, '') : module)})`,
      )
  const type = (value: ts.Type, seen = new Set<ts.Type>(), expand?: ts.Symbol): string => {
    if (seen.has(value)) return value.aliasSymbol?.name ?? value.symbol?.name ?? 'recursive'
    const next = new Set(seen).add(value)
    if (value.isUnion()) {
      return value.types
        .map(item => type(item, next))
        .sort()
        .join(' | ')
    }
    if (value.isIntersection()) return value.types.map(item => type(item, next)).join(' & ')
    if (value.flags & ts.TypeFlags.TypeParameter) return value.symbol?.name ?? 'unknown'
    if (value.flags & ts.TypeFlags.StringLiteral) return JSON.stringify((value as ts.StringLiteralType).value)
    if (value.flags & ts.TypeFlags.NumberLiteral) return String((value as ts.NumberLiteralType).value)
    if (checker.isTupleType(value)) return tuple(value, next)
    if (checker.isArrayType(value)) {
      return `Array<${checker
        .getTypeArguments(value as ts.TypeReference)
        .map(item => type(item, next))
        .join(', ')}>`
    }
    const named = nameOf(value, expand)
    if (named) return reference(value, named, next)
    if (value.flags & ts.TypeFlags.Object && !((value as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped)) return object(value, next)
    return printed(value)
  }
  return {type, signature, member, typeParameters, returns}
}

export type TypeText = ReturnType<typeof typeText>
