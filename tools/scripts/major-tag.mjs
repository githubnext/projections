// Whether a release moves its major version's tag (`v0` for v0.3.1), which `uses: githubnext/projections@v0` follows:
// only a stable release does, and only when it is that major version's newest stable release, so the tag never moves
// backwards (a rerun of an older release leaves it) and never to a prerelease. move-major-tag.yml runs this, then
// creates or moves the tag.
//
//   node tools/scripts/major-tag.mjs TAG < releases.json
//
// releases.json is `gh release list --json tagName,isDraft,isPrerelease`. Prints the major tag to move, or nothing
// (with the reason on standard error).
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {newestInMajor} from '../../packages/integrations/github-action/src/release.mjs'

/** `{major}` when the release `tag` moves `major`'s tag to itself, else `{reason}` it doesn't. */
export function majorTagMove(tag, releases) {
  const stable = /^v(\d+)\.\d+\.\d+$/.exec(tag)
  if (!stable) return {reason: `${tag} is not a stable release tag such as v0.1.0, so no major version tag moves`}
  const major = `v${stable[1]}`
  if (!releases.some(release => release.tagName === tag && !release.isDraft && !release.isPrerelease))
    return {reason: `${tag} is not a published stable release`}
  const newest = newestInMajor(releases, major)
  if (newest !== tag) return {reason: `${newest} is newer than ${tag}, so ${major} stays where it is`}
  return {major}
}

// Run as a script, not imported.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag] = process.argv.slice(2)
  if (!tag) throw new Error('Usage: major-tag.mjs TAG < releases.json')
  const result = majorTagMove(tag, JSON.parse(readFileSync(0, 'utf8')))
  if (result.major) console.log(result.major)
  else console.error(result.reason)
}
