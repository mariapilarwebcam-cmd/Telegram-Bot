"use client"

import { useEffect, useState, useRef } from 'react'

export function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value)
  const displayRef = useRef(value)

  useEffect(() => {
    let start = displayRef.current
    const end = value
    if (start === end) return

    const duration = 1000 // 1 segundo de animación
    const startTime = performance.now()
    let animationFrame: number

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      
      // Función de aceleración para que frene suavemente al final
      const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
      
      const current = Math.round(start + (end - start) * easeOut)
      setDisplayValue(current)
      displayRef.current = current

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate)
      }
    }

    animationFrame = requestAnimationFrame(animate)

    return () => cancelAnimationFrame(animationFrame)
  }, [value])

  return <span>{displayValue}</span>
}
