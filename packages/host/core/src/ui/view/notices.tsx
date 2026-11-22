import {Prose} from '../prose.js'

/** A view's notices beside their icon: none draws nothing, one is a sentence, and only several are a bulleted list. */
export function Notices({notices}: {notices: readonly string[]}) {
  if (notices.length === 0) return null
  if (notices.length === 1) {
    return (
      <p className="ph-notice ph-notices">
        <Prose>{notices[0]!}</Prose>
      </p>
    )
  }
  return (
    <ul className="ph-notice ph-notices pj:flex pj:list-disc pj:flex-col pj:gap-1 pj:pl-4" aria-label="Notices">
      {notices.map((notice, index) => (
        <li key={index}>
          <Prose>{notice}</Prose>
        </li>
      ))}
    </ul>
  )
}
