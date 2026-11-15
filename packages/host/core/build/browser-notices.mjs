import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {basename} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

// The licences a browser bundle that includes React ships with: Projections' own, then React's and any extra files.

/** The packages `browserNotices` always lists. */
export const browserNoticePackages = ['react', 'react-dom', 'scheduler']

/**
 * @param {string} importer
 * @param {readonly URL[]} additional
 */
export async function browserNotices(importer, additional = []) {
  const require = createRequire(importer)
  const reactDom = require.resolve('react-dom/package.json')
  const dependencies = [require.resolve('react/package.json'), reactDom, createRequire(reactDom).resolve('scheduler/package.json')]
  const notices = ['Projections\n\n', await readFile(new URL('../LICENSE', import.meta.url), 'utf8')]
  for (const path of dependencies) {
    const dependency = JSON.parse(await readFile(path, 'utf8'))
    notices.push(
      `\n===== ${dependency.name} ${dependency.version} =====\n`,
      await readFile(new URL('./LICENSE', pathToFileURL(path)), 'utf8'),
    )
  }
  for (const url of additional) {
    notices.push(`\n===== ${basename(fileURLToPath(url))} =====\n`, await readFile(url, 'utf8'))
  }
  return notices.join('')
}
