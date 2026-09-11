"use client"

import { useEffect, useState } from 'react'
import WebApp from '@twa-dev/sdk'
import { supabase } from '@/lib/supabase'
import { STAR_PACKAGES } from '@/lib/constants'
import Link from 'next/link'

export default function ShopPage() {
  const [user, setUser] = useState<any>(null)
  const [gems, setGems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState<number | null>(null)

  useEffect(() => {
    WebApp.ready()
    WebApp.expand()
    
    const tgUser = WebApp.initDataUnsafe?.user
    if (tgUser) {
      loadUserData(tgUser.id)
    }
  }, [])

  const loadUserData = async (telegramId: number) => {
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single()

      if (userData) {
        setUser(userData)
        setGems(userData.gems)
      }
    } catch (error) {
      console.error('Error cargando datos:', error)
    } finally {
      setLoading(false)
    }
  }

  const createInvoice = async (packageIndex: number) => {
    if (!user) return
    
    setPurchasing(packageIndex)

    try {
      const res = await fetch('/api/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
          package_id: packageIndex
        })
      })

      const data = await res.json()

      if (res.ok && data.invoice_link) {
        WebApp.openInvoice(data.invoice_link, async (status) => {
          if (status === 'paid') {
            alert('¡Compra exitosa! Gemas añadidas.')
            loadUserData(user.telegram_id)
          } else {
            alert('Pago cancelado o fallido.')
          }
          setPurchasing(null)
        })
      } else {
        alert(data.error || 'Error al crear factura')
        setPurchasing(null)
      }
    } catch (error) {
      alert('Error de conexión')
      setPurchasing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <Link href="/" className="text-textMuted hover:text-textMain">
          ← Volver
        </Link>
        <h1 className="text-xl font-bold">Tienda</h1>
        <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-full">
          <span className="text-primary">💎</span>
          <span className="font-bold text-sm">{gems}</span>
        </div>
      </header>

      {/* Info */}
      <div className="bg-surface p-4 rounded-xl border border-white/5 mb-6">
        <h2 className="font-bold mb-2">💎 Gemas</h2>
        <p className="text-sm text-textMuted">
          Las gemas se usan para chatear, generar imágenes y crear personajes.
        </p>
      </div>

      {/* Paquetes */}
      <div className="space-y-3">
        <h2 className="font-bold mb-3">Paquetes Disponibles</h2>
        
        {STAR_PACKAGES.map((pkg, idx) => {
          const finalGems = Math.floor(pkg.gems * (1 + pkg.bonus / 100))
          const isPopular = idx === 2
          
          return (
            <div
              key={idx}
              className={`bg-surface p-4 rounded-xl border ${
                isPopular ? 'border-primary/50' : 'border-white/5'
              } relative`}
            >
              {isPopular && (
                <span className="absolute -top-2 right-4 bg-primary text-white text-xs px-2 py-1 rounded-full">
                  Popular
                </span>
              )}
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">⭐</span>
                    <span className="font-bold text-lg">{pkg.stars} Stars</span>
                  </div>
                  <p className="text-sm text-textMuted">
                    💎 {finalGems} gemas
                    {pkg.bonus > 0 && (
                      <span className="text-primary ml-1">(+{pkg.bonus}% bonus)</span>
                    )}
                  </p>
                  {pkg.first_time && (
                    <p className="text-xs text-accent mt-1">¡Primera vez!</p>
                  )}
                </div>
                
                <button
                  onClick={() => createInvoice(idx)}
                  disabled={purchasing !== null}
                  className="bg-gradient-primary text-white px-4 py-2 rounded-xl font-bold disabled:opacity-50"
                >
                  {purchasing === idx ? '...' : 'Comprar'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Info adicional */}
      <div className="mt-6 bg-surface p-4 rounded-xl border border-white/5">
        <h3 className="font-bold mb-2">💡 ¿Cómo funciona?</h3>
        <ul className="text-sm text-textMuted space-y-1">
          <li>• 1 mensaje de chat = 1 gema</li>
          <li>• 1 imagen generada = 10 gemas</li>
          <li>• 1 audio generado = 5 gemas</li>
          <li>• Crear personaje = 5 gemas</li>
        </ul>
      </div>
    </div>
  )
}
