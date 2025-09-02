import {match} from 'ts-pattern'
import {Tween, Easing} from '@tweenjs/tween.js'

import {AutomationCue} from '../../constants/exhibition-cues'
import {$fadeStatus} from '../../store/fader'
import {$guidance} from '../../store/guidance'
import {$generating, $inferencePreview, $prompt} from '../../store/prompt'
import {keystrokeStream, getRandomDelay} from './keystroke-stream'
import {delay, onPromptKeyChangeStart} from '../prompt-manager'
import {$transcript} from '../../store/dictation'
import {disableRegen} from '../../store/regen'
import {resetProgress} from '../../store/progress'
import {$videoMode} from '../../store/exhibition'
import {AutomatorContext, runScreeningStartTask} from './run-automation-action'
import {
  shouldHandleOfflineGeneration,
  simulateStepByStepInference,
  shouldStartRegeneration,
  startOfflineRegeneration,
  abortOfflineRegeneration,
} from './offline-automation-replay'

// Used to control transcription's word-by-word typing speed
const W_SAMPLING_DELAY_MS = 70
const W_SAMPLING_LIMIT = 100000
const W_MIN_WORDS_FOR_TYPING = 1

let transcriptionImageTimer: number | null = null

export async function runOfflineAutomationAction(
  action: AutomationCue,
  context: AutomatorContext
) {
  const now = context.elapsed()
  const currentCue = context.cue()

  if (!action || !action.action) return

  // Abort any ongoing regeneration when starting a new action
  abortOfflineRegeneration()

  await match(action)
    .with({action: 'start'}, () => {
      runScreeningStartTask()
    })
    .with({action: 'move-slider'}, async (action) => {
      const guidance = {value: $guidance.get()}

      new Tween(guidance)
        .to({value: action.value}, 1000)
        .easing(Easing.Quadratic.InOut)
        .onUpdate(() => {
          $guidance.set(guidance.value)
        })
        .onComplete(async () => {
          // In offline mode, we don't actually commit to backend
          console.log(
            `[offline] Guidance set to ${action.value} for ${action.program}`
          )

          // Handle offline generation for slider cues
          $generating.set(true)

          console.log(
            `[offline] Starting step-by-step inference simulation for slider: ${action.program} → ${action.value}`
          )

          try {
            await simulateStepByStepInference(
              action,
              (imageUrl, step, isComplete) => {
                if (imageUrl) {
                  $inferencePreview.set(imageUrl)
                }

                if (isComplete) {
                  $generating.set(false)
                  console.log(
                    `[offline] Completed inference simulation for slider: ${action.program} → ${action.value}`
                  )
                } else {
                  console.log(`[offline] Step ${step}: ${imageUrl}`)
                }
              }
            )
          } catch (error) {
            console.error(
              '[offline] Failed to simulate slider inference:',
              error
            )
            $generating.set(false)
          }
        })
        .start()
    })
    .with({action: 'set-fade-status'}, (action) => {
      setTimeout(() => {
        $fadeStatus.set(action.fade)
        console.log('wait and fade')
      }, 500)
    })
    .with({action: 'navigate'}, (action) => {
      $generating.set(false)
      resetProgress()
      disableRegen('scene switch')

      if ($videoMode.get()) return

      const {navigate} = context
      navigate(action.route)
    })
    .with({action: 'prompt'}, async (action) => {
      const {commit = true} = action

      onPromptKeyChangeStart()

      const stream = keystrokeStream($prompt.get(), action.prompt)
      const {base = 100, variance = 80} = action.delay ?? {}

      const update = async () => {
        const result = stream.next()

        if (!result.done) {
          $prompt.set(result.value)

          const delayTime = getRandomDelay(base, variance)
          setTimeout(update, delayTime)
        } else if (!commit) {
          // do nothing
        } else if (shouldHandleOfflineGeneration(action)) {
          $generating.set(true)

          // Check if this should start continuous regeneration
          if (shouldStartRegeneration(action)) {
            console.log(
              `[offline] Starting continuous regeneration for prompt: ${action.prompt}`
            )

            try {
              await startOfflineRegeneration(
                action,
                (imageUrl, step, isComplete) => {
                  if (imageUrl) {
                    $inferencePreview.set(imageUrl)
                  }

                  if (isComplete) {
                    $generating.set(false)
                    console.log(
                      `[offline] Completed regeneration cycle for prompt: ${action.prompt}`
                    )
                  } else {
                    console.log(`[offline] Step ${step}: ${imageUrl}`)
                  }
                }
              )
            } catch (error) {
              console.error('[offline] Failed to start regeneration:', error)
              $generating.set(false)
            }
          } else {
            // Single inference simulation for non-regenerating prompts
            console.log(
              `[offline] Starting step-by-step inference simulation for prompt: ${action.prompt}`
            )

            try {
              await simulateStepByStepInference(
                action,
                (imageUrl, step, isComplete) => {
                  if (imageUrl) {
                    $inferencePreview.set(imageUrl)
                  }

                  if (isComplete) {
                    $generating.set(false)
                    console.log(
                      `[offline] Completed inference simulation for prompt: ${action.prompt}`
                    )
                  } else {
                    console.log(`[offline] Step ${step}: ${imageUrl}`)
                  }
                }
              )
            } catch (error) {
              console.error('[offline] Failed to simulate inference:', error)
              $generating.set(false)
            }
          }
        }
      }

      update()
    })
    .with({action: 'next'}, async () => {
      if ($videoMode.get()) return

      const {next} = context
      next()
    })
    .with({action: 'transcript'}, async (action) => {
      if (action.words && action.words.length > W_MIN_WORDS_FOR_TYPING) {
        let sentence = ''
        let timePassed = 0
        const words = action.words.slice(0, -1)

        // prevent infinite loop
        let limit = 0

        await delay(1000)

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

      // Gladia word utterance
      const [tStart, tEnd] = action.when ?? [0, 0]
      const generationDelay = (tEnd - tStart) * 1000

      if (action.generate && shouldHandleOfflineGeneration(action)) {
        if (transcriptionImageTimer !== null) {
          clearTimeout(transcriptionImageTimer)
        }

        transcriptionImageTimer = setTimeout(async () => {
          // For transcript, show final image directly without step-by-step preview
          console.log(
            `[offline] Loading final image for transcript: ${action.transcript}`
          )

          $generating.set(true)

          try {
            await simulateStepByStepInference(
              action,
              (imageUrl, _step, isComplete) => {
                if (imageUrl) {
                  $inferencePreview.set(imageUrl)
                }

                if (isComplete) {
                  $generating.set(false)
                  console.log(
                    `[offline] Loaded final image for transcript: ${action.transcript}`
                  )
                }
              }
            )
          } catch (error) {
            console.error('[offline] Failed to load transcript image:', error)
            $generating.set(false)
          }
        }, generationDelay)
      }
    })
    .with({action: 'reconnect'}, () => {
      // In offline mode, we don't need to reconnect to server
      // Just reset progress and disable regen
      resetProgress()
      disableRegen('offline mode - no reconnect needed')
      console.log('[offline] Skipping reconnect - running in offline mode')
    })
    .with({action: 'end'}, () => {
      context.navigate('/black')

      $prompt.set('')
      $transcript.set({transcript: '', final: false})
      $inferencePreview.set('')

      setTimeout(() => {
        $fadeStatus.set(false)
      }, 1000)
    })
    .exhaustive()
}
