import assert from 'node:assert/strict'
import test from 'node:test'
import {check, findings, rules, shipped} from './check-portability.mjs'

const rulesIn = (path, text) => findings(path, text).map(finding => finding.rule)

// One line each rule must flag, and a near miss it must not.
const cases = {
  'posix-shell': [
    ['packages/x/src/a.ts', "spawn('/bin/sh', ['-c', command])", "spawn(process.execPath, ['-e', code])"],
    ['packages/x/src/a.rs', 'let shell = Command::new("sh");', 'let node = Command::new("node");'],
    ['action.yml', "      run: '/usr/bin/env node install.mjs'", '      run: node install.mjs'],
  ],
  'shell-string': [
    ['packages/x/src/a.ts', 'spawnSync(command, {shell: true})', 'spawnSync(program, args, {shell: false})'],
    ['packages/x/src/a.mjs', "import {exec, spawn} from 'node:child_process'", "import {execFile, spawn} from 'node:child_process'"],
  ],
  'bare-launcher': [
    ['packages/x/scripts/a.mjs', "execFileSync('npm', ['run', 'build'])", "execFileSync(process.execPath, [npm, 'run', 'build'])"],
    ['packages/x/src/a.ts', "spawn('python3', [file])", "spawn('node', [file])"],
    ['packages/x/src/a.ts', "execFileSync('npm.cmd', ['ci'])", "execFileSync(process.execPath, [process.env.npm_execpath, 'ci'])"],
  ],
  'rust-bare-launcher': [['packages/x/src/a.rs', 'Command::new("npm")', 'Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" })']],
  'posix-path-module': [['packages/x/src/a.ts', 'const file = path.posix.join(root, name)', 'const file = path.join(root, name)']],
  'native-path-slash': [
    ['packages/x/src/a.ts', "const parts = relative(root, file).split('/')", 'const parts = relative(root, file).split(sep)'],
    [
      'packages/x/src/a.ts',
      "const inside = file.startsWith(join(root, 'src') + '/')",
      "const inside = file.startsWith(join(root, 'src') + sep)",
    ],
  ],
  'file-text-lf': [
    [
      'packages/x/src/a.ts',
      "const lines = readFileSync(file, 'utf8').split('\\n')",
      "const lines = readFileSync(file, 'utf8').split(/\\r?\\n/)",
    ],
  ],
  'path-equality': [
    ['packages/x/scripts/a.mjs', 'if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()', 'if (import.meta.main) main()'],
  ],
  'rust-path-slash': [['packages/x/src/a.rs', 'let head = root.join(".git/HEAD");', 'let head = root.join(".git").join("HEAD");']],
}

for (const [rule, examples] of Object.entries(cases)) {
  test(`${rule} flags the assumption and passes the portable form`, () => {
    for (const [path, flagged, portable] of examples) {
      assert.deepEqual(rulesIn(path, flagged), [rule], flagged)
      assert.deepEqual(rulesIn(path, portable), [], portable)
    }
  })
}

test('npm-script-posix flags scripts cmd.exe cannot run', () => {
  const scripts = command => JSON.stringify({scripts: {build: command}}, null, 2)
  for (const command of ['rm -rf dist && tsc', 'NODE_ENV=production vite build', "eslint 'src/**'", 'echo $HOME', 'tsc && cp a b'])
    assert.deepEqual(rulesIn('packages/x/package.json', scripts(command)), ['npm-script-posix'], command)
  for (const command of ['tsc -p tsconfig.json && node scripts/copy.mjs', 'node --test test/*.test.mjs', 'vite build --mode production'])
    assert.deepEqual(rulesIn('packages/x/package.json', scripts(command)), [], command)
})

test('every rule has a case', () => {
  assert.deepEqual(rules.map(rule => rule.name).sort(), [...Object.keys(cases), 'npm-script-posix'].sort())
})

test('a shebang and a Rust unit test module are not shipped code', () => {
  assert.deepEqual(rulesIn('packages/x/scripts/a.mjs', "#!/usr/bin/env node\nconsole.log('/x')"), [])
  const source = 'fn main() {}\n\n#[cfg(test)]\nmod tests {\n    fn shell() { Command::new("sh"); }\n}\n'
  assert.deepEqual(rulesIn('packages/x/src/a.rs', source), [])
})

test('tests, fixtures and browser suites are not shipped; the CLI and the action are', () => {
  for (const path of [
    'packages/cli/test/cli.test.mjs',
    'packages/cli/tests/native.rs',
    'packages/renderers/graph/fixtures/a.ts',
    'packages/renderers/harness/browser/checks.spec.ts',
    'packages/host/core/browser/helpers.ts',
    'packages/renderers/sdk/src/style.test.ts',
    'examples/extractors/x.mjs',
    'tools/scripts/considered.mjs',
  ])
    assert.equal(shipped(path), false, path)
  for (const path of [
    'packages/cli/src/browser/session.rs',
    'packages/cli/templates/renderer/src/index.ts',
    'action.yml',
    '.github/actions/check/action.yml',
  ])
    assert.equal(shipped(path), true, path)
})

test('an exception needs a reason, excuses only its rule in its file, and fails once stale', () => {
  const files = [['packages/x/src/a.ts', "spawn('/bin/sh')\nconst a = path.posix.join(x, y)"]]
  const entry = {path: 'packages/x/src/a.ts', rule: 'posix-shell', reason: 'Runs only on Linux.'}
  assert.deepEqual(
    check(files, [entry]).violations.map(violation => violation.rule),
    ['posix-path-module'],
  )
  assert.deepEqual(check([['packages/x/src/a.ts', '']], [entry]).stale, [entry])
  assert.throws(() => check(files, [{...entry, reason: ' '}]), /needs a path, a rule and a reason/)
  assert.throws(() => check(files, [{...entry, rule: 'tabs'}]), /no rule tabs/)
})
