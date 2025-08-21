import {Icon} from '@iconify/react'
import {useMatchRoute, useRouterState} from '@tanstack/react-router'

import {useIsVideo} from '../hooks/useIsVideo'
import {useStore} from '@nanostores/react'
import {$exhibitionMode} from '../store/exhibition'

const programNameMap: Record<string, string> = {
  one: '1',
  two: '2',
  'two-b': '2B',
  three: '3',
  'three-b': '3B',
  four: '4',
  'four-b': '4B',
}

export function CurrentProgramBadge() {
  const routeState = useRouterState()
  const mr = useMatchRoute()
  const isSpeechRoute = mr({to: '/zero'})

  const isVideo = useIsVideo()

  const currentProgramKey = routeState.location.href.replace('/', '')
  const currentProgram = programNameMap[currentProgramKey]

  const isExhibitionMode = useStore($exhibitionMode)

  // always show
  // indicate that we are on the video screen
  if (isVideo && isExhibitionMode) {
    return null
  }

  // hide program badge when there is no active program
  if (!currentProgram) return null

  // hide program badge when on the speech route
  if (isSpeechRoute) return null

  // once we finalise, we can hide the programme codes at the bottom left.
  // we can keep the progress counter and the connection indicator
  if (isExhibitionMode) return null

  return (
    <div className="bg-[#2d2d30] text-white leading-3 px-[5px] py-[4px] text-xs rounded-md font-mono">
      {currentProgram}
    </div>
  )
}
