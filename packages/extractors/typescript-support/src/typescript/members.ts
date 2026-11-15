import ts from 'typescript'
import type {Entity, Json, Relationship} from '../types.js'
import {evidence, id, type Project} from './model.js'
import {apiKind, facts, type Renderer} from './contracts.js'
import {declares, getterOnly, hasModifier, memberName, privateMember} from './symbols.js'

type Member = {symbol: ts.Symbol; static: boolean}

/** The members of an exported class or interface, collected as `contains` children of its export. */
export class MemberNodes {
  constructor(
    private readonly project: Project,
    private readonly checker: ts.TypeChecker,
    private readonly render: Renderer,
    private readonly nodes: Map<string, Entity>,
    private readonly edges: Relationship[],
  ) {}

  /** Adds every public member of `symbol`'s declared type (and, for a class, its constructor side). */
  add(exportId: string, symbol: ts.Symbol, declaration: ts.Declaration, declared: ts.Type): void {
    const members: Member[] = declared.getProperties().map(member => ({symbol: member, static: false}))
    if (symbol.flags & ts.SymbolFlags.Class) {
      const constructor = this.checker.getTypeOfSymbolAtLocation(symbol, declaration)
      members.push(
        ...constructor
          .getProperties()
          .filter(member => member.name !== 'prototype')
          .map(member => ({symbol: member, static: true})),
      )
      this.constructors(exportId, declaration, constructor)
    }
    for (const member of members) {
      if (privateMember(member.symbol)) continue
      const name = memberName(member.symbol)
      const at = member.symbol.valueDeclaration ?? member.symbol.declarations?.[0] ?? declaration
      this.node(exportId, id(exportId, member.static ? 'static' : 'instance', name), {
        label: name,
        data: {
          signature: `${member.static ? 'static ' : ''}${this.render.member(member.symbol)}`,
          contract: this.contract(member, declaration),
        },
        evidence: evidence(this.project, at, declaration),
      })
    }
    for (const index of this.checker.getIndexInfosOfType(declared)) this.index(exportId, declaration, index)
    for (const [kind, signatures] of [
      ['call', declared.getCallSignatures()],
      ['construct', declared.getConstructSignatures()],
    ] as const) {
      if (!signatures.length) continue
      this.node(exportId, id(exportId, kind), {
        label: kind,
        data: {
          signature: signatures.map(call => `${kind === 'construct' ? 'new ' : ''}${this.render.signature(call)}`).join('; '),
          contract: {...apiKind(kind), signatures: signatures.map(call => this.render.signatureFact(call))},
        },
        evidence: evidence(this.project, declaration),
      })
    }
  }

  private node(exportId: string, memberId: string, entity: Pick<Entity, 'label' | 'data' | 'evidence'>): void {
    this.nodes.set(memberId, {id: memberId, kind: 'member', ...entity, confidence: 'authoritative'})
    this.edges.push({id: id('contains', exportId, memberId), kind: 'contains', from: exportId, to: memberId})
  }

  private constructors(exportId: string, declaration: ts.Declaration, constructor: ts.Type): void {
    const constructors = constructor.getConstructSignatures().filter(call => {
      const at = call.getDeclaration()
      return !at || !declares(at, ts.SyntaxKind.PrivateKeyword)
    })
    if (!constructors.length) return
    const isProtected = (call: ts.Signature): boolean => {
      const at = call.getDeclaration()
      return Boolean(at && declares(at, ts.SyntaxKind.ProtectedKeyword))
    }
    this.node(exportId, id(exportId, 'constructor'), {
      label: 'constructor',
      data: {
        signature: constructors.map(call => `${isProtected(call) ? 'protected ' : ''}new ${this.render.signature(call)}`).join('; '),
        contract: facts({
          ...apiKind('constructor'),
          visibility: constructors.some(isProtected) ? 'protected' : 'public',
          signatures: constructors.map(call => this.render.signatureFact(call)),
        }),
      },
      evidence: evidence(this.project, declaration),
    })
  }

  private contract(member: Member, declaration: ts.Declaration): Json {
    const at = member.symbol.valueDeclaration ?? member.symbol.declarations?.[0] ?? declaration
    const value = this.checker.getTypeOfSymbolAtLocation(member.symbol, at)
    const common = {
      optional: Boolean(member.symbol.flags & ts.SymbolFlags.Optional),
      static: member.static,
      abstract: hasModifier(member.symbol, ts.SyntaxKind.AbstractKeyword),
      visibility: hasModifier(member.symbol, ts.SyntaxKind.ProtectedKeyword) ? 'protected' : 'public',
    }
    return member.symbol.flags & ts.SymbolFlags.Method && value.getCallSignatures().length
      ? facts({...apiKind('method'), ...common, signatures: value.getCallSignatures().map(call => this.render.signatureFact(call))})
      : facts({
          ...apiKind('property'),
          ...common,
          readonly: Boolean(hasModifier(member.symbol, ts.SyntaxKind.ReadonlyKeyword) || getterOnly(member.symbol)),
          type: this.render.fact(value),
        })
  }

  private index(exportId: string, declaration: ts.Declaration, index: ts.IndexInfo): void {
    const key = this.render.type(index.keyType)
    this.node(exportId, id(exportId, 'index', key), {
      label: `[${key}]`,
      data: {
        signature: `${index.isReadonly ? 'readonly ' : ''}[key: ${key}]: ${this.render.type(index.type)}`,
        contract: facts({
          ...apiKind('index'),
          readonly: index.isReadonly,
          type: this.render.fact(index.type),
          // An index signature is read with a key: its one parameter.
          signatures: [
            {
              parameters: [{name: 'key', type: this.render.textFact(key), optional: false, variadic: false, passing: 'value'}],
              returns: this.render.fact(index.type),
            },
          ],
        }),
      },
      evidence: evidence(this.project, declaration),
    })
  }
}
