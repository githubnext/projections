// What this machine has besides toolchains: available memory and the Playwright browsers installed.
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {freemem, homedir, totalmem} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {readJson} from './repo.ts'

/** Available memory in bytes. macOS's free memory excludes reclaimable inactive and purgeable pages; count them. */
export function availableMemory(): {available: number; total: number} {
  const total = totalmem()
  if (process.platform === 'darwin') {
    const vm = spawnSync('vm_stat', {encoding: 'utf8'}).stdout ?? ''
    const page = Number(/page size of (\d+) bytes/.exec(vm)?.[1] ?? 16384)
    const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0)
    const available = (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative') + pages('Pages purgeable')) * page
    if (available > 0) return {available, total}
  }
  if (process.platform === 'linux' && existsSync('/proc/meminfo')) {
    const kib = /MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1]
    if (kib) return {available: Number(kib) * 1024, total}
  }
  return {available: freemem(), total}
}

/** The Playwright browser revisions node_modules/playwright-core pins, and which are installed. */
export function playwrightBrowsers(root: string): {name: string; revision: string; installed: boolean}[] | undefined {
  const manifest = readJson<{browsers: {name: string; revision: string; installByDefault?: boolean}[]}>(
    root,
    'node_modules/playwright-core/browsers.json',
  )
  if (!manifest) return undefined
  const cache =
    process.env['PLAYWRIGHT_BROWSERS_PATH'] ??
    (process.platform === 'darwin'
      ? join(homedir(), 'Library/Caches/ms-playwright')
      : process.platform === 'win32'
        ? join(process.env['LOCALAPPDATA'] ?? homedir(), 'ms-playwright')
        : join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'ms-playwright'))
  const installed = existsSync(cache) ? readdirSync(cache) : []
  return manifest.browsers
    .filter(browser => ['chromium', 'webkit'].includes(browser.name))
    .map(browser => ({
      name: browser.name,
      revision: browser.revision,
      installed:
        installed.some(directory => directory === `${browser.name.replaceAll('-', '_')}-${browser.revision}`) &&
        statSync(join(cache, `${browser.name.replaceAll('-', '_')}-${browser.revision}`)).isDirectory(),
    }))
}

export function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
