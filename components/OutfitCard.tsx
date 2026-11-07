"use client"

import { useState } from 'react'
import { getItemImageUrl } from '@/lib/outfits'

export function OutfitCard({ itemKey, name, quantity, label, selected = false, disabled = false, onClick }: {
  itemKey: string
  name: string
  quantity?: number
  label?: string
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  const src = getItemImageUrl(itemKey)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const content = <>
    <div style={{ width: '100%', aspectRatio: '3/4', background: '#150f24', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span role="img" aria-label={name} style={{ fontSize: 48, opacity: 0.4 }}>👗</span>
      {src && failedSrc !== src && <img src={src} alt={name}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setFailedSrc(src)} />}
    </div>
    <div style={{ padding: 8, textAlign: 'center', width: '100%', boxSizing: 'border-box' }}>
      <span style={{ fontSize: 12, fontWeight: 700, display: 'block' }}>{name}</span>
      {quantity !== undefined && <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>×{quantity}</span>}
      {label && <span style={{ fontSize: 10, fontWeight: 800, display: 'block', marginTop: 4 }}>{label}</span>}
    </div>
  </>
  const style = {
    padding: 0, borderRadius: 12, overflow: 'hidden', width: '100%',
    background: selected ? 'rgba(34,197,94,0.1)' : 'rgba(168,85,247,0.1)',
    border: selected ? '2px solid #22c55e' : '1px solid rgba(168,85,247,0.3)',
    color: selected ? '#22c55e' : '#fff', fontFamily: 'inherit',
    opacity: disabled ? 0.6 : 1,
  }
  return onClick
    ? <button type="button" onClick={onClick} disabled={disabled} style={{ ...style, cursor: disabled ? 'default' : 'pointer' }}>{content}</button>
    : <div style={style}>{content}</div>
}