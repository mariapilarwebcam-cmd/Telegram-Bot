"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/UserContext'
import { tgFetch } from '@/lib/telegram-fetch'
import { getTranslations } from '@/lib/i18n'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { GACHA_ARCHETYPES, CHARACTER_NAMES_FEMALE, CHARACTER_NAMES_MALE, getCharacterImageUrl } from '@/lib/constants'

const TIER_COLORS = {
  common: { color: '#a395c9', bg: 'rgba(163, 149, 201, 0.1)', border: 'rgba(163, 149, 201, 0.3)', label: 'COMÚN' },
  rare: { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)', border: 'rgba(6, 182, 212, 0.3)', label: 'RARO' },
  epic: { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.4)', label: 'ÉPICO' },
  legendary: { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.1)', border: 'rgba(251, 191, 36, 0.5)', label: 'LEGENDARIO' },
  mythic: { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.7)', label: 'MÍTICO' },
}

const COST = 50

const getItemImageUrl = (itemId: string) => {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  if (!base) return ''
  const ext = itemId === 'roulette_chest' ? 'png' : 'jpg'
  return `${base.replace(/\/$/, '')}/item/${itemId}.${ext}`
}

const SHOWCASE_OUTFITS = [
  { id: 'outfit_red_lace', name: 'Encaje Rojo', rarity: 'epic' },
  { id: 'outfit_black_leather', name: 'Cuero Negro', rarity: 'epic' },
  { id: 'outfit_cyber_armor', name: 'Cyberpunk', rarity: 'legendary' },
  { id: 'outfit_latex_black', name: 'Látex Negro', rarity: 'legendary' },
  { id: 'outfit_sheer_white', name: 'Vestido Transparente', rarity: 'legendary' },
  { id: 'outfit_bunny', name: 'Conejita', rarity: 'epic' },
  { id: 'outfit_maid_sexy', name: 'Maid Provocativa', rarity: 'epic' },
  { id: 'outfit_corset_red', name: 'Corsé Rojo', rarity: 'epic' },
  { id: 'outfit_school', name: 'Escolar', rarity: 'rare' },
  { id: 'outfit_nurse', name: 'Enfermera', rarity: 'rare' },
  { id: 'outfit_police', name: 'Policía Sexy', rarity: 'rare' },
  { id: 'outfit_male_pirate', name: 'Pirata', rarity: 'epic' },
  { id: 'outfit_male_firefighter', name: 'Bombero', rarity: 'epic' },
  { id: 'outfit_male_gladiator', name: 'Gladiador', rarity: 'legendary' },
  { id: 'outfit_male_dancer', name: 'Bailarín', rarity: 'legendary' },
  { id: 'outfit_male_towel', name: 'Toalla de Baño', rarity: 'rare' },
]

export default function GachaPage() {
  const router = useRouter()
  const { user, loading: userLoading, lang, refresh } = useUser()
  const t = getTranslations(lang)

  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'characters' | 'outfits'>('characters')
  
  const [ownedCharacters, setOwnedCharacters] = useState<string[]>([])
  const [loadingChars, setLoadingChars] = useState(true)

  useEffect(() => {
    if (!user?.telegram_id) return
    tgFetch('/api/characters')
      .then(res => res.json())
      .then(data => {
        if (data.characters) {
          setOwnedCharacters(data.characters.map((c: any) => c.archetype))
        }
      })
      .catch(console.error)
      .finally(() => setLoadingChars(false))
  }, [user?.telegram_id])

  const handleSpin = async () => {
    if (!user || spinning) return
    if ((user.purchased_gems || 0) < COST) {
      setError(lang === 'es' ? 'Necesitas 50 gemas compradas para tirar.' : 'You need 50 purchased gems to spin.')
      return
    }

    setSpinning(true)
    setResult(null)
    setError(null)

    const minWait = new Promise(resolve => setTimeout(resolve, 2500))

    try {
      const res = await tgFetch('/api/gacha/spin', { method: 'POST' })
      const data = await res.json()

      await minWait

      if (!res.ok) {
        setError(data.message || 'Error al girar la ruleta')
        setSpinning(false)
        return
      }

      setResult(data)
      await refresh()
      
      if (data.reward_type === 'gacha_character') {
         setOwnedCharacters(prev => [...prev, data.item_key])
      }
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

      <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <div style={{ position: 'absolute', width: 300, height: 300, background: 'radial-gradient(circle, rgba(236,72,153,0.2) 0%, transparent 60%)', filter: 'blur(40px)', zIndex: 0, animation: 'pulseGlow 4s infinite' }} />

        <div style={{
          width: 220,
          height: 280,
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
          {/* ✅ IMAGEN DEL COFRE CON BORDES REDONDEADOS Y SOMBRA PREMIUM */}
          <img 
            src={getItemImageUrl('roulette_chest')} 
            alt="Roulette Chest"
            style={{ 
              width: 150, 
              height: 150, 
              objectFit: 'cover',
              borderRadius: 20, // ✅ Bordes redondeados
              boxShadow: '0 10px 30px rgba(0,0,0,0.8), 0 0 20px rgba(236,72,153,0.6)', // ✅ Sombra 3D
              border: '1px solid rgba(255,255,255,0.1)',
              animation: spinning ? 'spinFast 1s infinite linear' : 'none' 
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 24 24" fill="none" stroke="%23ec4899" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>';
            }}
          />
          <p style={{ color: '#f0abfc', fontWeight: 900, letterSpacing: '0.1em', marginTop: 16, fontSize: 14 }}>
            {spinning ? 'GIRANDO...' : 'TOCA PARA GIRAR'}
          </p>
        </div>
      </div>

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

      <div style={{ padding: '40px 24px 0', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setActiveTab('characters')}
            style={{
              flex: 1, padding: '10px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: activeTab === 'characters' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
              color: activeTab === 'characters' ? '#f0abfc' : '#8b8b9e',
              fontWeight: 800, fontFamily: 'inherit', fontSize: 13,
              borderBottom: activeTab === 'characters' ? '2px solid #a855f7' : '2px solid transparent'
            }}
          >
            👑 Personajes
          </button>
          <button
            onClick={() => setActiveTab('outfits')}
            style={{
              flex: 1, padding: '10px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: activeTab === 'outfits' ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255,255,255,0.05)',
              color: activeTab === 'outfits' ? '#06b6d4' : '#8b8b9e',
              fontWeight: 800, fontFamily: 'inherit', fontSize: 13,
              borderBottom: activeTab === 'outfits' ? '2px solid #06b6d4' : '2px solid transparent'
            }}
          >
            👗 Outfits
          </button>
        </div>

        {activeTab === 'characters' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {GACHA_ARCHETYPES.map((arch) => {
              const isFemale = arch === 'succubus' || arch === 'fallen_angel' || arch === 'werewolf_f' || arch === 'cyborg_assassin'
              const name = isFemale ? CHARACTER_NAMES_FEMALE[arch] : CHARACTER_NAMES_MALE[arch]
              const imgUrl = getCharacterImageUrl(arch, isFemale ? 'female' : 'male')
              const hasChar = ownedCharacters.includes(arch)
              
              return (
                <div key={arch} style={{ 
                  aspectRatio: '3/4', borderRadius: 12, 
                  background: 'linear-gradient(180deg, rgba(31,23,51,0.8) 0%, rgba(10,5,16,0.9) 100%)',
                  border: hasChar ? '1px solid #22c55e' : '1px solid rgba(168,85,247,0.2)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  position: 'relative', overflow: 'hidden'
                }}>
                  {imgUrl && (
                    <img 
                      src={imgUrl} 
                      alt={name} 
                      style={{ 
                        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top',
                        filter: hasChar ? 'none' : 'grayscale(100%)', 
                        opacity: hasChar ? 1 : 0.4 
                      }} 
                    />
                  )}
                  
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(10,5,16,0.9) 0%, transparent 50%)' }} />
                  
                  <div style={{ position: 'absolute', bottom: 4, width: '100%', textAlign: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 900, color: hasChar ? '#22c55e' : '#f5f0ff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {name}
                    </span>
                  </div>

                  {hasChar && (
                    <div style={{ position: 'absolute', top: 4, right: 4, fontSize: 12 }}>✅</div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'outfits' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {SHOWCASE_OUTFITS.map((outfit) => (
              <div key={outfit.id} style={{ 
                borderRadius: 12, 
                background: 'rgba(255,255,255,0.03)', 
                border: '1px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ 
                  width: '100%', 
                  aspectRatio: '3/4', 
                  backgroundImage: `url('${getItemImageUrl(outfit.id)}')`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundColor: '#150f24'
                }} />
                
                <div style={{ padding: '10px 8px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f5f0ff' }}>{outfit.name}</div>
                  <div style={{ fontSize: 9, color: TIER_COLORS[outfit.rarity as keyof typeof TIER_COLORS].color, fontWeight: 800 }}>
                    {TIER_COLORS[outfit.rarity as keyof typeof TIER_COLORS].label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ✅ SECCIÓN DE INFORMACIÓN ACTUALIZADA */}
      <div style={{ padding: '40px 24px 0', position: 'relative', zIndex: 1 }}>
        <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: '#f0abfc', margin: '0 0 12px 0', textAlign: 'center' }}>
            ℹ️ ¿Cómo funciona la Ruleta?
          </h3>
          <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#c4b5fd', lineHeight: 1.5 }}>
            <li>Cada tirada cuesta <strong>50 Gemas de Pago</strong>.</li>
            <li>Puedes ganar <strong>Gemas de Chat</strong> (para hablar), <strong>Outfits</strong> (para regalar), o <strong>Pases de Fantasía</strong> (fotos nivel 5).</li>
            <li>Los <strong>Personajes Exclusivos</strong> solo se pueden desbloquear aquí. Si ya los tienes, se marcan con un ✅.</li>
            <li><strong>Los premios más codiciados (Épicos, Legendarios y Míticos) tienen una probabilidad muy baja.</strong></li>
            <li><strong>Garantía:</strong> Si tienes mala suerte, cada 10 tiradas el sistema te asegura un premio Épico o superior.</li>
            <li><strong>Outfits:</strong> Cuando regalas un Outfit, el personaje lo guarda en su armario. ¡Y lo usará en las <strong>futuras fotos</strong> que te envíe!</li>
          </ul>
        </div>
      </div>

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
            
            <p style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.2em', color: TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color, margin: 0, textShadow: `0 0 10px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}` }}>
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
