// Import cycles between a workspace's own source modules.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import type {Unit} from '../packages.ts'
import {walk} from '../repo.ts'
import {importsOf, resolveRelative, skipped, sources} from './syntax.ts'

/** Strongly connected groups of more than one module (or a module importing itself), each sorted, largest first. */
export function cycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  let index = 0
  const indexes = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const groups: string[][] = []
  const connect = (node: string) => {
    indexes.set(node, index)
    low.set(node, index++)
    stack.push(node)
    onStack.add(node)
    for (const next of graph.get(node) ?? []) {
      if (!indexes.has(next)) {
        connect(next)
        low.set(node, Math.min(low.get(node)!, low.get(next)!))
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, indexes.get(next)!))
    }
    if (low.get(node) === indexes.get(node)) {
      const group: string[] = []
      let member: string
      do {
        member = stack.pop()!
        onStack.delete(member)
        group.push(member)
      } while (member !== node)
      if (group.length > 1 || graph.get(node)?.includes(node)) groups.push(group.toSorted())
    }
  }
  for (const node of [...graph.keys()].toSorted()) if (!indexes.has(node)) connect(node)
  return groups.toSorted((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!))
}

/** A workspace's own source modules (not tests, specs, fixtures or build output). */
function sourceModules(root: string, unit: Unit): string[] {
  return walk(root, unit.path, path => !skipped.test(path)).filter(
    path =>
      sources.test(path) &&
      `/${path.slice(unit.path.length + 1)}`.includes('/src/') &&
      !/\.(?:test|spec)\./.test(path) &&
      !path.endsWith('.d.ts'),
  )
}

/** Import cycles among a workspace's own source modules, through imports that exist at run time. */
export function workspaceCycles(root: string, unit: Unit): string[][] {
  const modules = sourceModules(root, unit)
  const graph = new Map<string, string[]>()
  for (const path of modules) {
    const targets = importsOf(path, readFileSync(join(root, path), 'utf8'))
      .filter(item => item.specifier.startsWith('.') && !item.typeOnly)
      .map(item => resolveRelative(root, path, item.specifier))
      .filter((target): target is string => target !== undefined && modules.includes(target))
    graph.set(path, [...new Set(targets)])
  }
  return cycles(graph)
}
