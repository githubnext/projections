import type {ProjectionController} from '@githubnext/projections-host'
import {Prose} from '../prose.js'
import {Notice} from '../notice.js'
import {ComparatorLine, rendererLabel, type ViewKind} from '../blocks.js'
import type {VscodeProjectionViewProps} from './props.js'

/**
 * What the view says above the stage: the host's banner, which view is showing (for assistive technology), the
 * comparator (for About this projection), the renderer notice and the other notices.
 */
export function ViewNotices({
  projection: p,
  props,
  view,
}: {
  projection: ProjectionController
  props: Pick<VscodeProjectionViewProps, 'banner' | 'comparator' | 'rendererNotice'>
  view: ViewKind
}) {
  const active = view === 'renderer' && p.renderer ? rendererLabel(p) : view === 'table' ? 'Built-in table view' : 'Built-in text view'
  const otherNotices = p.notices.slice(props.rendererNotice ? 1 : 0)
  return (
    <>
      {Boolean(props.banner) && <div className="phv-banner">{props.banner}</div>}
      <p className="phv-visually-hidden" aria-live="polite">
        Showing: <strong data-active-view={view}>{active}</strong>
      </p>
      {props.comparator && (
        <div className="ph-comparator phv-visually-hidden" data-comparator={props.comparator.id}>
          <ComparatorLine comparator={props.comparator} />
        </div>
      )}
      {props.rendererNotice && (
        <div role="status" className="phv-notice-region">
          <Notice title="Renderer notice" hideTitle>
            {props.rendererNotice}
          </Notice>
        </div>
      )}
      {otherNotices.length > 0 && (
        <ul className="phv-notices" aria-label="Notices">
          {otherNotices.map((notice, index) => (
            <li key={index}>
              <Notice title="Notice" hideTitle>
                <Prose>{notice}</Prose>
              </Notice>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
