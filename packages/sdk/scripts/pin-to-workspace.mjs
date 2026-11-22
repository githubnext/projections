// Pins a scaffolded package's dependencies to the versions a workspace installed (see check-pack.mjs).
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

/**
 * Pins the scaffold's registry dependencies to the versions this workspace's lockfile installed, so the check builds
 * with what CI already tested rather than whatever the registry newly lists for the scaffold's ranges (a release its
 * mirror hasn't caught up with fails the install: `ETARGET No matching version found`). A range the installed version
 * doesn't share a major version with is an error: the template and the workspace disagree. `workspace` is the
 * checkout whose node_modules hold the installed versions.
 */
export function pinToWorkspace(file, workspace) {
  const scaffold = JSON.parse(readFileSync(file, 'utf8'))
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(scaffold[field] ?? {})) {
      const installed = join(workspace, 'node_modules', name, 'package.json')
      if (!/^[\^~]?\d/.test(range) || !existsSync(installed)) continue
      const {version} = JSON.parse(readFileSync(installed, 'utf8'))
      if (version.split('.')[0] !== range.replace(/^[\^~]/, '').split('.')[0]) {
        throw new Error(`The scaffold asks for ${name}@${range}, but this workspace installs ${version}`)
      }
      scaffold[field][name] = version
    }
  }
  writeFileSync(file, `${JSON.stringify(scaffold, null, 2)}\n`)
}
