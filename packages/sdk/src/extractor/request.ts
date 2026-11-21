// The extractor request: `readRequest()` reads it from stdin and checks it is one this module speaks, and `request` is
// the request read the first time it is used, with accessors for what extractors usually read. The Python module
// (packages/cli/python/projections) does the same, with the same messages; the conformance fixtures in
// packages/schemas/fixtures/extractor-helpers.json hold both to it.
import {readFileSync} from 'node:fs'
import {sep} from 'node:path'
import {isatty} from 'node:tty'
import type {Definition, Extraction, ExtractorRequest} from '@githubnext/projections-schemas'
import {quoted} from './messages.ts'
import {PROTOCOL_VERSION} from './result.ts'

/** The project's directory under `directory`, as Python's `os.path.join` makes it, so both helpers agree. */
function within(directory: string, project: string): string {
  if (!project) return directory
  const separated = directory.endsWith('/') || (sep === '\\' && directory.endsWith('\\'))
  return `${directory}${separated ? '' : sep}${project.split('/').join(sep)}`
}

/**
 * The extractor request: the protocol's JSON object, with accessors. `request.repository.root` and the rest of the
 * protocol still work; `JSON.stringify(request)` writes the request as it came.
 */
export class Request {
  readonly #read: () => ExtractorRequest
  #value: ExtractorRequest | undefined

  /** The request `value`; without one, the request on stdin, read the first time it is used. */
  constructor(value?: ExtractorRequest) {
    this.#value = value
    this.#read = () => readRequest().toJSON()
  }

  /** The request's JSON object. */
  toJSON(): ExtractorRequest {
    return (this.#value ??= this.#read())
  }

  /** `protocolVersion`: the extractor protocol's version. */
  get protocolVersion(): ExtractorRequest['protocolVersion'] {
    return this.toJSON().protocolVersion
  }

  /** `projection`: the projection's `id` and `definition`. */
  get projection(): ExtractorRequest['projection'] {
    return this.toJSON().projection
  }

  /** `repository`: where the examined revision is and what it is. */
  get repository(): ExtractorRequest['repository'] {
    return this.toJSON().repository ?? ({} as ExtractorRequest['repository'])
  }

  /** `capabilities`: whether the run is trusted and may use the network. */
  get capabilities(): ExtractorRequest['capabilities'] {
    return this.toJSON().capabilities
  }

  /** `generations`: the generation store's snapshot, when it holds values to reuse. */
  get generations(): ExtractorRequest['generations'] {
    return this.toJSON().generations
  }

  /** The definition's project, relative to the repository's root and `/`-separated; `""` for the root. */
  get project(): string {
    return this.repository.project || ''
  }

  /** The examined revision's root directory (`repository.root`). */
  get repositoryRoot(): string {
    const root = this.repository.root
    if (typeof root !== 'string' || !root) {
      throw new Error("This request has no repository.root, so the extractor can't read the examined revision")
    }
    return root
  }

  /** The project's directory in the examined revision: read its files here, and give evidence relative to it. */
  get root(): string {
    return within(this.repositoryRoot, this.project)
  }

  /** The project's directory where its dependencies (`node_modules`, a virtualenv) are installed, if anywhere. */
  get checkout(): string | undefined {
    const checkout = this.repository.checkout
    return typeof checkout === 'string' && checkout ? within(checkout, this.project) : undefined
  }

  /** The projection's ID. */
  get id(): string {
    return this.projection?.id
  }

  /** The projection's definition. */
  get definition(): Definition {
    return this.projection?.definition ?? ({} as Definition)
  }

  /** The definition's `inputs`, or `{}`. */
  get inputs(): NonNullable<Definition['inputs']> {
    return this.definition.inputs ?? {}
  }

  /** The upstream built-in extractions the definition names, by name, or `{}`. */
  get upstream(): Readonly<Record<string, Extraction>> {
    return (this.toJSON().upstream as Record<string, Extraction> | undefined) ?? {}
  }

  /** Whether the run is trusted (`--trust`). */
  get trusted(): boolean {
    return this.capabilities?.trusted
  }
}

/**
 * Reads the extractor request from the file descriptor `fd` (default: stdin) and returns it as a `Request`, failing
 * with a clear message when there is none, it isn't JSON or it speaks another protocol version.
 */
export function readRequest(fd = 0): Request {
  if (isatty(fd)) {
    throw new Error(
      'No extractor request on stdin. Projections sends one when it runs this extractor ' +
        '(projections show -p <id> --trust); to run it by hand, pipe a request in',
    )
  }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(fd, 'utf8'))
  } catch (error) {
    throw new SyntaxError(`The extractor request on stdin is not JSON: ${(error as Error).message}`, {cause: error})
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('The extractor request on stdin is not a JSON object')
  }
  const version = (value as {protocolVersion?: unknown}).protocolVersion
  if (version !== PROTOCOL_VERSION) {
    throw new RangeError(
      `The extractor request has ${version === undefined ? 'no protocolVersion' : `protocolVersion ${quoted(version)}`}; ` +
        `this module speaks ${PROTOCOL_VERSION}. Use the module of the Projections that runs the extractor`,
    )
  }
  return new Request(value as ExtractorRequest)
}

/** The extractor request on stdin, read the first time it is used: `request.root`, `request.inputs`, … */
export const request: Request = new Request()
