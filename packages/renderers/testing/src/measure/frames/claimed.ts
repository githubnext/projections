// Style rules that draw in a kit frame's `::after`, which is the frame's edge (probe call `frames`).
import {describe} from '../paint.js'

/** What a rule may change in a frame's `::after`: the edge's color and opacity, and custom properties. */
const restyles = /^(?:--.*|opacity|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-color)$/u

function styleRules(rules: CSSRuleList, found: CSSStyleRule[]): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) found.push(rule)
    if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) styleRules(rule.cssRules, found)
  }
}

/** A selector list's selectors, split at its top-level commas. */
function selectors(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < list.length; at++) {
    const char = list[at]
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, at).trim())
      start = at + 1
    }
  }
  return [...parts, list.slice(start).trim()]
}

/**
 * Each kit frame (`pk-group`, `pk-frame`) a stylesheet's rule draws in through its `::after`, other than the kit's own
 * frame rules: the frame's edge is drawn there, over its contents, so such a rule either loses to the kit's (its
 * content never shows) or moves the edge. A rule may only recolor the edge (its border color and opacity).
 */
export function claimedOverlays(root: Element = document.body): {element: string; rule: string}[] {
  const frames = [...root.querySelectorAll('.pk-group, .pk-frame')]
  if (!frames.length) return []
  const rules: CSSStyleRule[] = []
  for (const sheet of document.styleSheets) {
    try {
      styleRules(sheet.cssRules, rules)
    } catch {
      // A cross-origin stylesheet can't be read; a renderer's own are same-origin.
    }
  }
  const found: {element: string; rule: string}[] = []
  for (const rule of rules) {
    const declared = [...rule.style]
    if (!declared.some(property => !restyles.test(property))) continue
    for (const selector of selectors(rule.selectorText)) {
      const match = /^(.*?)::?after$/u.exec(selector)
      // The kit's own frame rules name both kinds of frame.
      if (!match?.[1] || selector.includes(':is(.pk-group, .pk-frame)')) continue
      const base = match[1]
      const frame = frames.find(element => {
        try {
          return element.matches(base)
        } catch {
          return false
        }
      })
      if (!frame) continue
      const drawn = declared.filter(property => !restyles.test(property))
      found.push({element: describe(frame), rule: `${selector} { ${drawn.join(', ')} }`})
    }
  }
  return found
}
