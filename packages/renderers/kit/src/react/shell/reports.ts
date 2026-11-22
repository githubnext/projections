// What a kit renderer reports to its host besides the selection: declared controls, paint acknowledgements, its
// height and content shape, its legend and its step boundaries.
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject} from 'react'
import {
  controlValues,
  type ControlValue,
  type InitPayload,
  type RendererControl,
  type RendererLegend,
  type RendererOptions,
} from '@githubnext/projections-renderer-sdk/protocol'
import {type RendererClient, afterPaint} from '@githubnext/projections-renderer-sdk/client'
import type {FrameFillControl} from './frame.js'

/**
 * The renderer's controls: the static ones from its mount options until it declares others (see
 * `RendererProps.declareControls`), and every control's value, defaults filled in. `setControl` sets one from the
 * renderer's content: the host applies it and answers with its options, and until it does the value shows at once.
 */
export function useDeclaredControls(
  client: RendererClient | undefined,
  initial: readonly RendererControl[] | undefined,
  options: RendererOptions,
): {
  controls: Record<string, ControlValue>
  declareControls: (controls: readonly RendererControl[]) => void
  setControl: (id: string, value: ControlValue) => void
} {
  const [declared, setDeclared] = useState<readonly RendererControl[]>(() => initial ?? [])
  // A value set from the content, shown until the host's next options, which carry it (or, from a host that ignores
  // the message, leave it out).
  const [pending, setPending] = useState<{options: RendererOptions; values: Record<string, ControlValue>}>({options, values: {}})
  const declareControls = useCallback((controls: readonly RendererControl[]) => {
    setDeclared(previous => (JSON.stringify(previous) === JSON.stringify(controls) ? previous : controls))
  }, [])
  useEffect(() => {
    // Static declarations already went out in `ready`; later ones replace them.
    if (client && declared !== initial && !(declared.length === 0 && !initial)) client.declareOptions(declared)
  }, [client, declared, initial])
  const latest = useRef(options)
  latest.current = options
  const setControl = useCallback(
    (id: string, value: ControlValue) => {
      const shown = latest.current
      setPending(previous => ({options: shown, values: {...(previous.options === shown ? previous.values : {}), [id]: value}}))
      client?.setControl(id, value)
    },
    [client],
  )
  const values = pending.options === options ? pending.values : undefined
  const controls = useMemo(() => controlValues(declared, values ? {...options, ...values} : options), [declared, options, values])
  return {controls, declareControls, setControl}
}

/**
 * Acknowledges each committed progress value once painted, unless a component holds the acknowledgement (see
 * `usePaintGate`); returns the hold. Call it before the components that hold mount: children's effects run before this
 * component's, so a hold taken while mounting is seen by the acknowledgement.
 */
export function usePaintAcknowledgement(
  client: RendererClient | undefined,
  init: InitPayload | undefined,
  hostProgress: {progress: number},
): () => () => void {
  const holds = useRef(0)
  const [released, setReleased] = useState(0)
  const hold = useCallback(() => {
    holds.current++
    let held = true
    return () => {
      if (!held) return
      held = false
      holds.current--
      setReleased(count => count + 1)
    }
  }, [])
  useEffect(() => {
    if (!client || !init || holds.current) return
    return afterPaint(() => {
      if (!holds.current) client.rendered(hostProgress.progress, init)
    })
  }, [client, init, hostProgress, released])
  return hold
}

/**
 * The renderer's height report: its content height as laid out, or while a component fills the frame (see
 * `useFrameFill`) the height that component prefers. `filling` is set while any does.
 */
export function useFrameFillReport(
  client: RendererClient | undefined,
  root: RefObject<HTMLDivElement | null>,
): {filling: boolean; fill: FrameFillControl} {
  const [filling, setFilling] = useState(0)
  const [preferredHeight, setPreferredHeight] = useState<number>()
  const fill = useMemo<FrameFillControl>(
    () => ({
      start() {
        setFilling(count => count + 1)
        return () => setFilling(count => count - 1)
      },
      prefer: height => setPreferredHeight(height === undefined ? undefined : Math.ceil(height)),
    }),
    [],
  )
  // Sent as the layout commits, before the paint it is acknowledged with: a host that measures the frame once the paint
  // is acknowledged (a check, a screenshot) never sees it at the height from before, with the view placed for that.
  useLayoutEffect(() => {
    if (!client || !root.current) return
    if (!filling) return client.observeHeight(root.current)
    if (preferredHeight !== undefined) client.height(preferredHeight)
  }, [client, filling, preferredHeight, root])
  return {filling: filling > 0, fill}
}

/** Reports the content's shape (see `useContentAspect`) once per value, rounded so sub-pixel layout changes don't resend it. */
export function useAspectReport(client: RendererClient | undefined): (ratio: number | undefined) => void {
  const aspectSent = useRef<number>(undefined)
  return useCallback(
    (ratio: number | undefined) => {
      if (!client || ratio === undefined) return
      const rounded = Math.round(ratio * 1000) / 1000
      if (aspectSent.current === rounded) return
      aspectSent.current = rounded
      client.aspect(rounded)
    },
    [client],
  )
}

/** Reports the legend the host draws (see `RendererProps.reportLegend`); repeated identical legends are ignored. */
export function useLegendReport(client: RendererClient | undefined): (legend: RendererLegend) => void {
  const reportedLegend = useRef<string>('')
  return useCallback(
    (legend: RendererLegend) => {
      const key = JSON.stringify(legend)
      if (!client || key === reportedLegend.current) return
      reportedLegend.current = key
      client.legend(legend)
    },
    [client],
  )
}

/** Reports step boundaries where a host may hold (see `RendererProps.reportSteps`); repeated identical ones are ignored. */
export function useStepsReport(client: RendererClient | undefined): (ends: readonly number[], slots?: number) => void {
  const reported = useRef<string>('')
  return useCallback(
    (ends: readonly number[], slots?: number) => {
      const key = `${ends.join(',')}/${slots ?? ''}`
      if (!client || key === reported.current) return
      reported.current = key
      client.steps([...ends], slots)
    },
    [client],
  )
}
