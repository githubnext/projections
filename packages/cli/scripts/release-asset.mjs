// Extracts the executable from one dist archive and names it as a gh precompiled
// extension asset, with its own .sha256, for the release proof job.
//
//   node packages/cli/scripts/release-asset.mjs ARCHIVES TARGET NAME OUTPUT
//
// ARCHIVES holds dist's projections-cli-TARGET archive and its .sha256; NAME is the
// asset name without `.exe`. Writes OUTPUT/NAME[.exe], OUTPUT/NAME[.exe].sha256 and
// OUTPUT/asset-name (the file name, for the workflow).
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

const [archives, target, name, output] = process.argv.slice(2)
if (!output) throw new Error('Usage: release-asset.mjs ARCHIVES TARGET NAME OUTPUT')
const windows = target.includes('-windows-')
const archive = path.join(archives, `projections-cli-${target}${windows ? '.zip' : '.tar.xz'}`)
const sha256 = async file =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
const [expected] = (await readFile(`${archive}.sha256`, 'utf8')).trim().split(/\s+/u)
if ((await sha256(archive)) !== expected) throw new Error(`${archive} does not match its .sha256`)
const extracted = await mkdtemp(path.join(tmpdir(), 'projections-release-asset-'))
try {
  // Windows' own bsdtar reads zip archives; Git for Windows' GNU tar does not.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar'
  const result = spawnSync(tar, ['-xf', path.resolve(archive), '-C', extracted], {stdio: 'inherit'})
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${tar} exited with ${result.status}`)
  const executable = `projections${windows ? '.exe' : ''}`
  const found = (await readdir(extracted, {recursive: true})).filter(file => path.basename(file) === executable)
  if (found.length !== 1) throw new Error(`${archive} must contain exactly one ${executable}, found ${found.length}`)
  const asset = `${name}${windows ? '.exe' : ''}`
  await mkdir(output, {recursive: true})
  await copyFile(path.join(extracted, found[0]), path.join(output, asset))
  await chmod(path.join(output, asset), 0o755)
  await writeFile(path.join(output, `${asset}.sha256`), `${await sha256(path.join(output, asset))}  ${asset}\n`)
  await writeFile(path.join(output, 'asset-name'), asset)
  console.log(`${asset} from ${path.basename(archive)}`)
} finally {
  await rm(extracted, {recursive: true, force: true})
}
