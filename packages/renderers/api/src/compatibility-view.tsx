import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {plainProse, statusParts} from '@githubnext/projections-renderer-kit'
import {ChangeFooter, Icon, Prose} from '@githubnext/projections-renderer-kit/react'
import {compatibilityLabels, reasonText} from './compatibility.js'
import type {Classified, Compatibility} from './compatibility.js'

/** A level as its icon and word. */
function Level({classified}: {classified: Classified}) {
  const {icon, label} = compatibilityLabels[classified.level]
  return (
    <>
      <Icon name={icon} />
      {label}
    </>
  )
}

/**
 * The reserved footer of a row in a classified comparison: the kit footer's
 * change status (Modified), in a cell as wide as the longest status, then
 * the compatibility (Breaking), each an icon and a word, both fading with the change's emphasis.
 * At zero emphasis it is exactly the kit's empty footer. The reason is the
 * compatibility's tooltip; the diff also shows it under the signature, and
 * side by side it is read to assistive technology here.
 */
export function CompatibilityFooter({
  row,
  emphasis,
  classified,
  diff,
}: {
  row: EntityChange<Entity>
  emphasis: number
  classified: Classified | undefined
  diff: boolean
}) {
  const parts = emphasis > 0.01 ? statusParts(row) : []
  if (!parts.length) return <ChangeFooter className="api-declaration-footer" change={row} emphasis={emphasis} />
  const hidden = emphasis < 0.05
  return (
    <div className="pk-change-footer api-declaration-footer" data-change-footer="">
      <span className="pk-status-text api-change-status" style={{opacity: Math.min(1, emphasis)}} aria-hidden={hidden}>
        {parts.map(part => (
          <span key={part.status} className={`pk-status-part ${part.status}`} data-change-status={part.status}>
            <Icon name={part.icon} />
            {part.label}
          </span>
        ))}
      </span>
      {classified && (
        <span
          className={`api-compatibility ${classified.level}`}
          data-compatibility={classified.level}
          style={{opacity: Math.min(1, emphasis)}}
          aria-hidden={hidden}
          title={plainProse(reasonText(classified))}
        >
          <Level classified={classified} />
          {!diff && <span className="sr-only">: {plainProse(reasonText(classified))}</span>}
        </span>
      )}
    </div>
  )
}

/**
 * The classification's notices: caveats that qualify every level, such as rules that couldn't apply. The host's
 * summary bar counts the changes at each level, with the rules that classified them.
 */
export function CompatibilityNotices({compatibility}: {compatibility: Compatibility}) {
  if (!compatibility.notices.length) return null
  return (
    <div className="api-compatibility-notices" data-projections-content="">
      {compatibility.notices.map(notice => (
        <p key={notice} className="api-compatibility-notice">
          <Prose>{notice}</Prose>
        </p>
      ))}
    </div>
  )
}
