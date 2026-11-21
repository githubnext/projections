// A bar's planned layout, headless: the bar's UI owns its plans, how they are measured and its policy; this owns the
// measurement cache, the observation, the settled marker, the interaction lock and focus retention.

import {useEffect, useLayoutEffect, useRef} from 'react'
import {useMachine} from '@githubnext/projections-machine/react'
import type {RefObject} from 'react'
import {flushSync} from 'react-dom'
import {chooseFitPlan, toolbarHysteresis} from './fit-plan/choose.js'
import {fitWidth} from './fit-plan/fit-width.js'
import {useFocusRetention} from './fit-plan/focus.js'
import {carryNeeds, shiftNeeds} from './fit-plan/needs.js'
import {fitPlanLifecycle} from './fit-plan/lifecycle.js'

export {chooseFitPlan, toolbarHysteresis} from './fit-plan/choose.js'
export type {FitChoice, FitHysteresis} from './fit-plan/choose.js'
export {fitWidth} from './fit-plan/fit-width.js'

/** Options of `useFitPlan`. */
export interface FitPlanOptions<T> {
  /**
   * What the bar holds; measured needs are kept until it changes. A function of the bar's width (in whole pixels) for
   * what changes with it, for example a slider's minimum that is narrower under some width.
   */
  key: string | ((width: number) => string)
  /**
   * When `key` changes, a region resizes or `pending` settles, keep the measured needs and move them all by as much as
   * the shown plan's need moved once it is measured again, rather than measure each plan again (default `false`).
   */
  shiftNeeds?: boolean
  /**
   * When the plans change, each new plan takes the need of the first previous plan with the same key, when one of them
   * has the shown plan's key; else every plan is measured again (default: needs are kept by signature).
   */
  carry?: (plan: T) => string
  /**
   * The need the choice uses for a plan, from what it was measured to need (`undefined` until it is), for example with a
   * part measured once for several plans (default: that need). `undefined` tries the plan.
   */
  need?: (plan: T, measured: number | undefined) => number | undefined
  /** Content still rendering, for example custom elements that draw after they mount: measure again once it settles. */
  pending?: (element: HTMLElement) => Promise<unknown> | undefined
  /** The bar's regions observed with it, so a block that grows replans (default `[data-toolbar-region]`). */
  regions?: string
  /** A plan's identity (default `JSON.stringify`). */
  signature?: (plan: T) => string
  /** The plan in `plans` to render for a previous plan when the plans change (default: the same signature, else the first). */
  locate?: (plans: readonly T[], plan: T) => number
  /** While a person is using the bar, which plans keep the control in their hands mounted; `undefined` for any. */
  lock?: (element: HTMLElement, plan: T) => ((candidate: T) => boolean) | undefined
  /**
   * The widest the bar may be for a plan, measured as rendered like its need (default: no limit). A wider bar skips
   * the plan, for example a layout that would leave too much of the bar empty; the last plan is the fallback.
   */
  ceiling?: (element: HTMLElement, plan: T) => number
  /** The width the bar needs for `plan`, as it is rendered (default `fitWidth(element)`). */
  measure?: (element: HTMLElement, plan: T) => number
  /**
   * The room a move from the settled plan (`from`) to a more spacious one (`to`) needs to spare (default
   * `toolbarHysteresis`); with `from === to`, how far past its ceiling the settled plan may stay. `element` is the bar
   * as rendered.
   */
  hysteresis?: number | ((from: T, to: T, element: HTMLElement) => number)
  /**
   * Where focus goes, by `data-focus-id`, when the focused control's form leaves the bar and no control by its ID
   * replaces it, for example `{zoom: ['more']}` for a control that moves into an overflow.
   */
  focusFallbacks?: Readonly<Record<string, readonly string[]>>
  /** How a control gets focus back (default `control.focus()`), for example the control in a custom element's shadow root. */
  focusControl?: (control: HTMLElement) => void
}

/**
 * Chooses the most spacious of `plans` (ordered most spacious first) that fits the element's width, from a
 * ResizeObserver on the element itself (not the viewport, since bars are embedded at any width). Each plan is
 * measured as rendered, before paint, with `measure` (by default `fitWidth`: mark flexible children with
 * `data-fit-min` and measured rows with `data-fit`); unmeasured plans are tried in order and the needs are cached until
 * `key` changes (or shifted, `shiftNeeds`). Elements marked `data-toolbar-region` are observed too, so a block that
 * grows replans. A bar without width (hidden) keeps its plan. A plan more
 * spacious than the current one is chosen again only with `hysteresis` pixels to spare, so the bar doesn't flicker at
 * a boundary (`chooseFitPlan`). Once a plan settles, the bar says at what width (`data-fit-settled`, in whole pixels),
 * so a test can wait for it. Controls marked `data-focus-id` keep focus when a new plan remounts them.
 */
export function useFitPlan<T>(
  bar: RefObject<HTMLElement | null>,
  plans: readonly T[],
  options: FitPlanOptions<T>,
): {plan: T; index: number; width: number} {
  const sign = options.signature ?? ((plan: T) => JSON.stringify(plan))
  const find =
    options.locate ??
    ((list: readonly T[], plan: T) => {
      const index = list.findIndex(item => sign(item) === sign(plan))
      return index < 0 ? 0 : index
    })
  const [state, send, actor] = useMachine(fitPlanLifecycle, {
    state: {kind: 'planning', plan: plans[0]!, settled: plans[0]!, width: 0, run: 0, hand: 'free', frame: false},
    activities: {
      // Replanning inside the observer's callback would resize observed elements mid-delivery (a ResizeObserver loop),
      // so it waits for the next frame, and renders synchronously there, before that frame's layout and paint.
      frame: (_activity, {send}) => {
        const handle = requestAnimationFrame(() => {
          const element = bar.current
          if (element) flushSync(() => send({type: 'frame', width: Math.round(element.getBoundingClientRect().width)}))
        })
        return () => cancelAnimationFrame(handle)
      },
    },
  })
  const key = typeof options.key === 'function' ? options.key(state.width) : options.key
  const memo = useRef({
    key,
    plans,
    shown: plans[0]!,
    needs: new Map<string, number>(),
    ceilings: new Map<string, number>(),
    stale: false,
    fresh: false,
    regionWidths: new Map<Element, number>(),
    steps: 0,
    burst: '',
  })
  const index = find(plans, state.plan as T)
  const plan = plans[index]!
  const {lock, ceiling, measure = fitWidth, hysteresis = toolbarHysteresis, shiftNeeds: shift = false, carry, need, pending} = options
  const regions = options.regions ?? '[data-toolbar-region]'
  const latest = useRef({sign, find, lock, ceiling, measure, hysteresis, shift, carry, need, pending, regions})
  latest.current = {sign, find, lock, ceiling, measure, hysteresis, shift, carry, need, pending, regions}

  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return
    const {sign, find, lock: lockOf, ceiling, measure, hysteresis, shift, carry, need, pending, regions} = latest.current
    const m = memo.current
    if (m.key !== key) {
      m.key = key
      if (shift) m.stale = true
      else m.needs.clear()
      m.ceilings.clear()
    }
    if (m.plans !== plans) {
      if (carry) {
        const carried = carryNeeds(m.plans, plans, m.shown, m.needs, sign, carry)
        m.needs = carried ?? new Map()
        m.stale = carried !== undefined
      }
      m.plans = plans
    }
    const width = element.getBoundingClientRect().width
    if (width < 1) return
    if (Math.round(width) !== state.width) {
      // What a plan needs may depend on the width (say, a slider's minimum): render with it before measuring.
      send({type: 'resized', width: Math.round(width)})
      return
    }
    const measured = Math.ceil(measure(element, plan))
    if (m.stale) shiftNeeds(m.needs, sign(plan), measured)
    m.stale = false
    m.needs.set(sign(plan), measured)
    m.shown = plan
    const later = pending?.(element)
    if (later) {
      void later.then(() => {
        if (memo.current.key !== key || memo.current.plans !== plans) return
        if (shift) memo.current.stale = true
        memo.current.fresh = true
        send({type: 'rendered'})
      })
    }
    if (ceiling) m.ceilings.set(sign(plan), ceiling(element, plan))
    const lock = lockOf?.(element, plan)
    const needOf = (candidate: T) => (need ? need(candidate, m.needs.get(sign(candidate))) : m.needs.get(sign(candidate)))
    const target = chooseFitPlan({
      plans,
      width,
      settled: find(plans, actor.getState().settled as T),
      need: needOf,
      ceiling: candidate => m.ceilings.get(sign(candidate)),
      hysteresis: typeof hysteresis === 'number' ? hysteresis : (from, to) => hysteresis(from, to, element),
      allowed: lock,
    })
    // Trying an unmeasured plan always adds information. Switching between measured plans could only repeat if
    // measurements disagreed from one render to the next, so a burst of those switches settles; it never settles on a
    // plan known not to fit while one that fits is known. A change from outside (a region resized since the bar settled,
    // content that finished rendering) starts a new burst.
    const fits = (candidate: T) => (needOf(candidate) ?? Infinity) <= width + 0.5
    const burst = `${key}:${Math.round(width)}`
    if (m.burst !== burst || m.fresh) {
      m.burst = burst
      m.steps = 0
      m.fresh = false
    }
    const known = needOf(plans[target]!) !== undefined
    const switches = known && target !== index ? ++m.steps : m.steps
    if (target !== index && (!known || switches <= 4 || (!fits(plan) && switches <= 4 + plans.length))) {
      send({type: 'tried', plan: plans[target]!})
    } else {
      m.regionWidths = new Map([...element.querySelectorAll(regions)].map(region => [region, region.getBoundingClientRect().width]))
      send({type: 'fitted', plan, locked: Boolean(lock)})
    }
  }, [bar, send, actor, plans, plan, index, key, state.width, state.run])

  // Once a plan settles, the bar says at what width, so a test can wait for it.
  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return
    if (state.kind === 'planning') delete element.dataset.fitSettled
    else element.dataset.fitSettled = String(state.width)
  }, [bar, state.kind, state.width])

  // Replan when the bar or one of its regions changes size.
  const observer = useRef<ResizeObserver | undefined>(undefined)
  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return undefined
    const resize = new ResizeObserver(entries => {
      // A region that resized changed what the shown plan needs; one that isn't as wide as when the bar settled changed
      // from outside, not as part of the plan it settled on.
      const m = memo.current
      const regions = entries.filter(entry => entry.target !== element)
      if (latest.current.shift && regions.length) m.stale = true
      if (regions.some(({target}) => Math.abs(target.getBoundingClientRect().width - (m.regionWidths.get(target) ?? NaN)) >= 0.5)) {
        m.fresh = true
      }
      send({type: 'observed'})
    })
    observer.current = resize
    resize.observe(element)
    return () => {
      resize.disconnect()
      observer.current = undefined
      observed.current = new Set()
    }
  }, [bar, send])
  const observed = useRef(new Set<Element>())
  useLayoutEffect(() => {
    const resize = observer.current
    const element = bar.current
    if (!resize || !element) return
    const regions = new Set(element.querySelectorAll(latest.current.regions))
    for (const region of observed.current) if (!regions.has(region)) resize.unobserve(region)
    for (const region of regions) if (!observed.current.has(region)) resize.observe(region)
    observed.current = regions
  })

  // Focus moving and a pointer's press and release, for the lock (`fitPlanLifecycle`).
  useEffect(() => {
    const document = bar.current?.ownerDocument
    if (!document) return undefined
    const moved = () => send({type: 'moved'})
    const press = () => send({type: 'pressed'})
    const release = () => send({type: 'released'})
    document.addEventListener('focusin', moved)
    document.addEventListener('focusout', moved)
    document.addEventListener('pointerdown', press, true)
    document.addEventListener('pointerup', release, true)
    document.addEventListener('pointercancel', release, true)
    return () => {
      document.removeEventListener('focusin', moved)
      document.removeEventListener('focusout', moved)
      document.removeEventListener('pointerdown', press, true)
      document.removeEventListener('pointerup', release, true)
      document.removeEventListener('pointercancel', release, true)
    }
  }, [bar, send])

  useFocusRetention(bar, options.focusFallbacks, options.focusControl)

  return {plan, index, width: state.width}
}
