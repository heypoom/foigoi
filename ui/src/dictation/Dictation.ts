import {$dictationState, $transcript} from '../store/dictation'
import {$exhibitionMode} from '../store/exhibition'

import {
  generateFromPrompt,
  processInterimTranscript,
} from '../utils/process-transcript'

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition

/** Forcibly restart the recognizer after N words */
const FORCE_RESTART_BACKLOG_LIMIT = 20

/** Delay for N milliseconds before starting recognizer again */
const DELAY_BEFORE_START = 10

/** Wait for N milliseconds of total silence before restarting */
const WATCHDOG_TIMEOUT = 1000 * 7

export class Dictation {
  // Dictation Watchdog Timer
  silenceWatchdog = 0
  restarting = false

  get listening() {
    return $dictationState.get() === 'listening'
  }

  private recognition: SpeechRecognition | null = null

  restartWatchdog() {
    if (this.silenceWatchdog) {
      window.clearTimeout(this.silenceWatchdog)
    }

    // It's too quiet. Restart the recognition.
    this.silenceWatchdog = window.setTimeout(() => {
      // alternative logic: check if path is not ROOT
      if (!this.recognition) {
        console.log('[speech] recognition gone - not restarting watchdog.')
        return
      }

      this.restart('watchdog')
    }, WATCHDOG_TIMEOUT)
  }

  start = () => {
    if (this.listening && this.recognition) return

    this.restarting = false
    this.restartWatchdog()

    $dictationState.set('starting')

    this.recognition = new SpeechRecognition()
    this.recognition.continuous = true
    this.recognition.interimResults = true
    this.recognition.lang = 'en-SG'

    this.recognition.addEventListener(
      'audiostart',
      this.onAudioStart.bind(this)
    )

    this.recognition.addEventListener('result', this.onResult.bind(this))
    this.recognition.addEventListener('error', this.onError.bind(this))
    this.recognition.addEventListener('end', this.onEnd.bind(this))

    this.recognition.start()
  }

  restart(reason: string) {
    // do not listen in exhibition mode
    if ($exhibitionMode.get()) return

    if (this.restarting) {
      return
    }

    if (reason) {
      console.log(`[speech] restarting due to "${reason}"`)
    }

    this.restarting = true

    clearTimeout(this.silenceWatchdog)

    if (this.listening) {
      this.stop()

      setTimeout(() => {
        this.start()
      }, DELAY_BEFORE_START)
    } else {
      this.start()
    }
  }

  onAudioStart() {
    $dictationState.set('listening')
  }

  async onResult(event: SpeechRecognitionEvent) {
    console.log(`i hear`)

    const {results} = event
    const latest = results.item(results.length - 1)
    const first = latest.item(0)

    this.restartWatchdog()

    if (latest.isFinal) {
      await generateFromPrompt(first.transcript)
      return
    }

    await this.processInterimTranscript(results)
  }

  async processInterimTranscript(list: SpeechRecognitionResultList) {
    const results = [...list].map((r) => ({
      transcript: r.item(0).transcript,
      isFinal: r.isFinal,
    }))

    const {transcript, backlogLength} = processInterimTranscript(results)

    $transcript.set({transcript, final: false})

    if (backlogLength > FORCE_RESTART_BACKLOG_LIMIT) {
      this.restart('too many backlogs')
    }
  }

  onError(event: SpeechRecognitionErrorEvent) {
    // restart the recognition if speech is not detected
    if (event.error === 'no-speech') {
      this.restart('error of no-speech')

      return
    }

    $dictationState.set('failed')

    if (event.error === 'aborted') {
      this.restart('error of aborted')

      return
    }
  }

  onEnd() {
    console.log('[speech] recognition end')
  }

  stop = () => {
    $dictationState.set('stopped')
    this.recognition?.stop()
    this.recognition = null
  }
}

// Dictation singleton.
export const dictation = new Dictation()
