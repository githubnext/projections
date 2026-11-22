// The TypeScript API extractor's model of the examined project (`Project`, its `Package`s) and the leaf helpers every
// step shares: native and repository paths, protocol prose, IDs and their order, the definition's inputs and evidence.
import path from 'node:path'
import type ts from 'typescript'
import type {Evidence, Json} from '../types.js'
import {compareIds} from '../values.js'
import type {ExtractorContext} from '../shared.js'

export interface Package {
  name: string
  directory: string
  manifest: Record<string, unknown>
}
export interface Project {
  context: ExtractorContext
  root: string
  texts: Map<string, string>
  packages: Package[]
  programs: ts.Program[]
  sources: {source: ts.SourceFile; checker: ts.TypeChecker}[]
  /** The compiler's declaration library directory. */
  libraries: string
}
export const sourceExtension = /\.[cm]?[jt]sx?$/u
export const slash = (value: string): string => value.split(path.sep).join('/')
/** Raw tool text (compiler diagnostics) as protocol prose: backticks and backslashes escaped. */
export const escape = (text: string): string => text.replaceAll(/[\\\x60]/gu, character => `\\${character}`)
/** `text` as an inline code span of protocol prose (see the contracts' text with inline code). */
export const code = (text: string): string => `\`${escape(text)}\``
/** TypeScript spells file names with `/` on every platform; this is the native path. */
export const native = (fileName: string): string => path.resolve(fileName)
export const id = (...parts: string[]): string => parts.map(encodeURIComponent).join(':')
export const sort = <T extends {id: string}>(items: T[]): T[] => items.toSorted((a, b) => compareIds(a.id, b.id))
export const inputs = (context: ExtractorContext): Record<string, Json> => context.input.projection.definition.inputs ?? {}
/** `value` as a nonempty array of nonempty strings, or an error naming the input `label`. */
export function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${code(label)} must be a nonempty array of nonempty strings`)
  }
  return value as string[]
}

/** Whether a filesystem error means the path does not exist. */
export const absent = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR'

/**
 * Where `node` is declared, as a repository-relative source. A declaration
 * outside the repository (the compiler's own `lib.*.d.ts`, wherever TypeScript
 * is installed) has no repository path: `fallback`, the in-repository
 * declaration that brings it in (a class inheriting `Error`'s members), stands
 * in, or the evidence is omitted. Host paths never reach the extraction, and
 * the working tree and a commit give the same evidence.
 */
export function evidence(project: Project, node: ts.Node, fallback?: ts.Node): Evidence[] {
  const source = node.getSourceFile()
  const relative = slash(path.relative(project.root, native(source.fileName)))
  const external =
    relative === '..' ||
    relative.startsWith('../') ||
    path.isAbsolute(relative) ||
    native(path.dirname(source.fileName)) === project.libraries
  if (external) return fallback ? evidence(project, fallback) : []
  const position = source.getLineAndCharacterOfPosition(node.getStart(source))
  return [{kind: 'typescript', source: relative, location: {line: position.line + 1, column: position.character + 1}}]
}
