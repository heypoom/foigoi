import fs from 'node:fs'
import PQueue from 'p-queue'

const PATHS = [
  // 'prompt_392_00_54_28',
  // 'prompt_393_00_54_57',
  // 'prompt_396_00_55_46',
  // 'prompt_397_01_10_15',

  'prompt_401_00_54_30',
  'prompt_402_00_54_59',
  'prompt_405_00_55_46',
  'prompt_406_01_10_20',
]

console.log(`replicate token:`, process.env.REPLICATE_API_TOKEN)

for (const path of PATHS) {
  for (let variantId = 1; variantId <= 50; variantId++) {
    const imagePath = `${path}/${variantId}`
    const copySrc = `./out/${imagePath}/final.png`
    const copyTgt1 = `./out/${imagePath}/8.png`
    const copyTgt2 = `./out/${imagePath}/9.png`

    if (await fs.promises.exists(copyTgt1)) {
      console.log('skipped as exist:', copyTgt1)
      continue
    }

    if (await fs.promises.exists(copyTgt2)) {
      console.log('skipped as exist:', copyTgt2)
      continue
    }

    await fs.promises.copyFile(copySrc, copyTgt1)
    await fs.promises.copyFile(copySrc, copyTgt2)

    console.log('copied to', copyTgt1)
  }
}

console.log('done!')
