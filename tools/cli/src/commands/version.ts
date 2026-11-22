// `tools version`: the release version every shipped manifest carries (docs/maintainers/releasing.md). Without a
// version it checks them, against a release tag with --tag; with one it sets them all, then checks.
import {isVersion, readRelease, tagVersion, type VersionProblem} from '../lib/release.ts'
import {setReleaseVersion} from '../lib/release-bump.ts'
import {versionProblems} from '../lib/release-check.ts'
import {UsageError} from './work/change-set.ts'

export interface VersionReport {
  status: 'pass' | 'fail'
  version: string
  tag?: string
  released: {crates: number; workspaces: number}
  changed?: string[]
  problems: VersionProblem[]
  next: string[]
}

export function versionReport(root: string, options: {set?: string | undefined; tag?: string | undefined}): VersionReport {
  if (options.tag !== undefined && !tagVersion(options.tag)) throw new UsageError(`${options.tag} is not a release tag such as v0.1.0`)
  if (options.set !== undefined && !isVersion(options.set)) {
    throw new UsageError(`${options.set} is not a release version`, 'MAJOR.MINOR.PATCH, optionally with a prerelease: 0.2.0, 0.2.0-beta.1')
  }
  const changed = options.set === undefined ? undefined : setReleaseVersion(root, options.set)
  const {version, crates, workspaces} = readRelease(root)
  const problems = versionProblems(root, options.tag)
  const next = problems.length
    ? [`npm run tools -- version ${options.tag ? tagVersion(options.tag) : (version ?? '<version>')}  # sets every shipped manifest`]
    : changed?.length
      ? ['npm ci', 'cargo check --workspace --locked', 'git commit -am "Release <version>"']
      : []
  return {
    status: problems.length ? 'fail' : 'pass',
    version: version ?? 'none',
    ...(options.tag === undefined ? {} : {tag: options.tag}),
    released: {
      crates: crates.filter(crate => crate.released).length,
      workspaces: workspaces.filter(workspace => workspace.released).length,
    },
    ...(changed === undefined ? {} : {changed}),
    problems,
    next,
  }
}
