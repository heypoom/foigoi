import {useStore} from '@nanostores/react'
import cx from 'classnames'

import {$inferencePreview} from '../store/prompt'
import {useCrossFade} from '../hooks/useCrossFade'

export const ImageDisplay = () => {
  const url = useStore($inferencePreview)

  const {crossfading, prevUrl} = useCrossFade(url)

  const visible = !!url

  return (
    <div className="relative flex items-center justify-center h-screen w-full z-[1] bg-[#111]">
      <img
        src={crossfading ? prevUrl : url}
        alt=""
        className={cx(
          'absolute h-screen object-cover object-center transition-opacity duration-[3s] ease-in-out pointer-events-none select-none z-[1] w-full',
          visible ? 'opacity-100' : 'opacity-0'
        )}
      />

      <img
        src={url}
        alt=""
        className={cx(
          'absolute h-screen object-cover object-center transition-opacity duration-[3s] ease-in-out pointer-events-none select-none z-[10] w-full',
          crossfading ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  )
}
