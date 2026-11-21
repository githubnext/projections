/**
 * Invariants for code-statistics frames, shared by the unit tests and the
 * browser scrubbing suite. Checks return a list of failures.
 */

/** Runs inside the renderer document (pass to `evaluate`): what was actually painted. */
/** @param {ParentNode} [root] */
export function measureRenderedFrame(root = document) {
  const pk = root.querySelector('.pk')
  const view = root.querySelector('.statistics-view')
  const slots = [...root.querySelectorAll('.statistics-bars .stat-slot, .statistics-values .stat-slot')].map(slot => {
    const {top, height} = slot.getBoundingClientRect()
    const bar = slot.querySelector('.stat-bar')
    return {
      id: slot.dataset.statisticsId,
      label: slot.querySelector('.stat-label, .entity-link, .stat-values-row > span')?.textContent ?? '',
      top,
      height,
      size: parseFloat(slot.style.gridTemplateRows),
      opacity: Number(slot.style.opacity),
      width: bar ? parseFloat(bar.style.width) : null,
      // A share row's colour is its slice's.
      colour: bar
        ? getComputedStyle(bar).backgroundColor
        : getComputedStyle(root.querySelector(`.stat-arc[data-statistics-id="${slot.dataset.statisticsId}"] path`) ?? slot).fill,
      value: slot.querySelector('.stat-value, .stat-values-value')?.firstChild?.textContent ?? '',
    }
  })
  const arcs = [...root.querySelectorAll('.stat-arc')].map(arc => ({
    id: arc.dataset.statisticsId,
    d: arc.querySelector('path').getAttribute('d'),
  }))
  return {
    progress: Number(pk?.dataset.progress),
    chart: root.querySelector('.statistics-bars') ? 'bars' : 'share',
    // The share chart's centre states the ring's total; the bars state none (the host's summary bar has the total).
    total: view?.querySelector('.stat-centre-value')?.textContent ?? '',
    slots,
    arcs,
    emphasis: root.querySelectorAll('.stat-gain, .stat-loss, .stat-arc-change, .badge, .stat-delta-label, .pk-status-text').length,
    html: view?.outerHTML ?? '',
  }
}

/** Checks one measured frame: slots take the share of a row their presence gives them, and endpoints are neutral. */
export function checkRenderedFrame(frame, {rowHeight} = {}) {
  const errors = []
  for (const slot of frame.slots) {
    if (!(slot.opacity >= 0 && slot.opacity <= 1)) errors.push(`${slot.id} opacity ${slot.opacity}`)
    if (slot.width !== null && !(slot.width >= 0 && slot.width <= 100 + 1e-9)) errors.push(`${slot.id} bar width ${slot.width}%`)
    if (slot.opacity > slot.size + 1e-9) errors.push(`${slot.id} is visible (${slot.opacity}) beyond its slot (${slot.size})`)
    if (rowHeight && Math.abs(slot.height - rowHeight * slot.size) > 1.5) {
      errors.push(`${slot.id} slot height ${slot.height} for size ${slot.size}`)
    }
  }
  if ((frame.progress === 0 || frame.progress === 1) && frame.emphasis) {
    errors.push(`${frame.emphasis} emphasized elements at endpoint ${frame.progress}`)
  }
  return errors
}

/**
 * Checks a sequence of measured frames (one chart, in scrub order): nothing
 * mounts or unmounts part-way, order and colours stay fixed, and rows glide
 * rather than jump.
 */
export function checkFrameSequence(frames, {maxStep} = {}) {
  const errors = []
  const ids = frame => frame.slots.map(slot => slot.id).join('|')
  const first = frames[0]
  for (const frame of frames) {
    if (ids(frame) !== ids(first)) errors.push(`slots changed at ${frame.progress}`)
    for (const slot of frame.slots) {
      const initial = first.slots.find(candidate => candidate.id === slot.id)
      if (initial && initial.colour !== slot.colour) errors.push(`${slot.id} changed colour at ${frame.progress}`)
    }
  }
  if (maxStep !== undefined) {
    for (let index = 1; index < frames.length; index++) {
      for (const slot of frames[index].slots) {
        const previous = frames[index - 1].slots.find(candidate => candidate.id === slot.id)
        if (previous && Math.abs(slot.top - previous.top) > maxStep) {
          errors.push(
            `${slot.id} jumped ${Math.abs(slot.top - previous.top).toFixed(1)}px between ${frames[index - 1].progress} and ${frames[index].progress}`,
          )
        }
      }
    }
  }
  return errors
}
