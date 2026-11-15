import {useMemo} from 'react'
import type {Dispatch, RefObject, SetStateAction} from 'react'
import type {InspectorApi} from '../client/api.js'
import type {InspectorHost} from '../host.js'
import type {PartRow} from '../parts/model.js'
import {shortcutLabel} from '../shell/controls.js'
import type {Command} from '../shell/palette.js'
import type {InspectorDefinitionList, InspectorRevision, InspectorScenario} from '../types.js'
import {pairLabel} from './pairs.js'
import type {Marks} from './pairs.js'
import {revisionOption, workingTree} from './revisions.js'

/** The Inspector's commands, for the command palette and keyboard shortcuts. */
export function useCommands({
  host,
  showing,
  api,
  runnable,
  extract,
  projection,
  marked,
  busy,
  cancel,
  refreshDefinitions,
  definitionRevision,
  definitionOptions,
  chooseDefinition,
  partRows,
  resetParts,
  definitions,
  switchProjection,
  switcherCount,
  projectionDefault,
  choosePair,
  toggleOne,
  scenarios,
  showScenario,
  canSwap,
  swap,
  themeCommands,
  setSwitcher,
  upload,
}: {
  host: InspectorHost
  showing: 'live' | 'artifact'
  api: InspectorApi | undefined
  runnable: boolean
  extract: (refs: readonly string[], keep?: boolean) => void
  projection: string
  marked: Marks
  busy: boolean
  cancel: () => Promise<void>
  refreshDefinitions: (ref: string, quiet?: boolean) => Promise<void>
  definitionRevision: string
  definitionOptions: readonly InspectorRevision[]
  chooseDefinition: (ref: string) => void
  partRows: readonly PartRow[]
  resetParts: () => void
  definitions: InspectorDefinitionList | null
  switchProjection: (id: string) => void
  /** How many projections the switcher lists. */
  switcherCount: number
  projectionDefault: Marks
  choosePair: (pair: Marks) => void
  toggleOne: (one: boolean) => void
  scenarios: readonly InspectorScenario[]
  showScenario: (id: string) => void
  canSwap: boolean
  swap: () => void
  themeCommands: readonly Command[]
  setSwitcher: Dispatch<SetStateAction<boolean>>
  upload: RefObject<HTMLInputElement | null>
}): Command[] {
  return useMemo<Command[]>(() => {
    const list: Command[] = []
    if (api) {
      list.push(
        {
          id: 'extract.working',
          group: 'Extraction',
          label: 'Extract the working tree',
          disabled: !runnable,
          run: () => extract([workingTree]),
        },
        {id: 'extract.head', group: 'Extraction', label: 'Extract HEAD', disabled: !runnable, run: () => extract(['HEAD'])},
        {
          id: 'compare.head',
          group: 'Compare',
          label: 'Compare HEAD → Working tree',
          keywords: 'before after uncommitted changes pair',
          shortcut: shortcutLabel('e'),
          disabled: !projection,
          run: () => choosePair({a: 'HEAD', b: workingTree}),
        },
        {
          id: 'compare.default',
          group: 'Compare',
          label: `Compare ${pairLabel(projectionDefault)} (the default pair)`,
          keywords: 'before after history pair',
          disabled: !projection,
          run: () => choosePair(projectionDefault),
        },
        {
          id: 'compare.one',
          group: 'Compare',
          label: marked.a ? 'Show one revision' : 'Compare two revisions',
          keywords: 'single before after',
          disabled: !projection || !marked.b,
          run: () => toggleOne(Boolean(marked.a)),
        },
        ...scenarios.map(scenario => ({
          id: `scenario.${scenario.id}`,
          group: 'Renderer scenarios',
          label: `Show renderer scenario ${scenario.title}`,
          keywords: 'fixture sample',
          disabled: Boolean(scenario.error),
          run: () => showScenario(scenario.id),
        })),
        {
          id: 'extract.marked',
          group: 'Extraction',
          label: 'Extract Before and After again',
          disabled: !runnable || !(marked.a || marked.b),
          run: () => extract([marked.a, marked.b].filter((ref): ref is string => Boolean(ref))),
        },
        {id: 'extract.cancel', group: 'Extraction', label: 'Cancel the running extraction', disabled: !busy, run: () => void cancel()},
        {
          id: 'definitions.refresh',
          group: 'Extraction',
          label: 'Refresh definitions',
          run: () => void refreshDefinitions(definitionRevision),
        },
      )
      for (const row of partRows)
        for (const option of row.options)
          if (!option.disabled && option.value !== row.value)
            list.push({
              id: `use.${row.part}.${option.value}`,
              group: 'Parts',
              label: `Use ${row.part}: ${option.label}`,
              keywords: `${option.origin} ${option.group}`,
              run: () => row.onChange(option.value),
            })
      if (partRows.some(row => row.changed))
        list.push({id: 'parts.reset', group: 'Parts', label: 'Reset parts to the definition', run: resetParts})
      for (const item of definitionOptions)
        list.push({
          id: `definition.${item.ref}`,
          group: 'Definition',
          label: `Apply the definition from ${revisionOption(item)}`,
          keywords: 'definition from revision advanced',
          disabled: item.ref === definitionRevision || busy,
          run: () => chooseDefinition(item.ref),
        })
      for (const definition of definitions?.definitions ?? []) {
        list.push({
          id: `projection.${definition.id}`,
          group: 'Projection',
          label: `Switch to ${definition.title ?? definition.id}`,
          keywords: definition.id,
          disabled: definition.id === projection,
          run: () => switchProjection(definition.id),
        })
      }
    }
    list.push({
      id: 'projection.switch',
      group: 'Projection',
      label: 'Switch projection…',
      keywords: 'projection switcher find open title',
      shortcut: shortcutLabel('p'),
      disabled: !switcherCount,
      run: () => setSwitcher(open => !open),
    })
    list.push(
      {
        id: 'compare.swap',
        group: 'Comparison',
        label: 'Swap Before and After',
        shortcut: shortcutLabel('i'),
        disabled: !canSwap,
        run: swap,
      },
      {id: 'artifact.open', group: 'File', label: 'Open saved artifact…', shortcut: shortcutLabel('o'), run: () => upload.current?.click()},
      ...themeCommands,
    )
    if (host.revealInScm && showing === 'live')
      for (const [side, ref] of [
        ['Before', marked.a],
        ['After', marked.b],
      ] as const)
        if (ref)
          list.push({
            id: `scm.reveal.${side.toLowerCase()}`,
            group: 'Source control',
            label: `Reveal ${side} (${ref === workingTree ? 'Working tree' : ref}) in source control`,
            keywords: 'git scm commit history',
            run: () => host.revealInScm!(ref),
          })
    return list
  }, [
    host,
    showing,
    api,
    runnable,
    extract,
    projection,
    marked,
    busy,
    cancel,
    refreshDefinitions,
    definitionRevision,
    definitionOptions,
    chooseDefinition,
    partRows,
    resetParts,
    definitions,
    switchProjection,
    switcherCount,
    projectionDefault,
    choosePair,
    toggleOne,
    scenarios,
    showScenario,
    canSwap,
    swap,
    themeCommands,
    setSwitcher,
    upload,
  ])
}
