// Shared by the renderers' unit tests: reading rendered markup as text.

/** The text of rendered markup: everything outside its tags, found in one pass. */
export function plain(markup) {
  let text = ''
  let inTag = false
  for (const character of markup) {
    if (character === '<') inTag = true
    else if (character === '>') inTag = false
    else if (!inTag) text += character
  }
  return text
}
