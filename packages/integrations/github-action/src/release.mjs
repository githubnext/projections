// Which CLI release the Action installs, and how it checks the download. No dependencies; Node 20 or later.

/** The release asset for a runner, following GitHub CLI's precompiled extension names. */
export function releaseAsset(runnerOs, runnerArch) {
  const os = {Linux: 'linux', macOS: 'darwin', Windows: 'windows'}[runnerOs]
  const arch = {X64: 'amd64', ARM64: 'arm64'}[runnerArch]
  if (!os || !arch) throw new Error(`Projections publishes no CLI for ${runnerOs} ${runnerArch}. Set build-from-source: true to build it.`)
  return `gh-projections-${os}-${arch}${os === 'windows' ? '.exe' : ''}`
}

const versionTag = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const majorTag = /^v\d+$/

/**
 * The release tag to install: an explicit version, the action's own version tag, or the latest release (`undefined`).
 * A major tag such as `v0` (`uses: githubnext/projections@v0`, or `version: v0`) is returned as it is, for
 * `newestInMajor` to resolve to that major version's newest stable release, never a later major's.
 */
export function releaseTag(version, actionRef) {
  const explicit = (version ?? '').trim()
  if (explicit && explicit !== 'latest') {
    const tag = explicit.startsWith('v') ? explicit : `v${explicit}`
    if (!versionTag.test(tag) && !majorTag.test(tag)) {
      throw new Error(`version must be latest, a major version such as v0 or a release tag such as v0.1.0, not ${explicit}`)
    }
    return tag
  }
  if (!explicit && (versionTag.test(actionRef ?? '') || majorTag.test(actionRef ?? ''))) return actionRef
  return undefined
}

/** Whether `tag` is a major version tag, such as `v0`, that `newestInMajor` resolves. */
export const isMajorTag = tag => majorTag.test(tag ?? '')

/**
 * The newest stable release of the major version `major` (such as `v0`) among `releases`, as `gh release list --json
 * tagName,isDraft,isPrerelease` lists them: `v0.3.1` rather than `v0.10.0-beta.1` or `v1.0.0`.
 */
export function newestInMajor(releases, major) {
  const wanted = Number(major.slice(1))
  const stable = releases
    .filter(release => !release.isDraft && !release.isPrerelease)
    .map(release => ({
      tag: release.tagName,
      parts: /^v(\d+)\.(\d+)\.(\d+)$/
        .exec(release.tagName ?? '')
        ?.slice(1)
        .map(Number),
    }))
    .filter(release => release.parts?.[0] === wanted)
    .sort((a, b) => b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2])
  if (!stable.length) throw new Error(`No stable ${major}.x.y release to install`)
  return stable[0].tag
}

/** The expected digest of `asset` in a `sha256sum`-format checksum file, such as the release's `<asset>.sha256`. */
export function expectedDigest(sums, asset) {
  const matches = sums
    .split(/\r?\n/)
    .map(line => /^([0-9a-f]{64}) [ *]?(.+)$/.exec(line.trim()))
    .filter(match => match?.[2] === asset)
  if (matches.length !== 1) throw new Error(`The checksum file must list ${asset} exactly once`)
  return matches[0][1]
}
