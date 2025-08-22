import Replicate from 'replicate'
import fs from 'node:fs'
import PQueue from 'p-queue'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

// const BASE = 'https://files.poom.dev/foigoi/1/cues'
const BASE = 'https://files.poom.dev/foigoi/2/cues'

const PATHS = [
  'prompt_390_00_46_06',
  // 'prompt_392_00_54_28',
  // 'prompt_393_00_54_57',
  // 'prompt_396_00_55_46',
  // 'prompt_397_01_10_15',
]

const queue = new PQueue({concurrency: 10})

console.log(`replicate token:`, process.env.REPLICATE_API_TOKEN)

for (const path of PATHS) {
  for (let variantId = 31; variantId <= 50; variantId++) {
    const imagePath = `${path}/${variantId}`
    const imageUrl = `${BASE}/${imagePath}/final.png`
    const pathPrefix = `./out2/${imagePath}`

    if (await fs.promises.exists(pathPrefix)) {
      console.log('skipped as it exist:', pathPrefix)
      continue
    }

    queue.add(async () => {
      console.log('upscaling:', imageUrl)

      const output = await replicate.run(
        'philz1337x/clarity-upscaler:dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e',
        {
          input: {
            seed: 1337,
            image: imageUrl,
            prompt:
              'highres, masculine, <lora:more_details:0.2> <lora:SDXLrender_v2.0:1>',
            dynamic: 6,
            handfix: 'disabled',
            pattern: false,
            sharpen: 0,
            sd_model: 'juggernaut_reborn.safetensors [338b85bc4f]',
            scheduler: 'DPM++ 3M SDE Karras',
            creativity: 0.1,
            lora_links: '',
            downscaling: false,
            resemblance: 0.8,
            scale_factor: 2,
            tiling_width: 112,
            output_format: 'png',
            tiling_height: 144,
            custom_sd_model: '',
            negative_prompt:
              '(worst quality, low quality, normal quality:2) JuggernautNegative-neg',
            num_inference_steps: 18,
            downscaling_resolution: 768,
          },
        }
      )

      console.log('ran', imagePath)

      await fs.promises.mkdir(pathPrefix, {recursive: true})
      await fs.promises.writeFile(`${pathPrefix}/final.png`, output[0])

      console.log('saved', imagePath)
    })
  }
}

await queue.onIdle()

console.log('done!')
