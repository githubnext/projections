// The icons a graph card may show before its kind line (see `GraphCanvasProps.icon`): a fixed set of Lucide icons,
// chosen by name from untrusted data and drawn as SVG the kit owns, so no extraction ever supplies markup or a URL.
import {
  Activity,
  AppWindow,
  Binary,
  Blocks,
  BookOpen,
  Bot,
  Box,
  Boxes,
  Braces,
  Brain,
  Cable,
  ChartBar,
  Cloud,
  Code,
  CodeXml,
  Component,
  Container,
  Cpu,
  Database,
  File,
  FileCode,
  FileText,
  FlaskConical,
  Folder,
  FolderTree,
  Gauge,
  GitBranch,
  GitCompare,
  GitMerge,
  GitPullRequest,
  Globe,
  Hammer,
  HardDrive,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  ListTree,
  Lock,
  Mail,
  MessageSquare,
  Monitor,
  Network,
  Package,
  Palette,
  PanelRight,
  Pickaxe,
  Play,
  Plug,
  Puzzle,
  Rocket,
  Route,
  Scan,
  ScanSearch,
  Search,
  Server,
  Settings,
  Shapes,
  Shield,
  Smartphone,
  Sparkles,
  SquareTerminal,
  Table,
  Terminal,
  TestTube,
  User,
  Users,
  Webhook,
  Workflow,
  Wrench,
  Zap,
} from 'lucide'
import type {IconNode} from 'lucide'
import type {Entity} from '@githubnext/projections-schemas'

/** Each card icon's Lucide drawing (ISC license), by its Lucide name. */
const cardIconNodes = {
  activity: Activity,
  'app-window': AppWindow,
  binary: Binary,
  blocks: Blocks,
  'book-open': BookOpen,
  bot: Bot,
  box: Box,
  boxes: Boxes,
  braces: Braces,
  brain: Brain,
  cable: Cable,
  'chart-bar': ChartBar,
  cloud: Cloud,
  code: Code,
  'code-xml': CodeXml,
  component: Component,
  container: Container,
  cpu: Cpu,
  database: Database,
  file: File,
  'file-code': FileCode,
  'file-text': FileText,
  'flask-conical': FlaskConical,
  folder: Folder,
  'folder-tree': FolderTree,
  gauge: Gauge,
  'git-branch': GitBranch,
  'git-compare': GitCompare,
  'git-merge': GitMerge,
  'git-pull-request': GitPullRequest,
  globe: Globe,
  hammer: Hammer,
  'hard-drive': HardDrive,
  'key-round': KeyRound,
  layers: Layers,
  'layout-dashboard': LayoutDashboard,
  library: Library,
  'list-tree': ListTree,
  lock: Lock,
  mail: Mail,
  'message-square': MessageSquare,
  monitor: Monitor,
  network: Network,
  package: Package,
  palette: Palette,
  'panel-right': PanelRight,
  pickaxe: Pickaxe,
  play: Play,
  plug: Plug,
  puzzle: Puzzle,
  rocket: Rocket,
  route: Route,
  scan: Scan,
  'scan-search': ScanSearch,
  search: Search,
  server: Server,
  settings: Settings,
  shapes: Shapes,
  shield: Shield,
  smartphone: Smartphone,
  sparkles: Sparkles,
  'square-terminal': SquareTerminal,
  table: Table,
  terminal: Terminal,
  'test-tube': TestTube,
  user: User,
  users: Users,
  webhook: Webhook,
  workflow: Workflow,
  wrench: Wrench,
  zap: Zap,
} as const satisfies Record<string, IconNode>

/** A card icon's name: a Lucide icon name in `cardIconNames`. Validate untrusted input with `isCardIconName`. */
export type CardIconName = keyof typeof cardIconNodes

/**
 * The icons a graph card can show before its kind line (`GraphCanvasProps.icon`), by their Lucide names
 * (https://lucide.dev/icons), in name order: a fixed set for the parts of a system (`terminal`, `cpu`, `database`,
 * `globe`, `package`, `git-compare`…). A renderer bundles only these; any other name draws nothing.
 */
export const cardIconNames = Object.keys(cardIconNodes).sort() as CardIconName[]

/** Whether a value names a card icon (`cardIconNames`). */
export function isCardIconName(value: unknown): value is CardIconName {
  return typeof value === 'string' && Object.hasOwn(cardIconNodes, value)
}

/** The SVG elements a card icon draws, in Lucide's 24-unit box, each a tag and its attributes. */
export function cardIconNode(name: CardIconName): IconNode {
  return cardIconNodes[name]
}

/**
 * A card icon's box, in card units: `size` square, `gap` before the kind line's text, and `ink`, Lucide's margin
 * inside its 24-unit box at that size, which the box is pulled left by so the glyph lines up with the text below it.
 */
export const cardIconMetrics = {size: 14, gap: 5, ink: (14 * 2) / 24} as const

/** The room a card icon takes before the kind line's text: its box and the gap after it. */
export const cardIconRoom = cardIconMetrics.size + cardIconMetrics.gap - cardIconMetrics.ink

/** A row's card icon in each revision, or undefined where it names none in `cardIconNames`. */
export function rowIcons(
  row: {before?: Entity | undefined; after?: Entity | undefined},
  icon: ((entity: Entity) => string | undefined) | undefined,
): [CardIconName | undefined, CardIconName | undefined] {
  const named = (entity: Entity | undefined) => {
    const name = entity && icon?.(entity)
    return isCardIconName(name) ? name : undefined
  }
  return [named(row.before), named(row.after)]
}

/** Whether a row shows an icon in either revision, so its kind line keeps room for one at every progress. */
export function hasIcon(row: {before?: Entity | undefined; after?: Entity | undefined}, icon?: (entity: Entity) => string | undefined) {
  return rowIcons(row, icon).some(Boolean)
}
