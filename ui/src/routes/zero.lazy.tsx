import {createLazyFileRoute} from '@tanstack/react-router'

import {DictationCaption, dictation} from '../dictation'
import {ImageDisplay} from '../image/ImageDisplay'

import {useHotkeys} from 'react-hotkeys-hook'

export const Route = createLazyFileRoute('/zero')({
  component: ZeroRoute,
})

function ZeroRoute() {
  useHotkeys('space', () => {
    setTimeout(() => {
      dictation.restart('spacebar hotkey')
    }, 50)
  })

  return (
    <main>
      <div className="fixed font-mono w-full min-h-screen flex left-0 justify-center items-center pt-12 pointer-events-none z-[50] text-[42px] leading-[82px]">
        <DictationCaption />
      </div>

      <ImageDisplay />
    </main>
  )
}
