import {extraction} from '@githubnext/projections-renderer-harness/playwright'

const output = (id: string, label: string, text: string, presentation?: 'prose' | 'formatted') => ({
  id,
  kind: 'output',
  label,
  data: {text, ...(presentation ? {presentation} : {})},
})

export const reportBefore = [
  '$ parcel report shipments.json',
  'ID       City        Status',
  'PKG-101  Seattle     delivered',
  'PKG-102  Portland    in transit',
  'PKG-104  Denver      late: Weather hold at depot',
  'PKG-106  Boston      in transit',
  'Total: 12 shipments, 8 in transit, 2 late',
  '',
].join('\n')
export const reportAfter = [
  '$ parcel report shipments.json',
  'ID       City        Status',
  'PKG-101  Seattle     delivered',
  'PKG-102  Portland    late: Missed carrier handoff',
  'PKG-104  Denver      late: Weather hold at depot',
  'PKG-106  Boston      in transit',
  'PKG-111  Dallas      late: Address verification needed — the recipient address could not be matched to a delivery route',
  'Total: 14 shipments, 9 in transit, 3 late',
  '',
].join('\n')
export const notesBefore =
  'Shipments are grouped by city. Late shipments include the reason reported by the carrier.\n\nRun with --late-only to hide delivered shipments.'
export const notesAfter =
  'Shipments are grouped by city. Late shipments include the reason reported by the carrier, and the time it was reported.\n\nRun with --late-only to hide delivered shipments.'

export const before = extraction('graph/v0', [
  output('report', 'parcel report shipments.json', reportBefore),
  output('notes', 'parcel help report', notesBefore, 'prose'),
  output('legacy', 'parcel legacy-status', 'legacy status: ok\n'),
])
export const after = extraction('graph/v0', [
  output('report', 'parcel report shipments.json', reportAfter),
  output('notes', 'parcel help report', notesAfter, 'prose'),
  output('late', 'parcel report --late-only', 'PKG-102  Portland\nPKG-104  Denver\nPKG-111  Dallas\n'),
])
