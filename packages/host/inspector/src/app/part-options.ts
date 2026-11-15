import type {Definition, ExtractionDocument} from '@githubnext/projections-schemas'
import {domainSchemas} from '@githubnext/projections-schemas'
import {rendererAccepts} from '@githubnext/projections-host'
import type {RendererEntry} from '@githubnext/projections-host'
import {describeAccepts} from '@githubnext/projections-renderer-sdk/protocol'
import type {PartOption} from '../parts/model.js'
import type {InspectorPolicy} from '../types.js'
import {partPath} from './definitions.js'

/** The extractors to choose from: the definition's, each other projection's, and each built-in one once. */
export function extractorOptions(ownDefinition: Definition, others: readonly Definition[]): PartOption[] {
  const code = (path: string | undefined, fallback: string) => path ?? fallback
  const extractorOrigin = (item: Definition) =>
    typeof item.extractor === 'string'
      ? `Built-in · ${item.extractor}`
      : code(partPath(item, 'extractor'), item.extractor.command.join(' '))
  const builtinExtractors = new Set<string>()
  return [
    {value: 'own', label: "This projection's extractor", origin: extractorOrigin(ownDefinition), group: 'Definition'},
    ...others.flatMap((item): PartOption[] => {
      if (typeof item.extractor === 'string') {
        if (item.extractor === ownDefinition.extractor || builtinExtractors.has(item.extractor)) return []
        builtinExtractors.add(item.extractor)
        return [
          {
            value: `projection:${item.id}`,
            label: `Built-in ${item.extractor}`,
            origin: `Built-in · ${item.extractor}`,
            group: 'Built-in',
          },
        ]
      }
      return [
        {
          value: `projection:${item.id}`,
          label: `${item.title ?? item.id}'s extractor`,
          origin: extractorOrigin(item),
          group: 'In this repository',
        },
      ]
    }),
  ]
}

/** The comparators to choose from: the definition's, the default one, and every comparator file in the repository. */
export function comparatorOptions(
  ownDefinition: Definition,
  others: readonly Definition[],
  rules: readonly string[] | undefined,
): PartOption[] {
  const ownRules = partPath(ownDefinition, 'comparator')
  // Other projections' comparator files, by path: the same file serves each of them.
  const otherRules = new Map<string, Definition>()
  for (const item of others) {
    const path = partPath(item, 'comparator')
    if (path && path !== ownRules && !otherRules.has(path)) otherRules.set(path, item)
  }
  return [
    {value: 'own', label: "This projection's comparator", origin: ownRules ?? 'Default comparator', group: 'Definition'},
    ...(ownRules ? [{value: 'default', label: 'Default comparator', origin: 'Built-in, with its ordering', group: 'Built-in'}] : []),
    ...[...otherRules].map(([path, item]): PartOption => ({
      value: `file:${path}`,
      label: `${item.title ?? item.id}'s comparator`,
      origin: `Comparator file · ${path}`,
      group: 'In this repository',
    })),
    // Any comparator file in the repository can be tried as this projection's comparator.
    ...(rules ?? [])
      .filter(path => path !== ownRules && !otherRules.has(path))
      .map((path): PartOption => ({
        value: `file:${path}`,
        label: path
          .split('/')
          .pop()!
          .replace(/\.comparator\.ya?ml$/, ''),
        origin: `Comparator file · ${path}`,
        group: 'Comparator files',
      })),
  ]
}

/**
 * The renderers to choose from: the definition's, the built-in ones (those that don't fit the extraction disabled,
 * saying what they expect), and other projections' custom ones.
 */
export function rendererOptions(
  ownDefinition: Definition,
  others: readonly Definition[],
  builtins: readonly RendererEntry[],
  document: ExtractionDocument | undefined,
  policy: InspectorPolicy,
): PartOption[] {
  const schema = document?.extraction.schema
  const family = schema?.split('/')[0]
  const ownRenderer = ownDefinition.renderer
  return [
    {
      value: 'own',
      label: "This projection's renderer",
      origin:
        typeof ownRenderer === 'string'
          ? `Built-in · ${ownRenderer}`
          : `${ownRenderer.bundle}${policy.rendererDevServer ? ' · dev server' : ''}`,
      group: 'Definition',
    },
    ...builtins
      .filter(entry => entry.name !== ownRenderer)
      .map((entry): PartOption => {
        // A renderer declaring what it accepts (schema and vocabulary) is checked against the extraction itself;
        // one without the declaration by the schema family it is named for or handles.
        const extraction = document?.extraction
        const fits =
          !extraction ||
          (entry.accepts ? rendererAccepts(entry, extraction) : !family || entry.name === family || entry.handles.includes(family))
        const families = domainSchemas.map(item => item.split('/')[0])
        const expects = entry.accepts
          ? describeAccepts(entry.accepts)
          : [...new Set([entry.name, ...entry.handles])]
              .filter((name, index) => index === 0 || families.includes(name))
              .filter(name => families.includes(name) || entry.handles.every(handled => !families.includes(handled)))
              .slice(0, 2)
              .map(name => `\`${name}/v0\``)
              .join(' or ')
        return {
          value: `builtin:${entry.name}`,
          label: entry.title,
          origin: `Built-in · ${entry.name}`,
          group: 'Built-in',
          ...(fits ? {} : {disabled: true, reason: `Expects ${expects}; this extractor emits \`${schema}\``}),
        }
      }),
    ...others.flatMap((item): PartOption[] =>
      typeof item.renderer === 'string'
        ? []
        : [
            {
              value: `custom:${item.id}`,
              label: `${item.title ?? item.id}'s renderer`,
              origin: item.renderer.bundle,
              group: 'In this repository',
            },
          ],
    ),
  ]
}

/** The extraction's `data` fields the default comparator can order by, at most 12. */
export function dataFields(document: ExtractionDocument | undefined): string[] {
  return [...new Set((document?.extraction.entities ?? []).flatMap(entity => Object.keys(entity.data ?? {})))].slice(0, 12)
}
