import {useStore} from '@nanostores/react'
import {$exhibitionMode, $exhibitionStatus} from '../store/exhibition'
import {useMatchRoute} from '@tanstack/react-router'

export function ClosedScreen() {
  const status = useStore($exhibitionStatus)
  const mr = useMatchRoute()

  const isExhibition = useStore($exhibitionMode)

  if (!isExhibition) return null
  if (status.type !== 'closed') return null
  if (mr({to: '/'})) return null
  if (mr({to: '/transcript-tester'})) return null

  return (
    <div className="fixed z-[100] left-0 top-0 flex flex-col items-center justify-center w-full h-full font-mono min-h-screen bg-black text-white gap-y-8">
      <h1 className="text-4xl">Exhibition is now closed.</h1>
      <h2 className="text-xl">Thanks for visiting!</h2>
    </div>
  )
}
