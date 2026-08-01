import {createLazyFileRoute, useNavigate} from '@tanstack/react-router'
import {$exhibitionMode, $canPlay, $videoMode} from '../store/exhibition'
import {automator} from '../utils/exhibition/exhibition-automator'
import {useEffect, useState} from 'react'
import {resetAll} from '../utils/exhibition/reset'
import {fullscreen} from '../utils/commands'
import {$fadeStatus} from '../store/fader'
import {socket} from '../manager/socket'
import {dictation} from '../dictation'

export const Route = createLazyFileRoute('/')({
  component: SettingsRoute,
})

export function SettingsRoute() {
  const go = useNavigate()
  const [debugLog, setDebugLog] = useState('')

  useEffect(() => {
    resetAll()
    $fadeStatus.set(false)
  }, [])

  // performance lecture mode
  function startLiveLecture() {
    $exhibitionMode.set(false)
    $videoMode.set(false)

    socket.clearDisconnectionTimer()
    socket.reconnectSoon('program change - lecture', 10)

    resetAll()

    $canPlay.set(true)
    automator.stopClock()

    // NOTE: do not use fullscreen() here, as it will show "To exit full screen"

    go({to: '/zero'})
  }

  async function installSpeech() {
    const ok = await dictation.setupLocalSpeech()

    if (ok) {
      alert('✅ local speech processing is good to go')
    } else {
      alert('🚨 this is bad, your local speech processing is not working')
    }
  }

  async function testSpeech() {
    const dx = new SpeechRecognition()
    // @ts-expect-error -- ok
    dx.processLocally = true
    dx.continuous = true
    dx.onresult = e => {
      const r = e.results.item(e.resultIndex).item(0).transcript
      setDebugLog(r)
    }
    dx.start()
  }

  return (
    <div className="flex flex-col items-center justify-center h-full font-mono min-h-screen bg-black text-white gap-y-8">
      <h1 className="text-2xl">program manager</h1>

      <div className="flex flex-col sm:flex-row gap-x-4 gap-y-4">
        <button
          onClick={startLiveLecture}
          className="border border-yellow-300 text-yellow-300 px-3 py-2 text-xs"
        >
          start live lecture
        </button>

        <button
          onClick={installSpeech}
          className="border border-gray-300 text-gray-300 px-3 py-2 text-xs"
        >
          install speech
        </button>

        <button
          onClick={testSpeech}
          className="border border-gray-300 text-gray-300 px-3 py-2 text-xs"
        >
          test speech
        </button>

        <button
          onClick={fullscreen}
          className="border border-gray-300 text-gray-300 px-3 py-2 text-xs"
        >
          fullscreen
        </button>
      </div>

      <div className="space-y-4">
        <div>version: November 2, 2025</div>

        {debugLog && <div>voice test: {debugLog}</div>}
      </div>
    </div>
  )
}
