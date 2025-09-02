import {useMatchRoute, useNavigate} from '@tanstack/react-router'

import {$generating, $inferencePreview} from '../store/prompt'
import {$fadeStatus} from '../store/fader'
import {useStore} from '@nanostores/react'
import {resetProgress} from '../store/progress'
import {dictation} from '../dictation'
import {disableRegen} from '../store/regen'
import {$exhibitionMode, $videoMode} from '../store/exhibition'

const here = (a: false | object) => {
  if (a === false) return false
  if (typeof a === 'object') return true
}

export function useSceneSwitcher() {
  const route = useMatchRoute()
  const go = useNavigate()

  const isExhibition = useStore($exhibitionMode)

  const zero = here(route({to: '/zero'}))
  const one = here(route({to: '/one'}))
  const two = here(route({to: '/two'}))
  const twoB = here(route({to: '/two-b'}))
  const three = here(route({to: '/three'}))
  const threeB = here(route({to: '/three-b'}))
  const four = here(route({to: '/four'}))
  const fourB = here(route({to: '/four-b'}))
  const hasFadedBlack = useStore($fadeStatus)

  const prev = () => {
    clearInference()

    if (one) {
      // live performance
      if (!isExhibition) {
        dictation.start()
      }

      go({to: '/zero'})
    }

    if (two) go({to: '/one'})
    if (twoB) go({to: '/two'})
    if (three) go({to: '/two-b'})
    if (threeB) go({to: '/three'})
    if (four) go({to: '/three-b'})
    if (fourB) go({to: '/four'})
  }

  const next = () => {
    if ($videoMode.get()) return

    clearInference()

    if (zero) {
      dictation.stop()

      // socket.reconnectSoon('textToImage', {delay: 1000, removeListener: true})

      if (hasFadedBlack) {
        // remove the inference preview image from Program 0
        $inferencePreview.set('')

        // go to the next scene
        go({to: '/one'})

        // fade out the black screen
        setTimeout(() => {
          $fadeStatus.set(false)
        }, 50)
      } else {
        $fadeStatus.set(true)
      }
    }

    if (one) go({to: '/two'})
    if (two) {
      go({to: '/two-b'})
    }
    if (twoB) go({to: '/three'})
    if (three) {
      go({to: '/three-b'})
    }
    if (threeB) go({to: '/four'})
    if (four) {
      go({to: '/four-b'})
    }
  }

  function clearInference() {
    $generating.set(false)
    resetProgress()
    disableRegen('scene switch')
  }

  return {next, prev}
}
