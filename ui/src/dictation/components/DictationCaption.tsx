import {useStore} from '@nanostores/react'
import cn from 'classnames'

import {$transcript} from '../../store/dictation'
// import {$exhibitionMode} from '../../store/exhibition'

export const DictationCaption = () => {
  const {transcript, final} = useStore($transcript)
  // const isExhibition = useStore($exhibitionMode)

  if (!transcript) return null

  return (
    <div className="text-center max-w-[2048px] px-2 mb-[50px]">
      <div
        className={cn(
          'inline break-words bg-black py-2 px-6 font-extralight',
          final && 'text-white',
          !final && 'text-gray-300'
        )}
        style={{
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
          fontSize: '78px',
          lineHeight: '169px',
          padding: '25px 55px',
          fontWeight: 300,
        }}
      >
        {transcript}
      </div>
    </div>
  )
}
