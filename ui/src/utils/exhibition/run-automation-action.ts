import {match} from 'ts-pattern'
import {Tween, Easing} from '@tweenjs/tween.js'

import {AutomationAction} from '../../constants/exhibition-cues'
import {$fadeStatus} from '../../store/fader'
import {$guidance} from '../../store/guidance'
import {$generating, $inferencePreview, $prompt} from '../../store/prompt'
import {keystrokeStream, getRandomDelay} from './keystroke-stream'

import {
  delay,
  onGuidanceCommitted,
  onPromptCommitted,
  onPromptKeyChangeStart,
} from '../prompt-manager'

import {startInference} from '../inference'
import {$transcript} from '../../store/dictation'
import {generateFromPrompt} from '../process-transcript'

import {resetAll} from './reset'
import {disableRegen} from '../../store/regen'
import {resetProgress} from '../../store/progress'
import {$videoMode} from '../../store/exhibition'
import {socket} from '../../manager/socket'

export interface AutomatorContext {
  next(): void
  navigate(route: string): void
  cue(): number
  elapsed(): number
}

// Used to control transcription's word-by-word typing speed
const W_SAMPLING_DELAY_MS = 70
const W_SAMPLING_LIMIT = 100000
const W_MIN_WORDS_FOR_TYPING = 1

export function runScreeningStartTask() {
  console.log('[start of show]')
  resetAll()

  $fadeStatus.set(true)
}

export function runAutomationAction(
  action: AutomationAction,
  context: AutomatorContext
) {
  const {next, navigate} = context

  const now = context.elapsed()
  const currentCue = context.cue()

  if (!action || !action.action) return

  match(action)
    .with({action: 'start'}, () => {
      runScreeningStartTask()
    })
    .with({action: 'move-slider'}, (action) => {
      const guidance = {value: $guidance.get()}

      new Tween(guidance)
        .to({value: action.value}, 1000)
        .easing(Easing.Quadratic.InOut)
        .onUpdate(() => {
          $guidance.set(guidance.value)
        })
        .onComplete(() => {
          onGuidanceCommitted({command: action.program, value: action.value})
        })
        .start()
    })
    .with({action: 'set-fade-status'}, (action) => {
      $fadeStatus.set(action.fade)
    })
    .with({action: 'navigate'}, (action) => {
      $generating.set(false)
      resetProgress()
      disableRegen('scene switch')

      if ($videoMode.get()) return

      navigate(action.route)
    })
    .with({action: 'prompt'}, (action) => {
      const {commit = true} = action

      onPromptKeyChangeStart()

      const stream = keystrokeStream($prompt.get(), action.prompt)
      const {base = 100, variance = 80} = action.delay ?? {}

      const update = () => {
        const result = stream.next()

        const backendPrompt = action.override ?? action.prompt

        if (!result.done) {
          $prompt.set(result.value)

          const delay = getRandomDelay(base, variance)
          setTimeout(update, delay)
        } else if (!commit) {
          // do nothing
        } else if (action.enter && action.program) {
          startInference({
            prompt: backendPrompt,
            command: action.program,
            regenerate: action.enter.regen,
          })
        } else if (action.program) {
          const guidance = action.guidance ?? $guidance.get()

          onPromptCommitted({
            input: backendPrompt,
            command: action.program,
            guidance,
          })
        }
      }

      update()
    })
    .with({action: 'next'}, async () => {
      if ($videoMode.get()) return

      next()
    })
    .with({action: 'transcript'}, async (action) => {
      if (action.generate) {
        generateFromPrompt(action.transcript)
      }

      if (action.words && action.words.length > W_MIN_WORDS_FOR_TYPING) {
        let sentence = ''
        let timePassed = 0
        const words = action.words.slice(0, -1)

        // prevent infinite loop
        let limit = 0

        // simulate hand-typing the transcript
        while (context.cue() === currentCue && words.length > 0) {
          if (limit++ > W_SAMPLING_LIMIT) break

          const duration = now + timePassed / 1000
          const [word] = words

          timePassed += W_SAMPLING_DELAY_MS
          await delay(W_SAMPLING_DELAY_MS)

          if (duration > word.end) {
            words.shift()

            sentence += `${word.word}`
            $transcript.set({transcript: sentence, final: false})
          }
        }
      }

      $transcript.set({transcript: action.transcript, final: false})
    })
    .with({action: 'reconnect'}, () => {
      resetProgress()

      // disable regen and reconnect to server.
      const hasRegenEnabled = disableRegen('force reconnect to server')

      if (!hasRegenEnabled) {
        socket.reconnectSoon('textToImage', {
          reason: 'force reconnect to server',
          removeListener: true,
          delay: 10,
        })
      }
    })
    .with({action: 'end'}, () => {
      $prompt.set('')
      $transcript.set({transcript: '', final: false})
      $inferencePreview.set('')

      setTimeout(() => {
        $fadeStatus.set(false)
      }, 500)
    })
    .exhaustive()
}
