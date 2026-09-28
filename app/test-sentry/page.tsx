"use client"

import * as Sentry from '@sentry/nextjs'
import { useState } from 'react'

export default function TestSentryPage() {
  const [sent, setSent] = useState(false)

  const triggerError = () => {
    try {
      // Error controlado que SÍ captura Sentry
      throw new Error('Test Sentry desde Taboo Realm — ' + new Date().toISOString())
    } catch (e) {
      Sentry.captureException(e)
      setSent(true)
      alert('✅ Error enviado a Sentry. Ve a tu dashboard y refresca.')
    }
  }

  const triggerUnhandled = () => {
    // Error no manejado (más realista)
    setTimeout(() => {
      throw new Error('Test Sentry unhandled — ' + new Date().toISOString())
    }, 100)
  }

  return (
    <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>Test Sentry</h1>
      <p style={{ color: '#888', marginBottom: 30 }}>
        Haz click en uno de los botones para enviar un error a Sentry.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 300, margin: '0 auto' }}>
        <button
          onClick={triggerError}
          style={{
            padding: 14,
            background: '#a855f7',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Enviar error capturado
        </button>

        <button
          onClick={triggerUnhandled}
          style={{
            padding: 14,
            background: '#ec4899',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Enviar error no manejado
        </button>
      </div>

      {sent && (
        <p style={{ color: '#22c55e', marginTop: 20, fontWeight: 700 }}>
          ✅ Error enviado correctamente
        </p>
      )}

      <p style={{ color: '#666', fontSize: 12, marginTop: 40 }}>
        Esta página es temporal. Se puede eliminar después.
      </p>
    </div>
  )
}