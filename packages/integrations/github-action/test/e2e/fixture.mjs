// The Action's end-to-end check (the windows-integration job in .github/workflows/ci.yml): makes a small repository
// with a pull request, whose projections are extracted by a Python extractor run as `python3` (a Windows machine names
// it python or py) and a Node one, and the event file the Action reads in place of the workflow's own
// (PROJECTIONS_TEST_EVENT_PATH). Its checkout has CRLF line endings, as a Windows checkout usually does.
//
//   node packages/integrations/github-action/test/e2e/fixture.mjs DIRECTORY
//
// Writes `repository` and `event` to GITHUB_OUTPUT (and prints them); verify.mjs checks what the Action produced.
import {execFileSync} from 'node:child_process'
import {appendFileSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'

const directory = path.resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Usage: fixture.mjs DIRECTORY')
const repository = path.join(directory, 'repository')
rmSync(directory, {recursive: true, force: true})
mkdirSync(repository, {recursive: true})

const git = (...args) => execFileSync('git', args, {cwd: repository, encoding: 'utf8'}).trim()
const write = (file, text) => {
  mkdirSync(path.dirname(path.join(repository, file)), {recursive: true})
  writeFileSync(path.join(repository, file), text)
}
git('init', '--quiet', '--initial-branch=main')
for (const [name, value] of [
  ['user.name', 'Projections fixture'],
  ['user.email', 'fixture@example.invalid'],
  ['commit.gpgsign', 'false'],
  ['core.autocrlf', 'true'],
]) {
  git('config', name, value)
}

write(
  '.github/projections/teams.json',
  JSON.stringify({
    id: 'teams',
    title: 'Teams',
    renderer: 'graph',
    extractor: {command: ['python3', '.github/projections/teams/extract.py'], sources: ['.github/projections/teams/extract.py']},
    execution: {scope: ['teams.txt']},
  }),
)
write(
  '.github/projections/teams/extract.py',
  `from pathlib import Path

from projections import request, result

names = sorted((Path(request.root) / "teams.txt").read_text().split())
result(
    entities={f"team:{name}": {"kind": "team", "label": name} for name in names},
    relationships=[
        {"id": f"next:{a}", "kind": "next", "from": f"team:{a}", "to": f"team:{b}"} for a, b in zip(names, names[1:])
    ],
)
`,
)
write(
  '.github/projections/services.json',
  JSON.stringify({
    id: 'services',
    title: 'Services',
    renderer: 'graph',
    extractor: {command: ['node', '.github/projections/services/extract.mjs'], sources: ['.github/projections/services/extract.mjs']},
    execution: {scope: ['services.txt']},
  }),
)
write(
  '.github/projections/services/extract.mjs',
  `import {readFileSync} from 'node:fs'
import {join} from 'node:path'

const request = JSON.parse(readFileSync(0, 'utf8'))
const names = readFileSync(join(request.repository.root, 'services.txt'), 'utf8').split(/\\r?\\n/).filter(Boolean).sort()
const entities = names.map(name => ({id: \`service:\${name}\`, kind: 'service', label: name}))
process.stdout.write(JSON.stringify({protocolVersion: 0, schema: 'graph/v0', entities, relationships: []}))
`,
)
write('teams.txt', 'mu\nalpha\n')
write('services.txt', 'orders\npayments\n')
git('add', '.')
git('commit', '--quiet', '-m', 'Base')
const base = git('rev-parse', 'HEAD')

git('switch', '--quiet', '-c', 'change')
write('teams.txt', 'mu\nalpha\nzeta\n')
write('services.txt', 'orders\n')
git('commit', '--quiet', '-am', 'Add zeta; retire payments')
const head = git('rev-parse', 'HEAD')

const event = path.join(directory, 'event.json')
writeFileSync(event, JSON.stringify({pull_request: {number: 1, base: {sha: base}, head: {sha: head}}}))
for (const [name, value] of Object.entries({repository, event})) {
  console.log(`${name}=${value}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}
