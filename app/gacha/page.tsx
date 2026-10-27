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
const ITEM_WIDTH = 80
const ITEM_HEIGHT = 100
const STRIP_LEN = 40
const WIN_INDEX = 30
const SPIN_DURATION = 2600

interface Prize {
  icon: string
  imageKey?: string
  label: string
  color: string
  tier: string
}

const getPrizeImageUrl = (imageKey: string) => {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  if (!base) return ''
  return `${base.replace(/\/$/, '')}/item/gacha/${imageKey}.png`
}

const PRIZES_BG: Prize[] = [
  { icon: '💬', imageKey: 'icon_gems', label: '+15', color: '#a395c9', tier: 'common' },
  { icon: '💬', imageKey: 'icon_gems', label: '+20', color: '#a395c9', tier: 'common' },
  { icon: '💬', imageKey: 'icon_gems', label: '+25', color: '#a395c9', tier: 'common' },
  { icon: '💬', imageKey: 'icon_gems', label: '+30', color: '#a395c9', tier: 'common' },
  { icon: '💬', imageKey: 'icon_gems', label: '+35', color: '#06b6d4', tier: 'rare' },
  { icon: '📸', imageKey: 'icon_photo', label: 'Foto', color: '#06b6d4', tier: 'rare' },
  { icon: '🎵', imageKey: 'icon_audio', label: 'Audio', color: '#06b6d4', tier: 'rare' },
  { icon: '👗', imageKey: 'icon_outfit', label: 'Outfit', color: '#a855f7', tier: 'epic' },
  { icon: '🎟️', imageKey: 'icon_pass', label: 'Pase', color: '#a855f7', tier: 'epic' },
  { icon: '👑', imageKey: 'icon_character', label: 'Personaje', color: '#fbbf24', tier: 'legendary' },
  { icon: '🔥', imageKey: 'icon_mythic', label: 'Mítico', color: '#ec4899', tier: 'mythic' },
]

function getRandomPrize(): Prize {
  return PRIZES_BG[Math.floor(Math.random() * PRIZES_BG.length)]
}

function getResultPrize(result: any): Prize {
  const tierColor = (TIER_COLORS as any)[result.tier]?.color || '#a395c9'
  const tier = result.tier
  if (result.reward_type === 'gacha_character') {
    return { icon: tier === 'mythic' ? '🔥' : '👑', imageKey: tier === 'mythic' ? 'icon_mythic' : 'icon_character', label: 'Personaje', color: tierColor, tier }
  }
  if (result.reward_type === 'fantasy_pass') return { icon: '🎟️', imageKey: 'icon_pass', label: 'Pase', color: tierColor, tier }
  if (result.reward_type === 'outfit') return { icon: '👗', imageKey: 'icon_outfit', label: 'Outfit', color: tierColor, tier }
  if (result.reward_type === 'photo_token') return { icon: '📸', imageKey: 'icon_photo', label: 'Foto', color: tierColor, tier }
  if (result.reward_type === 'audio_token') return { icon: '🎵', imageKey: 'icon_audio', label: 'Audio', color: tierColor, tier }
  return { icon: '💬', imageKey: 'icon_gems', label: `+${result.item_key}`, color: tierColor, tier }
}

const getItemImageUrl = (itemId: string) => {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  if (!base) return ''
  const ext = itemId === 'roulette_chest' ? 'png' : 'jpg'
  return `${base.replace(/\/$/, '')}/item/${itemId}.${ext}`
}

const SHOWCASE_OUTFITS = [
  { id: 'outfit_school',          name: 'Escolar',              rarity: 'legendary' },
  { id: 'outfit_maid_sexy',       name: 'Maid Provocativa',     rarity: 'legendary' },
  { id: 'outfit_police',          name: 'Policía Sexy',         rarity: 'legendary' },
  { id: 'outfit_bunny',           name: 'Conejita',             rarity: 'legendary' },
  { id: 'outfit_red_lace',        name: 'Encaje Rojo',          rarity: 'epic' },
  { id: 'outfit_sheer_white',     name: 'Vestido Transparente', rarity: 'epic' },
  { id: 'outfit_corset_red',      name: 'Corsé Rojo',           rarity: 'epic' },
  { id: 'outfit_black_leather',   name: 'Cuero Negro',          rarity: 'rare' },
  { id: 'outfit_cyber_armor',     name: 'Cyberpunk',            rarity: 'rare' },
  { id: 'outfit_latex_black',     name: 'Látex Negro',          rarity: 'rare' },
  { id: 'outfit_nurse',           name: 'Enfermera',            rarity: 'rare' },
  { id: 'outfit_male_firefighter', name: 'Bombero',      rarity: 'legendary' },
  { id: 'outfit_male_dancer',      name: 'Bailarín',     rarity: 'legendary' },
  { id: 'outfit_male_pirate',      name: 'Pirata',       rarity: 'epic' },
  { id: 'outfit_male_gladiator',   name: 'Gladiador',    rarity: 'rare' },
  { id: 'outfit_male_towel',       name: 'Toalla de Baño', rarity: 'rare' },
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
  
  const [reelItems, setReelItems] = useState<Prize[]>([])
  const [showSkip, setShowSkip] = useState(false)
  const [tierLabel, setTierLabel] = useState('· LISTO ·')
  const [tierColor, setTierColor] = useState('')
  const [glowClass, setGlowClass] = useState('')
  const [isShaking, setIsShaking] = useState(false)
  
  // ✅ ESTADO: Para el toggle de animación rápida
  const [instantSpin, setInstantSpin] = useState(false)

  const reelRef = useRef<HTMLDivElement>(null)
  const reelWindowRef = useRef<HTMLDivElement>(null)
  const impactRingRef = useRef<HTMLDivElement>(null)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const winCanvasRef = useRef<HTMLCanvasElement>(null)
  const leverRef = useRef<HTMLDivElement>(null)

  const rafId = useRef(0)
  const animStart = useRef(0)
  const startPos = useRef(0)
  const targetPos = useRef(0)
  const currentPrize = useRef<Prize | null>(null)

  useEffect(() => {
    if (reelItems.length === 0) {
      setReelItems(Array.from({ length: 20 }, () => getRandomPrize()))
    }
  }, [reelItems.length])

  useEffect(() => {
    if (!user?.telegram_id) return
    tgFetch('/api/characters')
      .then(res => res.json())
      .then(data => {
        if (data.characters) setOwnedCharacters(data.characters.map((c: any) => c.archetype))
      })
      .catch(console.error)
  }, [user?.telegram_id])

  useEffect(() => {
    const cv = bgCanvasRef.current
    if (!cv) return
    const cx = cv.getContext('2d')
    if (!cx) return
    let W = cv.width = window.innerWidth
    let H = cv.height = window.innerHeight

    const stars = Array.from({ length: 100 }, () => ({
      x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.2,
      a: Math.random(), da: (Math.random() - 0.5) * 0.003,
      dy: -Math.random() * 0.00014, hue: Math.random() > 0.6 ? '270' : '220'
    }))

    let animId: number
    const loop = () => {
      cx.clearRect(0, 0, W, H)
      stars.forEach(s => {
        s.a += s.da; if (s.a <= 0 || s.a >= 1) s.da *= -1
        s.y += s.dy; if (s.y < -0.01) s.y = 1.01
        cx.beginPath(); cx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2)
        cx.fillStyle = `hsla(${s.hue}, 70%, 80%, ${s.a * 0.5})`; cx.fill()
      })
      animId = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(animId)
  }, [])

  const spawnParticles = (color: string) => {
    const cv = winCanvasRef.current
    if (!cv) return
    const cx = cv.getContext('2d')
    if (!cx) return
    cv.width = window.innerWidth; cv.height = window.innerHeight

    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2
    let parts: any[] = []
    const palette = [color, '#fbbf24', '#ec4899', '#a855f7', '#06b6d4', '#f5f0ff']

    for (let i = 0; i < 100; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 4 + Math.random() * 10
      parts.push({
        x: centerX, y: centerY,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - Math.random() * 6,
        r: 3 + Math.random() * 6, color: palette[Math.floor(Math.random() * palette.length)],
        life: 1, decay: 0.01 + Math.random() * 0.018, grav: 0.13,
        shape: ['rect', 'circle', 'diamond'][Math.floor(Math.random() * 3)]
      })
    }

    const loop = () => {
      cx.clearRect(0, 0, cv.width, cv.height)
      parts = parts.filter(p => p.life > 0)
      parts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.vx *= 0.985; p.life -= p.decay
        cx.globalAlpha = p.life
        cx.fillStyle = p.color
        if (p.shape === 'circle') { cx.beginPath(); cx.arc(p.x, p.y, p.r / 2, 0, Math.PI * 2); cx.fill() }
        else { cx.fillRect(p.x - p.r / 2, p.y - p.r / 4, p.r, p.r / 2) }
      })
      cx.globalAlpha = 1
      if (parts.length > 0) requestAnimationFrame(loop)
      else cx.clearRect(0, 0, cv.width, cv.height)
    }
    loop()
  }

  const animLever = () => {
    const lv = leverRef.current
    if (!lv) return
    lv.className = 'lever-wrap pulling'
    setTimeout(() => { lv.className = 'lever-wrap releasing' }, 160)
    setTimeout(() => { lv.className = 'lever-wrap back' }, 320)
    setTimeout(() => { lv.className = 'lever-wrap' }, 700)
  }

  const onLanded = () => {
    if (!currentPrize.current) return
    const p = currentPrize.current

    setGlowClass(`glow-${p.tier}`)
    setTierLabel(p.tier === 'common' ? '· COMÚN ·' : p.tier === 'rare' ? '· RARO ·' : p.tier === 'epic' ? '· ÉPICO ·' : p.tier === 'legendary' ? '· LEGENDARIO ·' : '· MÍTICO ·')
    setTierColor(p.color)

    if (['epic', 'legendary', 'mythic'].includes(p.tier)) spawnParticles(p.color)

    if (impactRingRef.current) {
      const ir = impactRingRef.current
      ir.style.animation = 'none'
      ir.style.setProperty('--wave-color', p.color)
      void ir.offsetWidth
      ir.style.animation = 'impactWave 0.7s ease-out forwards'
    }

    setIsShaking(true)
    setTimeout(() => setIsShaking(false), 400)

    setTimeout(() => {
      setResult(result)
    }, 600)
  }

  const finishSpin = () => {
    cancelAnimationFrame(rafId.current)
    setSpinning(false)
    setShowSkip(false)
    onLanded()
  }

  const frame = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - animStart.current) / SPIN_DURATION))
    const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
    const pos = startPos.current + (targetPos.current - startPos.current) * eased
    if (reelRef.current) reelRef.current.style.transform = `translateX(${pos}px)`
    if (t < 1) rafId.current = requestAnimationFrame(frame)
    else finishSpin()
  }

  const skipAnim = () => {
    if (!spinning) return
    cancelAnimationFrame(rafId.current)
    if (reelRef.current) reelRef.current.style.transform = `translateX(${targetPos.current}px)`
    finishSpin()
  }

  const handleSpin = async () => {
    if (!user || spinning) return
    if ((user.purchased_gems || 0) < COST) {
      setError(lang === 'es' ? 'Necesitas 50 gemas compradas para tirar.' : 'You need 50 purchased gems to spin.')
      return
    }

    setSpinning(true)
    setResult(null)
    setError(null)
    setGlowClass('')
    setTierLabel('· GIRANDO ·')
    setTierColor('#ec4899')
    animLever()

    try {
      const res = await tgFetch('/api/gacha/spin', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setSpinning(false)
        setError(data.message || 'Error al girar')
        return
      }

      const resultPrize = getResultPrize(data)
      currentPrize.current = resultPrize

      const newItems = Array.from({ length: STRIP_LEN }, () => getRandomPrize())
      newItems[WIN_INDEX] = resultPrize
      
      const decoy1 = Math.random() < 0.6 ? PRIZES_BG[9] : PRIZES_BG[7]
      const decoy2 = Math.random() < 0.3 ? PRIZES_BG[9] : PRIZES_BG[7]
      const r3 = Math.random()
      const decoy3 = r3 < 0.1 ? PRIZES_BG[10] : r3 < 0.5 ? PRIZES_BG[9] : PRIZES_BG[7]
      
      newItems[WIN_INDEX - 1] = decoy1
      newItems[WIN_INDEX - 2] = decoy2
      newItems[WIN_INDEX - 3] = decoy3

      setReelItems(newItems)

      if (reelRef.current) {
        reelRef.current.style.transition = 'none'
        reelRef.current.style.transform = 'translateX(0px)'
      }

      refresh().catch(() => {})
      if (data.reward_type === 'gacha_character') {
        setOwnedCharacters(prev => [...prev, data.item_key])
      }

      if (instantSpin) {
        setTimeout(() => {
          const cw = reelWindowRef.current?.offsetWidth || 340
          targetPos.current = (cw / 2) - (WIN_INDEX * ITEM_WIDTH + ITEM_WIDTH / 2)
          if (reelRef.current) {
            reelRef.current.style.transform = `translateX(${targetPos.current}px)`
          }
          finishSpin()
        }, 100)
      } else {
        setTimeout(() => {
          const cw = reelWindowRef.current?.offsetWidth || 340
          targetPos.current = (cw / 2) - (WIN_INDEX * ITEM_WIDTH + ITEM_WIDTH / 2)
          startPos.current = 0

          animStart.current = performance.now()
          rafId.current = requestAnimationFrame(frame)
          setShowSkip(true)
          
          setTimeout(() => {
            if (spinning) finishSpin()
          }, SPIN_DURATION + 1000)
        }, 50)
      }

    } catch (e) {
      setSpinning(false)
      setError('Error de conexión')
    }
  }

  if (userLoading || !user) return <div className="spinner-full"><div className="spinner" /></div>

  return (
    <div className="page" style={{ paddingBottom: 32, minHeight: '100vh', overflow: 'hidden' }}>
      <canvas ref={bgCanvasRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }} />
      <canvas ref={winCanvasRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60 }} />

      <header className="page-header" style={{ background: 'transparent', borderBottom: 'none', position: 'relative', zIndex: 10 }}>
        <button onClick={() => router.push('/')} style={{ background: 'transparent', border: 'none', color: '#fff', padding: 4 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <h1 className="page-title" style={{ flex: 1, textAlign: 'center', fontSize: 18 }}>La Ruleta de lo Prohibido</h1>
        <div style={{ width: 32 }} />
      </header>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8, position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(168, 85, 247, 0.15)', padding: '8px 16px', borderRadius: 20, border: '1px solid rgba(168, 85, 247, 0.3)' }}>
          <span style={{ fontSize: 14 }}>💎</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#f5f0ff' }}>
            <AnimatedNumber value={user.purchased_gems || 0} /> <span style={{ fontSize: 10, color: '#a395c9' }}>PAGO</span>
          </span>
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'center', marginTop: 24, padding: '0 16px' }}>
        
        <div className="lever-wrap" ref={leverRef} onClick={handleSpin} style={{ position: 'absolute', right: '10px', bottom: '20px' }}>
          <div className="lever-rail"></div>
          <div className="lever-arm"><div className="lever-ball"></div></div>
          <div className="lever-base"></div>
          <span className="lever-tag">PULL</span>
        </div>

        <div className={`cabinet ${isShaking ? 'shaking' : ''}`} style={{ marginRight: '40px' }}>
          <div className="marquee">
            <div className="marquee-body">
              <p className="marquee-title">Taboo Realm</p>
              <p className="marquee-name">EL ORÁCULO OSCURO</p>
              <div className="marquee-lights">
                {Array.from({ length: 12 }).map((_, i) => <div key={i} className="mlight" />)}
              </div>
            </div>
          </div>

          <div className="cab-body">
            <div className="screen-frame">
              <div className={`reel-panel ${glowClass}`} ref={reelWindowRef}>
                <div className="reel-inner">
                  <div className="reel-window">
                    <div className="selection-zone"></div>
                    <svg className="arrow arrow-top" width="22" height="14" viewBox="0 0 22 14"><polygon points="11,2 21,13 1,13" fill="#22d3ee"/><polygon points="11,0 21,11 1,11" fill="#ffe066" opacity="0.5"/></svg>
                    <svg className="arrow arrow-bottom" width="22" height="14" viewBox="0 0 22 14"><polygon points="11,12 21,1 1,1" fill="#22d3ee"/><polygon points="11,14 21,3 1,3" fill="#ffe066" opacity="0.5"/></svg>
                    
                    <div className="reel-clip">
                      <div className="reel-strip" ref={reelRef}>
                        {reelItems.map((item, i) => (
                          <div key={i} className="reel-item">
                            <div className="item-inner" style={{
                              background: `linear-gradient(180deg, ${item.color}25 0%, ${item.color}05 100%)`,
                              border: `1.5px solid ${item.color}60`,
                              boxShadow: `0 0 10px ${item.color}30, inset 0 0 8px ${item.color}15`,
                            }}>
                              {item.imageKey && getPrizeImageUrl(item.imageKey) ? (
                                <img 
                                  src={getPrizeImageUrl(item.imageKey)} 
                                  alt={item.label}
                                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, filter: `drop-shadow(0 0 6px ${item.color})`, zIndex: 2 }}
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    (e.target as HTMLImageElement).nextElementSibling?.setAttribute('style', 'display: block; font-size: 28px; line-height: 1; z-index: 2;');
                                  }}
                                />
                              ) : null}
                              <span style={{ display: item.imageKey ? 'none' : 'block', fontSize: 28, lineHeight: 1, zIndex: 2 }}>{item.icon}</span>
                              <span style={{ fontSize: 10, fontWeight: 900, color: item.color, textShadow: `0 0 8px ${item.color}80`, zIndex: 2, marginTop: 2 }}>
                                {item.label}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="reel-glass"></div>
                    <div className="fade-left"></div>
                    <div className="fade-right"></div>
                    <div className="impact-ring" ref={impactRingRef}></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="cab-info">
              <span className="info-gem">💎 Costo: <b>50</b> gemas</span>
              <div className="vents">
                {Array.from({ length: 7 }).map((_, i) => <div key={i} className="vent" />)}
              </div>
              <span className="info-tier" style={{ color: tierColor || 'rgba(34,211,238,0.7)' }}>{tierLabel}</span>
            </div>
          </div>

          <div className="control-panel">
            <button className="spin-btn" onClick={handleSpin} disabled={spinning}>
              {spinning ? '✦ GIRANDO...' : '⚡ GIRAR'}
            </button>
          </div>
          
          <div className="cab-base"><div className="cab-foot"></div></div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16, position: 'relative', zIndex: 10 }}>
        <button
          onClick={() => setInstantSpin(!instantSpin)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(168, 85, 247, 0.2)',
            padding: '6px 12px',
            borderRadius: 20,
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <span style={{ fontSize: 11, color: instantSpin ? '#22c55e' : '#8b8b9e', fontWeight: 700, letterSpacing: '0.05em' }}>
            {instantSpin ? 'MODO RÁPIDO ON' : 'MODO RÁPIDO OFF'}
          </span>
          <div style={{ 
            width: 36, height: 20, borderRadius: 10, 
            background: instantSpin ? '#22c55e' : '#1f1733', 
            position: 'relative', 
            transition: 'background 0.2s',
            boxShadow: instantSpin ? '0 0 10px rgba(34, 197, 94, 0.5)' : 'none'
          }}>
            <div style={{ 
              width: 16, height: 16, borderRadius: '50%', background: '#fff', 
              position: 'absolute', top: 2, left: instantSpin ? 18 : 2, 
              transition: 'left 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.4)'
            }} />
          </div>
        </button>
      </div>

      {showSkip && !instantSpin && <button className="skip-btn visible" onClick={skipAnim}>⏭ SALTAR</button>}

      {error && <p style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', marginTop: 12, position: 'relative', zIndex: 10 }}>⚠️ {error}</p>}

      <div style={{ padding: '40px 24px 0', position: 'relative', zIndex: 10 }}>
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
                    <img src={imgUrl} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', filter: hasChar ? 'none' : 'grayscale(100%)', opacity: hasChar ? 1 : 0.4 }} />
                  )}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(10,5,16,0.9) 0%, transparent 50%)' }} />
                  <div style={{ position: 'absolute', bottom: 4, width: '100%', textAlign: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 900, color: hasChar ? '#22c55e' : '#f5f0ff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{name}</span>
                  </div>
                  {hasChar && <div style={{ position: 'absolute', top: 4, right: 4, fontSize: 12 }}>✅</div>}
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'outfits' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {SHOWCASE_OUTFITS.map((outfit) => (
              <div key={outfit.id} style={{ borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ width: '100%', aspectRatio: '3/4', backgroundImage: `url('${getItemImageUrl(outfit.id)}')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#150f24' }} />
                <div style={{ padding: '10px 8px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f5f0ff' }}>{outfit.name}</div>
                  <div style={{ fontSize: 9, color: TIER_COLORS[outfit.rarity as keyof typeof TIER_COLORS].color, fontWeight: 800 }}>{TIER_COLORS[outfit.rarity as keyof typeof TIER_COLORS].label}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '40px 24px 0', position: 'relative', zIndex: 10 }}>
        <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: '#f0abfc', margin: '0 0 12px 0', textAlign: 'center' }}>ℹ️ ¿Cómo funciona la Ruleta?</h3>
          <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#c4b5fd', lineHeight: 1.5 }}>
            <li>Cada tirada cuesta <strong>50 Gemas de Pago</strong>.</li>
            <li>Puedes ganar <strong>Gemas de Chat</strong> (para hablar), <strong>Outfits</strong> (para regalar), o <strong>Pases de Fantasía</strong> (fotos nivel 5).</li>
            <li>Los <strong>Personajes Exclusivos</strong> solo se pueden desbloquear aquí. Si ya los tienes, se marcan con un ✅.</li>
            
            {/* ✅ TEXTOS MODIFICADOS AQUÍ */}
            <li><strong>Los premios más codiciados (Épicos, Legendarios y Míticos) tienen menor posibilidad de salir por su rareza y exclusividad.</strong></li>
            <li><strong>Garantía:</strong> Cada 10 tiradas tienes asegurado un premio Épico o superior si no lo has obtenido antes.</li>
            
            <li><strong>Outfits:</strong> Cuando regalas un Outfit, el personaje lo guarda en su armario. ¡Y lo usará en las <strong>futuras fotos</strong> que te envíe!</li>
          </ul>
        </div>
      </div>

      {result && (
        <div className="modal-backdrop" style={{ zIndex: 9999, background: 'rgba(5, 2, 10, 0.95)', backdropFilter: 'blur(10px)' }}>
          <div className="modal-box level-up-modal" style={{ textAlign: 'center', border: `2px solid ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}`, boxShadow: `0 0 40px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}40` }}>
            <div style={{ fontSize: 64, marginBottom: 16, animation: 'levelUpSparkle 1.5s infinite' }}>
              {result.tier === 'common' ? '💬' : result.tier === 'rare' ? '📸' : result.tier === 'epic' ? '🎟️' : result.tier === 'legendary' ? '👑' : '🔥'}
            </div>
            <p style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.2em', color: TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color, margin: 0, textShadow: `0 0 10px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}` }}>
              ¡HAS OBTENIDO UN PREMIO {TIER_COLORS[result.tier as keyof typeof TIER_COLORS].label}!
            </p>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: '#fff', margin: '12px 0', lineHeight: 1.3 }}>{result.reward_details}</h2>
            <div style={{ background: TIER_COLORS[result.tier as keyof typeof TIER_COLORS].bg, padding: 16, borderRadius: 16, border: `1px solid ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].border}`, margin: '20px 0' }}>
              <p style={{ fontSize: 13, color: '#c4b5fd', margin: 0 }}>{result.tier === 'common' ? 'Se han añadido a tu saldo de chat.' : 'Se ha guardado en tu inventario.'}</p>
            </div>
            <button onClick={() => setResult(null)} className="modal-btn primary" style={{ width: '100%', padding: 16, fontSize: 15, fontWeight: 800, background: TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color, color: '#000', boxShadow: `0 8px 24px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}60` }}>
              ¡GENIAL!
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .cabinet { 
          position: relative; 
          width: 100%; 
          max-width: 320px; 
          display: flex; 
          flex-direction: column; 
          align-items: center; 
          filter: drop-shadow(0 25px 35px rgba(0,0,0,0.9)) drop-shadow(0 0 40px rgba(168,85,247,0.2)); 
          transition: transform 0.1s; 
          z-index: 2;
        }
        
        .cabinet.shaking { animation: shake 0.38s ease; }
        @keyframes shake { 
          0%,100%{transform:translateX(0);} 
          20%{transform:translateX(-4px);} 
          40%{transform:translateX(4px);} 
          60%{transform:translateX(-3px);} 
          80%{transform:translateX(3px);} 
        }

        .marquee { width: 100%; position: relative; margin-bottom: -2px; z-index: 3; }
        .marquee-body { 
          position: relative; 
          margin: 0 12px; 
          background: linear-gradient(180deg, rgba(20, 15, 40, 0.95) 0%, rgba(10, 5, 20, 0.98) 100%);
          backdrop-filter: blur(10px);
          border-radius: 16px 16px 0 0; 
          padding: 14px 20px 12px; 
          border: 2px solid #c4b5fd; 
          border-bottom: none; 
          box-shadow: inset 0 4px 15px rgba(255,255,255,0.1), 0 0 15px rgba(196, 181, 253, 0.4);
        }
        .marquee-title { text-align: center; font-size: 9px; font-weight: 800; letter-spacing: 0.3em; color: #a78bfa; margin-bottom: 4px; text-shadow: 0 0 10px #a78bfa; }
        .marquee-name { 
          text-align: center; 
          font-size: 18px; 
          font-weight: 900; 
          letter-spacing: 0.05em; 
          background: linear-gradient(135deg, #ffe066 0%, #f472b6 50%, #22d3ee 100%); 
          -webkit-background-clip: text; 
          -webkit-text-fill-color: transparent; 
          filter: drop-shadow(0 0 12px rgba(255,224,102,0.5)); 
        }
        .marquee-lights { display: flex; justify-content: center; gap: 5px; margin-top: 8px; }
        .mlight { width: 6px; height: 6px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 10px #22d3ee; animation: mflicker 1.4s infinite; }
        .mlight:nth-child(2n) { background: #ec4899; box-shadow: 0 0 10px #ec4899; animation-delay: .2s; }
        .mlight:nth-child(3n) { background: #a855f7; box-shadow: 0 0 10px #a855f7; animation-delay: .4s; }
        @keyframes mflicker { 0%,100%{opacity:1;} 50%{opacity:0.4;} }

        .cab-body { 
          width: 100%; 
          position: relative; 
          background: linear-gradient(180deg, #1a1228 0%, #0d0820 100%); 
          border-left: 4px solid #7a4f10; 
          border-right: 4px solid #7a4f10; 
          padding: 16px 14px; 
          z-index: 1; 
          box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
        }

        .screen-frame {
          width: 100%;
          border: 3px solid #b8860b;
          border-radius: 8px;
          background: #060514;
          padding: 2px;
          box-shadow: 
            inset 0 0 15px rgba(0,0,0,1), 
            0 4px 10px rgba(0,0,0,0.5),
            0 0 15px rgba(184,134,11,0.4);
        }

        .reel-panel { position: relative; border-radius: 6px; padding: 2px; transition: box-shadow 0.5s ease; }
        .reel-inner { background: linear-gradient(180deg, #060514 0%, #0d0b22 50%, #060514 100%); border-radius: 4px; overflow: hidden; position: relative; box-shadow: inset 0 10px 20px rgba(0,0,0,0.9); }
        
        .reel-window { position: relative; width: 100%; height: 110px; }
        .selection-zone { position: absolute; top: 50%; left: 0; right: 0; transform: translateY(-50%); height: 80px; z-index: 8; pointer-events: none; }
        .selection-zone::before, .selection-zone::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent 0%, #22d3ee 15%, #ffe066 50%, #22d3ee 85%, transparent 100%); box-shadow: 0 0 10px #22d3ee; }
        .selection-zone::before { top: 0; } .selection-zone::after { bottom: 0; }
        
        .arrow { position: absolute; left: 50%; transform: translateX(-50%); z-index: 25; filter: drop-shadow(0 0 8px #22d3ee); }
        .arrow-top { top: -4px; } .arrow-bottom { bottom: -4px; }
        
        .reel-clip { position: absolute; inset: 0; overflow: hidden; }
        .reel-strip { display: flex; height: 110px; will-change: transform; align-items: center; }
        .reel-item { width: 80px; height: 90px; padding: 4px; flex-shrink: 0; }
        
        .item-inner { width: 100%; height: 100%; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; position: relative; overflow: hidden; }
        
        .reel-glass { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 40%, rgba(0,0,0,0.3) 100%); pointer-events: none; z-index: 15; }
        .fade-left { position: absolute; top: 0; bottom: 0; left: 0; width: 20%; background: linear-gradient(90deg, #060514 0%, transparent 100%); z-index: 12; pointer-events: none; }
        .fade-right { position: absolute; top: 0; bottom: 0; right: 0; width: 20%; background: linear-gradient(270deg, #060514 0%, transparent 100%); z-index: 12; pointer-events: none; }

        .impact-ring { position: absolute; top: 50%; left: 50%; width: 0; height: 0; border-radius: 50%; border: 2px solid transparent; transform: translate(-50%,-50%); pointer-events: none; z-index: 30; opacity: 0; }
        @keyframes impactWave { 0% { width: 60px; height: 60px; opacity: 0.9; border-color: var(--wave-color,#ec4899); } 100% { width: 300px; height: 120px; opacity: 0; border-color: var(--wave-color,#ec4899); } }

        .cab-info { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding: 6px 10px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid rgba(168,85,247,0.2); }
        .info-gem { font-size: 10px; color: rgba(196,181,253,0.7); font-weight: 600; }
        .info-gem b { color: #c4b5fd; font-size: 12px; }
        .info-tier { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700; transition: color 0.3s; }
        .vents { display: flex; gap: 3px; }
        .vent { width: 2px; height: 10px; border-radius: 1px; background: rgba(255,224,102,0.15); }

        .control-panel { 
          background: linear-gradient(180deg, #150f24 0%, #0a0510 100%); 
          border-left: 4px solid #7a4f10; 
          border-right: 4px solid #7a4f10; 
          padding: 16px; 
          display: flex; 
          justify-content: center; 
          box-shadow: inset 0 5px 15px rgba(0,0,0,0.8);
        }
        
        .spin-btn { 
          position: relative; 
          width: 85%; 
          height: 50px; 
          border: none; 
          cursor: pointer; 
          border-radius: 14px; 
          font-size: 15px; 
          font-weight: 900; 
          color: #1a1228; 
          background: linear-gradient(135deg, #f472b6 0%, #ffe066 50%, #f472b6 100%); 
          background-size: 200% 100%; 
          box-shadow: 
            0 6px 20px rgba(244,114,182,0.6),
            inset 0 2px 5px rgba(255,255,255,0.5);
          transition: transform 0.1s; 
          overflow: hidden; 
        }
        .spin-btn:hover { background-position: 100% 0; transform: translateY(-1px); }
        .spin-btn:active { transform: scale(0.97); }
        .spin-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; filter: grayscale(1); }

        .cab-base { width: 100%; }
        .cab-foot { 
          width: 100%; 
          height: 16px; 
          background: linear-gradient(180deg, #0e0b1e 0%, #07050f 100%); 
          border-radius: 0 0 12px 12px; 
          border: 2px solid #7a4f10; 
          border-top: none; 
          box-shadow: 0 10px 20px rgba(0,0,0,0.9);
        }

        .lever-wrap { 
          position: absolute; 
          right: 0px; 
          bottom: 10px; 
          width: 50px; 
          height: 260px; 
          display: flex; 
          flex-direction: column; 
          align-items: center; 
          cursor: pointer; 
          user-select: none; 
          z-index: 1;
        }
        
        .lever-rail { 
          position: absolute; 
          top: 20px; 
          bottom: 20px; 
          left: 50%; 
          transform: translateX(-50%); 
          width: 10px; 
          background: linear-gradient(90deg, #0a0510, #1f1733, #0a0510); 
          border-radius: 5px; 
          border: 1px solid rgba(168,85,247,0.3); 
          box-shadow: inset 0 5px 10px rgba(0,0,0,0.9);
        }
        
        .lever-arm { 
          position: absolute; 
          top: 30px; 
          left: 50%; 
          transform: translateX(-50%); 
          width: 8px; 
          height: 140px; 
          background: linear-gradient(90deg, #7a4f10, #c4b5fd 30%, #a5b4fc 60%, #3730a3); 
          border-radius: 4px; 
          transition: transform 0.15s ease; 
          box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
        }
        
        .lever-ball { 
          position: absolute; 
          top: -16px; 
          left: 50%; 
          transform: translateX(-50%); 
          width: 30px; 
          height: 30px; 
          border-radius: 50%; 
          background: radial-gradient(circle at 30% 30%, #fff 0%, #f472b6 20%, #c026d3 60%, #4c1d95 100%); 
          box-shadow: 
            0 6px 15px rgba(192,38,211,0.8), 
            inset 0 -4px 8px rgba(0,0,0,0.6),
            inset 4px 4px 8px rgba(255,255,255,0.4);
        }
        
        .lever-base { 
          position: absolute; 
          bottom: 10px; 
          left: 50%; 
          transform: translateX(-50%); 
          width: 24px; 
          height: 24px; 
          border-radius: 50%; 
          background: conic-gradient(from 90deg, #ffe066, #7a4f10, #0a0510, #7a4f10, #ffe066); 
          box-shadow: 0 4px 10px rgba(0,0,0,0.9);
        }
        
        .lever-tag { 
          position: absolute; 
          bottom: -10px; 
          font-size: 9px; 
          letter-spacing: 0.2em; 
          color: #a78bfa; 
          text-transform: uppercase; 
          font-weight: 800;
          text-shadow: 0 0 8px #a78bfa;
        }

        .lever-wrap.pulling .lever-arm { transform: translateX(-50%) rotate(35deg); transition: transform 0.1s ease-in; }
        .lever-wrap.releasing .lever-arm { transform: translateX(-50%) rotate(-5deg); transition: transform 0.2s ease-out; }
        .lever-wrap.back .lever-arm { transform: translateX(-50%) rotate(0deg); transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1); }

        .glow-common { box-shadow: inset 0 0 30px rgba(129,140,248,0.3), 0 0 20px rgba(129,140,248,0.4); }
        .glow-rare { box-shadow: inset 0 0 30px rgba(6,182,212,0.5), 0 0 30px rgba(6,182,212,0.6); }
        .glow-epic { box-shadow: inset 0 0 40px rgba(168,85,247,0.7), 0 0 40px rgba(168,85,247,0.8); }
        .glow-legendary { box-shadow: inset 0 0 50px rgba(251,191,36,0.8), 0 0 50px rgba(251,191,36,0.9); }
        .glow-mythic { box-shadow: inset 0 0 60px rgba(236,72,153,0.9), 0 0 60px rgba(236,72,153,1); }

        .skip-btn { position: fixed; bottom: 24px; right: 24px; z-index: 200; padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(129,140,248,0.4); background: rgba(7,6,26,0.85); color: rgba(196,181,253,0.8); font-size: 11px; font-weight: 700; cursor: pointer; backdrop-filter: blur(4px); transition: opacity 0.2s; }
        .skip-btn:hover { border-color: rgba(34,211,238,0.6); color: #22d3ee; }
      `}</style>
    </div>
  )
}
