import {useCallback, useEffect, useRef} from 'react'

import {paintDenseNoise} from '../utils/noise'
import {useMatchRoute} from '@tanstack/react-router'

export const AnimatedNoise = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const mr = useMatchRoute()

  // these routes are no-noise routes
  const isNoNoiseRoute =
    mr({to: '/'}) ||
    mr({to: '/zero'}) ||
    mr({to: '/video'}) ||
    mr({to: '/image-viewer'})

  const paint = useCallback(() => {
    if (isNoNoiseRoute) return

    const canvas = canvasRef.current
    if (!canvas) return

    paintDenseNoise(canvas)
  }, [isNoNoiseRoute])

  useEffect(() => {
    let timer: number

    if (!isNoNoiseRoute) {
      timer = setInterval(() => {
        paint()
      }, 400)
    }

    return () => {
      clearInterval(timer)
    }
  }, [isNoNoiseRoute, paint])

  if (isNoNoiseRoute) return null

  return (
    <div
      className="z-0 fixed w-screen h-screen top-0 left-0"
      style={{
        filter: 'blur(8px) brightness(50%)',
        WebkitFilter: 'blur(8px) brightness(50%)',
      }}
    >
      <canvas ref={canvasRef} className="w-screen h-screen" />
    </div>
  )
}
