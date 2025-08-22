import {createLazyFileRoute} from '@tanstack/react-router'

import {PromptManager} from '../components/PromptManager'
import {useStore} from '@nanostores/react'

export const Route = createLazyFileRoute('/four-b')({
  component: Index,
})

function Index() {
  return <PromptManager command="P4" regenerate />
}
