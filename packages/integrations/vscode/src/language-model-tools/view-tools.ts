import type {PageView} from '../current-view/types.js'
import {currentViewText, noProjectionTab} from '../current-view/text.js'
import {viewedTab} from '../panels/projection-editor.js'
import {namedFolder, sleep} from './folders.js'
import type {ToolInput} from './types.js'

/** `refresh`: the projection tab the person is looking at extracts again, then says what it shows. */
export async function refresh(input: ToolInput): Promise<string> {
  const viewed = viewedTab(namedFolder(input.folder))
  if (!viewed) return noProjectionTab
  await viewed.tab.control({op: 'refresh'})
  for (const end = Date.now() + 120_000; Date.now() < end;) {
    await sleep(500)
    const page = (await viewed.tab.control({op: 'currentView'}).catch(() => undefined)) as PageView | undefined
    if (page?.status && page.status !== 'extracting') break
  }
  return `Extracted again.\n\n${currentViewText(await viewed.tab.viewFacts(viewed.inFront))}`
}

/** `current_view`: what the projection tab the person is looking at shows. */
export async function currentView(input: ToolInput): Promise<string> {
  const viewed = viewedTab(namedFolder(input.folder))
  return viewed ? currentViewText(await viewed.tab.viewFacts(viewed.inFront)) : noProjectionTab
}
