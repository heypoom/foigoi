import {useStore} from '@nanostores/react'

import {$fadeStatus} from '../store/fader'
import {useMatchRoute} from '@tanstack/react-router'
import {useIsVideo} from '../hooks/useIsVideo'

export const FadeToBlack = () => {
  const isFaderVisible = useStore($fadeStatus)

  const mr = useMatchRoute()
  const isVideo = useIsVideo()
  const cannotFadeToBlack = mr({to: '/'}) || mr({to: '/transcript-tester'})

  if (isVideo) return null
  if (cannotFadeToBlack) return null

  return (
    <div
      className={`fixed z-[100000] w-full h-full top-0 left-0 inset-0 bg-black transition-opacity duration-[5s] ease-in-out ${
        isFaderVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{pointerEvents: isFaderVisible ? 'auto' : 'none'}}
      data-testid="fade-to-black"
      data-fader-visible={isFaderVisible}
    />
  )
}

export default FadeToBlack
