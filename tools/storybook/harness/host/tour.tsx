// `?controlled`: the page owns progress, playback, mode and the divider, as a guided tour would.
import {useCallback, useState, type Dispatch, type SetStateAction} from 'react'
import type {ComparisonMode} from '@githubnext/projections-host'

export interface TourState {
  progress: number
  playing: boolean
  requests: number
  ignore: boolean
  mode: ComparisonMode
  swipe: number
}

/** The tour's state and the explorer's controlled props: each request counts, and applies unless ignored. */
export function useTour() {
  const [tour, setTour] = useState<TourState>({progress: 1, playing: false, requests: 0, ignore: false, mode: 'animated', swipe: 0.5})
  const request = useCallback(
    (change: Partial<TourState>) => setTour(state => ({...state, requests: state.requests + 1, ...(state.ignore ? {} : change)})),
    [],
  )
  const onProgressChange = useCallback((progress: number) => request({progress}), [request])
  const onModeChange = useCallback((mode: ComparisonMode) => request({mode}), [request])
  const onSwipePositionChange = useCallback((swipe: number) => request({swipe}), [request])
  const onPlayingChange = useCallback((playing: boolean) => request({playing}), [request])
  const props = {
    progress: tour.progress,
    playing: tour.playing,
    onProgressChange,
    onPlayingChange,
    mode: tour.mode,
    onModeChange,
    swipePosition: tour.swipe,
    onSwipePositionChange,
  }
  return {tour, setTour, props}
}

/** The tour's buttons and the evidence the suites read. */
export function TourControls({tour, setTour}: {tour: TourState; setTour: Dispatch<SetStateAction<TourState>>}) {
  return (
    <div className="demo-tour" role="group" aria-label="Guided tour">
      <button type="button" onClick={() => setTour(state => ({...state, progress: 0.25, playing: false}))}>
        Tour: seek 25%
      </button>
      <button type="button" onClick={() => setTour(state => ({...state, progress: 0, playing: true}))}>
        Tour: play from start
      </button>
      <button type="button" onClick={() => setTour(state => ({...state, playing: false}))}>
        Tour: pause
      </button>
      <button type="button" onClick={() => setTour(state => ({...state, mode: 'side-by-side'}))}>
        Tour: side by side
      </button>
      <button type="button" onClick={() => setTour(state => ({...state, mode: 'swipe', swipe: 0.3}))}>
        Tour: swipe at 30%
      </button>
      <button type="button" onClick={() => setTour(state => ({...state, mode: 'animated'}))}>
        Tour: animated
      </button>
      <label>
        <input type="checkbox" checked={tour.ignore} onChange={event => setTour(state => ({...state, ignore: event.target.checked}))} />{' '}
        Ignore requests
      </label>
      <span>
        Tour progress <output aria-label="Tour progress">{Math.round(tour.progress * 100)}%</output>
      </span>
      <span>
        Tour playing <output aria-label="Tour playing">{tour.playing ? 'yes' : 'no'}</output>
      </span>
      <span>
        Tour mode <output aria-label="Tour mode">{tour.mode}</output>
      </span>
      <span>
        Tour divider <output aria-label="Tour divider">{Math.round(tour.swipe * 100)}%</output>
      </span>
      <span>
        Requests <output aria-label="Tour requests">{tour.requests}</output>
      </span>
    </div>
  )
}
