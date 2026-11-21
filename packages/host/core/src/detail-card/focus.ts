import {useCallback, useEffect, useRef} from 'react'
import type {RefObject} from 'react'
import type {Row} from '../model.js'
import type {Side} from '../modes.js'
import type {ProjectionController} from '../projection.js'

/** The element the card's opening focuses: its title. */
const focusTarget = (card: HTMLElement) => card.querySelector<HTMLElement>('[data-detail-card-title]') ?? card

export interface CardFocusInput {
  projection: ProjectionController
  container: RefObject<HTMLElement | null>
  view: RefObject<HTMLElement | null> | undefined
  card: HTMLElement | null
  /** The row the card is about while it is open. */
  row: Row | null
  /** The selection the card is for, which closing dismisses. */
  key: string | null
  setDismissed: (key: string | null) => void
  /** Whether the card has been placed. */
  shown: boolean
}

/**
 * How a detail card takes and returns focus, and how it is dismissed: Escape, the close action or a pointer press
 * outside it closes it and returns focus to where it was before the card (or the renderer frame); a selection made with
 * the keyboard (in the container or from the card) brings focus to the new card.
 */
export function useCardFocus({projection, container, view, card, row, key, setDismissed, shown}: CardFocusInput) {
  const rowId = row?.id
  const frames = projection.stage.frames
  const focus = useRef<{returnTo: Element | null; lastOutside: Element | null; inCard: boolean; keyboardAt: number; next: boolean}>({
    returnTo: null,
    lastOutside: null,
    inCard: false,
    keyboardAt: -Infinity,
    next: false,
  })

  const returnFocus = useCallback(() => {
    if (!card?.contains(document.activeElement)) return
    const back = focus.current.returnTo
    if (back instanceof HTMLElement && back.isConnected && back !== document.body && !card.contains(back)) {
      back.focus({preventScroll: true})
      return
    }
    const side: Side = projection.anchorFor(rowId)?.side ?? 'after'
    const iframe = frames.current[side]?.iframe ?? frames.current.after?.iframe
    if (iframe?.isConnected) iframe.focus({preventScroll: true})
    else (document.activeElement as HTMLElement | null)?.blur()
  }, [card, projection, rowId, frames])

  const close = useCallback(() => {
    returnFocus()
    setDismissed(key)
  }, [returnFocus, key, setDismissed])

  // Focus bookkeeping: where focus was before it entered the card, and selections made with the keyboard.
  useEffect(() => {
    const state = focus.current
    const box = container.current
    const focusIn = (event: FocusEvent) => {
      const element = event.target instanceof Element ? event.target : null
      if (card && element && card.contains(element)) {
        if (!state.inCard) state.returnTo = state.lastOutside
        state.inCard = true
      } else {
        state.lastOutside = element
        state.inCard = false
      }
    }
    const keyDown = (event: KeyboardEvent) => {
      const element = event.target instanceof Element ? event.target : null
      if (event.key === 'Escape' && !event.defaultPrevented && row) {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if ((event.key === 'Enter' || event.key === ' ') && !(card && element && card.contains(element))) {
        state.keyboardAt = performance.now()
      }
    }
    const pointerDown = (event: PointerEvent) => {
      state.keyboardAt = -Infinity
      const target = event.target instanceof Node ? event.target : null
      if (!row || !card || !target || card.contains(target)) return
      const inView = view?.current?.contains(target) ?? false
      if (!inView || box?.contains(target)) setDismissed(key)
    }
    // Escape with focus nowhere in particular (Safari doesn't focus a clicked button, so focus stays on the body) or in
    // a card portalled outside the container closes the card too.
    const documentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !row) return
      const active = document.activeElement
      const unfocused = !active || active === document.body || active === document.documentElement
      if (!unfocused && !(card && active && card.contains(active))) return
      if (box && active && box.contains(active)) return
      event.preventDefault()
      close()
    }
    document.addEventListener('focusin', focusIn, true)
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('keydown', documentKeyDown)
    box?.addEventListener('keydown', keyDown)
    return () => {
      document.removeEventListener('focusin', focusIn, true)
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('keydown', documentKeyDown)
      box?.removeEventListener('keydown', keyDown)
    }
  }, [container, view, card, row, key, close, setDismissed])

  // A selection made with the keyboard (in the container or from the card) brings focus to the new card.
  useEffect(() => {
    if (!row || !card || !shown) return
    const state = focus.current
    const active = document.activeElement
    const keyboard =
      performance.now() - state.keyboardAt < 1000 &&
      active instanceof HTMLElement &&
      active.tagName !== 'IFRAME' &&
      Boolean(container.current?.contains(active))
    if (state.next || keyboard) {
      state.next = false
      state.keyboardAt = -Infinity
      if (!card.contains(active)) state.returnTo = active
      state.inCard = true
      focusTarget(card).focus({preventScroll: true})
    }
  }, [key, row, card, shown, container])

  const select = useCallback(
    (id: string) => {
      focus.current.next = true
      projection.select(id)
    },
    [projection],
  )

  return {close, select}
}
