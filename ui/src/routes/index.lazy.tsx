import {createLazyFileRoute, useNavigate} from '@tanstack/react-router'
import {
  $exhibitionMode,
  $canPlay,
  $videoMode,
  $offlineMode,
} from '../store/exhibition'
import {automator} from '../utils/exhibition/exhibition-automator'
import {useEffect} from 'react'
import {resetAll} from '../utils/exhibition/reset'
import {fullscreen} from '../utils/commands'
import {$fadeStatus} from '../store/fader'
import {socket} from '../manager/socket'

export const Route = createLazyFileRoute('/')({
  component: SettingsRoute,
})

export function SettingsRoute() {
  const go = useNavigate()

  useEffect(() => {
    resetAll()
    $fadeStatus.set(false)
  }, [])

  // exhibition mode - program
  function startExhibitionProgramReal() {
    $offlineMode.set(true)
    $exhibitionMode.set(true)

    socket.forceReconnectAll('program change - exhibition')

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
    socket.disconnectAll()

    $videoMode.set(true)
    $canPlay.set(true)
    automator.sync({force: true})
    fullscreen()
  }

  // performance lecture mode
  function startLiveLecture() {
    $exhibitionMode.set(false)
    $videoMode.set(false)

    socket.forceReconnectAll('program change - lecture')

    resetAll()

    $canPlay.set(true)
    automator.stopClock()

    // NOTE: do not use fullscreen() here, as it will show "To exit full screen"

    go({to: '/zero'})
  }

  // debug: start exhibition from a fake time
  function setFakeTime() {
    $canPlay.set(true)
    const time = prompt('enter a test time in hh:mm:ss format')

    if (time) {
      setFakeExhibitionOpenTime(time)
    }
  }

  function setFakeExhibitionOpenTime(time: string) {
    resetAll()
    automator.mockTime(time)

    if ($videoMode.get()) {
      setTimeout(() => {
        go({to: '/video'})

        setTimeout(() => {
          automator.sync()
        }, 100)
      }, 150)
    } else {
      go({to: '/zero'})

      automator.sync({force: true})
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full font-mono min-h-screen bg-black text-white gap-y-8">
      <h1 className="text-2xl">program manager</h1>

      <div className="flex flex-col sm:flex-row gap-x-4 gap-y-4">
        <button
          onClick={startExhibitionVideo}
          className="border border-yellow-300 text-yellow-300 px-4 py-2"
        >
          video screen
        </button>

        <button
          onClick={startExhibitionProgramReal}
          className="border border-green-300 text-green-300 px-4 py-2"
        >
          program screen
        </button>
      </div>

      <h2 className="text-xl">testing options</h2>

      <div className="space-y-4">
        <div className="flex justify-start items-center gap-x-4 text-xs">
          <button
            onClick={() => setFakeExhibitionOpenTime('11:12:00')}
            className="border border-gray-300 text-gray-300 px-3 py-2 text-xs"
          >
            set time to 11:12:00
          </button>

          <div>simulate when the first screening round is opening</div>
        </div>

        <div className="flex justify-start items-center gap-x-4 text-xs">
          <button
            onClick={setFakeTime}
            className="border border-gray-300 text-gray-300 px-3 py-2 text-xs"
          >
            set a fake time
          </button>

          <div>simulate a time of day for the exhibition</div>
        </div>

        <div className="flex justify-start items-center gap-x-4 text-xs">
          <button
            onClick={fullscreen}
            className="border border-gray-300 text-gray-300 px-3 py-2 text-xs"
          >
            fullscreen
          </button>

          <div>set the page to full-screen</div>
        </div>

        <div className="flex justify-start items-center gap-x-4 text-xs text-black">
          <button
            onClick={startLiveLecture}
            className="border border-black text-black px-3 py-2 text-xs"
          >
            start lecture
          </button>

          <div>do not click this unless instructed</div>
        </div>

        <div>version: December 1, 2024</div>
      </div>
    </div>
  )
}
