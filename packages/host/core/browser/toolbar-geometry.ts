// Measurements of the toolbar's layout, taken in the page: its rows, its controls' boxes and every name it can reach.
import type {Page} from '@playwright/test'

/** A toolbar row as planned: its box, how much of it its blocks fill, and whether it is the playback row. */
export interface ToolbarRowGeometry {
  top: number
  height: number
  width: number
  /** The share of the row's width its blocks (and the gaps between them) take; flexible spacers count as empty. */
  fill: number
  /** The row holds the playback group and nothing else. */
  playbackOnly: boolean
  /** The row centres its mode region (`ToolbarRow`'s `centred`). */
  centred: boolean
}

/**
 * Where row 1's mode region (the mode and scope switches) sits: its content box's centre less the row's, and the room
 * between that box and the nearest control of the regions beside it.
 */
export interface ClusterGeometry {
  offset: number
  clearance: number
  left: number
}

/** The toolbar's rows, its interactive elements' boxes, overlaps between them and anything outside the toolbar. */
export const toolbarGeometry = (page: Page) =>
  page
    .locator('.ph-toolbar')
    .first()
    .evaluate(toolbar => {
      const box = (element: Element) => element.getBoundingClientRect()
      const shown = (element: Element) => {
        const rect = box(element)
        return rect.width > 1 && rect.height > 1 && getComputedStyle(element).visibility !== 'hidden'
      }
      const nameOf = (element: Element) =>
        element.getAttribute('aria-label') ??
        (element.id ? element.ownerDocument.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent.trim() : undefined) ??
        element.textContent.trim()
      const bar = box(toolbar)
      const rows = [...toolbar.querySelectorAll(':scope > .ph-toolbar-row')].map(row => {
        const rect = box(row)
        const gap = parseFloat(getComputedStyle(row).columnGap) || 0
        const items = [...row.children].filter(child => !child.matches('[data-fit-min="0"]') && shown(child))
        const used = items.reduce((sum, item) => sum + box(item).width, 0) + gap * Math.max(0, items.length - 1)
        return {
          top: rect.top,
          height: rect.height,
          width: rect.width,
          fill: used / rect.width,
          unused: rect.width - used,
          // A control in a collapsed form: More, the mode menu, the merged or compact pickers, or icon-only modes.
          collapsed:
            row.querySelector(
              'button[aria-label="More"], button[aria-label^="Comparison mode: "], button[aria-label^="Revisions: "], [data-slot="revision-trigger"]',
            ) !== null ||
            [...row.querySelectorAll('[role="radiogroup"][aria-label="Comparison mode"] [role="radio"]')].some(
              radio => !radio.textContent.trim(),
            ),
          playbackOnly: items.length === 1 && Boolean(items[0]!.querySelector('[role="group"][aria-label="Comparison playback"]')),
          centred: row.hasAttribute('data-centred'),
        }
      })
      // The span of a region's drawn controls, not its box (a centred mode region pads itself).
      const span = (region: Element | null | undefined) => {
        const boxes = [...(region?.querySelectorAll('button, select, input, [role="radiogroup"]') ?? [])].filter(shown).map(box)
        return boxes.length
          ? {left: Math.min(...boxes.map(item => item.left)), right: Math.max(...boxes.map(item => item.right))}
          : undefined
      }
      const first = toolbar.querySelector(':scope > .ph-toolbar-row')
      const region = (name: string) => first?.querySelector(`:scope > [data-toolbar-region="${name}"]`)
      // The mode region's content box: its controls and the room it keeps for the scope's other form.
      const content = (element: Element | null | undefined) => {
        if (!element) return undefined
        const rect = box(element)
        const style = getComputedStyle(element)
        return {left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight)}
      }
      const mode = content(region('mode'))
      const cluster: ClusterGeometry | undefined =
        mode && first
          ? {
              offset: (mode.left + mode.right) / 2 - (box(first).left + box(first).width / 2),
              clearance: Math.min(
                mode.left - (span(region('start'))?.right ?? -Infinity),
                (span(region('end'))?.left ?? Infinity) - mode.right,
              ),
              left: mode.left,
            }
          : undefined
      const controls = [...toolbar.querySelectorAll('button, select, input, output')].filter(shown).map(element => {
        const rect = box(element)
        return {name: nameOf(element), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width}
      })
      const overlaps: string[] = []
      for (const [index, a] of controls.entries()) {
        for (const b of controls.slice(index + 1)) {
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) {
            overlaps.push(`${a.name} × ${b.name}`)
          }
        }
      }
      const outside = controls
        .filter(c => c.left < bar.left - 0.5 || c.right > bar.right + 0.5 || c.top < bar.top - 0.5 || c.bottom > bar.bottom + 0.5)
        .map(c => c.name)
      const slider = toolbar.querySelector<HTMLInputElement>('input[type="range"]')
      // The thumb (16px) of the native range at its value, so a spec can check it at either end.
      const thumb =
        slider && shown(slider)
          ? (() => {
              const rect = box(slider)
              const value = (Number(slider.value) - Number(slider.min || 0)) / (Number(slider.max || 100) - Number(slider.min || 0))
              const center = rect.left + 8 + (rect.width - 16) * value
              return {left: center - 8, right: center + 8}
            })()
          : undefined
      // The visible box of every control a person aims at: a compact picker's trigger (not its hidden select), a
      // segmented control as a whole, and every other button or select.
      const targets = new Set<Element>()
      for (const element of toolbar.querySelectorAll('button, select, [role="radiogroup"]')) {
        if (!shown(element)) continue
        const target = element.closest('[data-slot="revision-trigger"]') ?? element.closest('[role="radiogroup"]') ?? element
        targets.add(target)
      }
      const heights = [...targets].map(target => ({name: nameOf(target).slice(0, 30), height: Math.round(box(target).height)}))
      // The first visible content after the toolbar, and its distance below it.
      let next = toolbar.nextElementSibling
      while (next && box(next).height <= 2) next = next.nextElementSibling
      const below = next ? box(next).top - bar.bottom : undefined
      return {
        cluster,
        thumb,
        heights,
        below,
        left: bar.left,
        width: bar.width,
        height: bar.height,
        rows,
        overlaps,
        outside,
        slider: slider && shown(slider) ? box(slider).width : undefined,
        overflow: toolbar.scrollWidth - toolbar.clientWidth,
      }
    })

/**
 * The accessible names of every toolbar control a person can reach: those shown in the row, and those in its
 * overflow popovers (More, More playback controls, the Revisions button and the mode menu), which it opens and
 * closes in turn. Focus is released afterwards, so the toolbar plans freely again.
 */
export const reachableNames = (page: Page) =>
  page
    .locator('.ph-toolbar')
    .first()
    .evaluate(async toolbar => {
      const frame = () =>
        new Promise(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(resolve)
          })
        })
      const shown = (element: Element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 1 && rect.height > 1
      }
      const nameOf = (element: Element) =>
        element.getAttribute('aria-label') ??
        (element.id ? element.ownerDocument.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent.trim() : undefined) ??
        element.textContent.trim()
      // Focus left in the toolbar (say, back on a popover's button) keeps its region's form; release it and let the
      // toolbar replan before reading it, so a replan can't remount a trigger while its popover opens.
      const settle = async () => {
        ;(toolbar.ownerDocument.activeElement as HTMLElement | null)?.blur()
        await frame()
        await new Promise(resolve => {
          setTimeout(resolve, 0)
        })
        await frame()
      }
      await settle()
      const controls = 'button, select, input, output, [role="radiogroup"]'
      const names = new Set([...toolbar.querySelectorAll(controls)].filter(shown).map(nameOf))
      const triggers = [...toolbar.querySelectorAll('button[aria-haspopup="dialog"]')].filter(
        trigger => shown(trigger) && /^(?:More|Revisions?: |Comparison mode: )/u.test(nameOf(trigger)),
      ) as HTMLElement[]
      for (const trigger of triggers) {
        trigger.click()
        // On a loaded machine the popover can take a few frames to mount its content.
        const opened = () => toolbar.ownerDocument.getElementById(trigger.getAttribute('aria-controls') ?? '')
        for (let i = 0; i < 30 && !opened()?.querySelector(controls); i++) await frame()
        const dialog = opened()
        for (const element of dialog?.querySelectorAll(controls) ?? []) names.add(nameOf(element))
        dialog?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
        for (let i = 0; i < 60 && toolbar.ownerDocument.getElementById(trigger.getAttribute('aria-controls') ?? ''); i++) await frame()
        // Focus returns to the button a few frames after its popover unmounts; landing while the next popover is open,
        // it would count as focus outside and close it.
        for (let i = 0; i < 30 && toolbar.ownerDocument.activeElement !== trigger; i++) await frame()
        await settle()
      }
      await settle()
      return [...names]
    })
