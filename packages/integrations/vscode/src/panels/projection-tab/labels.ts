// What a projection tab's toolbar and stage say (`TabPairLabels`): its choice and pair named for people, its edits,
// an unusual provenance or an observation's time, and whether its result is out of date.
import type {Choice} from '../../choices/model.js'
import {unusualProvenance} from '../../configuration-model.js'
import {provenanceBadge} from '../../environment-model.js'
import type {FolderModel} from '../../folder-model.js'
import {relativeAge, sideIcons, sideText, type SideLabel} from '../../labels.js'
import {pairLabel, refLabel, type Pair} from '../../projections/pairs.js'
import {pairTag, type TabPairLabels, type TabSide} from '../../protocol.js'
import {observation, type ResultStamp} from '../../staleness.js'
import {resultBadge, staleNotice, staleText, staleTitle} from '../../staleness/notices.js'
import type {TabStale} from './freshness.js'

/** One side of the pair as the toolbar names it: described by the folder, else by its ref. */
function tabSide(label: SideLabel | undefined, ref: string | undefined): TabSide | undefined {
  if (label) {
    const text = sideText(label)
    return {
      ref: ref ?? label.ref,
      name: label.name,
      detail: text.slice(label.name.length + 3),
      icon: sideIcons[label.kind],
      title: [text, ...(label.commit ? [label.commit] : [])].join('\n'),
    }
  }
  return ref ? {ref, name: refLabel(ref), detail: '', icon: 'git-commit', title: ref} : undefined
}

/** An observation's time, and the badge for who observed the result (`provenanceBadge`), from its provenance. */
function provenanceLabels(stamp: ResultStamp | undefined): Pick<TabPairLabels, 'observed' | 'provenance'> {
  if (!stamp) return {}
  const observed = observation(stamp)
  const badge = resultBadge(stamp, provenanceBadge)
  const age = observed?.at ? relativeAge(observed.at) : undefined
  return {
    ...(observed
      ? {
          observed: {
            text: `Observed ${age ?? 'live'}`,
            title: `Live or varying data (determinism "observed"), observed ${observed.at ? new Date(observed.at).toLocaleString() : 'when it ran'}. It isn't judged out of date: Refresh observes it again.`,
          },
        }
      : {}),
    ...(badge ? {provenance: {label: badge.label, title: badge.detail}} : {}),
  }
}

/** The toolbar's provenance: an observation's time, and the badge only when the result is unusual (not Local). */
function tabProvenance(stamp: ResultStamp | undefined): Pick<TabPairLabels, 'observed' | 'provenance'> {
  const labels = provenanceLabels(stamp)
  return {
    ...(labels.observed ? {observed: labels.observed} : {}),
    ...(labels.provenance && unusualProvenance(labels.provenance.label) ? {provenance: labels.provenance} : {}),
  }
}

/** What Refresh does to the out-of-date result: applies the edits (or the committed version) when that changed. */
export function refreshAction(applied: string | undefined, desired: string, stale: TabStale | undefined): string {
  if (applied && applied !== desired) return desired === 'working-tree' ? 'applies your edits' : 'applies the committed definition'
  return stale?.tier === 'comparison' ? 'compares it again' : 'extracts it again'
}

/** What the tab shows, as the toolbar labels it. */
export interface TabLabelsInput {
  model: FolderModel
  /** The choice the tab is pinned to and its pair, if it is. */
  pinned: (Choice & {pair: Pair}) | undefined
  pair: Pair | undefined
  edits: TabPairLabels['edits']
  stamp: ResultStamp | undefined
  stale: TabStale | undefined
  /** What Refresh does (`refreshAction`), asked only when the result is out of date. */
  refreshes: () => string
}

/** The tab's choice and pair, named for people (the pinned choice, else the folder's), and its notices. */
export function tabPairLabels({model, pinned, pair, edits, stamp, stale, refreshes}: TabLabelsInput): TabPairLabels {
  const shown = pinned ? model.describe(pinned, pinned.pair) : model.describe()
  const labels = pair ? model.labels(pair) : undefined
  const before = tabSide(labels?.before, pair?.before)
  const after = tabSide(labels?.after, pair?.after)
  const choice = pinned ?? model.choice
  return {
    tag: pairTag,
    choice: {
      id: choice.id,
      name: shown.name,
      detail: shown.detail,
      icon: shown.icon,
      title: [shown.text, ...(pair ? [pairLabel(pair)] : []), ...(pinned ? ['Pinned to this tab'] : [])].join('\n'),
    },
    ...(before ? {before} : {}),
    ...(after ? {after} : {}),
    single: !pair?.before,
    backwards: Boolean(labels?.backwards),
    pinned: Boolean(pinned),
    ...(edits ? {edits} : {}),
    ...tabProvenance(stamp),
    ...(stale
      ? {
          stale: {
            text: staleText(stale.files),
            ...staleNotice(stale.files),
            title: `${staleTitle(stale)}. Nothing refreshes on its own: Refresh ${refreshes()}.`,
          },
        }
      : {}),
  }
}
