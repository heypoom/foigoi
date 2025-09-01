import {useHotkeys} from 'react-hotkeys-hook'
import {useNavigate} from '@tanstack/react-router'

import {black, fullscreen} from '../utils/commands'

import {useSceneSwitcher} from '../hooks/useSceneSwitcher'

import {useExhibitionScheduler} from '../hooks/useExhibitionScheduler'
import {useExhibitionAutomator} from '../hooks/useExhibitionAutomator'

import {
  $offlineMode,
  $exhibitionMode,
  $videoMode,
  $canPlay,
} from '../store/exhibition'
import {automator} from '../utils/exhibition/exhibition-automator'
import {useEffect} from 'react'

export const HeadlessController = () => {
  const cmd = useSceneSwitcher()
  const go = useNavigate()

  const atm = useExhibitionAutomator()
  useExhibitionScheduler()

  useHotkeys('CTRL + F', fullscreen)
  useHotkeys('CTRL + B', black)

  useHotkeys('LeftArrow', cmd.prev)
  useHotkeys('RightArrow', cmd.next)

  // go to settings
  useHotkeys('CTRL + H', () => go({to: '/'}))
  useHotkeys('CTRL + G', () => atm.go())

  // exhibition mode - program
  function startExhibitionProgramReal() {
    $offlineMode.set(true)
    $exhibitionMode.set(true)

    $videoMode.set(false)
    $canPlay.set(true)
    automator.sync({force: true})
    fullscreen()

    go({to: '/black'})
  }

  // exhibition mode - video
  function startExhibitionVideo() {
    go({to: '/video'})

    $exhibitionMode.set(true)

    $videoMode.set(true)
    $canPlay.set(true)
    automator.sync({force: true})
    fullscreen()
  }

  useEffect(() => {
    const params = window.location.search

    if (params.includes('screen=left')) {
      startExhibitionVideo()
    } else if (params.includes('screen=right')) {
      startExhibitionProgramReal()
    }
  })

  return null
}
