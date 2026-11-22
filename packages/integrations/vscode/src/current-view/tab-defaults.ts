import {resolved, type TabDefaults, type TabFacts} from './types.ts'

/** What the tools take from a tab's facts. */
export function tabDefaults(facts: TabFacts): TabDefaults {
  return {
    folder: facts.folder,
    projection: facts.projection,
    title: facts.title,
    choice: facts.choice.name,
    pinned: facts.pinned,
    ...(facts.after ? {pair: {...(facts.before ? {before: resolved(facts.before)} : {}), after: resolved(facts.after)}} : {}),
    ...(facts.definitionRevision ? {definitionRevision: facts.definitionRevision} : {}),
    ...(facts.parts ? {parts: facts.parts} : {}),
    ...(facts.page
      ? {
          view: {
            ...(facts.page.mode ? {mode: facts.page.mode} : {}),
            ...(facts.page.progress !== undefined ? {progress: facts.page.progress} : {}),
            ...(facts.page.colorMode ? {theme: facts.page.colorMode} : {}),
            ...(facts.page.width ? {width: facts.page.width} : {}),
            ...(facts.page.height ? {height: facts.page.height} : {}),
          },
        }
      : {}),
  }
}

/** A screenshot of the tab's projection takes how the page presents it: its mode, progress, theme and size. */
export function presentAsShown(args: Record<string, unknown>, view: NonNullable<TabDefaults['view']>): void {
  const {mode, progress, theme, width, height} = view
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Math.round(value)))
  if (args.mode === undefined && mode && mode !== 'swipe') args.mode = mode
  if (args.progress === undefined && progress !== undefined) args.progress = progress
  if (args.theme === undefined && theme) args.theme = theme
  if (args.width === undefined && width) args.width = clamp(width, 320, 2560)
  if (args.height === undefined && height) args.height = clamp(height, 240, 1600)
}
