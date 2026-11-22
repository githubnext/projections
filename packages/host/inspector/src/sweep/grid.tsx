// The history sweep: its statistics, thumbnails, the table and the grid (here).

import {useEffect, useMemo, useRef, useState} from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  NativeSelectOption,
  TooltipProvider,
} from '@githubnext/projections-host/ui/components'
import {History, LoaderCircle} from 'lucide-react'
import type {InspectorApi} from '../client/api.js'
import type {Sweep, SweepCell} from '../types.js'
import {bySignal, signalCounts} from './stats.js'
import {SweepTable} from './table.js'
import type {Adoptable} from './table.js'
import {useThumbnailQueue} from './thumbnails.js'

/** The recent-changes grid's button and empty-state copy, which a host may name in its own words. */
export interface SweepLabels {
  run?: string
  again?: string
  running?: string
  /** No changes on the branch yet. */
  empty?: string
}

/**
 * The history sweep: each projection on each recent change into this branch, with how much it showed and a small
 * Diff, so the useful ones stand out before anything is adopted. Each cell opens that change in the Inspector.
 */
export function SweepGrid({
  api,
  titles,
  start,
  adoptable,
  selected,
  onSelect,
  labels,
}: {
  labels?: SweepLabels | undefined
  api: InspectorApi
  titles: Map<string, string>
  start: boolean
  adoptable: Map<string, Adoptable>
  selected: ReadonlySet<string>
  onSelect: (id: string, selected: boolean) => void
}) {
  const [sweep, setSweep] = useState<Sweep | null | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [last, setLast] = useState(20)
  const [order, setOrder] = useState<'signal' | 'name'>('signal')
  const [changedOnly, setChangedOnly] = useState(false)
  const queue = useThumbnailQueue(api)
  const started = useRef(false)

  const run = (count: number) => {
    setError(undefined)
    api.startSweep({last: count}).then(
      () => api.sweep().then(setSweep),
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    )
  }
  useEffect(() => {
    const abort = new AbortController()
    api.sweep(abort.signal).then(
      current => {
        setSweep(current)
        if (!current && start && !started.current) {
          started.current = true
          run(last)
        }
      },
      (failure: unknown) => !abort.signal.aborted && setError(failure instanceof Error ? failure.message : String(failure)),
    )
    return () => abort.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first load: later sweeps start from the button.
  }, [api])
  const running = sweep?.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      api.sweep().then(setSweep, () => undefined)
    }, 1000)
    return () => clearInterval(timer)
  }, [api, running])

  const cells = useMemo(() => {
    const map = new Map<string, SweepCell>()
    for (const cell of sweep?.cells ?? []) map.set(`${cell.projection}|${cell.after}`, cell)
    return map
  }, [sweep])
  const projections = useMemo(
    () =>
      order === 'signal'
        ? bySignal(sweep?.projections ?? [], sweep?.cells ?? [])
        : [...(sweep?.projections ?? [])].sort((a, b) => a.projection.localeCompare(b.projection)),
    [order, sweep],
  )
  const signals = useMemo(() => (sweep ? signalCounts(sweep) : new Map<string, number>()), [sweep])
  const rows = (sweep?.changes ?? []).filter(
    change => !changedOnly || projections.some(row => cells.get(`${row.projection}|${change.after}`)?.status === 'changed'),
  )
  const done = sweep?.cells.length ?? 0
  const total = projections.filter(row => row.status === 'ready').length * (sweep?.changes.length ?? 0)

  return (
    <TooltipProvider delayDuration={250}>
      <section aria-labelledby="pi-sweep-title" className="pj:flex pj:flex-col pj:gap-3">
        <div className="pj:flex pj:flex-wrap pj:items-end pj:justify-between pj:gap-3">
          <div className="pj:flex pj:max-w-3xl pj:flex-col pj:gap-1">
            <h2 id="pi-sweep-title" className="pj:flex pj:items-center pj:gap-2 pj:text-base pj:font-semibold">
              <History className="pj:size-4" aria-hidden="true" />
              Recent changes
            </h2>
            <p className="pj:text-sm pj:text-muted-foreground">
              Each projection on the latest merges into this branch (or its latest commits), extracted with the projection code in your
              working tree. Open a cell to tune it on that change; tick the projections worth keeping to adopt them.
            </p>
          </div>
          <form
            className="pj:flex pj:items-end pj:gap-2"
            onSubmit={event => {
              event.preventDefault()
              run(last)
            }}
          >
            <div className="pj:flex pj:flex-col pj:gap-1">
              <Label htmlFor="pi-sweep-last" className="pj:text-xs">
                Changes
              </Label>
              <Input
                id="pi-sweep-last"
                type="number"
                min={1}
                max={100}
                value={last}
                onChange={event => setLast(Math.min(100, Math.max(1, Number(event.target.value) || 1)))}
                className="pj:w-20"
              />
            </div>
            <Button type="submit" size="sm" variant={sweep ? 'outline' : 'default'} disabled={running}>
              {running ? (labels?.running ?? 'Sweeping…') : sweep ? (labels?.again ?? 'Sweep again') : (labels?.run ?? 'Sweep')}
            </Button>
          </form>
        </div>
        {sweep && sweep.changes.length > 0 && (
          <div className="pj:flex pj:flex-wrap pj:items-center pj:gap-x-5 pj:gap-y-2 pj:text-sm">
            <div className="pj:flex pj:items-center pj:gap-2">
              <Label htmlFor="pi-sweep-order">Order projections by</Label>
              <NativeSelect
                id="pi-sweep-order"
                size="sm"
                value={order}
                onChange={event => setOrder(event.target.value as 'signal' | 'name')}
              >
                <NativeSelectOption value="signal">Signal</NativeSelectOption>
                <NativeSelectOption value="name">ID</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="pj:flex pj:items-center pj:gap-2">
              <Checkbox id="pi-sweep-changed" checked={changedOnly} onCheckedChange={value => setChangedOnly(value === true)} />
              <Label htmlFor="pi-sweep-changed">Only changes where something changed</Label>
            </div>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {sweep?.status === 'failed' && sweep.error && (
          <Alert variant="destructive">
            <AlertDescription>{sweep.error}</AlertDescription>
          </Alert>
        )}
        {running && (
          <p role="status" className="pj:flex pj:items-center pj:gap-2 pj:text-xs pj:text-muted-foreground">
            <LoaderCircle className="pj:size-3 pj:animate-spin" aria-hidden="true" />
            Swept {done} of {total || '…'}
          </p>
        )}
        {sweep && sweep.changes.length > 0 && projections.length > 0 && (
          <SweepTable
            sweep={sweep}
            projections={projections}
            rows={rows}
            cells={cells}
            signals={signals}
            titles={titles}
            adoptable={adoptable}
            selected={selected}
            onSelect={onSelect}
            running={running}
            queue={queue}
          />
        )}
        {sweep && changedOnly && rows.length === 0 && sweep.changes.length > 0 && (
          <p className="pj:text-sm">No projection changed on these changes.</p>
        )}
        {sweep && sweep.status !== 'running' && sweep.changes.length === 0 && !sweep.error && (
          <p className="pj:text-sm">{labels?.empty ?? 'This branch has no changes to sweep yet.'}</p>
        )}
      </section>
    </TooltipProvider>
  )
}
