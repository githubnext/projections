import {useEffect, useState} from 'react'
import type {InspectorApi} from '../client/api.js'
import {isMarksList, type Marks} from './pairs.js'
import {pairKey, readJson, recentKey, withRecent, writeJson} from './persistence.js'

/**
 * Recently used Before → After pairs of each projection in this repository, newest first: read from storage when a
 * projection is first shown, and each pair it shows (`shownPair`) goes first. The shown pair and the list are saved.
 */
export function useRecentPairs(
  api: InspectorApi | undefined,
  repoKey: string,
  projection: string,
  shownPair: Marks | undefined,
): Record<string, Marks[]> {
  const [recentIn, setRecentIn] = useState<{repoKey: string; lists: Record<string, Marks[]>}>({repoKey, lists: {}})
  // The pair last put first, and where: the same pair shown in another projection or repository goes first there too.
  const [remembered, setRemembered] = useState<{repoKey: string; projection: string; pair: Marks}>()
  let recent = recentIn.repoKey === repoKey ? recentIn.lists : {}
  if (repoKey && projection && !(projection in recent)) {
    recent = {...recent, [projection]: readJson(recentKey(repoKey, projection), isMarksList) ?? []}
  }
  const known =
    remembered !== undefined && remembered.pair === shownPair && remembered.repoKey === repoKey && remembered.projection === projection
  const remember = api && projection && repoKey && shownPair?.a && shownPair.b && !known ? shownPair : undefined
  if (remember) {
    recent = {...recent, [projection]: withRecent(recent[projection], remember)}
    setRemembered({repoKey, projection, pair: remember})
  }
  if (recent !== recentIn.lists) setRecentIn({repoKey, lists: recent})
  const recentHere = recent[projection]
  useEffect(() => {
    if (!api || !projection || !repoKey || !shownPair?.b) return
    writeJson(pairKey(repoKey, projection), shownPair)
    if (shownPair.a && recentHere) writeJson(recentKey(repoKey, projection), recentHere)
  }, [api, projection, repoKey, shownPair, recentHere])
  return recent
}
