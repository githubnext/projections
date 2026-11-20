// Regenerates the Prisma and Django database fixtures from the small projects beside this script:
// `prisma-shop/{before,after}` and `prisma-licensing/{before,after}` (Prisma schemas, the second with tables that
// reference each other) and `django-library/{before,after}` (a Django
// project) are each committed to a scratch Git repository, and the prisma-schema and
// django-schema extractors read both revisions with the Projections CLI into
// `<project>-{before,after}.json`.
//
//   node renderers/database/fixtures/make-schemas.mjs [--cli path/to/projections] [--python path/to/python] [--only <project>]
//
// Without --cli the debug CLI is built with Cargo. django-schema runs the project's Django, so
// --python (or PROJECTIONS_DJANGO_PYTHON) names an interpreter with Django installed (the
// committed fixtures used Django 4.2.30 on Python 3.9); prisma-schema needs nothing.
import {execFileSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../..')
const {values} = parseArgs({options: {cli: {type: 'string'}, python: {type: 'string'}, only: {type: 'string'}}})
let cli = values.cli && path.resolve(values.cli)
if (!cli) {
  execFileSync('cargo', ['build', '-q', '-p', 'projections-cli'], {cwd: workspace, stdio: 'inherit'})
  cli = path.join(workspace, 'target/debug/projections')
}
const python = values.python ?? process.env.PROJECTIONS_DJANGO_PYTHON ?? 'python3'

const projects = [
  {name: 'prisma-shop', definition: {id: 'database', title: 'Database', extractor: 'prisma-schema', renderer: 'database'}, trust: false},
  {name: 'prisma-licensing', definition: {id: 'database', title: 'Database', extractor: 'prisma-schema', renderer: 'database'}, trust: false},
  {
    name: 'django-library',
    definition: {
      id: 'database',
      title: 'Database',
      extractor: 'django-schema',
      renderer: 'database',
      inputs: {python, settings: 'library.settings'},
      execution: {timeoutMs: 120000},
    },
    trust: true,
  },
]

for (const {name, definition, trust} of projects.filter(project => !values.only || project.name === values.only)) {
  const repository = mkdtempSync(path.join(tmpdir(), `projections-${name}-`))
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=Fixtures', '-c', 'user.email=fixtures@example.com', ...args], {cwd: repository})
  try {
    git('init', '-q')
    for (const revision of ['before', 'after']) {
      git('rm', '-rq', '--ignore-unmatch', '.')
      cpSync(path.join(here, name, revision), repository, {recursive: true})
      mkdirSync(path.join(repository, '.github/projections'), {recursive: true})
      writeFileSync(path.join(repository, '.github/projections/database.json'), `${JSON.stringify(definition, null, 2)}\n`)
      git('add', '-A')
      git('commit', '-qm', revision)
    }
    for (const [revision, commit] of [
      ['before', 'HEAD~1'],
      ['after', 'HEAD'],
    ]) {
      const saved = JSON.parse(
        execFileSync(cli, ['show', commit, '-p', 'database', '--json', ...(trust ? ['--trust'] : [])], {cwd: repository, encoding: 'utf8'}),
      )
      writeFileSync(path.join(here, `${name}-${revision}.json`), `${JSON.stringify(saved.extraction, null, 2)}\n`)
    }
  } finally {
    rmSync(repository, {recursive: true, force: true})
  }
}
