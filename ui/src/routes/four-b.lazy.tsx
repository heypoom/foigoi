import {createLazyFileRoute} from '@tanstack/react-router'

import {PromptManager} from '../components/PromptManager'
import {useStore} from '@nanostores/react'
import {$fadeStatus} from '../store/fader'

export const Route = createLazyFileRoute('/four-b')({
  component: Index,
})

function Index() {
  const fadeStatus = useStore($fadeStatus)
  if (fadeStatus) return null

  return <PromptManager command="P4" regenerate />
}
