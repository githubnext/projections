import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {comparisonModel, scheduleSteps} from '@githubnext/projections-renderer-kit'
import {columnType, declaredType, typeChange} from '../node_modules/.cache/test/types.js'
import {DatabaseRenderer} from '../node_modules/.cache/test/view.js'

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
const column = data => ({id: 'c', kind: 'column', label: 'c', data})

test('columns show their native database type when the extractor knows it', () => {
  assert.equal(columnType(column({type: 'CharField', databaseType: 'varchar(200)', nullable: true})), 'varchar(200)?')
  assert.equal(columnType(column({type: 'String', databaseType: null})), 'String')
  assert.equal(columnType(column({type: 'nvarchar(max)'})), 'nvarchar(max)')
  assert.equal(declaredType(column({type: 'CharField', databaseType: 'varchar(200)'})), 'CharField')
  assert.equal(declaredType(column({type: 'nvarchar(max)', databaseType: 'nvarchar(max)'})), undefined)
  assert.equal(
    typeChange({
      id: 'c',
      status: 'modified',
      before: column({type: 'CharField', databaseType: 'varchar(120)'}),
      after: column({type: 'CharField', databaseType: 'varchar(200)'}),
    }),
    'type varchar(120) to varchar(200)',
  )
  assert.equal(
    typeChange({id: 'c', status: 'modified', before: column({type: 'Int'}), after: column({type: 'Int', nullable: true})}),
    'type Int to Int?',
  )
  assert.equal(typeChange({id: 'c', status: 'added', after: column({type: 'Int'})}), undefined)
})

test('real Prisma and Django retypes read as type changes', async () => {
  const engine = createNativeEngine()
  for (const [name, id, from, to] of [
    ['django-library', 'column:table%3Acatalog_author/name', 'varchar(120)', 'varchar(200)'],
    ['django-library', 'column:table%3Acatalog_book/pages', 'integer', 'integer unsigned'],
    ['prisma-shop', 'column:table%3A%2FProduct/title', 'String', 'varchar(200)'],
    ['prisma-shop', 'column:table%3A%2FProduct/priceCents', 'Int', 'BigInt'],
  ]) {
    const before = fixture(`${name}-before`),
      after = fixture(`${name}-after`)
    const model = comparisonModel(before, after, await engine.compare(before, after))
    const change = model.entities.find(row => row.id === id)
    assert.equal(typeChange(change), `type ${from} to ${to}`, id)
    // With highlighting, the row says so for assistive technology, and shows the new type.
    const html = renderToStaticMarkup(
      createElement(DatabaseRenderer, {
        init: {},
        model,
        direction: 1,
        onOpen() {},
        reportSteps() {},
        declareControls() {},
        onAction: () => () => {},
        viewport: undefined,
        schedule: scheduleSteps(model),
        progress: 1,
        highlighting: 1,
        emphasis: () => 1,
        comparing: true,
        diff: false,
        selectedId: null,
        hoveredId: null,
        onSelect() {},
        controls: {},
        options: {},
        reducedMotion: true,
        locale: 'en',
        rendererName: 'database',
      }),
    )
    assert.ok(html.includes(`Modified, type ${from} to ${to}`), `${id} in the markup`)
    // Types are drawn whole, in pieces the browser may wrap between.
    const shown = [...html.matchAll(/<code[^>]*>(.*?)<\/code>/g)].map(match => match[1].replace(/<[^>]+>/g, ''))
    assert.ok(shown.includes(to), `${id} shows ${to}`)
  }
})
