import PQueue from 'p-queue'
import _cues from '../data/cues.json'
import type {AutomationCue} from './types'
import {RedisClient} from 'bun'
import {
  TRANSCRIPT_MAX_VARIANT_COUNT,
  PROMPT_MAX_VARIANT_COUNT,
  PREGEN_UPLOAD_STATUS_KEY,
  PREGEN_VERSION_ID,
  VALKEY_URL,
} from './constants'

const cues = _cues as AutomationCue[]

const CONCURRENT_REQUESTS = 10

interface ValidationResult {
  url: string
  cue_id: string
  variant_id: number
  exists: boolean
}

class ImageValidator {
  private queue: PQueue
  private vk: RedisClient

  constructor() {
    this.queue = new PQueue({concurrency: CONCURRENT_REQUESTS})
    this.vk = new RedisClient(VALKEY_URL)
  }

  async init() {
    console.log('Initializing Image Validator...')
    console.log(`Concurrent requests: ${CONCURRENT_REQUESTS}`)
    console.log(`Transcript max variant count: ${TRANSCRIPT_MAX_VARIANT_COUNT}`)
    console.log(`Prompt max variant count: ${PROMPT_MAX_VARIANT_COUNT}`)
    console.log(`Pregen version ID: ${PREGEN_VERSION_ID}`)
  }

  async checkImageExists(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {method: 'HEAD'})
      return response.ok
    } catch (error) {
      return false
    }
  }

  async validateImage(
    cue_id: string,
    variant_id: number
  ): Promise<ValidationResult> {
    const url = `https://images.poom.dev/foigoi/${PREGEN_VERSION_ID}/cues/${cue_id}/${variant_id}/final.png`
    const requestId = `${cue_id}_${variant_id}`

    const exists = await this.checkImageExists(url)

    if (exists) {
      process.stdout.write('.')

      // Mark whether the upload was successful in Valkey
      await this.vk.hmset(PREGEN_UPLOAD_STATUS_KEY, [requestId, '1'])
    } else {
      console.warn(
        `\n😰 Image missing: ${url} (CUE_ID: ${cue_id}, VARIANT_ID: ${variant_id})`
      )

      // Mark that the upload was not successful in Valkey
      await this.vk.hmset(PREGEN_UPLOAD_STATUS_KEY, [requestId, '0'])
    }

    return {
      url,
      cue_id,
      variant_id,
      exists,
    }
  }

  async validateTranscriptCues(): Promise<ValidationResult[]> {
    console.log('Validating transcript cues...')

    const transcriptCuesToValidate = cues.filter(
      (cue) => cue.action === 'transcript' && cue.generate
    )

    console.log(
      `Found ${transcriptCuesToValidate.length} transcript cues to validate`
    )

    if (transcriptCuesToValidate.length === 0) {
      console.log('No transcript cues to validate')
      return []
    }

    const allValidations: Promise<ValidationResult>[] = []

    for (const cue of transcriptCuesToValidate) {
      if (cue.action === 'transcript' && cue.transcript) {
        const cueIndex = cues.indexOf(cue)

        const cue_id = `transcript_${cueIndex}_${cue.time.replace(
          /[:.]/g,
          '_'
        )}`

        // Check all possible variant IDs (1 to TRANSCRIPT_MAX_VARIANT_COUNT)
        for (
          let variant_id = 1;
          variant_id <= TRANSCRIPT_MAX_VARIANT_COUNT;
          variant_id++
        ) {
          allValidations.push(
            this.queue.add(() =>
              this.validateImage(cue_id, variant_id)
            ) as Promise<ValidationResult>
          )
        }
      }
    }

    console.log(`Queuing ${allValidations.length} validation requests...`)

    const results = await Promise.all(allValidations)
    return results
  }

  async validateImageGenerationCues(): Promise<ValidationResult[]> {
    console.log('Validating image generation cues...')

    const imageGenerationCues = cues.filter((cue) => cue.action === 'prompt')

    console.log(`Found ${imageGenerationCues.length} image generation cues`)

    if (imageGenerationCues.length === 0) {
      console.log('No image generation cues to validate')
      return []
    }

    const allValidations: Promise<ValidationResult>[] = []

    for (const cue of imageGenerationCues) {
      if (cue.action === 'prompt' && cue.prompt) {
        const cueIndex = cues.indexOf(cue)
        const cue_id = `prompt_${cueIndex}_${cue.time.replace(/[:.]/g, '_')}`

        // For prompt cues, assuming single variant (variant_id = 1)
        allValidations.push(
          this.queue.add(() =>
            this.validateImage(cue_id, 1)
          ) as Promise<ValidationResult>
        )
      }
    }

    console.log(`Queuing ${allValidations.length} validation requests...`)

    const results = await Promise.all(allValidations)
    return results
  }

  async validatePromptAndSliderCues(): Promise<ValidationResult[]> {
    console.log(
      'Validating prompt and move-slider cues (matching generate.ts logic)...'
    )

    const allValidations: Promise<ValidationResult>[] = []
    let validationCount = 0

    for (const cueIndex in cues) {
      const cue = cues[cueIndex]

      // Only process 'prompt' and 'move-slider' actions
      if (!cue || (cue.action !== 'prompt' && cue.action !== 'move-slider')) {
        continue
      }

      let cue_id: string

      const cueSuffix = `${cueIndex}_${cue.time.replace(/[:.]/g, '_')}`

      if (cue.action === 'prompt') {
        // These do not require generation and is a no-op.
        // It is just to simulate typing.
        if (!cue.prompt || cue.commit === false) {
          continue
        }

        cue_id = `prompt_${cueSuffix}`
      } else if (cue.action === 'move-slider') {
        cue_id = `slider_${cueSuffix}_val${cue.value}`
      } else {
        continue
      }

      // Check all possible variant IDs (1 to PROMPT_MAX_VARIANT_COUNT)
      for (
        let variant_id = 1;
        variant_id <= PROMPT_MAX_VARIANT_COUNT;
        variant_id++
      ) {
        allValidations.push(
          this.queue.add(() =>
            this.validateImage(cue_id, variant_id)
          ) as Promise<ValidationResult>
        )
        validationCount++
      }
    }

    console.log(`Found ${validationCount} prompt/slider validations to process`)
    console.log(`Queuing ${allValidations.length} validation requests...`)

    const results = await Promise.all(allValidations)
    return results
  }

  printMissingImages(results: ValidationResult[]): void {
    const missingImages = results.filter((result) => !result.exists)

    if (missingImages.length === 0) {
      console.log('✅ All images exist!')
      return
    }

    console.log(`\n❌ Found ${missingImages.length} missing images:`)
    console.log('URL | CUE_ID | VARIANT_ID')
    console.log('--- | ------ | ----------')

    for (const missing of missingImages) {
      console.log(`${missing.url} | ${missing.cue_id} | ${missing.variant_id}`)
    }
  }

  async run(): Promise<void> {
    await this.init()

    console.log('=== Image Validation Report ===')

    // Validate transcript cues
    const transcriptResults = []

    // Validate prompt and slider cues (matching generate.ts logic)
    const imageResults = await this.validatePromptAndSliderCues()

    // Combine results
    const allResults = [...transcriptResults, ...imageResults]

    const existingCount = allResults.filter((r) => r.exists).length
    const totalCount = allResults.length

    console.log(`\n=== Summary ===`)
    console.log(`Total images checked: ${totalCount}`)
    console.log(`Existing images: ${existingCount}`)
    console.log(`Missing images: ${totalCount - existingCount}`)

    // Print missing images
    this.printMissingImages(allResults)

    console.log('\n✅ Validation complete')
  }
}

// Run the script
const validator = new ImageValidator()
await validator.run()
