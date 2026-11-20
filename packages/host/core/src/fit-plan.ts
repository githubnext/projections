// A bar's planned layout, headless: the bar's UI owns its plans, how they are measured and its policy; this owns the
// measurement cache, the observation, the settled marker, the interaction lock and focus retention.

import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {RefObject} from 'react'
import {flushSync} from 'react-dom'
import {chooseFitPlan, toolbarHysteresis} from './fit-plan/choose.js'
import {fitWidth} from './fit-plan/fit-width.js'
import {useFocusRetention} from './fit-plan/focus.js'

export {chooseFitPlan, toolbarHysteresis} from './fit-plan/choose.js'
export type {FitChoice, FitHysteresis} from './fit-plan/choose.js'
export {fitWidth} from './fit-plan/fit-width.js'

/** Options of `useFitPlan`. */
export interface FitPlanOptions<T> {
  /** What the bar holds; measured needs are kept until it changes. */
  key: string
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
}

/**
 * Chooses the most spacious of `plans` (ordered most spacious first) that fits the element's width, from a
 * ResizeObserver on the element itself (not the viewport, since bars are embedded at any width). Each plan is
 * measured as rendered, before paint, with `measure` (by default `fitWidth`: mark flexible children with
 * `data-fit-min` and measured rows with `data-fit`); unmeasured plans are tried in order and the needs are cached until
 * `key` changes. Elements marked `data-toolbar-region` are observed too, so a block that grows replans. A plan more
 * spacious than the current one is chosen again only with `hysteresis` pixels to spare, so the bar doesn't flicker at
 * a boundary (`chooseFitPlan`). Once a plan settles, the bar says at what width (`data-fit-settled`, in whole pixels),
 * so a test can wait for it. Controls marked `data-focus-id` keep focus when a new plan remounts them.
 */
export function useFitPlan<T>(
  bar: RefObject<HTMLElement | null>,
  plans: readonly T[],
  options: FitPlanOptions<T>,
): {plan: T; index: number; width: number} {
  const {key} = options
  const sign = options.signature ?? ((plan: T) => JSON.stringify(plan))
  const find =
    options.locate ??
    ((list: readonly T[], plan: T) => {
      const index = list.findIndex(item => sign(item) === sign(plan))
      return index < 0 ? 0 : index
    })
  const [state, setState] = useState<{plan: T; width: number; tick: number}>(() => ({plan: plans[0]!, width: 0, tick: 0}))
  const memo = useRef({
    key,
    needs: new Map<string, number>(),
    ceilings: new Map<string, number>(),
    settled: plans[0]!,
    locked: false,
    steps: 0,
    burst: '',
  })
  const index = find(plans, state.plan)
  const plan = plans[index]!
  const {lock, ceiling, measure = fitWidth, hysteresis = toolbarHysteresis} = options
  const latest = useRef({sign, find, lock, ceiling, measure, hysteresis})
  latest.current = {sign, find, lock, ceiling, measure, hysteresis}

  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return
    const {sign, find, lock: lockOf, ceiling, measure, hysteresis} = latest.current
    const m = memo.current
    if (m.key !== key) {
      m.key = key
      m.needs.clear()
      m.ceilings.clear()
    }
    const width = element.getBoundingClientRect().width
    if (Math.round(width) !== state.width) {
      // What a plan needs may depend on the width (say, a slider's minimum): render with it before measuring.
      delete element.dataset.fitSettled
      setState(previous => ({...previous, width: Math.round(width)}))
      return
    }
    m.needs.set(sign(plan), Math.ceil(measure(element, plan)))
    if (ceiling) m.ceilings.set(sign(plan), ceiling(element, plan))
    const lock = lockOf?.(element, plan)
    m.locked = Boolean(lock)
    const target = chooseFitPlan({
      plans,
      width,
      settled: find(plans, m.settled),
      need: candidate => m.needs.get(sign(candidate)),
      ceiling: candidate => m.ceilings.get(sign(candidate)),
      hysteresis: typeof hysteresis === 'number' ? hysteresis : (from, to) => hysteresis(from, to, element),
      allowed: lock,
    })
    // Trying an unmeasured plan always adds information. Switching between measured plans could only repeat if
    // measurements disagreed from one render to the next, so a burst of those settles; it never settles on a plan
    // known not to fit while one that fits is known.
    const fits = (candidate: T) => (m.needs.get(sign(candidate)) ?? Infinity) <= width + 0.5
    const burst = `${key}:${Math.round(width)}`
    if (m.burst !== burst) {
      m.burst = burst
      m.steps = 0
    }
    const known = m.needs.has(sign(plans[target]!))
    const switches = known ? ++m.steps : m.steps
    if (target !== index && (!known || switches <= 4 || (!fits(plan) && switches <= 4 + plans.length))) {
      delete element.dataset.fitSettled
      setState(previous => ({...previous, plan: plans[target]!}))
    } else {
      m.settled = plan
      element.dataset.fitSettled = String(Math.round(width))
    }
  }, [bar, plans, plan, index, key, state.width, state.tick])

  // Replan when the bar or one of its regions changes size.
  const observer = useRef<ResizeObserver | undefined>(undefined)
  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return
    // Replanning inside the observer's callback would resize observed elements mid-delivery (a ResizeObserver loop),
    // so it waits for the next frame, and renders synchronously there, before that frame's layout and paint.
    let frame = 0
    const resize = new ResizeObserver(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        flushSync(() =>
          setState(previous => ({...previous, width: Math.round(element.getBoundingClientRect().width), tick: previous.tick + 1})),
        )
      })
    })
    observer.current = resize
    resize.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      observer.current = undefined
      observed.current = new Set()
    }
  }, [bar])
  const observed = useRef(new Set<Element>())
  useLayoutEffect(() => {
    const resize = observer.current
    const element = bar.current
    if (!resize || !element) return
    const regions = new Set(element.querySelectorAll('[data-toolbar-region]'))
    for (const region of observed.current) if (!regions.has(region)) resize.unobserve(region)
    for (const region of regions) if (!observed.current.has(region)) resize.observe(region)
    observed.current = regions
  })

  // Once focus leaves a control kept in use, plan again, but not between a pointer's press and its click: trying
  // other plans then would remount the control being clicked (WebKit moves focus away on press).
  useEffect(() => {
    const document = bar.current?.ownerDocument
    if (!document) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let pressed = false
    let pending = false
    const replan = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setState(previous => ({...previous, tick: previous.tick + 1})), 0)
    }
    const moved = () => {
      if (!memo.current.locked) return
      if (pressed) pending = true
      else replan()
    }
    const press = () => {
      pressed = true
    }
    const release = () => {
      pressed = false
      if (pending) {
        pending = false
        replan()
      }
    }
    document.addEventListener('focusin', moved)
    document.addEventListener('focusout', moved)
    document.addEventListener('pointerdown', press, true)
    document.addEventListener('pointerup', release, true)
    document.addEventListener('pointercancel', release, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusin', moved)
      document.removeEventListener('focusout', moved)
      document.removeEventListener('pointerdown', press, true)
      document.removeEventListener('pointerup', release, true)
      document.removeEventListener('pointercancel', release, true)
    }
  }, [bar])

  useFocusRetention(bar, options.focusFallbacks)

  return {plan, index, width: state.width}
}
