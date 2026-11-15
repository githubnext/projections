import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {ReactNode} from 'react'
import type {Meta, StoryObj} from '@storybook/react-vite'
import {VscodeThemeFrame, vscodeThemeOf, vscodeThemes} from '../../src/vscode-frame.js'
import {renderVscodeExplorer} from '../../src/vscode-render.js'
import type {VscodeArgs} from '../../src/vscode-render.js'
import {runtimeLoader, scenarioArgTypes} from '../../src/stories.js'
import type {VscodeThemeFixture} from '@githubnext/projections-host-vscode'
import type {StoryContext} from '@storybook/react-vite'
import './toolbar.css'

/** Container widths the toolbar's priority collapse is shown at, widest first (packages/host/vscode-ui/README.md "Building blocks"). */
const widths = [1440, 1024, 768, 600, 480, 390, 320]

interface LadderArgs extends VscodeArgs {
  /** `all` shows every captured VS Code theme; otherwise the toolbar's VS Code theme. */
  themes?: 'current' | 'all'
  /** The widths to show (default all). */
  at?: readonly number[]
}

/**
 * Whether a cell's explorer has settled: its renderer has painted (its frames are revealed) or failed, or the
 * comparison failed. A ready renderer is still laying out and painting, which would slow the next cells' frames.
 */
function settled(cell: HTMLElement): boolean {
  if (cell.querySelector('.ph-explorer[data-outcome="failed"], .ph[data-renderer-status="failed"]')) return true
  if (!cell.querySelector('.ph[data-renderer-status]') || cell.querySelector('.ph[data-renderer-status="loading"]')) return false
  return !cell.querySelector('iframe.ph-frame[data-revealed="false"]')
}

/**
 * One explorer of the ladder, mounted once enough before it have settled: a ladder starts a dozen or more graph
 * renderers, and started at once on one main thread, none became ready within the host's 10 s limit on a CI runner;
 * one at a time, Linux WebKit took longer than a test's minute for the whole ladder.
 */
function Cell({
  index,
  mounted,
  onSettled,
  title,
  width,
  children,
}: {
  index: number
  mounted: number
  onSettled: (index: number) => void
  title: string
  width: number
  children: ReactNode
}) {
  const view = useRef<HTMLDivElement>(null)
  const shown = index < mounted
  useEffect(() => {
    const element = view.current
    if (!shown || !element) return
    const check = () => {
      if (settled(element)) onSettled(index)
    }
    const observer = new MutationObserver(check)
    observer.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-renderer-status', 'data-outcome', 'data-revealed'],
    })
    check()
    // A cell that never settles (no renderer to wait for) doesn't hold up the rest.
    const timer = setTimeout(() => onSettled(index), 20_000)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [shown, index, onSettled])
  return (
    <section className="sb-ladder-cell" data-width={width} aria-label={`${title} at ${width}px`}>
      <p className="sb-caption">{width}px</p>
      <div ref={view} className="sb-ladder-view" style={{width}}>
        {shown && children}
      </div>
    </section>
  )
}

function Ladders({
  args,
  context,
  themes,
}: {
  args: LadderArgs
  context: Pick<StoryContext, 'loaded'>
  themes: readonly VscodeThemeFixture[]
}) {
  const at = args.at ?? widths
  const total = themes.length * at.length
  // At most `concurrent` explorers load at once. Each graph renderer frame parses a 2 MB document on the page's one
  // main thread: in Linux WebKit, three side-by-side explorers (six frames) left the last frame short of the 10 s limit.
  const concurrent = 2
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set())
  const onSettled = useCallback((index: number) => setDone(previous => (previous.has(index) ? previous : new Set(previous).add(index))), [])
  const mounted = Math.min(total, done.size + concurrent)
  // One element for every cell: a new one per settled cell would hand each mounted explorer new extractions, and
  // every explorer would compute its comparison again while the next ones load.
  const explorer = useMemo(() => renderVscodeExplorer(args, context), [args, context])
  return (
    // Pending until every explorer is mounted, for the browser suites.
    <div className="sb-ladder" data-story-pending={mounted < total ? '' : undefined}>
      {themes.map((theme, themeIndex) => (
        <VscodeThemeFrame key={theme.id} theme={theme} className="sb-ladder-theme">
          <h2 className="sb-ladder-title">{theme.name}</h2>
          {at.map((width, widthIndex) => (
            <Cell
              key={width}
              index={themeIndex * at.length + widthIndex}
              mounted={mounted}
              onSettled={onSettled}
              title={theme.name}
              width={width}
            >
              {explorer}
            </Cell>
          ))}
        </VscodeThemeFrame>
      ))}
    </div>
  )
}

/**
 * The VS Code UI's toolbar in each comparison mode at every width of its collapse ladder: the slider's names go, the
 * pickers become compact, the mode switch a menu, playback's steps move into its "…", then zoom, About, full screen and
 * Filter into More Actions, then two rows. Each explorer is cut to its toolbar and the top of its stage. Choose the
 * VS Code theme in the toolbar, or `themes: all` for every captured theme.
 */
const meta = {
  title: 'VS Code UI/Toolbar',
  // Many explorers on one page: the browser suites give these stories more time.
  tags: ['ladder'],
  loaders: [runtimeLoader],
  args: {scenario: 'graph/service-platform', themes: 'current'},
  argTypes: {...scenarioArgTypes(), themes: {control: 'inline-radio', options: ['current', 'all']}},
  render: (args, context) => (
    <Ladders args={args} context={context} themes={args.themes === 'all' ? vscodeThemes : [vscodeThemeOf(context.globals)]} />
  ),
} satisfies Meta<LadderArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Animated: Story = {args: {initialMode: 'animated'}}
export const SideBySide: Story = {name: 'Side by side', args: {initialMode: 'side-by-side'}}
export const Swipe: Story = {args: {initialMode: 'swipe'}}
export const Diff: Story = {args: {scenario: 'text-diff/cli-output-release', initialMode: 'diff'}}
export const TableView: Story = {name: 'Table view', args: {initialView: 'table'}}
export const EveryTheme: Story = {name: 'Every theme, animated', args: {initialMode: 'animated', themes: 'all', at: [1024, 600, 390]}}
