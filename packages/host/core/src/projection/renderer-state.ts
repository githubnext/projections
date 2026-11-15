import {useEffect, useMemo, useState} from 'react'
import {controlValues, isControlValue} from '@githubnext/projections-renderer-sdk/protocol'
import type {ControlValue} from '@githubnext/projections-renderer-sdk/protocol'
import {clampMode, defaultComparisonModes, orderComparisonModes, twoPaneMode} from '../modes.js'
import type {ComparisonMode} from '../modes.js'
import type {PaneState} from '../pane.js'
import type {RendererEntry} from '../registry.js'
import type {Controllable} from './controllable.js'
import type {PaneKey, ProjectionController, ProjectionOptions, RendererStatus} from './types.js'

export type ComparisonModesInput = Pick<Controllable, 'request'> & {
  comparing: boolean
  renderer: RendererEntry | undefined
  chosenMode: ComparisonMode | undefined
  panes: Record<PaneKey, PaneState>
}

/**
 * The comparison modes the renderer supports, in canonical order, the mode shown (the chosen one when supported) and
 * the panes it shows. Records the modes the connected renderer declares, and falls back to a supported mode when the
 * chosen one isn't.
 */
export function useComparisonModes({request, comparing, renderer, chosenMode, panes}: ComparisonModesInput) {
  // The modes each renderer declared when it connected, by bundle URL; they outlive the panes that reported them.
  const [declaredModes, setDeclaredModes] = useState<{readonly [url: string]: readonly ComparisonMode[]}>({})
  // Shown in canonical order, whatever order the renderer declares them in.
  const declared = (renderer && (declaredModes[renderer.url] ?? renderer.comparisonModes)) || defaultComparisonModes
  const modesKey = declared.join()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const availableModes = useMemo(() => orderComparisonModes(declared), [modesKey])
  // Until a renderer is resolved and says which modes it supports (its manifest or its ready message), a chosen mode is
  // trusted and kept pending: a host mounted before its renderer catalog loads must not clamp `initialMode: 'diff'` to
  // the defaults (which have no diff) and lose it.
  const modesKnown = Boolean(renderer && (declaredModes[renderer.url] ?? renderer.comparisonModes))
  const mode: ComparisonMode = !comparing
    ? 'animated'
    : modesKnown
      ? clampMode(chosenMode, availableModes)
      : (chosenMode ?? clampMode(undefined, availableModes))
  const paneKeys: PaneKey[] = twoPaneMode(mode) ? ['before', 'after'] : ['main']
  const readyCapabilities = panes[paneKeys[0]!].capabilities
  useEffect(() => {
    if (!renderer || !readyCapabilities) return
    const modes = readyCapabilities.comparisonModes ?? defaultComparisonModes
    setDeclaredModes(previous =>
      JSON.stringify(previous[renderer.url]) === JSON.stringify(modes) ? previous : {...previous, [renderer.url]: modes},
    )
  }, [renderer, readyCapabilities])
  useEffect(() => {
    if (comparing && modesKnown && chosenMode !== undefined && chosenMode !== mode) request('mode', mode)
  }, [comparing, modesKnown, chosenMode, mode, request])
  return {availableModes, modesKnown, mode, paneKeys}
}

/** Whether the shown panes' renderer is loading, ready or failed (`none` without a renderer), and its errors. */
export function rendererState(renderer: RendererEntry | undefined, panes: Record<PaneKey, PaneState>, paneKeys: PaneKey[]) {
  const statuses = paneKeys.map(key => panes[key].status)
  const status: RendererStatus = !renderer
    ? 'none'
    : statuses.includes('failed')
      ? 'failed'
      : statuses.includes('loading')
        ? 'loading'
        : 'ready'
  const errors = paneKeys.flatMap(key => [
    ...panes[key].rendererErrors,
    ...(panes[key].status === 'failed' && panes[key].message ? [panes[key].message!] : []),
  ])
  return {status, errors}
}

export type RendererControlsInput = Pick<Controllable, 'latest' | 'internal' | 'setInternal'> & {
  options: ProjectionOptions
  renderer: RendererEntry | undefined
  panes: Record<PaneKey, PaneState>
  paneKeys: PaneKey[]
}

/**
 * The controls the shown renderer declares and their values. Definition defaults for renderer controls apply once the
 * renderer declares them; unknown or invalid ones get a notice.
 */
export function useRendererControls({latest, internal, setInternal, options, renderer, panes, paneKeys}: RendererControlsInput) {
  const presentation = options.presentation
  const controls = panes[paneKeys[0]!].controls
  const [seeded, setSeeded] = useState<{notices: string[]; key: string}>({notices: [], key: ''})
  const [action, setAction] = useState<{id: string; sequence: number}>()
  const declaredKey = JSON.stringify(controls)
  if (declaredKey !== seeded.key && controls.length && presentation?.rendererOptions) {
    const notices: string[] = []
    const values: {[id: string]: ControlValue} = {}
    for (const [id, raw] of Object.entries(presentation.rendererOptions)) {
      const control = controls.find(item => item.id === id)
      if (!control)
        notices.push(`The projection definition sets "${id}", which the ${renderer?.title ?? ''} renderer doesn't offer; it was ignored.`)
      else if (!isControlValue(control, raw))
        notices.push(`The projection definition's value for "${control.label}" isn't valid for this renderer; its default is used.`)
      else values[id] = raw
    }
    setSeeded({notices, key: declaredKey})
    setInternal(previous => ({...previous, controlValues: {...values, ...previous.controlValues}}))
  }
  const values = controlValues(controls, options.controlValues ?? internal.controlValues)
  const valuesKey = JSON.stringify(values)
  const stableValues = useMemo(() => JSON.parse(valuesKey) as {[id: string]: ControlValue}, [valuesKey])
  const actions: Pick<ProjectionController, 'setControl' | 'runAction'> = {
    setControl: (id, next) => {
      const control = controls.find(item => item.id === id)
      if (!control || !isControlValue(control, next)) return
      if (latest.current.controlValues === undefined)
        setInternal(previous => ({...previous, controlValues: {...previous.controlValues, [id]: next}}))
      latest.current.onControlChange?.(id, next)
    },
    runAction: id => {
      if (!controls.some(control => control.id === id && control.type === 'action')) return
      setAction(previous => ({id, sequence: (previous?.sequence ?? 0) + 1}))
      latest.current.onAction?.(id)
    },
  }
  return {controls, notices: seeded.notices, stableValues, action, ...actions}
}
