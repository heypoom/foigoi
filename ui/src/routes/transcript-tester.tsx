import {createFileRoute} from '@tanstack/react-router'
import {DictationCaption} from '../dictation'

const TranscriptTester = () => {
  return (
    <main className="min-h-screen bg-black">
      <img
        src="/caption-debug-background.png"
        alt=""
        className="fixed inset-0 h-screen w-full object-cover object-center"
      />

      <div className="fixed font-mono w-full min-h-screen flex left-0 justify-center items-center pt-12 pointer-events-none z-[50]">
        <DictationCaption transcript="a big black fox jumps over the lazy dog in the river" />
      </div>
    </main>
  )
}

export const Route = createFileRoute('/transcript-tester')({
  component: TranscriptTester,
})
