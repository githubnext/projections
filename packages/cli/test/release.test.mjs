import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {chmod, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import YAML from 'yaml'
import {majorTagMove} from '../../../tools/scripts/major-tag.mjs'
import {assetName, vsce} from '../../integrations/vscode/scripts/release-asset.mjs'

const read = file => readFile(new URL(`../../../${file}`, import.meta.url), 'utf8')
const workflow = async file => YAML.parse(await read(`.github/workflows/${file}`))
const lockfile = YAML.parse(await read('.github/workflows/actions.lock'))
/** Asserts a workflow runs an action at an exact release tag that the workflow dependency lockfile locks for it. */
function assertLocked(file, uses, message = uses) {
  assert.match(uses, /^[\w.-]+\/[\w./-]+@v\d+\.\d+\.\d+$/, message)
  const [action, ref] = uses.split('@')
  const key = `${action.split('/').slice(0, 2).join('/')}@${ref}`
  assert.ok(lockfile.workflows[`.github/workflows/${file}`]?.includes(key), `${message} is locked for ${file}`)
}
const assets = {
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-apple-darwin': 'darwin-amd64',
  'aarch64-unknown-linux-musl': 'linux-arm64',
  'x86_64-unknown-linux-musl': 'linux-amd64',
  'aarch64-pc-windows-msvc': 'windows-arm64',
  'x86_64-pc-windows-msvc': 'windows-amd64',
}
/** VS Code's target for each release target, whose executable its .vsix bundles. */
const vsceTargets = {
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-apple-darwin': 'darwin-x64',
  'aarch64-unknown-linux-musl': 'linux-arm64',
  'x86_64-unknown-linux-musl': 'linux-x64',
  'aarch64-pc-windows-msvc': 'win32-arm64',
  'x86_64-pc-windows-msvc': 'win32-x64',
}

/** The value of one top-level `[dist]` key, as single-line TOML source text. */
function setting(toml, key) {
  const section = toml.split(/^\[/m).find(part => part.startsWith('dist]'))
  const joined = section.replace(
    /\[\s*\n([^\]]*)\]/g,
    (_, items) =>
      `[${items
        .split('\n')
        .map(item => item.trim())
        .filter(Boolean)
        .join(' ')}]`,
  )
  return new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`, 'm').exec(joined)?.[1]
}

test('dist releases every target natively with attestations, no source tarball and no updater', async () => {
  const toml = await read('dist-workspace.toml')
  assert.equal(setting(toml, 'ci'), '"github"')
  assert.equal(setting(toml, 'packages'), '["projections-cli"]')
  assert.equal(setting(toml, 'source-tarball'), 'false', 'A source tarball would publish the whole repository')
  assert.equal(setting(toml, 'github-attestations'), 'true')
  assert.equal(setting(toml, 'github-release'), '"announce"')
  assert.equal(setting(toml, 'install-updater'), 'false')
  assert.equal(setting(toml, 'installers'), '["shell", "powershell"]')
  assert.equal(setting(toml, 'install-path'), '["$PROJECTIONS_INSTALL_DIR/", "~/.projections/bin"]')
  assert.match(setting(toml, 'cargo-dist-version'), /^"\d+\.\d+\.\d+"$/)
  const targets = [...setting(toml, 'targets').matchAll(/"([^"]+)"/g)].map(match => match[1])
  assert.deepEqual(targets.sort(), Object.keys(assets).sort())
  const runners = toml.split('[dist.github-custom-runners]')[1].split(/^\[/m)[0]
  for (const target of [...targets, 'global'])
    assert.match(runners, new RegExp(`^${target} = "[\\w.-]+"$`, 'm'), `${target} needs a runner`)
  const commits = toml.split('[dist.github-action-commits]')[1].split(/^\[/m)[0]
  for (const line of commits.trim().split('\n')) assert.match(line, /^"[\w/-]+" = "v\d+\.\d+\.\d+"$/, line)
  assert.equal(setting(toml, 'plan-jobs'), '["./release-inputs"]')
  assert.equal(setting(toml, 'global-artifacts-jobs'), '["./release-proof"]')
  assert.equal(setting(toml, 'publish-jobs'), '["./release-approval"]')
  // dist skips a publish job for a prerelease without it, and would announce the prerelease unapproved.
  assert.equal(setting(toml, 'publish-prereleases'), 'true')
  assert.equal(setting(toml, 'post-announce-jobs'), '["./publish-schemas", "./publish-npm", "./move-major-tag"]')
})

test('the generated workflow pins every action and announces only after every proof passes', async () => {
  const release = await workflow('release.yml')
  for (const [name, job] of Object.entries(release.jobs)) {
    if (job.uses)
      assert.match(
        job.uses,
        /^\$\/\.github\/workflows\/(release-inputs|release-proof|release-approval|publish-schemas|publish-npm|move-major-tag)\.yml$/,
        name,
      )
    for (const step of job.steps ?? []) if (step.uses) assertLocked('release.yml', step.uses, `${name}: ${step.uses}`)
  }
  assert.ok(release.jobs.host.needs.includes('custom-release-proof'))
  assert.match(release.jobs.host.if, /needs\.custom-release-proof\.result == 'success'/)
  // Announced only once a person approves the release.
  assert.deepEqual(release.jobs['custom-release-approval'].needs, ['plan', 'host'])
  assert.deepEqual(release.jobs.announce.needs, ['plan', 'host', 'custom-release-approval'])
  assert.match(release.jobs.announce.if, /needs\.custom-release-approval\.result == 'success'/)
  assert.deepEqual(release.jobs['custom-release-approval'].permissions, {actions: 'read', attestations: 'write', 'id-token': 'write'})
  assert.deepEqual(release.jobs['custom-release-proof'].permissions, {contents: 'read'})
  // dist attests the CLI archives as it builds them, so its build jobs' token is read-only.
  assert.deepEqual(release.jobs['build-local-artifacts'].permissions, {attestations: 'write', contents: 'read', 'id-token': 'write'})
  // The JSON Schemas and the npm package are published only once the release is announced.
  for (const job of ['custom-publish-schemas', 'custom-publish-npm']) {
    assert.deepEqual(release.jobs[job].needs, ['plan', 'announce'], job)
    assert.deepEqual(release.jobs[job].permissions, {contents: 'read', 'id-token': 'write'}, job)
  }
  // The major version tag moves after the release is announced, with a deploy key rather than the workflow's token.
  assert.deepEqual(release.jobs['custom-move-major-tag'].needs, ['plan', 'announce'])
  assert.deepEqual(release.jobs['custom-move-major-tag'].permissions, {contents: 'read'})
})

test('custom release jobs pin actions, use least privilege and name each executable for gh', async () => {
  const setup = YAML.parse(await read('.github/release-build-setup.yml'))
  // dist fails on unnamed build-setup steps.
  assert.ok(setup.every(step => step.name))
  for (const file of ['release-inputs.yml', 'release-proof.yml']) {
    const custom = await workflow(file)
    assert.deepEqual(custom.permissions, {})
    assert.deepEqual(Object.keys(custom.on), ['workflow_call'])
    for (const [name, job] of Object.entries(custom.jobs)) {
      const write = Object.entries(job.permissions)
        .filter(([, value]) => value === 'write')
        .map(([key]) => key)
        .sort()
      assert.deepEqual(write, [], `${file} ${name}`)
      for (const step of job.steps) {
        if (step.uses) assertLocked(file, step.uses, `${file}: ${step.uses}`)
        assert.equal(step.uses?.startsWith('actions/attest@') ?? false, false, 'attested only once the release is approved')
        if (step.run) assert.equal(step.run.includes('${{'), false, 'Expressions must enter through environment, not shell text')
        if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false)
      }
    }
  }
  const steps = (await workflow('release-proof.yml')).jobs.prove.steps
  const naming = steps.find(step => step.name === 'Extract the executable under its gh name').run
  for (const [target, id] of Object.entries(assets))
    assert.match(naming, new RegExp(`${target}\\) id=${id} vsce=${vsceTargets[target]} ;;`))
  assert.match(naming, /"gh-projections-\$id"/)
  assert.match(
    steps.find(step => step.name === 'Prove the installed binary').run,
    /cli\/test\/binary\.mjs --binary "release\/\$ASSET" --gh-extension/,
  )
  assert.equal(steps.at(-1).with.name, 'artifacts-gh-${{ env.ID }}', 'announce publishes every artifacts-* artifact')
  assert.deepEqual(steps.at(-1).with.path.trim().split('\n'), [
    'release/${{ env.ASSET }}',
    'release/${{ env.ASSET }}.sha256',
    'release/${{ env.VSIX }}',
    'release/${{ env.VSIX }}.sha256',
  ])
})

test('every native proof packages the VS Code extension with its executable and installs it with VS Code', async () => {
  const inputs = (await workflow('release-inputs.yml')).jobs.inputs.steps
  assert.ok(inputs.some(step => step.with?.name === 'vscode-extension' && step.with.path.trim() === 'packages/integrations/vscode/dist/'))
  const steps = (await workflow('release-proof.yml')).jobs.prove.steps
  assert.ok(steps.some(step => step.with?.name === 'vscode-extension' && step.with.path === 'packages/integrations/vscode/dist'))
  const run = steps.find(step => step.name === 'Package and install the VS Code extension').run
  assert.match(
    run,
    /node packages\/integrations\/vscode\/scripts\/release-asset\.mjs --target "\$VSCE_TARGET" --binary "release\/\$ASSET" --out vsix/,
  )
  const index = name => steps.findIndex(step => step.name === name || step.uses?.startsWith(name))
  assert.ok(index('Prove the installed binary') < index('Package and install the VS Code extension'))
  assert.equal(assetName('0.2.0', 'win32-arm64'), 'projections-vscode-0.2.0-win32-arm64.vsix')
  // The same vsce as npm run tools -- install, which packages development builds.
  assert.match(await read('tools/cli/src/commands/install.ts'), new RegExp(`VSCE = '${vsce.replaceAll('.', '\\.')}'`))
})

test("only a stable release that is its major version's newest moves the major version tag", async () => {
  const release = (tagName, isPrerelease = false, isDraft = false) => ({tagName, isPrerelease, isDraft})
  const releases = [release('v0.1.0'), release('v0.2.0'), release('v0.3.0-beta.1', true), release('v1.0.0'), release('v0.9.0', false, true)]
  assert.deepEqual(majorTagMove('v0.2.0', releases), {major: 'v0'}, 'v1.0.0 is another major version')
  assert.deepEqual(majorTagMove('v1.0.0', releases), {major: 'v1'}, 'created if missing')
  assert.match(majorTagMove('v0.1.0', releases).reason, /v0\.2\.0 is newer than v0\.1\.0, so v0 stays/, 'never backwards')
  assert.match(majorTagMove('v0.3.0-beta.1', releases).reason, /not a stable release tag/)
  assert.match(majorTagMove('v0.9.0', releases).reason, /not a published stable release/, 'a draft')
  const job = (await workflow('move-major-tag.yml')).jobs.move
  // The tag ruleset's only bypass is a deploy key, whose private half is a secret of the major-tag environment.
  assert.deepEqual(job.permissions, {contents: 'read'})
  assert.equal(job.environment, 'major-tag')
  const move = job.steps.find(step => step.name === 'Move the tag')
  assert.equal(move.run.includes('${{'), false, 'Expressions must enter through environment, not shell text')
  assert.equal(move.env.DEPLOY_KEY, '${{ secrets.MAJOR_TAG_DEPLOY_KEY }}')
  assert.match(move.run, /node tools\/scripts\/major-tag\.mjs "\$TAG"/)
  assert.match(move.run, /push -q --force "\$remote" "\$commit:refs\/tags\/\$major"/)
  assert.match(move.run, /remote="git@github\.com:\$REPOSITORY\.git"/)
  assert.match(move.run, /StrictHostKeyChecking=yes/)
  for (const step of job.steps) if (step.uses) assertLocked('move-major-tag.yml', step.uses)
})

test('every release attaches the package tarball, proved with the release CLI in a scaffolded renderer and without React', async () => {
  const {steps, permissions} = (await workflow('release-proof.yml')).jobs.package
  assert.deepEqual(permissions, {contents: 'read'})
  const run = name => steps.find(step => step.name === name)?.run ?? ''
  assert.ok(
    steps.some(step => step.with?.name === 'artifacts-build-local-x86_64-unknown-linux-musl'),
    'the release Linux executable',
  )
  assert.match(run('Check the version'), /announcement_tag/)
  assert.match(run('Build and pack the package'), /node packages\/sdk\/scripts\/release-asset\.mjs release\n/)
  const proof = 'Prove the tarball in a scaffolded renderer and a renderer without React'
  const prove = run(proof)
  assert.match(prove, /cli\/scripts\/release-asset\.mjs dist-archives x86_64-unknown-linux-musl projections cli-release/)
  // Outside packages/cli/dist and target/, so the CLI scaffolds as a release does: on its release's tarball URL.
  assert.match(
    prove,
    /PROJECTIONS_CLI="\$PWD\/cli-release\/projections" node packages\/sdk\/scripts\/check-pack\.mjs --tarball "release\/\$ASSET"/,
  )
  const upload = steps.at(-1)
  assert.equal(upload.with.name, 'artifacts-npm-package', 'announce publishes every artifacts-* artifact')
  assert.deepEqual(upload.with.path.trim().split('\n'), ['release/${{ env.ASSET }}', 'release/${{ env.ASSET }}.sha256'])
})

/** Runs the release approval's environment check against canned API replies: `{path: [status, body]}`. */
async function checkEnvironment(t, replies) {
  const run = (await workflow('release-approval.yml')).jobs.check.steps[0].run
  const directory = await mkdtemp(path.join(tmpdir(), 'projections-release-approval-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  await writeFile(path.join(directory, 'replies.json'), JSON.stringify(replies))
  // curl -sS --retry 3 -o FILE -w '%{http_code}' -H ... URL: writes the reply's body to FILE and prints its status.
  const curl = path.join(directory, 'curl')
  await writeFile(
    curl,
    `#!/usr/bin/env node
const {readFileSync, writeFileSync} = require('node:fs')
const args = process.argv.slice(2)
const url = new URL(args.at(-1))
const replies = JSON.parse(readFileSync(${JSON.stringify(path.join(directory, 'replies.json'))}, 'utf8'))
const [status, body] = replies[url.pathname + url.search] ?? [404, {message: 'Not Found'}]
writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(body))
process.stdout.write(String(status))
`,
  )
  await chmod(curl, 0o755)
  const result = spawnSync('bash', ['-c', run], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      GH_TOKEN: 'token',
      ENVIRONMENT: 'release',
      TAGS: 'v*.*.*',
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'githubnext/projections',
    },
  })
  return {code: result.status, output: result.stdout + result.stderr}
}

test('a release waits for a person to approve the release environment, which must be protected, and only then is attested', async t => {
  const {check, approve} = (await workflow('release-approval.yml')).jobs
  assert.deepEqual(check.permissions, {actions: 'read'})
  assert.deepEqual(check.steps[0].env, {GH_TOKEN: '${{ github.token }}', ENVIRONMENT: 'release', TAGS: 'v*.*.*'})
  assert.equal(approve.needs, 'check')
  assert.equal(approve.environment, 'release')
  assert.deepEqual(approve.permissions, {attestations: 'write', 'id-token': 'write'})
  for (const step of [...check.steps, ...approve.steps]) {
    if (step.uses) assertLocked('release-approval.yml', step.uses)
    if (step.run) assert.equal(step.run.includes('${{'), false, 'Expressions must enter through environment, not shell text')
  }
  // Every file announce attaches: every artifacts-* artifact but the granular manifests.
  assert.deepEqual(approve.steps[0].with, {pattern: 'artifacts-*', path: 'artifacts', 'merge-multiple': true})
  assert.match(approve.steps[1].run, /rm -f artifacts\/\*-dist-manifest\.json/)
  assert.ok(approve.steps[2].uses.startsWith('actions/attest@'))
  assert.equal(approve.steps[2].with['subject-path'], 'artifacts/*')

  const environment = '/repos/githubnext/projections/environments/release'
  const policies = `${environment}/deployment-branch-policies?per_page=100`
  const protectedEnvironment = {
    protection_rules: [{type: 'required_reviewers', reviewers: [{type: 'Team', reviewer: {slug: 'next'}}]}],
    deployment_branch_policy: {protected_branches: false, custom_branch_policies: true},
  }
  const tagsOnly = {total_count: 1, branch_policies: [{name: 'v*.*.*', type: 'tag'}]}
  const passed = await checkEnvironment(t, {[environment]: [200, protectedEnvironment], [policies]: [200, tagsOnly]})
  assert.equal(passed.code, 0, passed.output)
  assert.match(passed.output, /release requires a reviewer, and only v\*\.\*\.\* tags may deploy to it/)

  // Fails closed on anything else.
  for (const [why, replies, message] of [
    ['missing', {}, /doesn't exist/],
    ['unreadable', {[environment]: [403, {}]}, /Couldn't read the release environment \(HTTP 403\)/],
    [
      'no reviewers',
      {[environment]: [200, {...protectedEnvironment, protection_rules: []}], [policies]: [200, tagsOnly]},
      /no required reviewers/,
    ],
    [
      'any branch',
      {[environment]: [200, {...protectedEnvironment, deployment_branch_policy: null}], [policies]: [200, tagsOnly]},
      /doesn't limit deployments to selected tags/,
    ],
    [
      'a branch too',
      {
        [environment]: [200, protectedEnvironment],
        [policies]: [200, {total_count: 2, branch_policies: [...tagsOnly.branch_policies, {name: 'main', type: 'branch'}]}],
      },
      /but its deployment policies are/,
    ],
    [
      'another tag',
      {[environment]: [200, protectedEnvironment], [policies]: [200, {total_count: 1, branch_policies: [{name: 'v*', type: 'tag'}]}]},
      /but its deployment policies are/,
    ],
    [
      'no policies',
      {[environment]: [200, protectedEnvironment], [policies]: [200, {total_count: 0, branch_policies: []}]},
      /but its deployment policies are/,
    ],
    ['unreadable policies', {[environment]: [200, protectedEnvironment]}, /deployment policies \(HTTP 404\)/],
  ]) {
    const failed = await checkEnvironment(t, replies)
    assert.equal(failed.code, 1, `${why}: ${failed.output}`)
    assert.match(failed.output, message, why)
    assert.match(failed.output, /Nothing was published/, why)
  }
})
