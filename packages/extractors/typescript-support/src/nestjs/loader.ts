import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import ts from 'typescript'
import {nearest, slash, sourceFile, within} from './model.js'

/**
 * Compiler options for loading the application: the project's tsconfig, emitting
 * CommonJS with the legacy decorators and decorator metadata Nest requires.
 */
export function compilerOptions(root: string, configured: string | undefined, directory: string): ts.CompilerOptions {
  const file = configured ?? nearest(root, directory, 'tsconfig.json')
  let options: ts.CompilerOptions = {}
  if (file) {
    const read = ts.readConfigFile(file, ts.sys.readFile)
    if (read.error && configured) {
      throw new Error(`Cannot read ${slash(path.relative(root, file))}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`)
    }
    // A base config extended from an uninstalled package is not fatal: only module
    // resolution and decorator emit matter here, and those are set below.
    if (!read.error) options = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file)).options
  }
  return {
    ...options,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: options.moduleResolution ?? ts.ModuleResolutionKind.Node10,
    target: options.target ?? ts.ScriptTarget.ES2021,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    sourceMap: false,
    inlineSourceMap: false,
    inlineSources: false,
    declaration: false,
    declarationMap: false,
    noEmit: false,
    isolatedModules: true,
    verbatimModuleSyntax: false,
  }
}

interface ModuleClass {
  _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string
  _extensions: Record<string, (module: {_compile: (code: string, file: string) => void}, file: string) => void>
  _nodeModulePaths: (directory: string) => string[]
  isBuiltin: (request: string) => boolean
}

/**
 * Loads repository TypeScript with the repository's own compiler. Revisions are
 * materialized without `node_modules`, so packages resolve from the same relative
 * location in the repository checkout, and never above it.
 */
export function installLoader(root: string, checkout: string, options: ts.CompilerOptions): () => void {
  const Module = createRequire(import.meta.url)('node:module') as ModuleClass
  const original = Module._resolveFilename
  const previous = Module._extensions['.ts']
  const bare = (request: string): boolean => !request.startsWith('.') && !path.isAbsolute(request)
  const inCheckout = (file: string): string | undefined => {
    if (within(checkout, file)) return file
    if (within(root, file)) return path.join(checkout, path.relative(root, file))
    return undefined
  }
  const viaCompiler = (request: string, parent: string): string | undefined => {
    const resolved = ts.resolveModuleName(request, parent, options, ts.sys).resolvedModule?.resolvedFileName
    if (!resolved || resolved.endsWith('.d.ts') || !sourceFile.test(resolved)) return undefined
    const file = path.resolve(resolved)
    return within(root, file) && !file.split(path.sep).includes('node_modules') ? file : undefined
  }
  Module._resolveFilename = function (this: unknown, request, parent, isMain, resolveOptions) {
    const from = (parent as {filename?: string} | undefined)?.filename
    if (!from || Module.isBuiltin(request)) return original.call(this, request, parent, isMain, resolveOptions)
    if (bare(request)) {
      // Path aliases (tsconfig `paths`) name repository sources.
      if (options.paths && within(root, from)) {
        const aliased = viaCompiler(request, from)
        if (aliased) return aliased
      }
      const mapped = inCheckout(from)
      if (mapped) {
        const paths = Module._nodeModulePaths(path.dirname(mapped)).filter(directory => within(checkout, directory))
        return original.call(this, request, {id: mapped, filename: mapped, paths}, isMain, resolveOptions)
      }
      return original.call(this, request, parent, isMain, resolveOptions)
    }
    try {
      return original.call(this, request, parent, isMain, resolveOptions)
    } catch (error) {
      // ECMAScript-style specifiers (`./orders.service.js`) name TypeScript sources.
      const compiled = within(root, from) ? viaCompiler(request, from) : undefined
      if (compiled) return compiled
      throw error
    }
  }
  Module._extensions['.ts'] = (module, file) => {
    const output = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: options, fileName: file, reportDiagnostics: false})
    module._compile(output.outputText, file)
  }
  return () => {
    Module._resolveFilename = original
    if (previous) Module._extensions['.ts'] = previous
    else delete Module._extensions['.ts']
  }
}

/** Application code may print while it loads; stdout carries only the extraction. */
export async function quietly<T>(action: () => Promise<T>): Promise<T> {
  const write = process.stdout.write
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write
  try {
    return await action()
  } finally {
    process.stdout.write = write
  }
}
