/*
 * What **Projections: New Projection…** offers and runs: its quick picks' items, the built-ins that fit together, the
 * ID and title checks, and the `projections init` arguments it writes the projection with. The CLI writes every file;
 * nothing here imports VS Code (or anything at run time).
 */

/** A built-in extractor, as `projections extractor list --json` lists it. */
export interface BuiltinExtractor {
  id: string
  title: string
  description: string
  /** The domain schema its extractions use, such as `graph/v0`. */
  schema: string
  /** The built-in renderer its definition template uses. */
  renderer: string
  /** Whether it runs repository code (`trust` other than `none`). */
  runsCode: boolean
}

/** What a renderer presents: a domain schema and, with `vocabulary`, only extractions that declare it. */
export interface RendererAccepts {
  schema: string
  vocabulary?: string
}

/** A built-in renderer, as the backend's `GET /api/renderers` lists it (its manifest). */
export interface BuiltinRenderer {
  name: string
  title: string
  /** The definition `renderer` names it answers to, its own first. */
  handles: string[]
  /** Absent: any extraction. */
  accepts?: RendererAccepts[]
}

/** A suggestion, as the Suggested section shows it: an explore candidate not yet adopted. */
export interface Suggestion {
  id: string
  title: string
  description?: string
  requiresTrust: boolean
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** The built-in extractors in `projections extractor list --json`'s catalog. */
export function parseExtractors(value: unknown): BuiltinExtractor[] {
  const list = (value as {extractors?: unknown} | null)?.extractors
  if (!Array.isArray(list)) throw new Error('projections extractor list --json returned no extractors')
  return list.flatMap(item => {
    const entry = item as Record<string, unknown> | null
    if (!entry || typeof entry.id !== 'string' || !entry.id) return []
    return [
      {
        id: entry.id,
        title: text(entry.title) || entry.id,
        description: text(entry.description),
        schema: text(entry.schema),
        renderer: text(entry.renderer),
        runsCode: entry.trust !== undefined && entry.trust !== 'none',
      },
    ]
  })
}

/** The built-in renderers in the backend's `GET /api/renderers` answer. */
export function parseRenderers(value: unknown): BuiltinRenderer[] {
  const list = (value as {renderers?: unknown} | null)?.renderers
  if (!Array.isArray(list)) throw new Error('The Projections backend listed no renderers')
  return list.flatMap(item => {
    const entry = item as Record<string, unknown> | null
    if (!entry || typeof entry.name !== 'string' || !entry.name) return []
    const handles = [entry.name, ...(Array.isArray(entry.handles) ? entry.handles : [])].filter(
      (name, index, all): name is string => typeof name === 'string' && all.indexOf(name) === index,
    )
    const accepts = Array.isArray(entry.accepts)
      ? entry.accepts.flatMap(accepted => {
          const {schema, vocabulary} = (accepted ?? {}) as {schema?: unknown; vocabulary?: unknown}
          return typeof schema === 'string' ? [{schema, ...(typeof vocabulary === 'string' ? {vocabulary} : {})}] : []
        })
      : undefined
    return [{name: entry.name, title: text(entry.title) || entry.name, handles, ...(accepts ? {accepts} : {})}]
  })
}

/** A renderer to offer for an extractor: the definition `renderer` name it writes, and its bundle's title. */
export interface RendererChoice {
  /** The extractor's own renderer name for its default (which may be a preset the bundle handles, such as `dependencies`), else the bundle's name. */
  name: string
  title: string
  /** Whether it is the extractor's default, which its definition template already names. */
  isDefault: boolean
}

/**
 * The renderers that present an extractor's extractions, its own default first. A renderer fits when it accepts the
 * extractor's schema (or any). One that accepts the schema only with a vocabulary fits only as the extractor's default:
 * the catalog doesn't say which vocabularies an extractor declares, only which renderer its template uses.
 */
export function rendererChoices(extractor: BuiltinExtractor, renderers: readonly BuiltinRenderer[]): RendererChoice[] {
  const isDefault = (renderer: BuiltinRenderer) => renderer.handles.includes(extractor.renderer)
  const fits = (renderer: BuiltinRenderer) =>
    isDefault(renderer) ||
    !renderer.accepts ||
    renderer.accepts.some(accepted => accepted.schema === extractor.schema && !accepted.vocabulary)
  const fitting = renderers.filter(fits)
  return [...fitting.filter(isDefault), ...fitting.filter(renderer => !isDefault(renderer))].map(renderer =>
    isDefault(renderer)
      ? {name: extractor.renderer, title: renderer.title, isDefault: true}
      : {name: renderer.name, title: renderer.title, isDefault: false},
  )
}

/** How a new projection starts: the first quick pick's choices. */
export type Start = 'suggestion' | 'explore' | 'builtin' | 'custom' | 'agent'

export interface StartItem {
  start: Start
  label: string
  detail: string
}

/** The first pick: a suggestion (or, with none, exploring for some), built-ins, custom parts, or an agent. */
export function startItems(suggestions: number): StartItem[] {
  return [
    suggestions
      ? {
          start: 'suggestion',
          label: '$(lightbulb) Start from a suggestion',
          detail: `${suggestions === 1 ? 'One built-in projection applies' : `${suggestions} built-in projections apply`} to this repository`,
        }
      : {
          start: 'explore',
          label: '$(search) Explore this repository',
          detail: 'No suggestions yet: find the projections that apply here and try them on recent changes',
        },
    {
      start: 'builtin',
      label: '$(extensions) Start from a built-in extractor and renderer',
      detail: 'Choose what to read from the repository, then how to draw it',
    },
    {
      start: 'custom',
      label: '$(code) Write a custom extractor, renderer or comparator',
      detail: 'Scaffold the parts you write yourself, as projections init does',
    },
    {
      start: 'agent',
      label: '$(sparkle) Ask an agent to write it',
      detail: 'Describe what it should show; your coding agent builds it from a scaffold',
    },
  ]
}

/** Which parts a custom projection scaffolds. */
export type CustomParts = 'extractor' | 'renderer' | 'extractor-renderer' | 'comparator'

export interface CustomItem {
  parts: CustomParts
  label: string
  detail: string
}

export const customItems: readonly CustomItem[] = [
  {
    parts: 'extractor',
    label: 'Custom extractor',
    detail: 'A starter program that reads the repository, drawn by the built-in graph renderer',
  },
  {parts: 'renderer', label: 'Custom renderer', detail: 'A TypeScript, Vite and React package, on a built-in extractor you choose'},
  {parts: 'extractor-renderer', label: 'Custom extractor and renderer', detail: 'A starter program and a renderer package'},
  {
    parts: 'comparator',
    label: 'Custom comparator',
    detail: 'A rules file that explains and orders changes, with its tests, on a built-in extractor you choose',
  },
]

/** Whether these parts include a starter extractor (else they need a built-in one). */
export const writesExtractor = (parts: CustomParts) => parts === 'extractor' || parts === 'extractor-renderer'

/** A starter extractor's language: `projections init --language`, or undefined for the repository's toolchain. */
export type Language = 'node' | 'python' | 'go'

export interface LanguageItem {
  language: Language | undefined
  label: string
  detail: string
}

/** The languages a starter extractor comes in, as `projections init --language` takes them. */
export function languageItems(detect: boolean): LanguageItem[] {
  return [
    ...(detect
      ? [
          {
            language: undefined,
            label: "This repository's toolchain",
            detail: 'Node.js, Python or Go, from package.json, pyproject.toml, go.mod and the like',
          },
        ]
      : []),
    {language: 'node', label: 'Node.js', detail: 'An ES module: extract.mjs'},
    {language: 'python', label: 'Python', detail: 'A Python 3 script: extract.py'},
    {language: 'go', label: 'Go', detail: 'A Go program run with go run: extract.go'},
  ]
}

/** What `projections init` writes. */
export interface Plan {
  id: string
  /** Empty: the CLI's default, from the ID. */
  title: string
  extractor: {builtin: string; inputs?: Record<string, unknown>} | {language: Language | undefined}
  /** A built-in renderer's name, `custom`, or undefined for the extractor's default. */
  renderer?: string
  comparator?: boolean
  definitionDirectory: DefinitionDirectory
}

export type DefinitionDirectory = '.github/projections' | '.projections'

/** Where definitions go, as adopting decides: `.projections` only when it exists and `.github/projections` doesn't. */
export function definitionDirectory(exists: {github: boolean; dot: boolean}): DefinitionDirectory {
  return !exists.github && exists.dot ? '.projections' : '.github/projections'
}

/** The definition file a plan writes, relative to the repository. */
export const definitionPath = (plan: Pick<Plan, 'id' | 'definitionDirectory'>) => `${plan.definitionDirectory}/${plan.id}.json`

/** `projections init`'s arguments for a plan: the flags a person would pass. */
export function initArguments(plan: Plan): string[] {
  const args = ['init', plan.id]
  if (plan.title.trim()) args.push('--title', plan.title.trim())
  if ('builtin' in plan.extractor) {
    args.push('--extractor', plan.extractor.builtin)
    for (const [name, value] of Object.entries(plan.extractor.inputs ?? {})) {
      args.push('--input', `${name}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    }
  } else if (plan.extractor.language) args.push('--language', plan.extractor.language)
  if (plan.renderer) args.push('--renderer', plan.renderer)
  if (plan.comparator) args.push('--comparator', 'custom')
  if (plan.definitionDirectory !== '.github/projections') args.push('--definition-directory', plan.definitionDirectory)
  return args
}

/** The definition schema's ID pattern (`properties.id`, through its `$ref`), the one `projections init` validates. */
export function identifierPattern(schema: unknown): RegExp {
  const document = schema as
    | {properties?: {id?: {$ref?: string; pattern?: string}}; $defs?: Record<string, {pattern?: string}>}
    | null
    | undefined
  const id = document?.properties?.id
  const pattern = id?.$ref?.startsWith('#/$defs/') ? document?.$defs?.[id.$ref.slice('#/$defs/'.length)]?.pattern : id?.pattern
  if (typeof pattern !== 'string') throw new Error('The definition schema has no projection ID pattern')
  return new RegExp(pattern, 'u')
}

/** The environment file's name in the definitions directory, which no projection may take. */
const environmentId = 'environment'

/** Why an ID can't be used, or undefined when it can: the schema's pattern, and not one the repository has. */
export function idProblem(id: string, options: {pattern: RegExp; taken: (id: string) => boolean}): string | undefined {
  if (!id) return 'Enter an ID, for example service-map'
  if (!options.pattern.test(id)) return 'Use letters, digits, ".", "_" or "-", starting with a letter or digit (at most 100 characters)'
  if (id === environmentId) return 'environment.json is the environment file; choose another ID'
  if (options.taken(id)) return `A projection ${id} already exists here; choose another ID`
  return undefined
}

/** An ID based on `base` that isn't taken: `base`, else `base-2`, `base-3`… */
export function freeId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base
  for (let index = 2; ; index++) if (!taken(`${base}-${index}`)) return `${base}-${index}`
}

/** What went wrong in `projections init`, so the error can offer its fix. */
export type InitFailure = 'exists' | 'language' | 'other'

export function initFailure(message: string): InitFailure {
  if (/already exists at|already has files/.test(message)) return 'exists'
  if (message.includes("Choose the extractor's language")) return 'language'
  return 'other'
}

/** The CLI's last line of a failure (`Error: …`), without the prefix. */
export function failureMessage(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const error = lines.find(line => line.startsWith('Error:'))
  return (error ?? lines.at(-1) ?? 'projections init failed').replace(/^Error:\s*/, '')
}

/**
 * The prompt for a coding agent: the one `projections init` printed under "Ask your coding agent:", with what the
 * person described in place of its placeholder, else one in the same words.
 */
export function agentPrompt(output: string, description: string, id: string): string {
  const lines = output.split('\n')
  const heading = lines.findIndex(line => line.trim() === 'Ask your coding agent:')
  const printed = heading >= 0 ? lines[heading + 1]?.trim() : undefined
  const what = description.trim().replace(/[.\s]+$/, '')
  const prompt =
    (printed ?? '') ||
    `Build the "${id}" projection in this repository so it shows <what this projection should show>. Follow the projections skill, and verify it with \`projections check -p ${id} --trust\` before you finish.`
  return prompt.replace(/<what this projection should show>/, what)
}
