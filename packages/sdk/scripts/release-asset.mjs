// Packs @githubnext/projections as published (manifest.mjs) for the release proof job, which attaches it to the
// GitHub release beside the CLI's executables, with its own .sha256. Renderers depend on it by URL until npm
// publishing is approved (docs/contracts/packages.md).
//
//   node packages/sdk/scripts/release-asset.mjs OUTPUT
//
// Run `npm run build` in packages/sdk/ first. Writes OUTPUT/githubnext-projections-VERSION.tgz, its .sha256 and
// OUTPUT/asset-name (the file name, for the workflow).
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {packPublished} from './manifest.mjs'

const [output] = process.argv.slice(2)
if (!output) throw new Error('Usage: release-asset.mjs OUTPUT')
if (!existsSync(fileURLToPath(new URL('../dist/renderer.js', import.meta.url)))) throw new Error('Run npm run build in packages/sdk/ first')
const destination = resolve(output)
mkdirSync(destination, {recursive: true})
const npmCli = process.env.npm_execpath
const npm = (args, cwd) =>
  execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
const {filename} = packPublished(destination, npm)
const digest = createHash('sha256')
  .update(readFileSync(join(destination, filename)))
  .digest('hex')
writeFileSync(join(destination, `${filename}.sha256`), `${digest}  ${filename}\n`)
writeFileSync(join(destination, 'asset-name'), filename)
console.log(`${filename} (sha256 ${digest})`)
