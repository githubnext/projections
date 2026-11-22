/*
 * The side bar's model of a repository's projections, from its backend (`GET /api/definitions`, `GET /api/explore`),
 * and what each row says: its kind icon, its status, its parts. Nothing here imports VS Code, so it is unit tested on
 * its own (its modules import each other with `.ts` specifiers, which Node loads from source); `sidebar.ts` shows it
 * in tree views, Problems and projection tabs.
 */

/** A located diagnostic of a definition file, as the runner reports it. */
export interface DefinitionDiagnostic {
  code: string
  message: string
  pointer?: string
  location?: {path: string; line: number; column: number}
}

/** A definition file that isn't valid: its projection ID (when it has one), its path and why. */
export interface InvalidDefinition {
  id: string | null
  path: string
  diagnostics: DefinitionDiagnostic[]
}

export interface DefinitionPolicy {
  id: string
  requiresTrust: boolean
  rendererRequiresTrust: boolean
}

/** A valid definition, as far as the side bar reads it. */
export interface ProjectionDefinition {
  id: string
  title?: string
  description?: string
  extractor: string | {command: string[]; sources?: string[]}
  renderer: string | {bundle: string}
  comparator?: string | {file?: string; options?: unknown}
}

/** `GET /api/definitions?ref=working-tree`, as the side bar uses it. */
export interface DefinitionList {
  definitions: ProjectionDefinition[]
  policies: DefinitionPolicy[]
  invalid: InvalidDefinition[]
  executionAuthorized: boolean
  /** Present when the repository defines no projections (the definitions are then the built-in defaults). */
  setup: boolean
}

/** An explore candidate, with why it applies here. */
export interface Candidate {
  id: string
  /** The built-in extractor it uses; its ID when absent. */
  extractor?: string
  /** Inputs it sets, such as the one workflow it reads. */
  inputs?: Record<string, unknown>
  title: string
  description?: string
  renderer?: string
  requiresTrust: boolean
  /** The projection that already adopts it, if any. */
  adopted?: string
  basis: {pattern: string; count: number; examples: string[]}
}

export const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

function diagnostics(value: unknown): DefinitionDiagnostic[] {
  return (Array.isArray(value) ? value : []).flatMap(entry => {
    const item = record(entry)
    if (!item || typeof item.message !== 'string') return []
    const location = record(item.location)
    return [
      {
        code: typeof item.code === 'string' ? item.code : 'INVALID_DEFINITION',
        message: item.message,
        ...(typeof item.pointer === 'string' ? {pointer: item.pointer} : {}),
        ...(location && typeof location.path === 'string' && typeof location.line === 'number'
          ? {location: {path: location.path, line: location.line, column: typeof location.column === 'number' ? location.column : 1}}
          : {}),
      },
    ]
  })
}

const titleOrder = new Intl.Collator(undefined, {sensitivity: 'base', numeric: true})

/**
 * Items in the order the extension lists projections: alphabetically by the title shown (locale-aware, ignoring case
 * and accents, numbers by value), then by ID, so rows read in order whatever their files are named.
 */
export function byTitle<T>(items: readonly T[], title: (item: T) => string, id: (item: T) => string): T[] {
  return items.toSorted(
    (a, b) => titleOrder.compare(title(a), title(b)) || titleOrder.compare(id(a), id(b)) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0),
  )
}

/** Reads `GET /api/definitions`' body. */
export function parseDefinitions(body: unknown): DefinitionList {
  const value = record(body)
  if (!value || !Array.isArray(value.definitions)) throw new Error('The backend listed definitions in an unexpected shape')
  const definitions = value.definitions.flatMap(entry => {
    const item = record(entry)
    return item && typeof item.id === 'string' ? [item as unknown as ProjectionDefinition] : []
  })
  const policies = (Array.isArray(value.policies) ? value.policies : []).flatMap(entry => {
    const item = record(entry)
    return item && typeof item.id === 'string'
      ? [{id: item.id, requiresTrust: item.requiresTrust === true, rendererRequiresTrust: item.rendererRequiresTrust === true}]
      : []
  })
  const invalid = (Array.isArray(value.invalid) ? value.invalid : []).flatMap(entry => {
    const item = record(entry)
    return item && typeof item.path === 'string'
      ? [{id: typeof item.id === 'string' ? item.id : null, path: item.path, diagnostics: diagnostics(item.diagnostics)}]
      : []
  })
  return {definitions, policies, invalid, executionAuthorized: value.executionAuthorized === true, setup: value.setup !== undefined}
}

/** A candidate's inputs, from its trial definition, when it sets any. */
function inputsOf(definition: unknown): {inputs?: Record<string, unknown>} {
  const inputs = record(record(definition)?.inputs)
  return inputs ? {inputs} : {}
}

/** Reads `GET /api/explore`'s candidates. */
export function parseCandidates(body: unknown): Candidate[] {
  const candidates = record(body)?.candidates
  return (Array.isArray(candidates) ? candidates : []).flatMap(entry => {
    const item = record(entry)
    if (!item || typeof item.id !== 'string') return []
    const basis = record(item.basis) ?? {}
    return [
      {
        id: item.id,
        ...(typeof item.extractor === 'string' && item.extractor !== item.id ? {extractor: item.extractor} : {}),
        ...inputsOf(item.definition),
        title: typeof item.title === 'string' ? item.title : item.id,
        ...(typeof item.description === 'string' ? {description: item.description} : {}),
        ...(typeof item.renderer === 'string' ? {renderer: item.renderer} : {}),
        requiresTrust: item.requiresTrust === true,
        ...(typeof item.adopted === 'string' ? {adopted: item.adopted} : {}),
        basis: {
          pattern: typeof basis.pattern === 'string' ? basis.pattern : '',
          count: typeof basis.count === 'number' ? basis.count : 0,
          examples: Array.isArray(basis.examples) ? basis.examples.filter((path): path is string => typeof path === 'string') : [],
        },
      },
    ]
  })
}

/** Why a candidate applies: how many tracked files match the pattern its extractor detects. */
export function candidateReason(candidate: Candidate): string {
  const files = `${candidate.basis.count} file${candidate.basis.count === 1 ? '' : 's'}`
  return candidate.basis.pattern ? `${files} match ${candidate.basis.pattern}` : files
}
