import cx from 'classnames'
import {ComponentProps, useEffect, useRef, useState} from 'react'
import {$exhibitionMode} from '../store/exhibition'
import {useStore} from '@nanostores/react'

interface Props {
  input?: ComponentProps<'textarea'>
  className?: string
}

const E_MIN_WIDTH = 600
const E_MAX_WIDTH = 1000
const E_MIN_CHARS = 23
const E_MAX_CHARS = 40

function getExpandWidth(charactersTyped: number) {
  // Return minimum width if below the threshold
  if (charactersTyped < E_MIN_CHARS) {
    return E_MIN_WIDTH
  }

  // Calculate how many pixels to add per character
  const widthRange = E_MAX_WIDTH - E_MIN_WIDTH
  const charactersRange = E_MAX_CHARS - E_MIN_CHARS
  const widthPerChar = widthRange / charactersRange

  // Calculate extra width based on characters past minimum
  const extraChars = Math.min(charactersTyped - E_MIN_CHARS, charactersRange)

  return Math.round(E_MIN_WIDTH + extraChars * widthPerChar)
}

export const PromptInput = ({input, className}: Props) => {
  const isExhibition = useStore($exhibitionMode)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [w, setW] = useState<number | null>(null)

  useEffect(() => {
    if (textareaRef.current) {
      const value = String(input?.value)
      const newWidth = getExpandWidth(value.length)

      textareaRef.current.style.width = `${newWidth}px`
      setW(newWidth)

      // Reset height to auto to get the correct scrollHeight
      textareaRef.current.style.height = 'auto'

      if (value.length > E_MAX_CHARS) {
        // Allow vertical expansion after max chars
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
      } else {
        // Single line height otherwise
        textareaRef.current.style.height = 'unset'
      }
    }
  }, [input?.value])

  return (
    <div
      className="flex items-center justify-center max-w-[1000px] w-full px-[20px]"
      style={{
        background: 'rgba(17, 17, 17, 0.5)',
        width: `${w}px`,
        boxSizing: 'content-box',
      }}
    >
      <textarea
        style={{
          fontFamily: 'Monaco',
          background: 'transparent',

          whiteSpace:
            String(input?.value)?.length <= E_MAX_CHARS ? 'nowrap' : 'pre-wrap',
        }}
        className={cx(
          'text-white font-mono text-center w-full',
          'resize-none overflow-hidden min-h-[40px]',
          'outline-none',

          isExhibition
            ? 'text-2xl p-2 px-4 py-2'
            : 'text-[42px] leading-[82px]',
          className
        )}
        rows={1}
        ref={textareaRef}
        {...input}
      />
    </div>
  )
}
