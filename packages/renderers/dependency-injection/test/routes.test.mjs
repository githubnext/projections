import {test} from 'node:test'
import assert from 'node:assert/strict'
import {portInset, portSpacing, routeRadius, routesCross, trackSpacing} from '@githubnext/projections-renderer-kit'
import {createDiDiff} from '../node_modules/.cache/test/diff-model.js'
import {diMetrics} from '../node_modules/.cache/test/geometry.js'
import {routeLinks} from '../node_modules/.cache/test/card.js'
import {crowdedRuns, draftingIssues, portIssues} from '../../kit/test/quality.mjs'
import {compared} from './engine.mjs'
import {loadPair} from './fixtures.mjs'

/** An arrow's SVG path (`M`, `L` and `C` commands) as a chain of cubics. */
function pathSpline(d) {
  const tokens = d.match(/[MLC]|-?[\d.]+(?:e-?\d+)?/gu)
  const chain = []
  let command,
    numbers = []
  const flush = () => {
    const points = []
    for (let index = 0; index + 1 < numbers.length; index += 2) points.push({x: Number(numbers[index]), y: Number(numbers[index + 1])})
    if (command === 'M') chain.push(points[0])
    else if (command === 'L') {
      for (const point of points) {
        const last = chain.at(-1)
        chain.push(
          {x: last.x + (point.x - last.x) / 3, y: last.y + (point.y - last.y) / 3},
          {x: last.x + (2 * (point.x - last.x)) / 3, y: last.y + (2 * (point.y - last.y)) / 3},
          point,
        )
      }
    } else if (command === 'C') chain.push(...points)
    numbers = []
  }
  for (const token of tokens) {
    if (/[MLC]/u.test(token)) {
      flush()
      command = token
    } else numbers.push(token)
  }
  flush()
  return chain
}

test("diff mode, as drafted: every arrow is axis-aligned lines and quarter circles at the standard radius, runs a track apart, no crossings among a card's own arrows", async () => {
  for (const name of ['orders', 'scoring', 'nestjs-orders', 'spring-orders']) {
    const {before, after} = loadPair(name)
    const {model} = await compared(before, after)
    const diff = createDiDiff(model)
    const half = diMetrics.width / 2
    const boxes = new Map(
      diff.units.map(unit => [unit.id, {x: unit.x - half, y: unit.y - diMetrics.height / 2, width: diMetrics.width, height: unit.height}]),
    )
    const routes = routeLinks(boxes, diff.links, 0.5)
    const arrows = diff.links.map(link => ({
      key: link.key,
      fromId: link.fromId,
      toId: link.toId,
      points: pathSpline(routes.get(link.key).d),
    }))
    const issues = []
    for (const arrow of arrows) for (const issue of draftingIssues(arrow.points, routeRadius)) issues.push(`${arrow.key}: ${issue}`)
    issues.push(...crowdedRuns(arrows, trackSpacing))
    for (let i = 0; i < arrows.length; i++) {
      for (let j = i + 1; j < arrows.length; j++) {
        const [a, b] = [arrows[i], arrows[j]]
        if (a.fromId !== b.fromId) continue
        const shared = [a.points[0], b.points[0], ...(a.toId === b.toId ? [a.points.at(-1), b.points.at(-1)] : [])]
        if (routesCross(a.points, b.points, shared, 6)) issues.push(`${a.key} crosses ${b.key}, which leaves the same card`)
      }
    }
    // Arrows into a card from above meet its top spread evenly over a centred band, in the order they come from.
    const into = new Map()
    for (const link of diff.links) {
      const route = routes.get(link.key)
      if (route.end.y <= route.start.y) continue
      into.set(link.toId, [...(into.get(link.toId) ?? []), {link, route}])
    }
    for (const [id, list] of into) {
      const box = boxes.get(id)
      const ordered = [...list].toSorted((a, b) => a.link.from.x - b.link.from.x || (a.link.key < b.link.key ? -1 : 1))
      for (const issue of portIssues(
        ordered.map(({route}) => route.end.x),
        box.x + box.width / 2,
        box.width,
        portSpacing,
        portInset,
      )) {
        issues.push(`into ${id}: ${issue}`)
      }
    }
    assert.deepEqual(issues.slice(0, 8), [], name)
  }
})
