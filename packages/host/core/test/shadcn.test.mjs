import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readdir, readFile} from 'node:fs/promises'
import {mergeComponent} from '../scripts/shadcn/merge.mjs'
import {prefixClasses} from '../scripts/shadcn/classes.mjs'
import {parseHeader} from '../scripts/shadcn/header.mjs'
import {transformItem} from '../scripts/shadcn/transform.mjs'

const components = new URL('../src/ui/components/', import.meta.url)
const upstream = new URL('upstream/', components)
const manifest = JSON.parse(await readFile(new URL('manifest.json', upstream), 'utf8'))
const readItem = async name => JSON.parse(await readFile(new URL(`${name}.json`, upstream), 'utf8'))
const readOurs = async name => readFile(new URL(`${name}.tsx`, components), 'utf8')

// The genuine local edits (each file's header names them), undone: what remains must be the transformed base.
const portal = source =>
  source
    .replace("import {usePortalContainer} from '../lib/portal.js'\n", '')
    .replaceAll(/^ *\/\/ local: portal into ScopedRoot.*\n/gm, '')
    .replaceAll(' container={usePortalContainer()}', '')
const genuineEdits = {
  button: source => source.replace('pj:focus-visible:ring-ring/50 ', '$&pj:active:not-aria-[haspopup]:translate-y-px '),
  'dropdown-menu': portal,
  popover: portal,
  select: portal,
  tooltip: portal,
}

test('every vendored shadcn/ui file has a pristine base, and every base a file', async () => {
  const bases = (await readdir(upstream)).filter(file => file !== 'manifest.json').map(file => file.replace(/\.json$/, ''))
  const vendored = []
  for (const file of await readdir(components)) {
    if (file.endsWith('.tsx') && parseHeader(await readFile(new URL(file, components), 'utf8'))) vendored.push(file.replace(/\.tsx$/, ''))
  }
  assert.deepEqual(vendored.toSorted(), bases.toSorted())
})

test('the transformed base reproduces each vendored file except its documented local edits', async () => {
  for (const file of await readdir(upstream)) {
    if (file === 'manifest.json') continue
    const name = file.replace(/\.json$/, '')
    const ours = await readOurs(name)
    const header = parseHeader(ours)
    assert.equal(header.version, manifest.version, `${name}.tsx is at the base's release`)
    const transformed = await transformItem(await readItem(name), {style: manifest.style, version: manifest.version, notes: header.notes})
    assert.equal((genuineEdits[name] ?? (source => source))(ours), transformed, `${name}.tsx`)
  }
})

test('classes get the pj: prefix and --pj- variables; cn-* hooks, Radix variables and Tailwind functions do not', () => {
  assert.equal(
    prefixClasses(
      'cn-menu-target flex gap-(--card-spacing) [--card-spacing:--spacing(6)] max-h-(--radix-select-x) hover:bg-[var(--secondary)]',
    ),
    'cn-menu-target pj:flex pj:gap-(--pj-card-spacing) pj:[--pj-card-spacing:--spacing(6)] pj:max-h-(--radix-select-x) pj:hover:bg-[var(--pj-secondary)]',
  )
})

test('the variables a style prop sets are renamed like the ones its classes read', async () => {
  const content = 'export const Gap = () => <div style={{"--gap": 2, color: "red"}} className="gap-[--spacing(var(--gap))]" />\n'
  const output = await transformItem({name: 'gap', files: [{content}]}, {style: manifest.style, version: manifest.version})
  assert.match(output, /style=\{\{'--pj-gap': 2, color: 'red'\}\} className="pj:gap-\[--spacing\(var\(--pj-gap\)\)\]"/)
})

const editedItem = (item, from, to) => {
  assert.ok(item.files[0].content.includes(from), `upstream contains ${from}`)
  return {...item, files: [{...item.files[0], content: item.files[0].content.replace(from, to)}]}
}

test('an upstream change merges into our file and keeps our edits and header notes', async () => {
  const baseItem = await readItem('button')
  const nextItem = editedItem(baseItem, 'icon: "size-9"', 'icon: "size-9.5"')
  const result = await mergeComponent({
    name: 'button',
    ours: await readOurs('button'),
    baseItem,
    nextItem,
    style: manifest.style,
    version: '9.9.9',
  })
  assert.equal(result.status, 'merged')
  assert.match(result.text, /icon: 'pj:size-9\.5'/)
  assert.doesNotMatch(result.text, /pj:active:not-aria-\[haspopup\]:translate-y-px/)
  assert.match(result.text, /shadcn@9\.9\.9\. MIT/)
  assert.match(result.text, /no \x60active:translate-y-px\x60 on the button/)
})

test('an upstream change to a line we edited is a conflict with diff3 markers', async () => {
  const baseItem = await readItem('button')
  const nextItem = editedItem(baseItem, 'select-none focus-visible', 'select-none cursor-pointer focus-visible')
  const result = await mergeComponent({
    name: 'button',
    ours: await readOurs('button'),
    baseItem,
    nextItem,
    style: manifest.style,
    version: '9.9.9',
  })
  assert.equal(result.status, 'conflict')
  assert.equal(result.conflicts, 1)
  assert.match(result.text, /^<<<<<<< ours \(button\.tsx\)$/m)
  assert.match(result.text, /^\|\|\|\|\|\|\| base \(shadcn@4\.23\.0\)$/m)
  assert.match(result.text, /^>>>>>>> upstream \(shadcn@9\.9\.9\)$/m)
})

test('an unchanged item only bumps the header release', async () => {
  const ours = await readOurs('card')
  const item = await readItem('card')
  const result = await mergeComponent({name: 'card', ours, baseItem: item, nextItem: item, style: manifest.style, version: '9.9.9'})
  assert.equal(result.status, 'unchanged')
  assert.equal(result.text, ours.replace(`shadcn@${manifest.version}.`, 'shadcn@9.9.9.'))
})
