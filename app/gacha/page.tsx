"use client"

import { useState, useEffect, useRef } from 'react'
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

// ─── Reel configuration ───
const ITEM_WIDTH = 100
const ITEM_HEIGHT = 120
const FAST_SPEED = 40          // px por frame en fase rápida
const MIN_SPIN_TIME = 900      // ms mínimo de giro rápido (antes de frenar)
const LANDING_DURATION = 2200  // ms de desaceleración
const WIN_OFFSET = 24          // items adelante del actual donde se coloca el ganador

interface Prize {
  icon: string
  label: string
  color: string
  tier: string
}

const REEL_POOL: Prize[] = [
  { icon: '💬', label: '+15', color: '#a395c9', tier: 'common' },
  { icon: '💬', label: '+20', color: '#a395c9', tier: 'common' },
  { icon: '💬', label: '+25', color: '#a395c9', tier: 'common' },
  { icon: '💬', label: '+30', color: '#a395c9', tier: 'common' },
  { icon: '💬', label: '+35', color: '#06b6d4', tier: 'rare' },
  { icon: '💬', label: '+40', color: '#06b6d4', tier: 'rare' },
  { icon: '📸', label: 'Foto', color: '#06b6d4', tier: 'rare' },
  { icon: '🎵', label: 'Audio', color: '#06b6d4', tier: 'rare' },
  { icon: '👗', label: 'Outfit', color: '#a855f7', tier: 'epic' },
  { icon: '🎟️', label: 'Pase', color: '#a855f7', tier: 'epic' },
  { icon: '👑', label: 'Personaje', color: '#fbbf24', tier: 'legendary' },
  { icon: '🔥', label: 'Mítico', color: '#ec4899', tier: 'mythic' },
]

function getRandomPrize(): Prize {
  const r = Math.random() * 100
  let idx: number
  if (r < 40) idx = Math.floor(Math.random() * 4)            // gems comunes
  else if (r < 65) idx = 4 + Math.floor(Math.random() * 2)   // gems raras
  else if (r < 82) idx = 6 + Math.floor(Math.random() * 2)   // foto/audio
  else if (r < 93) idx = 8 + Math.floor(Math.random() * 2)   // outfit/pase
  else if (r < 98) idx = 10                                   // personaje
  else idx = 11                                               // mítico
  return { ...REEL_POOL[idx] }
}

function getResultPrize(result: any): Prize {
  const tierColor = (TIER_COLORS as any)[result.tier]?.color || '#a395c9'
  const tier = result.tier
  if (result.reward_type === 'gacha_character') {
    return { icon: tier === 'mythic' ? '🔥' : '👑', label: 'Personaje', color: tierColor, tier }
  }
  if (result.reward_type === 'fantasy_pass') return { icon: '🎟️', label: 'Pase', color: tierColor, tier }
  if (result.reward_type === 'outfit') return { icon: '👗', label: 'Outfit', color: tierColor, tier }
  if (result.reward_type === 'photo_token') return { icon: '📸', label: 'Foto', color: tierColor, tier }
  if (result.reward_type === 'audio_token') return { icon: '🎵', label: 'Audio', color: tierColor, tier }
  return { icon: '💬', label: `+${result.item_key}`, color: tierColor, tier }
}

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

  // ─── Reel refs y estado ───
  const [reelItems, setReelItems] = useState<Prize[]>([])
  const reelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef(0)
  const targetRef = useRef(0)
  const phaseRef = useRef<'idle' | 'fast' | 'landing'>('idle')
  const landingStartRef = useRef(0)
  const landingStartPosRef = useRef(0)
  const rafRef = useRef(0)
  const spinStartRef = useRef(0)
  const spinningRef = useRef(false)
  const handleLandingCompleteRef = useRef<() => void>(() => {})

  // Inicializar preview del reel
  useEffect(() => {
    if (reelItems.length === 0) {
      setReelItems(Array.from({ length: 20 }, () => getRandomPrize()))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cleanup en unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Cargar personajes poseídos
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

  // ─── Animation loop ───
  const tick = (time: number) => {
    if (phaseRef.current === 'fast') {
      positionRef.current -= FAST_SPEED
      if (reelRef.current) {
        reelRef.current.style.transform = `translateX(${positionRef.current}px)`
      }
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    if (phaseRef.current === 'landing') {
      const elapsed = time - landingStartRef.current
      const t = Math.min(1, elapsed / LANDING_DURATION)
      // Ease-out cuadrático: la velocidad inicial coincide con la del fast spin → transición sin saltos
      const eased = 1 - (1 - t) * (1 - t)
      const pos = landingStartPosRef.current + (targetRef.current - landingStartPosRef.current) * eased
      positionRef.current = pos
      if (reelRef.current) {
        reelRef.current.style.transform = `translateX(${pos}px)`
      }
      if (t >= 1) {
        phaseRef.current = 'idle'
        handleLandingCompleteRef.current()
        return
      }
      rafRef.current = requestAnimationFrame(tick)
      return
    }
  }

  const startLanding = (resultData: any) => {
    const currentIndex = Math.floor(-positionRef.current / ITEM_WIDTH)
    const winIndex = currentIndex + WIN_OFFSET

    const items = [...reelItems]
    while (items.length <= winIndex + 3) {
      items.push(getRandomPrize())
    }
    items[winIndex] = getResultPrize(resultData)
    setReelItems(items)

    const containerWidth = containerRef.current?.offsetWidth || 340
    const targetX = containerWidth / 2 - (winIndex * ITEM_WIDTH + ITEM_WIDTH / 2)

    // Establecer fase y capturar posición de forma atómica (sin frames en medio)
    phaseRef.current = 'landing'
    targetRef.current = targetX
    landingStartPosRef.current = positionRef.current
    landingStartRef.current = performance.now()

    handleLandingCompleteRef.current = () => {
      setResult(resultData)
      setSpinning(false)
      spinningRef.current = false
      refresh().catch(() => {})
      if (resultData.reward_type === 'gacha_character') {
        setOwnedCharacters(prev => [...prev, resultData.item_key])
      }
    }
  }

  const handleSpin = async () => {
    if (!user || spinningRef.current) return
    if ((user.purchased_gems || 0) < COST) {
      setError(lang === 'es' ? 'Necesitas 50 gemas compradas para tirar.' : 'You need 50 purchased gems to spin.')
      return
    }

    spinningRef.current = true
    setSpinning(true)
    setResult(null)
    setError(null)

    // Preparar reel nuevo
    const initialItems = Array.from({ length: 150 }, () => getRandomPrize())
    setReelItems(initialItems)
    positionRef.current = 0
    if (reelRef.current) {
      reelRef.current.style.transform = 'translateX(0px)'
    }

    spinStartRef.current = Date.now()
    phaseRef.current = 'fast'
    rafRef.current = requestAnimationFrame(tick)

    try {
      const res = await tgFetch('/api/gacha/spin', { method: 'POST' })
      const data = await res.json()

      const elapsed = Date.now() - spinStartRef.current
      if (elapsed < MIN_SPIN_TIME) {
        await new Promise(r => setTimeout(r, MIN_SPIN_TIME - elapsed))
      }

      if (!res.ok) {
        phaseRef.current = 'idle'
        cancelAnimationFrame(rafRef.current)
        setError(data.message || 'Error al girar la ruleta')
        setSpinning(false)
        spinningRef.current = false
        return
      }

      startLanding(data)
    } catch (e: any) {
      phaseRef.current = 'idle'
      cancelAnimationFrame(rafRef.current)
      setError('Error de conexión. Intenta de nuevo.')
      setSpinning(false)
      spinningRef.current = false
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

      {/* ═══════════════════ REEL SLOT MACHINE ═══════════════════ */}
      <div style={{ marginTop: 32, padding: '0 16px' }}>
        <div style={{ position: 'relative', maxWidth: 500, margin: '0 auto' }}>
          {/* Glow */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 320, height: 200,
            background: 'radial-gradient(circle, rgba(236,72,153,0.3) 0%, transparent 70%)',
            filter: 'blur(40px)',
            pointerEvents: 'none',
            zIndex: 0,
            animation: 'pulseGlow 4s infinite',
          }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            {/* Flecha superior */}
            <div style={{
              position: 'absolute', top: -4, left: '50%',
              transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '10px solid transparent',
              borderRight: '10px solid transparent',
              borderTop: '12px solid #ec4899',
              zIndex: 20,
              filter: 'drop-shadow(0 0 8px #ec4899)',
            }} />
            {/* Flecha inferior */}
            <div style={{
              position: 'absolute', bottom: -4, left: '50%',
              transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '10px solid transparent',
              borderRight: '10px solid transparent',
              borderBottom: '12px solid #ec4899',
              zIndex: 20,
              filter: 'drop-shadow(0 0 8px #ec4899)',
            }} />

            {/* Ventana del reel */}
            <div ref={containerRef} style={{
              overflow: 'hidden',
              borderRadius: 16,
              padding: '14px 0',
              background: 'linear-gradient(180deg, #150f24 0%, #1f1733 50%, #150f24 100%)',
              border: '2px solid rgba(168,85,247,0.45)',
              boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.85), 0 20px 50px rgba(0,0,0,0.6)',
              position: 'relative',
            }}>
              <div ref={reelRef} style={{ display: 'flex', willChange: 'transform' }}>
                {reelItems.map((item, i) => (
                  <div key={i} style={{
                    width: ITEM_WIDTH,
                    height: ITEM_HEIGHT,
                    padding: 5,
                    boxSizing: 'border-box',
                    flexShrink: 0,
                  }}>
                    <div style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: 10,
                      background: `linear-gradient(180deg, ${item.color}25 0%, ${item.color}05 100%)`,
                      border: `2px solid ${item.color}60`,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      boxShadow: `0 0 10px ${item.color}30, inset 0 0 8px ${item.color}15`,
                    }}>
                      <span style={{ fontSize: 30, lineHeight: 1 }}>{item.icon}</span>
                      <span style={{
                        fontSize: 9,
                        fontWeight: 900,
                        color: item.color,
                        textAlign: 'center',
                        textShadow: `0 0 8px ${item.color}80`,
                        letterSpacing: '0.02em',
                      }}>
                        {item.label}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Línea central */}
              <div style={{
                position: 'absolute', top: 0, bottom: 0, left: '50%',
                width: 2,
                background: 'linear-gradient(180deg, transparent 0%, #ec4899 30%, #ec4899 70%, transparent 100%)',
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: 10,
                boxShadow: '0 0 12px #ec4899',
                opacity: 0.7,
              }} />

              {/* Fades laterales */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '12%', background: 'linear-gradient(90deg, #150f24 0%, transparent 100%)', pointerEvents: 'none', zIndex: 5 }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '12%', background: 'linear-gradient(270deg, #150f24 0%, transparent 100%)', pointerEvents: 'none', zIndex: 5 }} />
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════ SPIN BUTTON ═══════════════════ */}
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
          {spinning ? 'Girando...' : (
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

      {/* ═══════════════════ TABS ═══════════════════ */}
      <div style={{ padding: '40px 24px 0', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setActiveTab('characters')}
            style={{
              flex: 1, padding: '10px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: activeTab === 'characters' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
              color: activeTab === 'characters' ? '#f0abfc' : '#8b8b9e',
              fontWeight: 800, fontFamily: 'inherit', fontSize: 13,
              borderBottom: activeTab === 'characters' ? '2px solid #a855f7' : '2px solid transparent',
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
              borderBottom: activeTab === 'outfits' ? '2px solid #06b6d4' : '2px solid transparent',
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
                  position: 'relative', overflow: 'hidden',
                }}>
                  {imgUrl && (
                    <img
                      src={imgUrl}
                      alt={name}
                      style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top',
                        filter: hasChar ? 'none' : 'grayscale(100%)',
                        opacity: hasChar ? 1 : 0.4,
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
                  backgroundColor: '#150f24',
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

      {/* ═══════════════════ INFO ═══════════════════ */}
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

      {/* ═══════════════════ RESULT MODAL ═══════════════════ */}
      {result && (
        <div className="modal-backdrop" style={{ zIndex: 9999, background: 'rgba(5, 2, 10, 0.95)', backdropFilter: 'blur(10px)' }}>
          <div
            className="modal-box level-up-modal"
            style={{
              textAlign: 'center',
              border: `2px solid ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}`,
              boxShadow: `0 0 40px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}40`,
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
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.15); }
        }
      `}</style>
    </div>
  )
}
