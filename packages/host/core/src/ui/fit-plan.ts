import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {RefObject} from 'react'
import {flushSync} from 'react-dom'

/** A more spacious plan is chosen again only once the toolbar is this much wider than that plan needs, so it doesn't flicker. */
export const toolbarHysteresis = 24
const px = (value: string) => parseFloat(value) || 0

/**
 * The width an element needs at its minimums. `data-fit-min` elements (the slider, spacers) need that many pixels;
 * `data-fit="row"` containers need their padding, border, gaps and their in-flow children's needs; `column`
 * containers the widest child's; `centre` containers (three children, the middle one centred) the middle child's and
 * twice the wider side's, so the middle one stays centred; anything else (blocks that never shrink) its current width.
 */
export function fitWidth(element: Element): number {
  const min = element.getAttribute('data-fit-min')
  if (min !== null) return Number(min)
  const fit = element.getAttribute('data-fit')
  if (!fit) return element.getBoundingClientRect().width
  const view = element.ownerDocument.defaultView!
  const style = view.getComputedStyle(element)
  const frame = px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth)
  const items = [...element.children].filter(child => {
    const item = view.getComputedStyle(child)
    return item.display !== 'none' && item.position !== 'absolute' && item.position !== 'fixed'
  })
  const widths = items.map(fitWidth)
  if (fit === 'column') return frame + Math.max(0, ...widths)
  if (fit === 'centre' && widths.length === 3) {
    const [start, middle, end] = widths as [number, number, number]
    return frame + middle + 2 * Math.max(start, end) + 2 * px(style.columnGap)
  }
  return frame + widths.reduce((sum, width) => sum + width, 0) + px(style.columnGap) * Math.max(0, items.length - 1)
}

/**
 * The first plan that fits `width` (preferring plans `allowed` keeps), or the first whose needs are unknown, to try
 * it. Plans more spacious than the settled one must fit with `toolbarHysteresis` to spare.
 */
function choose<T>(
  plans: readonly T[],
  needs: ReadonlyMap<string, number>,
  ceilings: ReadonlyMap<string, number>,
  sign: (plan: T) => string,
  width: number,
  settled: number,
  allowed: ((plan: T) => boolean) | undefined,
): number {
  for (const keep of allowed ? [allowed, undefined] : [undefined])
    for (const [index, plan] of plans.entries()) {
      if (keep && !keep(plan)) continue
      const need = needs.get(sign(plan))
      if (need === undefined) return index
      if (width > (ceilings.get(sign(plan)) ?? Infinity) + (index === settled ? toolbarHysteresis : 0)) continue
      if (need <= width + 0.5 - (index < settled ? toolbarHysteresis : 0)) return index
    }
  return plans.length - 1
}

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
}

/**
 * Chooses the most spacious of `plans` (ordered most spacious first) that fits the element's width, from a
 * ResizeObserver on the element itself (not the viewport, since bars are embedded at any width). Each plan is
 * measured as rendered, before paint, with `fitWidth` (mark flexible children with `data-fit-min` and measured rows
 * with `data-fit`); unmeasured plans are tried in order and the needs are cached until `key` changes. Elements marked
 * `data-toolbar-region` are observed too, so a block that grows replans. A plan more spacious than the current one is
 * chosen again only with `toolbarHysteresis` pixels to spare, so the bar doesn't flicker at a boundary. Once a plan
 * settles, the bar says at what width (`data-fit-settled`, in whole pixels), so a test can wait for it.
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
  const latest = useRef({sign, find, lock: options.lock, ceiling: options.ceiling})
  latest.current = {sign, find, lock: options.lock, ceiling: options.ceiling}

  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return
    const {sign, find, lock: lockOf, ceiling} = latest.current
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
    m.needs.set(sign(plan), Math.ceil(fitWidth(element)))
    if (ceiling) m.ceilings.set(sign(plan), ceiling(element, plan))
    const lock = lockOf?.(element, plan)
    m.locked = Boolean(lock)
    const target = choose(plans, m.needs, m.ceilings, sign, width, find(plans, m.settled), lock)
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

  return {plan, index, width: state.width}
}
