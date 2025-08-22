import {createLazyFileRoute} from '@tanstack/react-router'

import {PromptManager} from '../components/PromptManager'
import {useStore} from '@nanostores/react'
import {$endingBlackout} from '../store/fader'

export const Route = createLazyFileRoute('/four-b')({
  component: Index,
})

function Index() {
  const isBlackout = useStore($endingBlackout)

  if (isBlackout) return null

  return <PromptManager command="P4" regenerate />
}
