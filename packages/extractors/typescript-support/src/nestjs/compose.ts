import type {Extraction, Json} from '../types.js'
import {extraction} from '../shared.js'
import {compareIds} from '../values.js'
import {ArchitectureItems} from './entities.js'
import {applicationClasses, moduleKeys, tokenIdentities} from './identity.js'
import {linksOf, registrationsOf} from './links.js'
import type {Graph, NestModule, Registration} from './model.js'

export interface Composition {
  root: string
  rootName: string
  entry: string | undefined
  include: string
  nestVersion: string
  graph: Graph
  modules: NestModule[]
  coreProviders: Set<unknown>
}

/** The composed container as an `architecture/v0` extraction. */
export function compose(input: Composition): Extraction {
  const classes = applicationClasses(input.root)
  const tokens = tokenIdentities(input.modules, classes)
  const keys = moduleKeys(input.modules, input.coreProviders, tokens.tokenLabel)
  const items = new ArchitectureItems(classes, keys, tokens)
  const registrations = registrationsOf(input.modules, keys, tokens.tokenId, input.coreProviders, items.applicationModule)
  const links = linksOf(input.graph, registrations)

  // Application registrations, and the framework registrations they inject.
  const kept = new Set<Registration>()
  for (const registration of registrations.byWrapper.values()) {
    if (input.include === 'all' || registration.application) kept.add(registration)
  }
  for (const link of links) if (kept.has(link.from)) kept.add(link.to)

  const keptModules = new Set([...input.modules.filter(items.applicationModule), ...[...kept].map(registration => registration.module)])
  items.addModules(input.modules, keptModules, input.rootName)
  for (const registration of kept) items.addRegistration(registration)
  for (const link of links) if (kept.has(link.from) && kept.has(link.to)) items.addLink(link)

  const unique = <T extends {id: string}>(values: T[]): T[] =>
    [...new Map(values.map(item => [item.id, item])).values()].sort((a, b) => compareIds(a.id, b.id))
  const metadata: Record<string, Json> = {
    nestjs: input.nestVersion,
    rootModule: input.rootName,
    include: input.include,
    limitations: [
      "Composed in NestJS preview mode: no provider is instantiated and factories are not invoked, so a value provider's implementation is its value's class only when that class is known.",
      'Enhancers (guards, interceptors, pipes and filters bound with decorators) and middleware are not registrations; providers bound to APP_GUARD and similar tokens are.',
      input.include === 'all'
        ? "Every module and provider, including Nest's internal core module."
        : "Application modules' providers and controllers, plus the framework providers they inject.",
    ],
  }
  if (input.entry) metadata.entry = input.entry
  return extraction('architecture/v0', unique(items.entities), unique(items.relationships), metadata)
}
