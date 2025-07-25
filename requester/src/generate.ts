import {RedisClient} from 'bun'
import PQueue from 'p-queue'
import _cues from '../data/cues.json'
import type {AutomationCue} from './types'
import {
  TRANSCRIPT_MAX_VARIANT_COUNT,
  PROMPT_MAX_VARIANT_COUNT,
  PREGEN_VERSION_ID,
  VALKEY_URL,
  PREGEN_UPLOAD_STATUS_KEY,
} from './constants'

const cues = _cues as AutomationCue[]

const MODAL_ENDPOINT =
  'https://heypoom--exhibition-pregen-text-to-image-endpoint.modal.run/generate'

const MALAYA_ENDPOINT =
  'https://heypoom--exhibition-pregen-malaya-endpoint.modal.run/generate'

const CONCURRENT_REQUESTS = 3

const REQUESTER_DURATIONS_KEY = `requester/${PREGEN_VERSION_ID}/durations`
const REQUESTER_R2_KEY = `requester/${PREGEN_VERSION_ID}/r2`
const REQUESTER_ERRORS_KEY = `requester/${PREGEN_VERSION_ID}/errors`

interface GenerationRequest {
  cue_id: string
  prompt: string
  program_key: string
  variant_id: number
  guidance: number | null
}

class GenerationRequester {
  private queue: PQueue
  private vk: RedisClient

  constructor() {
    this.queue = new PQueue({concurrency: CONCURRENT_REQUESTS})
    this.vk = new RedisClient(VALKEY_URL)
  }

  async generateImage(request: GenerationRequest): Promise<void> {
    const REQ_ID = `${request.cue_id}_${request.variant_id}`

    if (request.program_key.startsWith('P2')) {
      console.log('[skip P2]')
      return
    }

    try {
      console.log(
        `😶 fetch: cue ${request.cue_id}, var ${request.variant_id}, pgm ${request.program_key}`
      )

      const start = performance.now()

      // Route P2/P2B to malaya endpoint, others to text-to-image endpoint
      const endpoint = request.program_key.startsWith('P2')
        ? MALAYA_ENDPOINT
        : MODAL_ENDPOINT

      const body = {
        prompt: request.prompt,
        program_key: request.program_key,
        cue_id: request.cue_id,
        variant_id: request.variant_id,

        // we actually use guidance as strength in the backend
        ...(typeof request.guidance === 'number' && {
          strength: request.guidance / 100,
        }),
      }

      console.log(`🔗 Sending request:`, body)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        console.log(`HTTP error!:`, response.status, await response.text())
        throw new Error(response.statusText)
      }

      const output = (await response.json()) as {status: string; r2_key: string}
      const duration = (performance.now() - start).toFixed(2)

      console.log(
        `✨ Done: ${request.cue_id}. r2_key: ${output.r2_key}, time: ${duration}ms`
      )

      await this.vk.hmset(REQUESTER_DURATIONS_KEY, [REQ_ID, duration])

      if (output.r2_key) {
        await this.vk.hmset(REQUESTER_R2_KEY, [REQ_ID, output.r2_key])
      }
    } catch (error) {
      console.error(`⚠️ Failed to generate image for ${REQ_ID}:`, error)

      // Flag any errors in Valkey
      await this.vk.hmset(REQUESTER_ERRORS_KEY, [REQ_ID, String(error)])

      throw error
    }
  }

  async processPromptAndSliderCues(): Promise<void> {
    console.log('Processing prompt and move-slider cues...')

    const allRequests: GenerationRequest[] = []
    let skippedCount = 0

    for (const cueIndex in cues) {
      const cue = cues[cueIndex]

      // Only process 'prompt' and 'move-slider' actions
      if (!cue || (cue.action !== 'prompt' && cue.action !== 'move-slider')) {
        continue
      }

      let prompt: string
      let program_key: string
      let cue_id: string
      let guidance: number | null = null

      const cueSuffix = `${cueIndex}_${cue.time.replace(/[:.]/g, '_')}`

      if (cue.action === 'prompt') {
        // These do not require generation and is a no-op.
        // It is just to simulate typing.
        if (!cue.prompt || cue.commit === false) {
          continue
        }

        prompt = cue.override || cue.prompt
        program_key = cue.program
        cue_id = `prompt_${cueSuffix}`

        if (cue.guidance !== undefined) {
          guidance = cue.guidance
        }
      } else if (cue.action === 'move-slider') {
        // For move-slider, only P2 and P2B programs use guidance values
        if (!cue.program.startsWith('P2')) {
          console.log(
            `⚠️ slider cue for ${cue.program} at ${cue.time} - not supported!`
          )
          continue
        }

        // For P2 slider cues, use the base P2 prompt with the guidance value
        prompt = 'painting like epic poem of malaya'
        program_key = cue.program
        cue_id = `slider_${cueSuffix}_val${cue.value}`
        guidance = cue.value
      } else {
        continue
      }

      const localStart = performance.now()
      let localComplete = 0

      let requestIds = []

      for (
        let variant_id = 1;
        variant_id <= PROMPT_MAX_VARIANT_COUNT;
        variant_id++
      ) {
        requestIds.push(`${cue_id}_${variant_id}`)
      }

      const statuses = await this.vk.hmget(PREGEN_UPLOAD_STATUS_KEY, requestIds)

      if (statuses.length !== requestIds.length) {
        console.warn(
          `⚠️ Warning: expected ${requestIds.length} statuses for cue ${cue_id}, but got ${statuses.length}`
        )

        process.exit(1)
      }

      for (let variant_id = 1; variant_id <= requestIds.length; variant_id++) {
        const status = statuses[variant_id - 1]

        if (!status || status === '0') {
          // This variant needs to be generated
          allRequests.push({
            cue_id,
            prompt,
            program_key,
            variant_id,
            guidance,
          })

          process.stdout.write('+')
        } else {
          process.stdout.write('.')

          // This variant has already been generated
          skippedCount++
          localComplete++
        }
      }

      const localDuration = (performance.now() - localStart).toFixed(2)
      console.log(` ${cue_id} (${localComplete} ~ ${localDuration}ms)`)
    }

    console.log(`Skipping ${skippedCount} fully generated cues`)
    console.log(`Queuing ${allRequests.length} new generation requests...`)

    if (allRequests.length === 0) {
      console.log('All prompt and slider cues have already been processed!')
      return
    }

    // Add all requests to the queue
    const promises = allRequests.map((request) =>
      this.queue.add(() => this.generateImage(request))
    )

    try {
      await Promise.all(promises)
      console.log(
        `✓ All ${allRequests.length} prompt and slider cues processed successfully`
      )
    } catch (error) {
      console.error('✗ Some requests failed:', error)
    }
  }

  async processTranscriptCues(): Promise<void> {
    console.log('Processing transcript cues...')

    const allRequests: GenerationRequest[] = []
    let skippedCount = 0

    for (const cueIndex in cues) {
      const cue = cues[cueIndex]

      if (!cue || cue.action !== 'transcript' || !cue.generate) {
        continue
      }

      const prompt = cue.transcript

      const cue_id = `transcript_${cueIndex}_${cue.time.replace(/[:.]/g, '_')}`

      // For transcript cues, we'll use P0 as default program
      const program_key = 'P0'

      const localStart = performance.now()
      let localComplete = 0

      let requestIds = []

      for (
        let variant_id = 1;
        variant_id <= TRANSCRIPT_MAX_VARIANT_COUNT;
        variant_id++
      ) {
        requestIds.push(`${cue_id}_${variant_id}`)
      }

      const statuses = await this.vk.hmget(PREGEN_UPLOAD_STATUS_KEY, requestIds)

      if (statuses.length !== requestIds.length) {
        console.warn(
          `⚠️ Warning: expected ${requestIds.length} statuses for cue ${cue_id}, but got ${statuses.length}`
        )

        process.exit(1)
      }

      for (let variant_id = 1; variant_id <= requestIds.length; variant_id++) {
        const status = statuses[variant_id - 1]

        if (!status || status === '0') {
          // This variant needs to be generated
          allRequests.push({
            cue_id,
            prompt,
            program_key,
            variant_id,
            guidance: null, // no guidance for transcript cues
          })

          process.stdout.write('+')
        } else {
          process.stdout.write('.')

          // This variant has already been generated
          skippedCount++
          localComplete++
        }
      }

      const localDuration = (performance.now() - localStart).toFixed(2)
      console.log(` ${cue_id} (${localComplete} ~ ${localDuration}ms)`)
    }

    console.log(`Skipping ${skippedCount} fully generated cues`)
    console.log(`Queuing ${allRequests.length} new generation requests...`)

    if (allRequests.length === 0) {
      console.log('All transcript cues have already been processed!')
      return
    }

    // Add all requests to the queue
    const promises = allRequests.map((request) =>
      this.queue.add(() => this.generateImage(request))
    )

    try {
      await Promise.all(promises)
      console.log(
        `✓ All ${allRequests.length} transcript cues processed successfully`
      )
    } catch (error) {
      console.error('✗ Some requests failed:', error)
    }
  }

  async run(): Promise<void> {
    console.log(`Using Modal endpoint: ${MODAL_ENDPOINT}`)
    console.log(`Using Malaya endpoint: ${MALAYA_ENDPOINT}`)
    console.log(`Using Valkey at: ${VALKEY_URL}`)
    console.log(`Concurrent requests: ${CONCURRENT_REQUESTS}`)

    // await this.processTranscriptCues()
    await this.processPromptAndSliderCues()

    console.log('✅ Generation requester finished')
  }
}

// Run the script
const requester = new GenerationRequester()
await requester.run()
