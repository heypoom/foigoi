import {AutomationCue} from '../../constants/exhibition-cues'
import {automator} from './exhibition-automator'
import {$timestep, $startTimestep} from '../../store/progress'
import {$regenCount, $regenActive, $regenEnabled} from '../../store/regen'

// Project ID for image path
const PROJ_ID = 'foigoi'

// Which version of pre-generated images to use
const PREGEN_VERSION_ID = 2

// Program 0 transcript cues
const TRANSCRIPT_MAX_VARIANT_COUNT = 30

// Other programs (prompt and move-slider actions)
const PROMPT_MAX_VARIANT_COUNT = 50

const V1_DEFAULT_PREVIEW_STEPS = 10
const V2_DEFAULT_PREVIEW_STEPS = 40

// Wait a fixed 500ms delay before showing the next transcript cues
const TRANSCRIPT_DELAY_MS = 500

// Minimum and maximum delay for prompt cues
const MIN_DELAY = 750
const MAX_DELAY = 1800

// Regeneration timing constants (from regen.ts)
const BASE_DELAY = 30 * 1000 // 30 seconds
const INCREMENTAL_DELAY = BASE_DELAY // 30 seconds
const BASE_GENERATION = 6

// Track active regeneration
let regenerationTimer: number | null = null
let currentRegenerationCue: AutomationCue | null = null

// Track any ongoing inference (to prevent race conditions)
let ongoingInferenceCue: AutomationCue | null = null

function getRandomVariant(
  actionType: 'transcript' | 'prompt' | 'move-slider'
): number {
  const maxCount =
    actionType === 'transcript'
      ? TRANSCRIPT_MAX_VARIANT_COUNT
      : PROMPT_MAX_VARIANT_COUNT
  return 1 + Math.floor(Math.random() * maxCount)
}

export function getPreviewStepsForCue(
  cue: AutomationCue,
  pregenVersionId?: number
): number {
  // override inference step if defined in the cue
  if (
    (cue.action === 'prompt' || cue.action === 'move-slider') &&
    cue.program
  ) {
    if (cue.inferenceStep !== undefined) {
      return cue.inferenceStep
    }
  }

  // Use the dynamic version if not specified
  const version = pregenVersionId ?? getPregenVersionForCue(cue)

  if (version === 1) {
    return V1_DEFAULT_PREVIEW_STEPS
  }

  return V2_DEFAULT_PREVIEW_STEPS
}

function getPregenVersionForCue(cue: AutomationCue): number {
  // Use version 1 for Program 4
  if (cue.action === 'prompt' && cue.program === 'P4') {
    return 1
  }

  // Use version 2 for everything else
  return PREGEN_VERSION_ID
}

export function generateOfflineImagePath(
  cue: AutomationCue,
  variantId: number,
  step: number
): string {
  const allCueIndex = automator.cues.indexOf(cue)
  const cueSuffix = `${allCueIndex}_${cue.time.replace(/[:.]/g, '_')}`

  let cueId: string
  if (cue.action === 'transcript') {
    cueId = `transcript_${cueSuffix}`
  } else if (cue.action === 'prompt') {
    cueId = `prompt_${cueSuffix}`
  } else if (cue.action === 'move-slider') {
    cueId = `slider_${cueSuffix}_val${cue.value}`
  } else {
    return ''
  }

  // For prompt and move-slider cues, support preview steps (0-N.png) and final.png
  // For transcript cues, only final.png is available
  let fileName: string
  if ((cue.action === 'prompt' || cue.action === 'move-slider') && step >= 0) {
    const maxStep = getPreviewStepsForCue(cue) - 1

    if (step <= maxStep) {
      fileName = `${step}.png`
    } else {
      fileName = 'final.png'
    }
  } else {
    fileName = 'final.png'
  }

  const version = getPregenVersionForCue(cue)

  return `./${PROJ_ID}/${version}/cues/${cueId}/${variantId}/${fileName}`
}

export function shouldHandleOfflineGeneration(cue: AutomationCue): boolean {
  // Handle transcript cues with generation enabled
  if (cue.action === 'transcript' && cue.generate) {
    return true
  }

  // Handle prompt cues with generation enabled
  if (cue.action === 'prompt') {
    // Skip if no prompt or commit is false
    if (!cue.prompt || cue.commit === false) {
      return false
    }

    return true
  }

  // Handle slider cues with generation enabled
  if (cue.action === 'move-slider') {
    return true
  }

  return false
}

export function createBlackBackgroundDataUrl(): string {
  // Create a 1x1 black pixel as data URL
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, 1, 1)
  }
  return canvas.toDataURL()
}

export async function loadOfflineImage(
  imagePath: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()

    img.onload = () => {
      resolve(imagePath)
    }

    img.onerror = () => {
      resolve(null)
    }

    img.src = imagePath
  })
}

export async function simulateStepByStepInference(
  cue: AutomationCue,
  onStepUpdate: (
    imageUrl: string | null,
    step: number,
    isComplete: boolean
  ) => void
): Promise<void> {
  // Set this as the ongoing inference
  ongoingInferenceCue = cue
  const variantId = getRandomVariant(
    cue.action === 'transcript'
      ? 'transcript'
      : cue.action === 'move-slider'
        ? 'move-slider'
        : 'prompt'
  )

  // For transcript cues, only show final image directly
  // For move-slider with value=0 (strength=0), show final image immediately
  if (cue.action === 'transcript') {
    const finalImagePath = generateOfflineImagePath(cue, variantId, -1)
    const loadedImageUrl = await loadOfflineImage(finalImagePath)

    // wait for 0.5 seconds.
    await new Promise((resolve) => setTimeout(resolve, TRANSCRIPT_DELAY_MS))

    // Check if we should still continue before updating
    if (!shouldContinueInference(cue)) {
      console.log(
        '[offline-inference] Aborted transcript inference during delay'
      )
      ongoingInferenceCue = null
      return
    }

    onStepUpdate(loadedImageUrl, -1, true)
    ongoingInferenceCue = null // Clear ongoing inference when complete
    return
  }

  // For prompt cues and move-slider cues (non-zero value), show step-by-step inference
  if (cue.action === 'prompt' || cue.action === 'move-slider') {
    const totalSteps = getPreviewStepsForCue(cue)
    console.log(`steps for ${cue.action}#${cue.program} is ${totalSteps}`)

    // Set initial timestep
    $startTimestep.set(0)
    $timestep.set(0)

    for (let step = 0; step < totalSteps; step++) {
      // Check if we should abort before each step
      if (!shouldContinueInference(cue)) {
        console.log(`[offline-inference] Aborted inference at step ${step}`)
        ongoingInferenceCue = null
        return
      }

      // Update timestep
      $timestep.set(step)

      const stepImagePath = generateOfflineImagePath(cue, variantId, step)

      const loadedImageUrl = await loadOfflineImage(stepImagePath)

      // Check again after loading image
      if (!shouldContinueInference(cue)) {
        console.log(
          `[offline-inference] Aborted inference after loading step ${step}`
        )
        ongoingInferenceCue = null
        return
      }

      // Update the image
      onStepUpdate(loadedImageUrl, step, false)

      if (step < totalSteps - 1) {
        let delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY)

        // override delay if specified in the cue
        if (cue.fixedDelayPerStep) {
          delay = cue.fixedDelayPerStep
        }

        await new Promise((resolve) => setTimeout(resolve, delay))

        // Check again after delay
        if (!shouldContinueInference(cue)) {
          console.log(
            `[offline-inference] Aborted inference after delay at step ${step}`
          )
          ongoingInferenceCue = null
          return
        }
      }
    }

    // Final check before showing final image
    if (!shouldContinueInference(cue)) {
      console.log('[offline-inference] Aborted inference before final image')
      ongoingInferenceCue = null
      return
    }

    // Show final image
    const finalImagePath = generateOfflineImagePath(cue, variantId, -1)
    const finalImageUrl = await loadOfflineImage(finalImagePath)
    onStepUpdate(finalImageUrl, -1, true)
    ongoingInferenceCue = null // Clear ongoing inference when complete
  }
}

/**
 * Calculate regeneration delay based on current regen count
 * Matches the delay logic from ui/src/store/regen.ts
 */
function calculateRegenerationDelay(): number {
  const gen = $regenCount.get()
  let delay = BASE_DELAY

  if (gen > BASE_GENERATION) {
    delay += (gen - BASE_GENERATION) * INCREMENTAL_DELAY
  }

  return delay
}

/**
 * Check if regeneration should continue by monitoring current cue changes
 */
function shouldContinueRegeneration(originalCue: AutomationCue): boolean {
  return currentRegenerationCue === originalCue && $regenActive.get()
}

/**
 * Check if any inference should continue (for both regeneration and single inference)
 */
function shouldContinueInference(originalCue: AutomationCue): boolean {
  return ongoingInferenceCue === originalCue
}

/**
 * Start offline continuous regeneration for Program B cues
 */
export async function startOfflineRegeneration(
  cue: AutomationCue,
  onStepUpdate: (
    imageUrl: string | null,
    step: number,
    isComplete: boolean
  ) => void
): Promise<void> {
  // Stop any existing regeneration
  abortOfflineRegeneration()

  // Set up regeneration state
  currentRegenerationCue = cue
  $regenEnabled.set(true)
  $regenActive.set(true)
  $regenCount.set(0)

  console.log(
    `[offline-regen] Starting continuous regeneration for: ${cue.action}`
  )

  // Start the regeneration cycle
  await performRegenerationCycle(cue, onStepUpdate)
}

/**
 * Perform a single regeneration cycle and schedule the next one
 */
async function performRegenerationCycle(
  cue: AutomationCue,
  onStepUpdate: (
    imageUrl: string | null,
    step: number,
    isComplete: boolean
  ) => void
): Promise<void> {
  if (!shouldContinueRegeneration(cue)) {
    return
  }

  // Perform the inference simulation
  await simulateStepByStepInference(cue, onStepUpdate)

  if (!shouldContinueRegeneration(cue)) {
    return
  }

  // Increment regen count
  const currentCount = $regenCount.get()
  $regenCount.set(currentCount + 1)

  // Calculate delay for next regeneration
  const delay = calculateRegenerationDelay()

  console.log(
    `[offline-regen] Next regeneration in ${delay}ms (count: ${currentCount + 1})`
  )

  // Clear any existing timer
  if (regenerationTimer !== null) {
    clearTimeout(regenerationTimer)
    regenerationTimer = null
  }

  // Schedule next regeneration
  regenerationTimer = window.setTimeout(async () => {
    if (shouldContinueRegeneration(cue)) {
      await performRegenerationCycle(cue, onStepUpdate)
    }
  }, delay)
}

/**
 * Abort ongoing offline regeneration
 */
export function abortOfflineRegeneration(): void {
  if (regenerationTimer !== null) {
    clearTimeout(regenerationTimer)
    regenerationTimer = null
  }

  if (currentRegenerationCue !== null) {
    console.log(
      `[offline-regen] Aborting regeneration for: ${currentRegenerationCue.action}`
    )

    currentRegenerationCue = null
  }

  // Also abort any ongoing inference to prevent race conditions
  if (ongoingInferenceCue !== null) {
    console.log(
      `[offline-inference] Aborting ongoing inference for: ${ongoingInferenceCue.action}`
    )

    ongoingInferenceCue = null
  }

  $regenCount.set(0)
  $regenActive.set(false)
}

/**
 * Check if a cue should trigger continuous regeneration
 */
export function shouldStartRegeneration(cue: AutomationCue): boolean {
  return cue.action === 'prompt' && cue.enter?.regen === true
}
