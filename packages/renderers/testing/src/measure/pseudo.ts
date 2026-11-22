// What an HTML element draws in its `::before` and `::after`.

/**
 * The `::before` and `::after` an HTML element draws, with their opacity and generated text: changing only that text
 * ("Added", a marker) is a visible change.
 */
export function pseudoPaints(node: Element, opacity: number) {
  const drawn: {pseudo: string; painted: CSSStyleDeclaration; alpha: number; generated: string | undefined}[] = []
  for (const pseudo of ['before', 'after']) {
    const painted = getComputedStyle(node, `::${pseudo}`)
    if (painted.content === 'none' || painted.content === 'normal' || painted.display === 'none') continue
    const alpha = painted.visibility === 'hidden' ? 0 : opacity * Number(painted.opacity)
    if (alpha > 0.01) drawn.push({pseudo, painted, alpha, generated: /^"(.*)"$/su.exec(painted.content)?.[1]?.trim()})
  }
  return drawn
}
