import path from 'node:path'
import {lstat, readdir, readFile} from 'node:fs/promises'
import {containedIn, containedPath, type ExtractorContext} from '../shared.js'
import {absent, code, slash} from './model.js'

/**
 * The texts the compiler reads, loaded on demand from the examined revision.
 * The compiler asks for files and directories synchronously; what it asked for
 * and was not loaded yet is collected in `requested` and `requestedDirectories`
 * and loaded by `loadRequested` before the next resolution pass.
 */
export class SourceFiles {
  readonly texts = new Map<string, string>()
  readonly missing = new Set<string>()
  readonly requested = new Set<string>()
  readonly requestedDirectories = new Set<string>()
  readonly directoryCache = new Map<string, string[]>()
  // Paths reached through an in-repository symlink (a workspace package under
  // `node_modules`), to their real file. The compiler reads both, but its
  // `realpath` maps an alias to the real file, so each file is one source; aliases
  // are never program roots, tsconfig matches or packages.
  readonly aliases = new Map<string, string>()
  // Types of installed dependencies come from the checkout. A materialized
  // revision has no ignored `node_modules`, so a path under one that the revision
  // lacks is read, read-only, from the same place in the repository checkout,
  // following links only within the checkout. A link into a workspace package
  // (whose real path is outside every `node_modules`) maps back to that package in
  // the examined revision, so its source is the revision's, never the checkout's.
  private readonly checkout: string
  private readonly fromCheckout = new Map<string, boolean>()

  constructor(
    private readonly context: ExtractorContext,
    readonly root: string,
  ) {
    this.checkout = context.toolchain.checkout
  }

  private async installedInCheckout(relative: string): Promise<boolean> {
    const segments = relative.split('/')
    const index = segments.indexOf('node_modules')
    if (index < 0 || this.checkout === this.root) return false
    const prefix = segments.slice(0, index + 1).join('/')
    if (!this.fromCheckout.has(prefix)) {
      let missing = false
      try {
        await containedPath(this.context, prefix)
      } catch (error) {
        if (!absent(error)) throw error
        missing = true
      }
      this.fromCheckout.set(prefix, missing)
    }
    return this.fromCheckout.get(prefix)!
  }

  /** Where a root-relative path is read (`read`), and the path under the root it is known by (`key`). */
  async locate(relative: string): Promise<{key: string; read: string}> {
    if (!(await this.installedInCheckout(relative))) {
      const real = await containedPath(this.context, relative)
      return {key: real, read: real}
    }
    const real = await containedIn(this.checkout, relative)
    const offset = slash(path.relative(this.checkout, real))
    if (offset.split('/').includes('node_modules')) return {key: path.join(this.root, offset), read: real}
    const revision = await containedPath(this.context, offset)
    return {key: revision, read: revision}
  }

  within = (file: string): boolean => {
    const relative = path.relative(this.root, path.resolve(file))
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  }

  private missingInput(file: string, cause?: unknown): Error {
    return new Error(`Missing TypeScript input: ${code(slash(path.relative(this.root, file)))}`, cause === undefined ? undefined : {cause})
  }

  async load(file: string, required = false): Promise<boolean> {
    file = path.resolve(file)
    if (this.texts.has(file) || this.missing.has(file)) {
      if (required && this.missing.has(file)) throw this.missingInput(file)
      return false
    }
    if (!this.within(file)) {
      if (required) throw new Error(`TypeScript inputs must stay within the repository: ${code(file)}`)
      return false
    }
    try {
      return await this.read(file)
    } catch (error) {
      if (!absent(error)) throw error
      this.missing.add(file)
      if (!required) return false
      throw this.missingInput(file, error)
    }
  }

  private async read(file: string): Promise<boolean> {
    const relative = slash(path.relative(this.root, file))
    const {key, read} = await this.locate(relative)
    const stat = await lstat(read)
    if (!stat.isFile()) {
      this.missing.add(file)
      return false
    }
    if (stat.size > 32 * 1024 * 1024) throw new Error(`Input must be a regular file under 32 MiB: ${code(relative)}`)
    const text = this.texts.get(key) ?? (await readFile(read, 'utf8'))
    this.texts.set(file, text)
    if (key !== file) {
      this.aliases.set(file, key)
      this.texts.set(key, text)
    }
    return true
  }

  /** Loads what the compiler asked for since the last call; reports whether anything new appeared. */
  async loadRequested(): Promise<boolean> {
    let changed = false
    for (const file of this.requested) changed = (await this.load(file)) || changed
    for (const directory of this.requestedDirectories) changed = (await this.loadDirectory(directory)) || changed
    this.clearRequests()
    return changed
  }

  private async loadDirectory(directory: string): Promise<boolean> {
    try {
      const guarded = (await this.locate(slash(path.relative(this.root, directory)))).read
      const children = (await readdir(guarded, {withFileTypes: true}))
        .filter(child => child.isDirectory() || child.isSymbolicLink())
        .map(child => child.name)
        .sort()
      this.directoryCache.set(directory, children)
      return children.length > 0
    } catch (error) {
      if (!absent(error)) throw error
      this.directoryCache.set(directory, [])
      return false
    }
  }

  clearRequests(): void {
    this.requested.clear()
    this.requestedDirectories.clear()
  }
}
