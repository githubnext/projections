import type {SummaryFactContext, SummaryFactItem, SummaryNouns, ComparisonModel} from '@githubnext/projections-renderer-kit'
import type {DependencyInjectionExtraction} from '@githubnext/projections-schemas'
import {diFacts} from './facts.js'

const noun = (singular: string, plural: string) => ({singular, plural})

/**
 * The summary bar's words: services, their registrations and implementations, modules, and the links a card draws
 * (dependencies, runtime resolutions and aliases). A `registration` relationship, `implements`, `provides` and
 * `imports` fold a service's parts into its card, so they are structure, not figures; without leaving the
 * `registration` relationship out, the entity and relationship kinds of that name would be one figure counted twice.
 */
export const dependencyInjectionNouns: SummaryNouns = {
  service: noun('service', 'services'),
  'entities:registration': noun('registration', 'registrations'),
  implementation: noun('implementation', 'implementations'),
  module: noun('module', 'modules'),
  dependsOn: noun('dependency', 'dependencies'),
  resolves: noun('runtime resolution', 'runtime resolutions'),
  aliases: noun('alias', 'aliases'),
  'relationships:registration': false,
  implements: false,
  provides: false,
  imports: false,
}

/** The summary bar's facts: units whose lifetime, service type, implementation or registration count changed, and renames. */
export function dependencyInjectionFacts({model}: SummaryFactContext): SummaryFactItem[] {
  return diFacts(model as ComparisonModel<DependencyInjectionExtraction>)
}
