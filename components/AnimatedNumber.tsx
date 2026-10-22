"use client"

import { useEffect, useState } from 'react'

export function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    let start = displayValue
    const end = value
    if (start === end) return

    const duration = 1000 // 1 segundo de animación
    const startTime = performance.now()

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      
      // Función de aceleración para que frene suavemente al final
      const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
      
      const current = Math.round(start + (end - start) * easeOut)
      setDisplayValue(current)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }, [value, displayValue])

  return <span>{displayValue}</span>
}