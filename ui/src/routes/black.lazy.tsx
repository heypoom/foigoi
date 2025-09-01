import {createLazyFileRoute} from '@tanstack/react-router'

export const Route = createLazyFileRoute('/black')({
  component: () => null,
})
