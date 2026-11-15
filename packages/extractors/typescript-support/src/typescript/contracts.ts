import ts from 'typescript'
import type {Json} from '../types.js'
import {typeText, type TypeText} from './text.js'

/** api/v0 contract facts without the ones that are false or empty, which mean the same as absent ones. */
export function facts(values: {[key: string]: Json | undefined}): Json {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) =>
        value !== undefined &&
        value !== false &&
        !(Array.isArray(value) && !value.length) &&
        !(value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length),
    ),
  ) as Json
}

/** A declaration's kind in api/v0 terms, TypeScript's own word for it, and who can use it: `public` unless a member says otherwise. */
export function apiKind(term: string): {declaration: string; term: string; visibility: string} {
  return {declaration: term === 'namespace' ? 'module' : term, term, visibility: 'public'}
}

/** The primitive a constituent is, or a literal widens to; enum literals are not widened. */
function primitive(value: ts.Type): string | undefined {
  const flags = value.flags
  if (flags & ts.TypeFlags.EnumLiteral) return undefined
  if (flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) return 'string'
  if (flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return 'number'
  if (flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return 'boolean'
  if (flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) return 'bigint'
  if (flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) return 'symbol'
  if (flags & ts.TypeFlags.Null) return 'null'
  if (flags & ts.TypeFlags.Undefined) return 'undefined'
  if (flags & ts.TypeFlags.Void) return 'void'
  return undefined
}

/** Types and signatures as the api/v0 contract facts compatibility compares. */
export function typeFacts(checker: ts.TypeChecker, text: TypeText) {
  const {type, returns} = text
  /** A type as compatibility compares it: the checker's text and its union constituents. */
  const fact = (value: ts.Type, expand?: ts.Symbol): Json => {
    const constituents = value.isUnion() ? value.types : [value]
    const union = constituents
      .map(item => {
        const kind = primitive(item)
        return {text: type(item), ...(kind ? {primitive: kind} : {})}
      })
      .sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
    return {text: type(value, new Set(), expand), union}
  }
  const textFact = (text: string): Json => ({text, union: [{text}]})
  /** Generic parameters as api/v0 contract facts: each name, its constraint and its default. */
  const typeParameterFacts = (parameters: readonly ts.TypeParameterDeclaration[] | undefined): Json[] =>
    (parameters ?? []).map(parameter => ({
      name: parameter.name.text,
      constraints: parameter.constraint ? [type(checker.getTypeFromTypeNode(parameter.constraint), new Set())] : [],
      ...(parameter.default ? {default: type(checker.getTypeFromTypeNode(parameter.default), new Set())} : {}),
    }))
  /** One call signature's parameters and return type, for callers. */
  const signatureFact = (value: ts.Signature): Json => {
    const declaration = value.getDeclaration()
    const predicate = checker.getTypePredicateOfSignature(value)
    const generics = typeParameterFacts(declaration?.typeParameters)
    return {
      parameters: value.getParameters().map(parameter => {
        const at = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? declaration
        const parameterDeclaration = at && ts.isParameter(at) ? at : undefined
        return {
          name: parameter.name,
          type: at ? fact(checker.getTypeOfSymbolAtLocation(parameter, at)) : textFact('unknown'),
          optional: Boolean(
            parameter.flags & ts.SymbolFlags.Optional || parameterDeclaration?.questionToken || parameterDeclaration?.initializer,
          ),
          variadic: Boolean(parameterDeclaration?.dotDotDotToken),
          passing: 'value',
        }
      }),
      returns: predicate ? textFact(returns(value)) : fact(checker.getReturnTypeOfSignature(value)),
      ...(generics.length ? {typeParameters: generics} : {}),
    }
  }
  return {fact, textFact, signatureFact}
}

/** Declaration text and contract facts for the types `checker` sees. */
export function renderer(checker: ts.TypeChecker, exported: Set<ts.Symbol>) {
  const text = typeText(checker, exported)
  return {...text, ...typeFacts(checker, text)}
}

export type Renderer = ReturnType<typeof renderer>
