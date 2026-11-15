// Node-side file access for the renderer's Vite plugins (vite.ts runs at build
// and serve time in Node, but its sources stay free of Node imports).
import {existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

/**
 * Records a running development server at `file` under `root`, and returns a
 * function that removes the record.
 */
export function recordDevServer(root, file, record) {
  const path = join(root, file)
  mkdirSync(dirname(path), {recursive: true})
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
  return () => rmSync(path, {force: true})
}

/** A file's text, for dependencies that import it with `?raw`. */
export function readText(path) {
  return readFileSync(path, 'utf8')
}

/**
 * `file` resolved from `root`, and whether it exists: a renderer's view or entry module. `/`-separated, and through
 * symbolic links as Vite identifies modules.
 */
export function resolveFile(root, file) {
  const path = resolve(root, file)
  const exists = existsSync(path)
  return {path: (exists ? realpathSync(path) : path).replace(/\\/g, '/'), exists}
}
