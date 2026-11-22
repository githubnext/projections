// The pure parts of `tools link`: finding a Projections checkout, its pinned Node, and the `projections-tools`
// launcher script written onto PATH. Light (Node built-ins and lib/install.ts): src/launch.ts runs it on every call.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join} from 'node:path'
import {canonical} from './install.ts'

export const LINK_NAME = 'projections-tools'
/** In every launcher this writes; a file at the link's path without it is someone else's and is never replaced. */
export const MARKER = 'projections-tools: written by tools link'
const PACKAGE_NAME = '@githubnext/projections-tools'

export type Platform = NodeJS.Platform
/** What the launcher and node discovery depend on, injectable for tests. */
export interface Host {
  platform: Platform
  env: NodeJS.ProcessEnv
  home: string
  execPath: string
  version: string
}

export function currentHost(): Host {
  return {platform: process.platform, env: process.env, home: homedir(), execPath: process.execPath, version: process.version}
}

export function linkFileName(platform: Platform = process.platform): string {
  return platform === 'win32' ? `${LINK_NAME}.cmd` : LINK_NAME
}

/** Whether `directory` is a Projections workspace root: it holds this tools package. */
export function isCheckout(directory: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'tools/cli/package.json'), 'utf8')) as {name?: string}
    return manifest.name === PACKAGE_NAME && existsSync(join(directory, 'tools/cli/src/bin.ts'))
  } catch {
    return false
  }
}

/**
 * The Projections checkout `from` is in: the nearest directory upwards that is a workspace root. A Git repository root
 * that isn't one may hold the workspace one directory down (a repository that embeds it); the first such, by name.
 */
export function findCheckout(from: string): string | undefined {
  let directory = canonical(from)
  for (;;) {
    if (isCheckout(directory)) return directory
    if (existsSync(join(directory, '.git'))) {
      const embedded = childDirectories(directory).find(isCheckout)
      if (embedded) return embedded
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

function childDirectories(directory: string): string[] {
  try {
    return readdirSync(directory, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map(entry => join(directory, entry.name))
      .toSorted()
  } catch {
    return []
  }
}

/** The Node version a checkout pins in `.node-version`, without a leading `v`. */
export function pinnedNode(root: string): string | undefined {
  try {
    return readFileSync(join(root, '.node-version'), 'utf8').trim().replace(/^v/, '') || undefined
  } catch {
    return undefined
  }
}

/** Where version managers keep Node `version`: nvm, fnm, Volta, asdf, mise and n (nvm-windows, fnm, Volta on Windows). */
export function nodeCandidates(version: string, host: Pick<Host, 'platform' | 'env' | 'home'>): string[] {
  const {env, home} = host
  if (host.platform === 'win32') {
    const appData = env.APPDATA ?? join(home, 'AppData/Roaming')
    const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData/Local')
    return [
      ...(env.NVM_HOME ? [join(env.NVM_HOME, `v${version}`, 'node.exe')] : []),
      join(env.FNM_DIR ?? join(appData, 'fnm'), 'node-versions', `v${version}`, 'installation', 'node.exe'),
      join(env.VOLTA_HOME ?? join(localAppData, 'Volta'), 'tools/image/node', version, 'node.exe'),
    ]
  }
  const fnm = env.FNM_DIR
    ? [env.FNM_DIR]
    : [join(home, '.local/share/fnm'), join(home, 'Library/Application Support/fnm'), join(home, '.fnm')]
  return [
    join(env.NVM_DIR ?? join(home, '.nvm'), 'versions/node', `v${version}`, 'bin/node'),
    ...fnm.map(directory => join(directory, 'node-versions', `v${version}`, 'installation/bin/node')),
    join(env.VOLTA_HOME ?? join(home, '.volta'), 'tools/image/node', version, 'bin/node'),
    join(env.ASDF_DATA_DIR ?? join(home, '.asdf'), 'installs/nodejs', version, 'bin/node'),
    join(env.MISE_DATA_DIR ?? join(home, '.local/share/mise'), 'installs/node', version, 'bin/node'),
    join(env.N_PREFIX ?? '/usr/local', 'n/versions/node', version, 'bin/node'),
  ]
}

export interface NodeChoice {
  path: string
  version: string
  pinned: string | undefined
  matched: boolean
}

/** The Node to run a checkout's tools with: its pinned version when this one is it or a version manager has it, else this one. */
export function findNode(root: string, host: Host = currentHost(), exists: (path: string) => boolean = existsSync): NodeChoice {
  const pinned = pinnedNode(root)
  const current = {path: host.execPath, version: host.version.replace(/^v/, ''), pinned, matched: pinned === undefined}
  if (pinned === undefined || current.version === pinned) return {...current, matched: true}
  const found = nodeCandidates(pinned, host).find(exists)
  return found ? {path: found, version: pinned, pinned, matched: true} : current
}

/** A shell word: single-quoted, with embedded single quotes closed, escaped and reopened. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export interface Launcher {
  checkout: string
  node: string
}

/**
 * The `projections-tools` launcher: runs the linked checkout's src/launch.ts with the recorded Node (or `node` on
 * PATH once that is gone), which picks the checkout to run (see launch.ts). A POSIX shell script, or a `.cmd` shim.
 * `path` is where it is written: it passes its own absolute path on, the stable command for MCP and `next` hints.
 */
export function launcherText(path: string, launcher: Launcher, platform: Platform = process.platform): string {
  const message = 'projections-tools: the linked checkout is gone (moved or deleted); run `npm run tools -- link` in a checkout'
  if (platform === 'win32') {
    return [
      '@echo off',
      `rem ${MARKER}; projections-tools unlink removes it`,
      'setlocal',
      `set "checkout=${launcher.checkout}"`,
      `set "node=${launcher.node}"`,
      'if exist "%checkout%\\tools\\cli\\src\\launch.ts" goto run',
      `echo ${message.replace(/\x60/g, '')}: "%checkout%" 1>&2`,
      'exit /b 3',
      ':run',
      'if not exist "%node%" set "node=node"',
      'set "PROJECTIONS_TOOLS_BIN=%~f0"',
      '"%node%" "%checkout%\\tools\\cli\\src\\launch.ts" %*',
      '',
    ].join('\r\n')
  }
  return [
    '#!/bin/sh',
    `# ${MARKER}; \`projections-tools unlink\` removes it`,
    `checkout=${shellQuote(launcher.checkout)}`,
    `node=${shellQuote(launcher.node)}`,
    'if [ ! -f "$checkout/tools/cli/src/launch.ts" ]; then',
    `  printf '%s: %s\\n' ${shellQuote(message)} "$checkout" >&2`,
    '  exit 3',
    'fi',
    '[ -x "$node" ] || node=node',
    `PROJECTIONS_TOOLS_BIN=${shellQuote(path)} exec "$node" "$checkout/tools/cli/src/launch.ts" "$@"`,
    '',
  ].join('\n')
}

/** What a file at the link's path is: absent, someone else's, or a launcher with what it records. */
export function readLauncher(text: string | undefined): {kind: 'absent'} | {kind: 'foreign'} | ({kind: 'launcher'} & Launcher) {
  if (text === undefined) return {kind: 'absent'}
  if (!text.includes(MARKER)) return {kind: 'foreign'}
  const value = (name: string) => {
    const posix = new RegExp(`^${name}=('(?:[^']|'\\\\'')*')$`, 'm').exec(text)?.[1]
    if (posix) return posix.slice(1, -1).replace(/'\\''/g, "'")
    return new RegExp(`^set "${name}=(.*)"\\r?$`, 'm').exec(text)?.[1] ?? ''
  }
  return {kind: 'launcher', checkout: value('checkout'), node: value('node')}
}
