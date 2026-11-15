import {codeSpan, escapeProse, plainProse} from '@githubnext/projections-schemas'
import type {Entity} from '@githubnext/projections-schemas'
import {proseOf, text} from './model.js'
import type {Chip} from './model.js'

/** What a rule does, as prose: its actions in words, or its effect when it has none, and whether monitor mode elides it. */
export function effectProse(entity: Entity | undefined): string {
  if (!entity) return ''
  const data = entity.data ?? {}
  const actions = Array.isArray(data['actions']) ? (data['actions'] as {display?: unknown; action?: unknown}[]) : []
  const listed = actions
    .map(action => proseOf(action.display, text(action.action)))
    .filter(prose => prose && plainProse(prose) !== 'Observe')
  const effect = text(data['effect'])
  const words: Record<string, string> = {observe: 'Observe', track: 'Track', silent: 'Silent', respond: 'Respond', enforce: 'Enforce'}
  const result = listed.length ? listed.join(', ') : ((effect && words[effect]) ?? 'Unknown effect')
  return data['enforcement'] === 'elided' ? `${result} (elided in ${codeSpan('monitor')} mode)` : result
}

/** When a rule acts, as prose: each condition, or every call. */
export function conditionLines(entity: Entity | undefined): string[] {
  if (!entity) return []
  const conditions = entity.data?.['conditions']
  const lines = Array.isArray(conditions)
    ? conditions.map(condition => proseOf((condition as {display?: unknown}).display, undefined)).filter(Boolean)
    : []
  return lines.length ? lines : ['every call']
}

/** How a chip's relationship reads before its subject: `except`, `under`, `launched by`. */
export function chipPrefix(chip: Chip): string {
  if (chip.kind === 'applies-to') return chip.subject.entity.data?.['subjectKind'] === 'workloads' ? '' : 'in'
  const data = chip.data ?? {}
  const parent = data['parent'] === true
  const operator = text(data['operator']) ?? 'In'
  const relation = operator.startsWith('Not') ? 'except' : ''
  const match = operator.includes('Prefix') ? 'under' : operator.includes('Postfix') ? 'ending' : ''
  return [relation, parent ? 'launched by' : '', parent && match ? `binaries ${match}` : match].filter(Boolean).join(' ')
}

/** Warnings that hold for the presented revision, as prose: CRD violations and the extractor's findings. */
export function warnings(entity: Entity): string[] {
  const data = entity.data ?? {}
  const invalid = Array.isArray(data['invalid'])
    ? data['invalid']
        .filter((line): line is string => typeof line === 'string')
        .map(line => {
          const split = line.indexOf(': ')
          const [path, rest] = split > 0 ? [line.slice(0, split), line.slice(split + 2)] : ['', line]
          return `The repository's CRD rejects this policy: ${path ? `${codeSpan(path)} ` : ''}${escapeProse(rest)}`
        })
    : []
  const found = Array.isArray(data['findings'])
    ? data['findings'].map(finding => proseOf((finding as {message?: unknown}).message, undefined)).filter(Boolean)
    : []
  return [...invalid, ...found]
}

/** A hook's stability in words. */
export const stabilityText: Record<string, string> = {
  stable: 'stable interface',
  syscall: 'system call',
  'kernel-internal': 'kernel internal',
  user: 'user space',
  generated: 'generated at load',
}

export function hookSummary(entity: Entity): {type: string; stability: string | undefined} {
  return {type: text(entity.data?.['hookType']) ?? 'hook', stability: text(entity.data?.['stability'])}
}
