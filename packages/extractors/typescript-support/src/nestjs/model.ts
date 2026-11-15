import {existsSync} from 'node:fs'
import path from 'node:path'
import type {Json} from '../types.js'
import type {ExtractorContext} from '../shared.js'

/** The oldest `@nestjs/core` with preview mode and the serialized graph. */
export const MINIMUM_NEST: [number, number] = [9, 3]
export const SCOPES = ['DEFAULT', 'TRANSIENT', 'REQUEST'] as const
export const sourceFile = /\.(?:ts|tsx|mts|cts)$/

export type Token = unknown
export interface Wrapper {
  id: string
  name?: string
  token: Token
  metatype?: ((...args: unknown[]) => unknown) | null
  inject?: unknown[] | null
  instance?: unknown
  scope?: number
  durable?: boolean
  isAlias?: boolean
  isDependencyTreeStatic(): boolean
}
export interface NestModule {
  id: string
  name: string
  metatype: unknown
  isGlobal?: boolean
  providers: Map<Token, Wrapper>
  controllers: Map<Token, Wrapper>
  imports: Set<NestModule>
  exports: Set<Token>
}
interface GraphEdge {
  source: string
  target: string
  metadata: {type: string; injectionType?: string; keyOrIndex?: string | number | symbol}
}
export interface Graph {
  status?: string
  edges: Record<string, GraphEdge>
  metadata?: unknown
}
export interface SerializedGraph {
  toJSON(): Graph
}
export interface Dependency {
  injection: 'constructor' | 'property' | 'factory'
  keyOrIndex: string | number
  token: Token
  optional: boolean
  parameter?: string
}
export interface Registration {
  module: NestModule
  moduleKey: string
  wrapper: Wrapper
  role: 'provider' | 'controller'
  service: string
  registration: string
  implementation?: string
  application: boolean
}

export const slash = (value: string): string => value.split(path.sep).join('/')
export const within = (root: string, file: string): boolean => {
  const relative = path.relative(root, file)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
export const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
export const getMetadata = (key: string, target: unknown): unknown =>
  (Reflect as unknown as {getMetadata?: (key: string, target: unknown) => unknown}).getMetadata?.(key, target)

function inputs(context: ExtractorContext): Record<string, Json> {
  return context.input.projection.definition.inputs ?? {}
}

export function optionalString(context: ExtractorContext, key: string): string | undefined {
  const value = inputs(context)[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new Error(`inputs.${key} must be a nonempty string`)
  return value
}

export function nearest(root: string, start: string, name: string): string | undefined {
  for (let directory = start; within(root, directory); directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, name))) return path.join(directory, name)
    if (directory === root) break
  }
  return undefined
}
