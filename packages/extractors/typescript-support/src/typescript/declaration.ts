import ts from 'typescript'
import type {Json} from '../types.js'
import {apiKind, facts, type Renderer} from './contracts.js'
import {declares, privateMember} from './symbols.js'

type GenericDeclaration = ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration

/** What an exported symbol declares: its text, contract facts and the surface conflicting exports compare. */
export interface ExportDescription {
  isType: boolean
  structured: boolean
  declared: ts.Type
  signature: string
  contract: Json
  surface: string
}

/** `extends`/`implements` clauses as text, each clause's types sorted. */
function heritageText(checker: ts.TypeChecker, render: Renderer, declaration: GenericDeclaration | undefined): string {
  return declaration && !ts.isTypeAliasDeclaration(declaration)
    ? (declaration.heritageClauses ?? [])
        .map(
          clause =>
            `${clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements'} ${clause.types
              .map(type => render.type(checker.getTypeAtLocation(type)))
              .sort()
              .join(', ')}`,
        )
        .sort()
        .join(' ')
    : ''
}

/** The supertypes a class or interface names, as contract facts. */
function supertypes(checker: ts.TypeChecker, render: Renderer, declaration: GenericDeclaration | undefined) {
  return declaration && !ts.isTypeAliasDeclaration(declaration)
    ? (declaration.heritageClauses ?? [])
        .flatMap(clause =>
          clause.types.map(type => ({
            relation: clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements',
            type: render.type(checker.getTypeAtLocation(type)),
          })),
        )
        .sort((a, b) => {
          const [left, right] = [`${a.relation} ${a.type}`, `${b.relation} ${b.type}`]
          return left < right ? -1 : left > right ? 1 : 0
        })
    : []
}

export function describeExport(
  checker: ts.TypeChecker,
  render: Renderer,
  symbol: ts.Symbol,
  name: string,
  declaration: ts.Declaration,
): ExportDescription {
  const isClass = Boolean(symbol.flags & ts.SymbolFlags.Class)
  const isType = Boolean(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias))
  const declared = isType || isClass ? checker.getDeclaredTypeOfSymbol(symbol) : checker.getTypeOfSymbolAtLocation(symbol, declaration)
  const genericDeclaration = symbol.declarations!.find(
    item => ts.isClassDeclaration(item) || ts.isInterfaceDeclaration(item) || ts.isTypeAliasDeclaration(item),
  ) as GenericDeclaration | undefined
  const generics = render.typeParameters(genericDeclaration?.typeParameters, new Set())
  const structured = Boolean(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface))
  const heritage = heritageText(checker, render, genericDeclaration)
  const calls = declared.getCallSignatures()
  const abstract = genericDeclaration && declares(genericDeclaration, ts.SyntaxKind.AbstractKeyword)
  const signature = structured
    ? `${abstract ? 'abstract ' : ''}${isClass ? 'class' : 'interface'} ${name}${generics}${heritage ? ` ${heritage}` : ''}`
    : isType
      ? `type ${name}${generics} = ${render.type(declared, new Set(), symbol)}`
      : calls.length
        ? calls.map(call => `${name}${render.signature(call)}`).join('; ')
        : `${name}: ${render.type(declared, new Set(), symbol)}`
  // Private members make a class nominal: only its instances are assignable to it.
  const branding: Record<string, Json> = isClass
    ? {
        nominalBrand: declared.getProperties().some(privateMember),
        staticNominalBrand: checker.getTypeOfSymbolAtLocation(symbol, declaration).getProperties().some(privateMember),
      }
    : {}
  const supers = supertypes(checker, render, genericDeclaration)
  const contract: Json = structured
    ? isClass
      ? facts({...apiKind('class'), abstract: Boolean(abstract), supertypes: supers, native: facts(branding)})
      : facts({...apiKind('interface'), supertypes: supers})
    : isType
      ? {...apiKind('alias'), type: render.fact(declared, symbol)}
      : calls.length
        ? {...apiKind('function'), signatures: calls.map(call => render.signatureFact(call))}
        : {
            ...apiKind(symbol.flags & ts.SymbolFlags.Enum ? 'enum' : symbol.flags & ts.SymbolFlags.Module ? 'namespace' : 'variable'),
            type: render.fact(declared, symbol),
          }
  const surface = structured
    ? `${signature}\n${JSON.stringify(branding)}\n${render.type(declared, new Set(), symbol)}\n${isClass ? render.type(checker.getTypeOfSymbolAtLocation(symbol, declaration), new Set(), symbol) : ''}`
    : signature
  return {isType, structured, declared, signature, contract, surface}
}
