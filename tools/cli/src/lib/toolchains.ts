// Toolchains: what the repository requires (package.json engines, .node-version, rust-toolchain.toml, global.json and
// the optional native toolchains the CI check action installs) against what is installed.
import {probe, readJson, readText} from './repo.ts'
import {compareVersions, satisfies, versionIn} from './versions.ts'

export type Status = 'ok' | 'warn' | 'fail'

export interface Toolchain {
  name: string
  required: string | undefined
  installed: string | undefined
  status: Status
  source: string
  optional: boolean
}

/** `channel = "1.97.1"` and the components and targets of rust-toolchain.toml. */
export function rustToolchainFile(root: string): {channel: string; targets: string[]} | undefined {
  const text = readText(root, 'rust-toolchain.toml')
  const channel = text && /^channel\s*=\s*"([^"]+)"/mu.exec(text)?.[1]
  if (!text || !channel) return undefined
  const targets = [...(/targets\s*=\s*\[([^\]]*)\]/u.exec(text)?.[1]?.matchAll(/"([^"]+)"/gu) ?? [])].map(match => match[1]!)
  return {channel, targets}
}

/** Installed rustup toolchains (names such as `1.97.1-aarch64-apple-darwin`), or undefined without rustup. */
export function rustupToolchains(root: string): string[] | undefined {
  const list = probe(root, ['rustup', 'toolchain', 'list'])
  return list === undefined ? undefined : list.split('\n').map(line => line.split(' ')[0]!)
}

/** The toolchains this repository uses, required versus installed. */
export function toolchains(root: string, options: {optional?: boolean} = {}): Toolchain[] {
  const found: Toolchain[] = []
  const engines = readJson<{engines?: {node?: string}}>(root, 'package.json')?.engines?.node
  const pinned = readText(root, '.node-version')?.trim()
  const node = process.versions.node
  const nodeOk = (!engines || satisfies(node, engines)) && (!pinned || satisfies(node, `>=${pinned}`))
  found.push({
    name: 'node',
    required: [engines, pinned && `.node-version ${pinned}`].filter(Boolean).join(', ') || undefined,
    installed: node,
    status: nodeOk ? 'ok' : 'fail',
    source: 'package.json engines, .node-version',
    optional: false,
  })
  const rust = rustToolchainFile(root)
  if (rust) {
    const installed = rustupToolchains(root)
    const has = installed?.some(name => name === rust.channel || name.startsWith(`${rust.channel}-`))
    const rustc = versionIn(probe(root, ['rustc', '--version']))
    let targetsMissing: string[] = []
    if (has) {
      const targets = probe(root, ['rustup', 'target', 'list', '--installed', '--toolchain', rust.channel])?.split('\n') ?? []
      targetsMissing = rust.targets.filter(target => !targets.includes(target))
    }
    found.push({
      name: 'rust',
      required: `${rust.channel}${rust.targets.length ? ` + ${rust.targets.join(', ')}` : ''}`,
      installed:
        installed === undefined
          ? (rustc ?? undefined)
          : has
            ? `${rust.channel}${targetsMissing.length ? ` (missing ${targetsMissing.join(', ')})` : ''}`
            : rustc,
      status: has && !targetsMissing.length ? 'ok' : 'fail',
      source: 'rust-toolchain.toml',
      optional: false,
    })
  }
  const globalJson = readJson<{sdk?: {version?: string}}>(root, 'global.json')
  if (globalJson?.sdk?.version) {
    const installed = versionIn(probe(root, ['dotnet', '--version']))
    found.push({
      name: 'dotnet',
      required: globalJson.sdk.version,
      installed,
      status: installed && satisfies(installed, `>=${globalJson.sdk.version}`) ? 'ok' : 'fail',
      source: 'global.json',
      optional: false,
    })
  }
  if (options.optional) found.push(...optionalToolchains(root, globalJson?.sdk?.version !== undefined))
  return found
}

/** The native extractor suites' toolchains, as the CI check action installs them; missing ones only warn. */
export function optionalToolchains(root: string, skipDotnet = false): Toolchain[] {
  const action = readText(root, '.github/actions/check/action.yml') ?? ''
  const pin = (key: string) => new RegExp(`${key}:\\s*['"]?([^'"\\s]+)`).exec(action)?.[1]
  const tools: [string, string | undefined, string[]][] = [
    ['dotnet', pin('dotnet-version'), ['dotnet', '--version']],
    ['python', pin('python-version'), ['python3', '--version']],
    ['go', pin('go-version'), ['go', 'version']],
    ['java', pin('java-version'), ['java', '-version']],
    ['terraform', pin('terraform_version'), ['terraform', 'version']],
  ]
  return tools
    .filter(([name, required]) => !!required && !(skipDotnet && name === 'dotnet'))
    .map(([name, required, argv]) => {
      const installed = versionIn(probe(root, argv))
      const wanted = required!.replace(/\.x$/u, '')
      return {
        name,
        required,
        installed,
        status: installed && (installed.startsWith(wanted) || compareVersions(installed, wanted) >= 0) ? 'ok' : 'warn',
        source: '.github/actions/check/action.yml (native extractor suites)',
        optional: true,
      } satisfies Toolchain
    })
}

/** The pinned nightly the reference docs' Rust SDK pages need, and whether it is installed. */
export function nightly(root: string): {name: string | undefined; installed: boolean} {
  const name = probe(root, ['node', 'tools/scripts/reference-docs.mjs', '--nightly'])?.split('\n').pop()
  const installed = name ? (rustupToolchains(root)?.some(toolchain => toolchain.startsWith(name)) ?? false) : false
  return {name, installed}
}
