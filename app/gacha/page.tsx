"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/UserContext'
import { tgFetch } from '@/lib/telegram-fetch'
import { getTranslations } from '@/lib/i18n'
import { AnimatedNumber } from '@/components/AnimatedNumber'

const TIER_COLORS = {
  common: { color: '#a395c9', bg: 'rgba(163, 149, 201, 0.1)', border: 'rgba(163, 149, 201, 0.3)', label: 'COMÚN' },
  rare: { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)', border: 'rgba(6, 182, 212, 0.3)', label: 'RARO' },
  epic: { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.4)', label: 'ÉPICO' },
  legendary: { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.1)', border: 'rgba(251, 191, 36, 0.5)', label: 'LEGENDARIO' },
  mythic: { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.7)', label: 'MÍTICO' },
}

const COST = 50

export default function GachaPage() {
  const router = useRouter()
  const { user, loading: userLoading, lang, refresh } = useUser()
  const t = getTranslations(lang)

  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSpin = async () => {
    if (!user || spinning) return
    if ((user.purchased_gems || 0) < COST) {
      setError('Necesitas 50 gemas compradas para tirar de la ruleta.')
      return
    }

    setSpinning(true)
    setResult(null)
    setError(null)

    // Simulamos una animación de 2 segundos para generar emoción
    const minWait = new Promise(resolve => setTimeout(resolve, 2500))

    try {
      const res = await tgFetch('/api/gacha/spin', { method: 'POST' })
      const data = await res.json()

      await minWait // Esperamos a que termine la animación

      if (!res.ok) {
        setError(data.message || 'Error al girar la ruleta')
        setSpinning(false)
        return
      }

      setResult(data)
      await refresh() // Actualizamos las gemas del usuario
    } catch (e: any) {
      await minWait
      setError('Error de conexión. Intenta de nuevo.')
      setSpinning(false)
    }
  }

  if (userLoading || !user) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="page" style={{ paddingBottom: 32, minHeight: '100vh', overflow: 'hidden' }}>
      
      {/* HEADER */}
      <header className="page-header" style={{ background: 'transparent', borderBottom: 'none', position: 'relative' }}>
        <button
          onClick={() => router.push('/')}
          style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 4 }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="page-title" style={{ flex: 1, textAlign: 'center', fontSize: 18 }}>
          La Ruleta de lo Prohibido
        </h1>
        <div style={{ width: 32 }} />
      </header>

      {/* BALANCE Y GEMAS BONUS */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(168, 85, 247, 0.15)', padding: '8px 16px', borderRadius: 20, border: '1px solid rgba(168, 85, 247, 0.3)' }}>
          <span style={{ fontSize: 14 }}>💎</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#f5f0ff' }}>
            <AnimatedNumber value={user.purchased_gems || 0} /> <span style={{ fontSize: 10, color: '#a395c9' }}>PAGO</span>
          </span>
        </div>
        {((user as any).bonus_gems > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(34, 197, 94, 0.15)', padding: '8px 16px', borderRadius: 20, border: '1px solid rgba(34, 197, 94, 0.3)' }}>
            <span style={{ fontSize: 14 }}>💬</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#22c55e' }}>
              <AnimatedNumber value={(user as any).bonus_gems || 0} /> <span style={{ fontSize: 10, color: '#86efac' }}>CHAT</span>
            </span>
          </div>
        )}
      </div>

      {/* LA MÁQUINA / CAJA FUERTE */}
      <div style={{ 
        marginTop: 40, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center',
        position: 'relative'
      }}>
        {/* Efectos de luces de fondo */}
        <div style={{ position: 'absolute', width: 300, height: 300, background: 'radial-gradient(circle, rgba(236,72,153,0.2) 0%, transparent 60%)', filter: 'blur(40px)', zIndex: 0, animation: 'pulseGlow 4s infinite' }} />

        <div style={{
          width: 200,
          height: 260,
          borderRadius: 24,
          background: 'linear-gradient(145deg, #1f1733 0%, #150f24 100%)',
          border: '2px solid rgba(168, 85, 247, 0.4)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.8), inset 0 0 30px rgba(168,85,247,0.2)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          zIndex: 1,
          transition: 'transform 0.2s',
          animation: spinning ? 'shake 0.5s infinite' : 'float 3s infinite ease-in-out'
        }}>
          <div style={{ fontSize: 72, filter: 'drop-shadow(0 0 20px rgba(236,72,153,0.8))', animation: spinning ? 'spinFast 1s infinite linear' : 'none' }}>
            {spinning ? '🎰' : '🎁'}
          </div>
          <p style={{ color: '#f0abfc', fontWeight: 900, letterSpacing: '0.1em', marginTop: 16, fontSize: 14 }}>
            {spinning ? 'GIRANDO...' : 'TOCA PARA GIRAR'}
          </p>
        </div>

        {/* CONTADOR DE PITY (Lástima) */}
        <div style={{ marginTop: 24, zIndex: 1, textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: '#8b8b9e', margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Garantía de Épico o superior
          </p>
          <div style={{ display: 'flex', gap: 4, marginTop: 8, justifyContent: 'center' }}>
            {[...Array(10)].map((_, i) => (
              <div key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: i < ((user as any).pity_counter || 0) ? '#ec4899' : 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.4)' }} />
            ))}
          </div>
        </div>
      </div>

      {/* BOTÓN DE TIRADA */}
      <div style={{ padding: '32px 24px 0', position: 'relative', zIndex: 10 }}>
        {error && (
          <p style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', marginBottom: 12, background: 'rgba(220,38,38,0.1)', padding: 8, borderRadius: 8 }}>
            ⚠️ {error}
          </p>
        )}
        
        <button
          onClick={handleSpin}
          disabled={spinning || (user.purchased_gems || 0) < COST}
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: 16,
            background: spinning ? 'rgba(168, 85, 247, 0.2)' : 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
            border: 'none',
            color: '#fff',
            fontSize: 16,
            fontWeight: 900,
            cursor: spinning || (user.purchased_gems || 0) < COST ? 'not-allowed' : 'pointer',
            boxShadow: spinning ? 'none' : '0 8px 32px rgba(236, 72, 153, 0.5)',
            opacity: (user.purchased_gems || 0) < COST ? 0.5 : 1,
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {spinning ? 'Abriendo el cofre...' : (
            <>
              <span>🎰</span> Tirar por {COST} Gemas
            </>
          )}
        </button>
        
        {!spinning && (user.purchased_gems || 0) < COST && (
          <button
            onClick={() => router.push('/shop')}
            style={{ width: '100%', background: 'transparent', border: 'none', color: '#fbbf24', fontSize: 13, fontWeight: 700, marginTop: 12, cursor: 'pointer' }}
          >
            Recargar Gemas
          </button>
        )}
      </div>

      {/* VITRINA DE PREMIOS */}
      <div style={{ padding: '40px 24px 0', position: 'relative', zIndex: 1 }}>
        <p style={{ fontSize: 12, fontWeight: 800, color: '#8b8b9e', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
          Premios Disponibles
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ background: 'rgba(163,149,201,0.05)', padding: 12, borderRadius: 12, border: '1px solid rgba(163,149,201,0.2)' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#a395c9' }}>Mensajes de Chat</p>
            <p style={{ margin: '4px 0 0', fontSize: 10, color: '#8b8b9e' }}>Gana entre 20 y 50 gemas de chat</p>
          </div>
          <div style={{ background: 'rgba(6,182,212,0.05)', padding: 12, borderRadius: 12, border: '1px solid rgba(6,182,212,0.2)' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#06b6d4' }}>Fotos y Pases</p>
            <p style={{ margin: '4px 0 0', fontSize: 10, color: '#8b8b9e' }}>Fotos nivel 3, 4 o Pases Nivel 5</p>
          </div>
          <div style={{ background: 'rgba(168,85,247,0.05)', padding: 12, borderRadius: 12, border: '1px solid rgba(168,85,247,0.2)' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#a855f7' }}>Outfits Exclusivos</p>
            <p style={{ margin: '4px 0 0', fontSize: 10, color: '#8b8b9e' }}>Lencería y conjuntos permanentes</p>
          </div>
          <div style={{ background: 'rgba(251,191,36,0.05)', padding: 12, borderRadius: 12, border: '1px solid rgba(251,191,36,0.2)' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>Personajes Ocultos</p>
            <p style={{ margin: '4px 0 0', fontSize: 10, color: '#8b8b9e' }}>Desbloquea arquetipos únicos</p>
          </div>
        </div>
      </div>

      {/* MODAL DE RESULTADO */}
      {result && (
        <div className="modal-backdrop" style={{ zIndex: 9999, background: 'rgba(5, 2, 10, 0.95)', backdropFilter: 'blur(10px)' }}>
          <div 
            className="modal-box level-up-modal" 
            style={{ 
              textAlign: 'center', 
              border: `2px solid ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}`,
              boxShadow: `0 0 40px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}40`
            }}
          >
            <div style={{ fontSize: 64, marginBottom: 16, animation: 'levelUpSparkle 1.5s infinite' }}>
              {result.tier === 'common' ? '💬' : result.tier === 'rare' ? '📸' : result.tier === 'epic' ? '🎟️' : result.tier === 'legendary' ? '👑' : '🔥'}
            </div>
            
            <p style={{ 
              fontSize: 12, 
              fontWeight: 900, 
              letterSpacing: '0.2em', 
              color: TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color,
              margin: 0,
              textShadow: `0 0 10px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}`
            }}>
              ¡HAS OBTENIDO UN PREMIO {TIER_COLORS[result.tier as keyof typeof TIER_COLORS].label}!
            </p>

            <h2 style={{ fontSize: 22, fontWeight: 900, color: '#fff', margin: '12px 0', lineHeight: 1.3 }}>
              {result.reward_details}
            </h2>

            <div style={{ background: TIER_COLORS[result.tier as keyof typeof TIER_COLORS].bg, padding: 16, borderRadius: 16, border: `1px solid ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].border}`, margin: '20px 0' }}>
              <p style={{ fontSize: 13, color: '#c4b5fd', margin: 0 }}>
                {result.tier === 'common' ? 'Se han añadido a tu saldo de chat.' : 'Se ha guardado en tu inventario.'}
              </p>
            </div>

            <button
              onClick={() => setResult(null)}
              className="modal-btn primary"
              style={{ width: '100%', padding: 16, fontSize: 15, fontWeight: 800, background: TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color, color: '#000', boxShadow: `0 8px 24px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}60` }}
            >
              ¡GENIAL!
            </button>
          </div>
        </div>
      )}

      {/* ESTILOS DE ANIMACIÓN */}
      <style jsx>{`
        @keyframes shake {
          0% { transform: translate(1px, 1px) rotate(0deg); }
          10% { transform: translate(-1px, -2px) rotate(-1deg); }
          20% { transform: translate(-3px, 0px) rotate(1deg); }
          30% { transform: translate(3px, 2px) rotate(0deg); }
          40% { transform: translate(1px, -1px) rotate(1deg); }
          50% { transform: translate(-1px, 2px) rotate(-1deg); }
          60% { transform: translate(-3px, 1px) rotate(0deg); }
          70% { transform: translate(3px, 1px) rotate(-1deg); }
          80% { transform: translate(-1px, -1px) rotate(1deg); }
          90% { transform: translate(1px, 2px) rotate(0deg); }
          100% { transform: translate(1px, -2px) rotate(-1deg); }
        }
        @keyframes spinFast {
          0% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(180deg) scale(1.1); }
          100% { transform: rotate(360deg) scale(1); }
        }
      `}</style>
    </div>
  )
}