import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {Group} from '../dist/react.js'
import {plain} from './markup.mjs'

const noop = () => undefined

const html = (props, children = createElement('table', {className: 'body'})) => renderToStaticMarkup(createElement(Group, props, children))

test('a group is a titled panel: a heading inside its header band labels the section, then its body', () => {
  const markup = html({title: 'Policies'})
  const [, labelled] = markup.match(/^<section class="pk-group" aria-labelledby="([^"]+)">/u)
  assert.match(
    markup,
    new RegExp(
      `<header class="pk-group-header"><h2 class="pk-group-title" id="${labelled}"><span class="pk-group-label pk-truncate" title="Policies">Policies</span></h2></header><table class="body"></table></section>$`,
    ),
  )
  // No status, actions, meta or entity without their props.
  assert.doesNotMatch(markup, /pk-change-status|pk-group-actions|pk-group-meta|data-entity-id|data-change=/u)
  assert.match(html({title: 'Rules', level: 3}), /<h3 class="pk-group-title"/u)
})

test('a code title is an identifier in the monospace font; a title in words keeps the UI font', () => {
  assert.match(
    html({title: 'parcel report', titleFont: 'code'}),
    /<span class="pk-group-label pk-truncate" data-projections-identifier="" title="parcel report">/u,
  )
  assert.doesNotMatch(html({title: 'Files'}), /data-projections-identifier/u)
})

test("the subject's icon leads the title, decorative, and only with the prop", () => {
  assert.match(
    html({title: 'Workloads', icon: 'workload'}),
    /<h2 class="pk-group-title" id="[^"]+"><span class="pk-group-icon"><span class="pk-icon" data-icon="workload" aria-hidden="true"><\/span><\/span><span class="pk-group-label pk-truncate" title="Workloads">Workloads<\/span><\/h2>/u,
  )
  assert.doesNotMatch(html({title: 'Workloads'}), /data-icon/u)
})

test('meta follows the title, and actions and the reserved status cell close the band', () => {
  const markup = html({
    title: 'Files',
    meta: '3 hooks',
    actions: createElement('button', {type: 'button', className: 'pk-button'}, 'Expand'),
    change: {status: 'unchanged'},
  })
  assert.match(
    markup,
    /<\/span><span class="pk-group-meta">3 hooks<\/span><\/h2><div class="pk-group-actions"><button type="button" class="pk-button">Expand<\/button><\/div><span class="pk-change-status pk-group-status" data-change-footer=""><\/span><\/header>/u,
  )
})

test('in a comparison the status states the change in proportion to emphasis, and a removed group is marked', () => {
  const removed = {status: 'removed'}
  const shown = html({title: 'legacy', change: removed, emphasis: 1, mark: removed})
  assert.match(shown, /^<section class="pk-group" aria-labelledby="[^"]+" data-change="removed">/u)
  // The title is diff text, which the kit strikes through in a removed group.
  assert.match(shown, /class="pk-group-label pk-truncate pk-diff-text"/u)
  assert.equal(plain(shown.match(/<span class="pk-change-status pk-group-status".*?<\/header>/u)[0]), 'Removed')
  // At zero emphasis the cell stays reserved and empty, and nothing else changes.
  const quiet = html({title: 'legacy', change: removed, emphasis: 0, mark: removed})
  assert.match(quiet, /<span class="pk-change-status pk-group-status" data-change-footer=""><\/span>/u)
  // An unchanged group carries no mark.
  assert.doesNotMatch(html({title: 'help', change: {status: 'unchanged'}, mark: {status: 'unchanged'}}), /data-change=|pk-diff-text/u)
  // The kit's React styles with the base styles and their partials (`styles/*.css`) inlined where they're imported.
  const inline = path =>
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll(/^@import '\.\/([a-z/-]+\.css)';$/gmu, (_, file) =>
      inline(file),
    )
  const css = inline('react.css')
  assert.match(css, /\.pk \[data-change='removed'\] \.pk-diff-text \{[^}]*text-decoration: line-through/u)
})

test('a group that presents an item is its unit, and its title is the button that selects it', () => {
  const element = createElement(Group, {title: 'parcel --version', titleFont: 'code', id: 'version', selected: true, onSelect: noop}, null)
  const markup = renderToStaticMarkup(element)
  assert.match(markup, /^<section class="pk-group" aria-labelledby="[^"]+" data-entity-id="version">/u)
  assert.match(
    markup,
    /<button type="button" class="pk-group-label pk-truncate" data-projections-identifier="" title="parcel --version" aria-pressed="true">parcel --version<\/button>/u,
  )
  // Without onSelect the title is not a button.
  assert.doesNotMatch(html({title: 'Policies', id: 'policies'}), /<button/u)
})
