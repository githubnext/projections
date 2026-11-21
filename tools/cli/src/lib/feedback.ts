// Agent feedback as a GitHub issue: a draft built from what the agent was doing and the environment, redacted of
// absolute paths and anything resembling a credential. Nothing is filed without an explicit `--submit`.
import {release} from 'node:os'

export const FEEDBACK_LABEL = 'agent-feedback'
export const FEEDBACK_TEMPLATE = 'agent-feedback.yml'

export interface FeedbackInput {
  summary: string
  details?: string | undefined
  command?: string | undefined
  error?: string | undefined
}

export interface Environment {
  tools: string
  os: string
  node: string
  rust: string | undefined
  ref: string | undefined
}

export interface Draft {
  repository: string
  title: string
  body: string
  labels: string[]
  fields: Record<string, string>
  url: string
}

/** Credential-shaped substrings: GitHub, npm, Slack, AWS, OpenAI-style and JWT tokens, bearer headers, URL passwords and key=value secrets. */
const secrets: [RegExp, string][] = [
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted token]'],
  [/\bnpm_[A-Za-z0-9]{30,}\b/g, '[redacted token]'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, '[redacted token]'],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted key]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted jwt]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]'],
  [/\b(authorization:\s*(?:bearer|token|basic))\s+[^\s'"]+/gi, '$1 [redacted]'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, '$1 [redacted]'],
  [/(\w+:\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1[redacted]@'],
  [
    /\b((?:[A-Za-z_][\w-]*?)?(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credentials?))(\s*[=:]\s*)(['"]?)[^\s'"]{6,}\3/gi,
    '$1$2$3[redacted]$3',
  ],
]

/** Rewrites absolute paths inside the repository to repository-relative ones, and home directories to `~`. */
export function redactPaths(text: string, root: string, home: string): string {
  let redacted = text
  const variants = (path: string) => [path, path.replaceAll('\\', '/'), `file://${path.replaceAll('\\', '/')}`]
  for (const prefix of variants(root).sort((a, b) => b.length - a.length)) {
    if (!prefix) continue
    redacted = redacted.split(`${prefix}/`).join('').split(`${prefix}\\`).join('').split(prefix).join('.')
  }
  if (home && home.length > 1) {
    for (const prefix of variants(home)) redacted = redacted.split(prefix).join('~')
  }
  // Other users' home directories (another checkout in a log line, for example).
  return redacted.replace(/(\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^/\\\s'"]+/g, '~')
}

export function redactSecrets(text: string): string {
  return secrets.reduce((redacted, [pattern, replacement]) => redacted.replace(pattern, replacement), text)
}

export function redact(text: string, root: string, home: string): string {
  return redactSecrets(redactPaths(text, root, home))
}

/** `owner/name` from a package.json `repository` (string or object) or a git remote URL. */
export function repositorySlug(value: string | {url?: string} | undefined): string | undefined {
  const url = typeof value === 'string' ? value : value?.url
  if (!url) return undefined
  const match = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url) ?? /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(url)
  return match ? `${match[1]}/${match[2]}` : undefined
}

export function environmentText(environment: Environment): string {
  return [
    `- tools: ${environment.tools}`,
    `- OS: ${environment.os}`,
    `- Node: ${environment.node}`,
    `- Rust: ${environment.rust ?? 'not installed'}`,
    `- Git ref: ${environment.ref ?? 'unknown'}`,
  ].join('\n')
}

export function currentOs(): string {
  return `${process.platform} ${release()} (${process.arch})`
}

const MAX_FIELD = 1800

function bounded(text: string): string {
  return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD)}\n… (${text.length - MAX_FIELD} more characters)` : text
}

/**
 * The issue draft. Its body uses the issue form's labels as headings, so an issue filed with `gh` reads like one filed
 * through the form, and the form's fields are prefilled from `fields` in the URL.
 */
export function buildDraft(
  input: FeedbackInput,
  environment: Environment,
  options: {repository: string; root: string; home: string},
): Draft {
  const clean = (text: string | undefined) => (text?.trim() ? bounded(redact(text.trim(), options.root, options.home)) : undefined)
  const summary = clean(input.summary)?.replace(/\s+/g, ' ') ?? 'Agent feedback'
  const title = `[agent feedback] ${summary.length > 90 ? `${summary.slice(0, 89)}…` : summary}`
  const fields: Record<string, string> = {
    summary,
    details: clean(input.details) ?? '',
    command: clean(input.command) ?? '',
    error: clean(input.error) ?? '',
    environment: environmentText(environment),
  }
  const section = (heading: string, text: string, fence?: string) =>
    `### ${heading}\n\n${text ? (fence !== undefined ? `\`\`\`${fence}\n${text}\n\`\`\`` : text) : '_No response_'}`
  const body = [
    section('What were you trying to do?', fields.summary!),
    section('Details', fields.details!),
    section('Command and inputs', fields.command!, 'sh'),
    section('Error', fields.error!, 'text'),
    section('Environment', fields.environment!),
    '<sub>Drafted by `tools feedback`; absolute paths and credential-like strings were redacted.</sub>',
  ].join('\n\n')
  const params = new URLSearchParams({template: FEEDBACK_TEMPLATE, title, labels: FEEDBACK_LABEL})
  for (const [key, value] of Object.entries(fields)) if (value) params.set(key, value)
  return {
    repository: options.repository,
    title,
    body,
    labels: [FEEDBACK_LABEL],
    fields,
    url: `https://github.com/${options.repository}/issues/new?${params}`,
  }
}

/** Word overlap between two titles (Jaccard over words longer than two characters), for finding duplicates. */
export function similarity(a: string, b: string): number {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/\[agent feedback\]/g, '')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(word => word.length > 2),
    )
  const left = words(a)
  const right = words(b)
  if (!left.size || !right.size) return 0
  const shared = [...left].filter(word => right.has(word)).length
  return shared / (left.size + right.size - shared)
}
