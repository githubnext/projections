// The kit's main entry is framework-free: neither it nor anything it loads, JavaScript or declarations, names React.
// Only `src/react.ts` and the modules under `src/react/` may, and nothing outside them imports them.
import assert from 'node:assert/strict'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {registerHooks} from 'node:module'
import {dirname, join, relative, resolve, sep} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const react = /^(react|react-dom)(\/|$)|^@githubnext\/projections-renderer-sdk\/react$/
const specifiers = text => [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map(match => match[1])

const sources = (directory, files = []) => {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) sources(path, files)
    else if (/\.tsx?$/.test(entry.name)) files.push(path)
  }
  return files
}

test('only src/react.ts and src/react/ import React, and nothing else imports them', () => {
  const src = join(root, 'src')
  const reactSide = path => path === join(src, 'react.ts') || path.startsWith(join(src, 'react') + sep)
  const problems = []
  for (const file of sources(src)) {
    if (reactSide(file)) continue
    if (file.endsWith('.tsx')) problems.push(`${relative(root, file)} is JSX outside src/react/`)
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      if (react.test(specifier)) problems.push(`${relative(root, file)} imports ${specifier}`)
      else if (specifier.startsWith('.') && reactSide(resolve(dirname(file), specifier).replace(/\.js$/, '.ts'))) {
        problems.push(`${relative(root, file)} imports ${specifier}, a React module`)
      }
    }
  }
  assert.deepEqual(problems, [])
})

// The `@githubnext/projections-*` workspace a bare specifier names, and the file its `exports` map it to.
function workspaceFile(specifier, from, condition) {
  const [scope, name, ...rest] = specifier.split('/')
  for (let directory = dirname(from); directory !== dirname(directory); directory = dirname(directory)) {
    const manifest = join(directory, 'node_modules', scope, name, 'package.json')
    if (!existsSync(manifest)) continue
    const target = JSON.parse(readFileSync(manifest, 'utf8')).exports[rest.length ? `./${rest.join('/')}` : '.']
    return join(dirname(manifest), typeof target === 'string' ? target : target[condition])
  }
  throw new Error(`Can't resolve ${specifier} from ${from}`)
}

test("the built entry's declarations, and the SDK declarations they name, never name React", () => {
  const seen = new Set()
  const problems = []
  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      if (react.test(specifier)) problems.push(`${relative(root, file)} names ${specifier}`)
      else if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier).replace(/\.js$/, '.d.ts'))
      else if (specifier.startsWith('@githubnext/projections-')) visit(workspaceFile(specifier, file, 'types'))
    }
  }
  visit(join(root, 'dist/index.d.ts'))
  assert.ok(seen.size > 50, `only ${seen.size} declaration files reached`)
  assert.deepEqual(problems, [])
})

test('the built entry loads without React', async () => {
  const loaded = []
  registerHooks({
    resolve(specifier, context, next) {
      if (react.test(specifier)) loaded.push(`${specifier} from ${context.parentURL}`)
      return next(specifier, context)
    },
  })
  const kit = await import('../dist/index.js')
  assert.ok(Object.keys(kit).length > 100)
  assert.deepEqual(loaded, [])
  const reactEntry = await import('../dist/react.js')
  assert.equal(typeof reactEntry.mountRenderer, 'function')
  assert.ok(
    loaded.some(line => line.startsWith('react ')),
    'the hook sees React when the React entry loads',
  )
})
