import {createLazyFileRoute} from '@tanstack/react-router'
import {useState, useEffect, useCallback, useMemo} from 'react'
import {automator} from '../utils/exhibition/exhibition-automator'
import {AutomationCue} from '../constants/exhibition-cues'
import {getPreviewStepsForCue} from '../utils/exhibition/offline-automation-replay'

export const Route = createLazyFileRoute('/image-viewer')({
  component: ImageViewer,
})

const DEFAULT_PREGEN_VERSION_ID = 2 // default pregen version ID
const TRANSCRIPT_MAX_VARIANT_COUNT = 30 // Program 0 transcript cues
const PROMPT_MAX_VARIANT_COUNT = 50 // Other programs (prompt actions)

function getMaxVariantCount(cue: AutomationCue): number {
  if (cue.action === 'transcript') {
    return TRANSCRIPT_MAX_VARIANT_COUNT
  } else if (cue.action === 'move-slider') {
    return PROMPT_MAX_VARIANT_COUNT // Slider cues use the same variant count as prompts
  } else {
    return PROMPT_MAX_VARIANT_COUNT
  }
}

function ImageViewer() {
  const [cueIndex, setCueIndex] = useState(0)
  const [variantIndex, setVariantIndex] = useState(1)
  const [previewStep, setPreviewStep] = useState(-1) // -1 = final.png, 0-N = preview steps
  const [imageError, setImageError] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [pregenVersionId, setPregenVersionId] = useState(
    DEFAULT_PREGEN_VERSION_ID
  )

  // Filter cues that have generation enabled - matching generate.ts logic
  const imageGenerationCues = useMemo(() => {
    if (!isReady) {
      return []
    }

    return automator.cues.filter((cue) => {
      // Transcript cues with generation enabled
      if (cue.action === 'transcript' && cue.generate) {
        return true
      }

      // Prompt cues with generation enabled - matching generate.ts filtering logic
      if (cue.action === 'prompt') {
        // Skip if no prompt or commit is false
        if (!cue.prompt || cue.commit === false) {
          return false
        }

        return true
      }

      // Slider cues with generation enabled
      if (cue.action === 'move-slider') {
        return true
      }

      return false
    })
  }, [isReady])

  const currentCue = imageGenerationCues[cueIndex]
  const totalCues = imageGenerationCues.length
  const maxVariantCount = currentCue
    ? getMaxVariantCount(currentCue)
    : PROMPT_MAX_VARIANT_COUNT

  // Get the max preview steps for the current cue
  const maxPreviewSteps = currentCue
    ? getPreviewStepsForCue(currentCue, pregenVersionId) - 1
    : 39 // -1 because steps are 0-indexed

  // Generate image path based on generate.ts logic
  const generateImagePath = useCallback(
    (cue: AutomationCue, variant: number, step: number = -1) => {
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
        // unsupported action type.
        return ''
      }

      // For prompt cues, support preview steps (0-N.png) and final.png
      // For transcript and slider cues, only final.png is available
      let fileName: string
      const maxSteps = getPreviewStepsForCue(cue, pregenVersionId) - 1 // -1 because steps are 0-indexed
      if (
        (cue.action === 'prompt' || cue.action === 'move-slider') &&
        step >= 0 &&
        step <= maxSteps
      ) {
        fileName = `${step}.png`
      } else {
        fileName = 'final.png'
      }

      return `./foigoi/${pregenVersionId}/cues/${cueId}/${variant}/${fileName}`
    },
    [pregenVersionId]
  )

  const currentImagePath = currentCue
    ? generateImagePath(currentCue, variantIndex, previewStep)
    : ''

  // Poll until automator is ready
  useEffect(() => {
    let timeout: number = 0

    const checkReady = () => {
      if (automator.loaded) {
        clearTimeout(timeout)
        setIsReady(true)
      } else {
        timeout = setTimeout(checkReady, 100) // Check every 100ms
      }
    }

    checkReady()

    return () => clearTimeout(timeout)
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          setCueIndex((prev) => (prev > 0 ? prev - 1 : totalCues - 1))
          setPreviewStep(-1) // Reset to final image when changing cues
          setImageError(false)
          break
        case 'ArrowRight':
          e.preventDefault()
          setCueIndex((prev) => (prev < totalCues - 1 ? prev + 1 : 0))
          setPreviewStep(-1) // Reset to final image when changing cues
          setImageError(false)
          break
        case 'ArrowUp':
          e.preventDefault()
          setVariantIndex((prev) => (prev < maxVariantCount ? prev + 1 : 1))
          setPreviewStep(-1) // Reset to final image when changing variants
          setImageError(false)
          break
        case 'ArrowDown':
          e.preventDefault()
          setVariantIndex((prev) => (prev > 1 ? prev - 1 : maxVariantCount))
          setPreviewStep(-1) // Reset to final image when changing variants
          setImageError(false)
          break
        case ',':
          e.preventDefault()
          if (
            currentCue &&
            (currentCue.action === 'prompt' ||
              currentCue.action === 'move-slider')
          ) {
            setPreviewStep((prev) =>
              prev > 0 ? prev - 1 : prev === -1 ? maxPreviewSteps : -1
            )
            setImageError(false)
          }
          break
        case '.':
          e.preventDefault()
          // Only works for prompt cues (non-transcript)
          if (
            currentCue &&
            (currentCue.action === 'prompt' ||
              currentCue.action === 'move-slider')
          ) {
            setPreviewStep((prev) =>
              prev < maxPreviewSteps ? prev + 1 : prev === -1 ? 0 : -1
            )
            setImageError(false)
          }
          break
        case 'v':
          e.preventDefault()
          setPregenVersionId((prev) => (prev === 1 ? 2 : 1))
          setImageError(false)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [totalCues, currentCue, maxVariantCount, maxPreviewSteps])

  // Reset image error when image changes
  useEffect(() => {
    setImageError(false)
  }, [currentImagePath])

  // If not ready, show loading state
  if (!isReady) {
    return <div className="min-h-screen bg-[#424242]" />
  }

  if (currentCue === undefined || currentCue === null) {
    return (
      <div className="min-h-screen bg-[#424242] flex items-center justify-center text-white">
        <div className="text-center">
          <h1 className="text-2xl mb-4">No generated cues found</h1>
          <p>
            Check exhibition-cues.ts for transcript cues with generate: true
          </p>
          <p>or prompt cues that match the generation criteria</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#424242] text-white relative">
      {/* Image Display */}
      <div className="flex items-center justify-center min-h-screen">
        {imageError ? (
          <div className="border-2 border-gray-600 border-dashed rounded-lg p-8 text-center">
            <div className="text-6xl mb-4">🖼️</div>
            <div className="text-xl mb-2">Missing Image</div>
            <div className="text-sm text-gray-400 font-mono break-all">
              {currentImagePath}
            </div>
          </div>
        ) : (
          <img
            src={currentImagePath}
            alt={`Cue ${cueIndex} Variant ${variantIndex}`}
            className="w-full h-full min-h-[100vh] object-cover"
            onError={() => setImageError(true)}
          />
        )}
      </div>

      {/* Metadata Overlay */}
      <div className="absolute top-4 left-4 bg-black/70 rounded p-4 font-mono text-sm">
        <div className="mb-2">
          <span className="text-gray-400">Cue:</span> {cueIndex + 1}/{totalCues}
        </div>
        <div className="mb-2">
          <span className="text-gray-400">Type:</span> {currentCue.action}
        </div>
        <div className="mb-2">
          <span className="text-gray-400">Time:</span> {currentCue.time}
        </div>
        <div className="mb-2">
          <span className="text-gray-400">Variant:</span> {variantIndex}/
          {maxVariantCount}
        </div>
        <div className="mb-2">
          <span className="text-gray-400">Program:</span>{' '}
          {currentCue.action === 'prompt'
            ? currentCue.program
            : currentCue.action === 'move-slider'
              ? currentCue.program
              : 'P0'}
        </div>
        <div className="mb-2">
          <span className="text-gray-400">Version:</span> {pregenVersionId}
        </div>
        {currentCue.action === 'move-slider' && (
          <div className="mb-2">
            <span className="text-gray-400">Slider Value:</span>{' '}
            {currentCue.value}
          </div>
        )}
        {(currentCue.action === 'prompt' ||
          currentCue.action === 'move-slider') && (
          <div className="mb-2">
            <span className="text-gray-400">Step:</span>{' '}
            {previewStep === -1 ? 'final' : `${previewStep}/${maxPreviewSteps}`}
          </div>
        )}
        <div className="max-w-md">
          <span className="text-gray-400">Prompt:</span>{' '}
          <span className="break-words">
            {currentCue.action === 'transcript'
              ? currentCue.transcript
              : currentCue.action === 'prompt'
                ? currentCue.override || currentCue.prompt
                : currentCue.action === 'move-slider'
                  ? `Slider action: ${currentCue.program} → ${currentCue.value}`
                  : 'N/A'}
          </span>
        </div>
      </div>

      {/* Keyboard Guide */}
      <div className="absolute top-4 right-4 bg-black/70 rounded p-4 font-mono text-sm">
        <div className="text-gray-400 mb-2">Navigation:</div>
        <div>← → Change cue</div>
        <div>↑ ↓ Change variant</div>
        <div>v Toggle version (1/2)</div>
        {currentCue &&
          (currentCue.action === 'prompt' ||
            currentCue.action === 'move-slider') && (
            <div>, . Change preview step</div>
          )}
      </div>
    </div>
  )
}
