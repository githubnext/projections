// The styling checks: colors, type and spacing from the theme.
import type {ComparisonMode} from '@githubnext/projections-renderer-sdk/protocol'
import type {StageSubject, StageSurfaceMeasurement, StyledElement, StyleMeasurement, StyleTokens} from '../types.js'
import type {CheckDriver} from './catalog.js'
import {Passed, progressModes, limit} from './support.js'
import type {Checks} from './support.js'

/** Theme tokens a smaller text may never go below; `font-size-xs` and labels are 12px, and existing kit text uses 11px. */
const textFloor = 11
const hairlines = [1, 2]
const listed = (values: readonly number[]) => [...new Set(values)].sort((a, b) => a - b).join(', ')
const near = (value: number, allowed: readonly number[], tolerance: number) => allowed.some(item => Math.abs(item - value) <= tolerance)
const nearest = (value: number, allowed: readonly number[]) =>
  allowed.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), allowed[0] ?? 0)

/** What a styling check presents: the default view of the subject, and mid-progress when the renderer has progress modes. */
function stylePresentations(
  subject: StageSubject,
  modes: readonly ComparisonMode[],
): {where: string; progress: number; comparisonMode?: ComparisonMode}[] {
  if (subject.mode === 'extraction') return [{where: 'The extraction', progress: 1}]
  const views: {where: string; progress: number; comparisonMode?: ComparisonMode}[] = []
  if (modes.includes('diff')) views.push({where: 'In diff mode', progress: 1, comparisonMode: 'diff'})
  // Halfway, change emphasis and status are on screen.
  if (modes.some(mode => progressModes.includes(mode))) views.push({where: 'At progress 0.5', progress: 0.5})
  return views
}

async function stylesAt(
  driver: CheckDriver,
  subject: StageSubject,
  view: {progress: number; comparisonMode?: ComparisonMode},
  width: number | undefined,
  colorMode: 'light' | 'dark',
): Promise<StyleMeasurement> {
  await driver.load(subject, {
    progress: view.progress,
    colorMode,
    reuse: true,
    ...(width ? {width} : {}),
    ...(view.comparisonMode ? {comparisonMode: view.comparisonMode} : {}),
  })
  await driver.measure('settle')
  return driver.measure<StyleMeasurement>('styles')
}

/**
 * Collects failures, one line per kind of element (its tag and classes, whatever entity it presents), property and
 * value, counting the elements, up to a limit, and says how many more there were.
 */
class Findings {
  private readonly found = new Map<string, {line: string; count: number}>()
  add(key: string, line: string) {
    const generic = key.replace(/\[data-entity-id="[^"]*"\]/gu, '')
    const found = this.found.get(generic)
    if (found) found.count += 1
    else this.found.set(generic, {line, count: 1})
  }
  result(): string[] {
    const lines = [...this.found.values()].map(({line, count}) => (count > 1 ? `${line} (${count} elements like it)` : line))
    const shown = lines.slice(0, 3 * limit)
    return lines.length > shown.length ? [...shown, `… and ${lines.length - shown.length} more.`] : shown
  }
}

type Rgba = [number, number, number, number]
function rgba(color: string): Rgba | undefined {
  // Normalized colors are `#rrggbb` when opaque, `rgba(…)` otherwise.
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/iu.exec(color.trim())
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16), hex[4] ? parseInt(hex[4], 16) / 255 : 1]
  const match = /rgba?\(([^)]*)\)/u.exec(color)
  if (!match) return undefined
  const [r = 0, g = 0, b = 0, a = 1] = match[1]!
    .split(/[\s,/]+/u)
    .filter(Boolean)
    .map(Number)
  return [r, g, b, a]
}
const distance = (a: Rgba, b: Rgba) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const colorTolerance = 4

interface ThemeColors {
  names: string[]
  light: Map<string, Rgba>
  dark: Map<string, Rgba>
}

function themeColors(light: StyleTokens, dark: StyleTokens): ThemeColors {
  const parse = (tokens: StyleTokens) =>
    new Map(Object.entries(tokens.colors).flatMap(([name, value]) => (rgba(value) ? [[name, rgba(value)!] as const] : [])))
  const lightColors = parse(light),
    darkColors = parse(dark)
  return {names: [...lightColors.keys()].filter(name => darkColors.has(name)), light: lightColors, dark: darkColors}
}

/** Whether a color painted in light and dark mode (either may be missing when the DOM differs) is the theme's. */
function themed(theme: ThemeColors, light: Rgba | undefined, dark: Rgba | undefined): boolean {
  if ((!light || light[3] < 0.01) && (!dark || dark[3] < 0.01)) return true
  const sides: [Rgba | undefined, Map<string, Rgba>][] = [
    [light, theme.light],
    [dark, theme.dark],
  ]
  // One token, as is or faded toward transparent.
  for (const name of theme.names) {
    if (
      sides.every(([color, tokens]) => {
        if (!color) return true
        const token = tokens.get(name)!
        return distance(color, token) <= colorTolerance && color[3] <= token[3] + 0.02
      })
    ) {
      return true
    }
  }
  // One mix of two opaque tokens, in the same proportion in both modes.
  const opaque = theme.names.filter(name => theme.light.get(name)![3] > 0.99 && theme.dark.get(name)![3] > 0.99)
  const reference = light ?? dark!
  const referenceTokens = light ? theme.light : theme.dark
  if (reference[3] < 0.99) return false
  for (let i = 0; i < opaque.length; i++) {
    for (let j = i + 1; j < opaque.length; j++) {
      const a = referenceTokens.get(opaque[i]!)!,
        b = referenceTokens.get(opaque[j]!)!
      const span = distance(a, b)
      if (span < 8) continue
      const weight =
        ((reference[0] - b[0]) * (a[0] - b[0]) + (reference[1] - b[1]) * (a[1] - b[1]) + (reference[2] - b[2]) * (a[2] - b[2])) / span ** 2
      if (weight <= 0.02 || weight >= 0.98) continue
      const ok = sides.every(([color, tokens]) => {
        if (!color) return true
        const x = tokens.get(opaque[i]!)!,
          y = tokens.get(opaque[j]!)!
        const mixed: Rgba = [0, 1, 2].map(channel => x[channel]! * weight + y[channel]! * (1 - weight)).concat(1) as Rgba
        return distance(color, mixed) <= colorTolerance
      })
      if (ok) return true
    }
  }
  return false
}

function nearestColor(theme: ThemeColors, color: Rgba, tokens: Map<string, Rgba>): string {
  let best = theme.names[0] ?? 'color-fg'
  for (const name of theme.names) if (distance(color, tokens.get(name)!) < distance(color, tokens.get(best)!)) best = name
  return `--projections-${best}`
}

const opaqueText = (color: string) => color.replace(/^rgba\(([^,]+, [^,]+, [^,]+), 1(?:\.00)?\)$/u, 'rgb($1)')
const unparsed = (color: string | undefined) => color !== undefined && !rgba(color)

function paletteFailures(theme: ThemeColors, light: StyleMeasurement, dark: StyleMeasurement, where: string, findings: Findings) {
  const darkByIndex = new Map(dark.elements.map(element => [element.index, element]))
  const check = (element: StyledElement, other: StyledElement | undefined, mode: 'light' | 'dark' | 'both') => {
    if (element.category) return
    for (const [property, value] of Object.entries(element.colors)) {
      const otherValue = other?.colors[property]
      const [lightValue, darkValue] = mode === 'dark' ? [undefined, value] : [value, mode === 'both' ? otherValue : undefined]
      // A color this check can't read (a gradient's, say) isn't judged.
      if (unparsed(lightValue) || unparsed(darkValue)) continue
      if (themed(theme, lightValue ? rgba(lightValue) : undefined, darkValue ? rgba(darkValue) : undefined)) continue
      const shown = [lightValue && `${opaqueText(lightValue)} in light`, darkValue && `${opaqueText(darkValue)} in dark`]
        .filter(Boolean)
        .join(', ')
      const sample = rgba(lightValue ?? '') ?? rgba(darkValue ?? '') ?? [0, 0, 0, 1]
      findings.add(
        `${element.element}|${property}|${lightValue}|${darkValue}`,
        `${where}, ${element.element} ${property} is ${shown}, not a theme color; use a token such as ${nearestColor(theme, sample, lightValue ? theme.light : theme.dark)} (or the kit's components).`,
      )
    }
  }
  for (const element of light.elements) {
    const other = darkByIndex.get(element.index)
    check(element, other?.element === element.element ? other : undefined, other?.element === element.element ? 'both' : 'light')
  }
  const lightIndexes = new Set(light.elements.map(element => element.index))
  for (const element of dark.elements) if (!lightIndexes.has(element.index)) check(element, undefined, 'dark')
}

function typeFailures(measured: StyleMeasurement, where: string, findings: Findings) {
  const {tokens} = measured
  const sizes = [...tokens.fontSizes, textFloor]
  const family = (value: string) => value.toLowerCase().replace(/["'\s]/gu, '')
  const families = tokens.fontFamilies.map(family)
  for (const element of measured.elements) {
    const font = element.font
    if (!font) continue
    const text = `${element.element} ("${font.text}")`
    if (font.size < textFloor - 0.25) {
      findings.add(
        `${element.element}|size|${font.size}`,
        `${where}, ${text} is ${font.size}px, below the ${textFloor}px floor; use --projections-font-size-xs or larger.`,
      )
    } else if (!near(font.size, sizes, 0.25)) {
      findings.add(
        `${element.element}|size|${font.size}`,
        `${where}, ${text} is ${font.size}px, not on the type scale (${listed(sizes)} px); use --projections-font-size tokens, such as the nearest, ${nearest(font.size, sizes)}px.`,
      )
    }
    if (families.length && !families.includes(family(font.family))) {
      findings.add(
        `${element.element}|family|${font.family}`,
        `${where}, ${text} is set in ${font.family}, not the theme's text or monospace font; use --projections-font-family (buttons and inputs need font: inherit).`,
      )
    }
    if (tokens.fontWeights.length && !near(font.weight, tokens.fontWeights, 0.5)) {
      findings.add(
        `${element.element}|weight|${font.weight}`,
        `${where}, ${text} has font-weight ${font.weight}, not a weight token (${listed(tokens.fontWeights)}).`,
      )
    }
  }
}

function spacingFailures(measured: StyleMeasurement, where: string, findings: Findings) {
  const {tokens} = measured
  const spaces = [0, ...hairlines, ...tokens.spaces]
  const radii = [0, ...tokens.radii, ...tokens.radii.flatMap(radius => hairlines.map(border => radius - border))]
  const borders = [...hairlines, ...tokens.borderWidths]
  for (const element of measured.elements) {
    // One line per value: `padding-top, padding-bottom are 5px`.
    const off = new Map<number, string[]>()
    for (const [property, value] of Object.entries(element.spacing)) {
      if (near(Math.abs(value), spaces, 0.5)) continue
      off.set(value, [...(off.get(value) ?? []), property])
    }
    for (const [value, properties] of off) {
      findings.add(
        `${element.element}|${properties.join()}|${value}`,
        `${where}, ${element.element} ${properties.join(', ')} ${properties.length > 1 ? 'are' : 'is'} ${value}px, off the space scale (${listed(spaces)} px); use --projections-space tokens, such as the nearest, ${nearest(Math.abs(value), spaces)}px.`,
      )
    }
    for (const [corner, value] of Object.entries(element.radii)) {
      if (value === 'pill' || near(value, radii, 0.5)) continue
      findings.add(
        `${element.element}|radius|${value}`,
        `${where}, ${element.element} border-${corner}-radius is ${value}px, not a radius token (${listed(tokens.radii)} px, or one less a 1–2px border, or fully rounded).`,
      )
    }
    for (const [side, value] of Object.entries(element.borders)) {
      if (near(value, borders, 0.25)) continue
      findings.add(
        `${element.element}|border|${value}`,
        `${where}, ${element.element} border-${side}-width is ${value}px, not a border-width token (${listed(borders)} px).`,
      )
    }
  }
}

function exemptionNotes(measured: StyleMeasurement[]): string[] {
  return [...new Set(measured.flatMap(item => item.exemptions))].map(item => `Exempt (data-projections-off-system): ${item}`)
}

/** Where a renderer's field paints something other than the stage, one line per point. */
function stageSurfaceFailures(measured: StageSurfaceMeasurement, where: string): string[] {
  const stage = rgba(measured.stage)
  return measured.samples.flatMap(sample => {
    if (sample.color === 'transparent' || sample.color === 'exempt') return []
    const color = rgba(sample.color)
    if (!color || (stage && distance(color, stage) <= colorTolerance && color[3] > 0.99)) return []
    return [
      `${where}, the field at its ${sample.where} (${sample.at}) is ${opaqueText(sample.color)}, painted by ${sample.element}, not the stage (${opaqueText(measured.stage)}): paint it with --projections-color-surface-canvas (the kit's --stage) or leave it transparent, and stand cards and panels on --projections-color-surface-raised.`,
    ]
  })
}

export const styleChecks: Pick<Checks, 'palette' | 'stage-surface' | 'type-scale' | 'spacing'> = {
  async palette(driver, subject, {modes, phoneWidth}) {
    const findings = new Findings()
    const measured: StyleMeasurement[] = []
    for (const view of stylePresentations(subject, modes)) {
      for (const width of [undefined, phoneWidth]) {
        const light = await stylesAt(driver, subject, view, width, 'light')
        const dark = await stylesAt(driver, subject, view, width, 'dark')
        measured.push(light, dark)
        paletteFailures(themeColors(light.tokens, dark.tokens), light, dark, `${view.where}${width ? ` at ${width}px` : ''}`, findings)
      }
    }
    return withExemptions(findings, measured)
  },
  async 'stage-surface'(driver, subject, {modes}) {
    const [view] = stylePresentations(subject, modes)
    const failures: string[] = []
    for (const colorMode of ['light', 'dark'] as const) {
      await driver.load(subject, {
        progress: view!.progress,
        colorMode,
        reuse: true,
        ...(view!.comparisonMode ? {comparisonMode: view!.comparisonMode} : {}),
      })
      await driver.measure('settle')
      const measured = await driver.measure<StageSurfaceMeasurement>('stageSurface')
      failures.push(...stageSurfaceFailures(measured, `${view!.where} (${colorMode})`))
    }
    return failures
  },
  async 'type-scale'(driver, subject, {modes, phoneWidth}) {
    const findings = new Findings()
    const measured: StyleMeasurement[] = []
    for (const view of stylePresentations(subject, modes)) {
      for (const width of [undefined, phoneWidth]) {
        const styles = await stylesAt(driver, subject, view, width, 'light')
        measured.push(styles)
        typeFailures(styles, `${view.where}${width ? ` at ${width}px` : ''}`, findings)
      }
    }
    return withExemptions(findings, measured)
  },
  async spacing(driver, subject, {modes, phoneWidth}) {
    const findings = new Findings()
    const measured: StyleMeasurement[] = []
    for (const view of stylePresentations(subject, modes)) {
      for (const width of [undefined, phoneWidth]) {
        const styles = await stylesAt(driver, subject, view, width, 'light')
        measured.push(styles)
        spacingFailures(styles, `${view.where}${width ? ` at ${width}px` : ''}`, findings)
      }
    }
    return withExemptions(findings, measured)
  },
}

/**
 * A styling check's failures; exemptions are listed after them, so a review sees what was left out. A check with no
 * failures passes even with exemptions, which are reported then too (see `runChecks`).
 */
function withExemptions(findings: Findings, measured: StyleMeasurement[]): string[] {
  const failures = findings.result()
  const notes = exemptionNotes(measured)
  if (!failures.length && notes.length) throw new Passed(notes)
  return failures.length ? [...failures, ...notes] : []
}
