// app/gacha/page.tsx
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
  return `${base.replace(/\/$/, '')}/items/gacha/${imageKey}.png`
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
  return { icon: '💬', imageKey: 'icon_gems', label: `+${result.item_key || '?'}`, color: tierColor, tier }
}

const getItemImageUrl = (itemId: string) => {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  if (!base) return ''
  const cleanBase = base.replace(/\/$/, '')
  const folder = cleanBase.endsWith('/item') || cleanBase.endsWith('/items') ? '' : '/item'
  return `${cleanBase}${folder}/${itemId}.jpg`
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
  const { user, loading: userLoading, lang, refresh, setUser } = useUser() // ✅ Añadido setUser
  const t = getTranslations(lang)

  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'characters' | 'outfits'>('characters')
  const [ownedCharacters, setOwnedCharacters] = useState<string[]>([])
  const [isVip, setIsVip] = useState(false)
  
  const [reelItems, setReelItems] = useState<Prize[]>([])
  const [showSkip, setShowSkip] = useState(false)
  const [tierLabel, setTierLabel] = useState('· LISTO ·')
  const [tierColor, setTierColor] = useState('')
  const [glowClass, setGlowClass] = useState('')
  const [isShaking, setIsShaking] = useState(false)
  
  const [instantSpin, setInstantSpin] = useState(false)

  const reelRef = useRef<HTMLDivElement>(null)
  const reelWindowRef = useRef<HTMLDivElement>(null)
  const impactRingRef = useRef<HTMLDivElement>(null)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const winCanvasRef = useRef<HTMLCanvasElement>(null)

  const rafId = useRef(0)
  const animStart = useRef(0)
  const startPos = useRef(0)
  const targetPos = useRef(0)
  const currentPrize = useRef<Prize | null>(null)
  
  const currentResultData = useRef<any>(null)
  const hasFinished = useRef(false)

  useEffect(() => {
    if (!user?.telegram_id) return
    tgFetch('/api/subscription')
      .then(res => res.json())
      .then(data => setIsVip(!!data.active))
      .catch(console.error)
  }, [user?.telegram_id])

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
    const onResize = () => { W = cv.width = window.innerWidth; H = cv.height = window.innerHeight }
    window.addEventListener('resize', onResize)

    const HUES = ['270', '220', '270', '330', '190']
    const stars = Array.from({ length: 130 }, (_, i) => ({
      x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.2,
      a: Math.random(), da: (Math.random() - 0.5) * 0.003,
      dy: -Math.random() * 0.00015,
      hue: HUES[i % HUES.length],
      wob: Math.random() * 0.0006,
      ph: Math.random() * Math.PI * 2,
      bright: i % 12 === 0
    }))

    const paint = (t: number) => {
      cx.clearRect(0, 0, W, H)
      stars.forEach(s => {
        s.a += s.da; if (s.a <= 0 || s.a >= 1) s.da *= -1
        s.y += s.dy; if (s.y < -0.01) s.y = 1.01
        const px = (s.x + Math.sin(t * 0.0004 + s.ph) * s.wob) * W
        const py = s.y * H
        if (s.bright) {
          cx.beginPath(); cx.arc(px, py, s.r * 3.2, 0, Math.PI * 2)
          cx.fillStyle = `hsla(${s.hue}, 80%, 80%, ${s.a * 0.10})`; cx.fill()
        }
        cx.beginPath(); cx.arc(px, py, s.r, 0, Math.PI * 2)
        cx.fillStyle = `hsla(${s.hue}, 72%, 82%, ${s.a * (s.bright ? 0.72 : 0.5)})`; cx.fill()
      })
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paint(0)
      return () => window.removeEventListener('resize', onResize)
    }

    let animId = 0
    const loop = (t: number) => { paint(t); animId = requestAnimationFrame(loop) }
    animId = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', onResize) }
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
      setResult(currentResultData.current)
    }, 600)
  }

  const finishSpin = () => {
    if (hasFinished.current) return
    hasFinished.current = true

    cancelAnimationFrame(rafId.current)
    setSpinning(false)
    setShowSkip(false)
    onLanded()
  }

  const frame = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - animStart.current) / SPIN_DURATION))
    const eased = 1 - Math.pow(1 - t, 3)
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

    if (!isVip && (user.purchased_gems || 0) < COST) {
      setError(lang === 'es' ? 'Necesitas 50 gemas compradas para tirar.' : 'You need 50 purchased gems to spin.')
      return
    }

    setSpinning(true)
    setResult(null)
    setError(null)
    setGlowClass('')
    setTierLabel('· GIRANDO ·')
    setTierColor('#ec4899')
    
    hasFinished.current = false
    currentResultData.current = null

    try {
      const res = await tgFetch('/api/gacha/spin', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setSpinning(false)
        if (res.status === 402 || data.error === 'insufficient_gems') {
          setError(lang === 'es' ? 'Necesitas 50 gemas compradas para tirar.' : 'You need 50 purchased gems to spin.')
        } else {
          setError(data.message || 'Error al girar')
        }
        return
      }

      currentResultData.current = data

      // ✅ FIX 1: Actualizar las gemas en el contexto global al instante
      if (typeof data.remaining_purchased_gems === 'number') {
        setUser({
          ...user,
          purchased_gems: data.remaining_purchased_gems,
          gems: data.remaining_gems ?? user.gems
        })
      } else {
        refresh().catch(() => {})
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

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', marginTop: 24, padding: '0 8px', width: '100%' }}>
        
        <div className={`cabinet ${isShaking ? 'shaking' : ''}`} style={{ flex: '1 1 auto', minWidth: 0, maxWidth: '260px' }}>
          <div className="marquee">
            <div className="marquee-body">
              <svg className="arcane-sigil" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
                <circle cx="50" cy="50" r="46" />
                <circle cx="50" cy="50" r="33" strokeDasharray="3 8" />
                <polygon points="50,9 85,71 15,71" />
                <polygon points="50,91 15,29 85,29" />
                <circle cx="50" cy="50" r="5.5" />
              </svg>
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
            <div className="panel-side left" aria-hidden="true">
              <span className="panel-dot" /><span className="panel-dot" /><span className="panel-dot" />
            </div>
            <div className="panel-side right" aria-hidden="true">
              <span className="panel-dot" /><span className="panel-dot" /><span className="panel-dot" />
            </div>
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
                <div style={{ width: '100%', aspectRatio: '3/4', backgroundColor: '#150f24', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 48, opacity: 0.2 }}>👗</span>
                  <img 
                    src={getItemImageUrl(outfit.id)} 
                    alt={outfit.name}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </div>
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
            
            <li><strong>Los premios más codiciados (Épicos, Legendarios y Míticos) tienen menor posibilidad de salir por su rareza y exclusividad.</strong></li>
            <li><strong>Garantía:</strong> Cada 10 tiradas tienes asegurado un premio Épico o superior si no lo has obtenido antes.</li>
            
            <li><strong>Outfits:</strong> Cuando regalas un Outfit, el personaje lo guarda en su armario. ¡Y lo usará en las <strong>futuras fotos</strong> que te envíe!</li>
          </ul>
        </div>
      </div>

      {result && (
        <div className="modal-backdrop" style={{ zIndex: 9999, background: 'rgba(5, 2, 10, 0.95)', backdropFilter: 'blur(10px)' }}>
          <div className="modal-box level-up-modal" style={{ textAlign: 'center', border: `2px solid ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.color || '#a395c9'}`, boxShadow: `0 0 40px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.color || '#a395c9'}40` }}>
            <div style={{ fontSize: 64, marginBottom: 16, animation: 'levelUpSparkle 1.5s infinite' }}>
              {result.tier === 'common' ? '💬' : result.tier === 'rare' ? '📸' : result.tier === 'epic' ? '🎟️' : result.tier === 'legendary' ? '👑' : '🔥'}
            </div>
            <p style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.2em', color: TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.color || '#a395c9', margin: 0, textShadow: `0 0 10px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.color || '#a395c9'}` }}>
              ¡HAS OBTENIDO UN PREMIO {TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.label || 'COMÚN'}!
            </p>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: '#fff', margin: '12px 0', lineHeight: 1.3 }}>{result.reward_details}</h2>
            
            {/* ✅ FIX 3: Aviso de tirada gratis VIP */}
            {result.is_free_spin && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(34, 197, 94, 0.15)', borderRadius: 12, border: '1px solid rgba(34, 197, 94, 0.4)' }}>
                <p style={{ fontSize: 12, fontWeight: 800, color: '#22c55e', margin: 0 }}>
                  👑 ¡Tirada Gratis VIP!
                </p>
              </div>
            )}

            <div style={{ background: TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.bg || 'rgba(163, 149, 201, 0.1)', padding: 16, borderRadius: 16, border: `1px solid ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.border || 'rgba(163, 149, 201, 0.3)'}`, margin: '20px 0' }}>
              <p style={{ fontSize: 13, color: '#c4b5fd', margin: 0 }}>{result.tier === 'common' ? 'Se han añadido a tu saldo de chat.' : 'Se ha guardado en tu inventario.'}</p>
            </div>

            {/* ✅ FIX 4: Botón para ir a usar el personaje si es un gacha_character */}
            {result.reward_type === 'gacha_character' ? (
              <button onClick={() => { setResult(null); router.push('/') }} className="modal-btn primary" style={{ width: '100%', padding: 16, fontSize: 15, fontWeight: 800, background: TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.color || '#a395c9', color: '#000', boxShadow: `0 8px 24px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.color || '#a395c9'}60` }}>
                ¡USAR PERSONAJE AHORA!
              </button>
            ) : (
              <button onClick={() => setResult(null)} className="modal-btn primary" style={{ width: '100%', padding: 16, fontSize: 15, fontWeight: 800, background: TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.color || '#a395c9', color: '#000', boxShadow: `0 8px 24px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS]?.color || '#a395c9'}60` }}>
                ¡GENIAL!
              </button>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        /* ... (Mantén todos tus estilos CSS exactamente igual) ... */
        .cabinet { 
          position: relative; 
          width: 100%; 
          display: flex; 
          flex-direction: column; 
          align-items: center; 
          filter: drop-shadow(0 0 22px rgba(236,72,153,0.42)) drop-shadow(0 0 40px rgba(255,196,90,0.20)) drop-shadow(0 25px 35px rgba(0,0,0,0.9)); 
          transition: transform 0.1s; 
          z-index: 2;
          padding: 8px 8px 10px;
          border-radius: 26px;
          background: linear-gradient(180deg, rgba(38,20,52,0.98) 0%, rgba(14,8,26,0.99) 55%, rgba(8,4,16,1) 100%);
          box-shadow: inset 0 0 0 2px rgba(184,134,11,0.55), inset 0 0 32px rgba(168,85,247,0.25), 0 26px 40px rgba(0,0,0,0.9);
        }
        
        .cabinet.shaking { animation: shake 0.38s ease; }
        @keyframes shake { 
          0%,100%{transform:translateY(0);} 
          20%{transform:translateY(-4px);} 
          40%{transform:translateY(4px);} 
          60%{transform:translateY(-3px);} 
          80%{transform:translateY(3px);} 
        }

        .marquee { width: 100%; position: relative; margin-bottom: -2px; z-index: 3; }
        .marquee-body { 
          position: relative; 
          margin: 0; 
          padding: 16px 8px 6px; 
        }
        .marquee-title { text-align: center; font-size: 9px; font-weight: 800; letter-spacing: 0.3em; color: #a78bfa; margin-bottom: 4px; text-shadow: 0 0 10px #a78bfa; }
        .marquee-name { 
          text-align: center; 
          max-width: 196px; 
          margin: 0 auto; 
          font-size: 25px; 
          line-height: 1.06; 
          font-weight: 900; 
          letter-spacing: 0.015em; 
          background: linear-gradient(180deg, #ffb3e6 0%, #f472b6 46%, #ffd27a 100%); 
          -webkit-background-clip: text; 
          -webkit-text-fill-color: transparent; 
          filter: drop-shadow(0 0 14px rgba(244,114,182,0.55)); 
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
          padding: 12px 10px 14px; 
          z-index: 1; 
          box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
        }

        .screen-frame {
          width: 100%;
          position: relative;
          border: 4px solid #b8860b;
          border-radius: 12px;
          background: #05030f;
          padding: 3px;
          box-shadow: 0 0 0 2px rgba(122,79,16,0.9), inset 0 0 24px rgba(0,0,0,1), 0 0 18px rgba(184,134,11,0.45), 0 0 34px rgba(6,182,212,0.18);
        }
        .screen-frame::before {
          content: ''; position: absolute; inset: 0; border-radius: 9px; pointer-events: none; z-index: 1;
          background: linear-gradient(180deg, rgba(34,211,238,0.10) 0%, rgba(34,211,238,0.03) 26%, transparent 48%, transparent 74%, rgba(34,211,238,0.07) 100%);
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

        .cab-info { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; padding: 8px 12px; background: linear-gradient(180deg, rgba(28,16,44,0.95), rgba(8,4,16,0.98)); border-radius: 10px; border: 1px solid rgba(184,134,11,0.55); box-shadow: inset 0 1px 0 rgba(255,224,102,0.18), inset 0 0 14px rgba(0,0,0,0.8), 0 0 12px rgba(168,85,247,0.14); }
        .info-gem { font-size: 10px; color: rgba(196,181,253,0.7); font-weight: 600; }
        .info-gem b { color: #c4b5fd; font-size: 12px; }
        .info-tier { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700; transition: color 0.3s; }
        .vents { display: flex; gap: 3px; }
        .vent { width: 2px; height: 10px; border-radius: 1px; background: rgba(255,224,102,0.15); }

        .control-panel { 
          background: linear-gradient(180deg, #150f24 0%, #0a0510 100%); 
          padding: 6px 10px 12px; 
          display: flex; 
          align-items: center;
          justify-content: center; 
          gap: 9px;
          box-shadow: inset 0 5px 15px rgba(0,0,0,0.85), 0 0 14px rgba(168,85,247,0.16);
          position: relative;
          overflow: hidden;
          width: 100%;
        }
        
        .spin-btn { 
          position: relative; 
          order: 2;
          flex: 0 0 56%;
          min-width: 0;
          max-width: 188px;
          height: 62px; 
          border: none; 
          cursor: pointer; 
          border-radius: 16px; 
          font-size: 17px; 
          font-weight: 900; 
          letter-spacing: 0.02em;
          color: #2a1030; 
          background: linear-gradient(180deg, #ffb3e0 0%, #ff8fce 34%, #ffd27a 82%, #f7b955 100%); 
          background-size: 180% 180%; 
          z-index: 1;
          box-shadow: 
            0 0 0 2px rgba(255,224,102,0.75),
            0 0 0 4px rgba(122,79,16,0.9),
            0 10px 18px rgba(0,0,0,0.55),
            0 0 22px rgba(236,72,153,0.45),
            inset 0 3px 6px rgba(255,255,255,0.55),
            inset 0 -5px 10px rgba(76,29,149,0.45);
          text-shadow: 0 1px 0 rgba(255,255,255,0.45);
          transition: transform 0.1s, box-shadow 0.2s; 
          overflow: hidden; 
        }
        .spin-btn:hover { background-position: 100% 0; transform: translateY(-1px); }
        .spin-btn:active { transform: scale(0.97); }
        .spin-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; filter: saturate(0.45) brightness(0.92); }

        .cab-base { width: 100%; }
        .cab-foot { 
          width: 100%; 
          height: 30px; 
          background: linear-gradient(180deg, #3a2410 0%, #180d24 52%, #07040d 100%); 
          border-radius: 0 0 24px 24px; 
          border: 4px solid #7a4f10; 
          border-top: none; 
          border-bottom-width: 6px;
          box-shadow: 0 10px 20px rgba(0,0,0,0.9), 0 10px 28px rgba(236,72,153,0.30), inset 0 2px 0 rgba(255,224,102,0.38), inset 0 -8px 16px rgba(0,0,0,0.95), 0 0 20px rgba(255,196,90,0.22);
          position: relative;
          overflow: hidden;
        }

        /* ── Símbolo arcano (detrás del título, decorativo) ── */
        .arcane-sigil {
          position: absolute; top: 50%; left: 50%;
          width: 74px; height: 74px; margin: -37px 0 0 -37px;
          fill: none; stroke: #a78bfa; stroke-width: 1.6;
          opacity: 0.14; pointer-events: none; z-index: 0;
          animation: sigilPulse 7s ease-in-out infinite;
        }
        .marquee-title, .marquee-name { position: relative; z-index: 1; }
        @keyframes sigilPulse { 0%,100% { opacity: 0.10; } 50% { opacity: 0.18; } }

        /* ── Paneles decorativos amplios (por debajo del botón) ── */
        .panel-side {
          position: relative;
          order: 1;
          flex: 1 1 0;
          min-width: 0;
          height: 64px;
          border-radius: 12px;
          background:
            linear-gradient(180deg, rgba(38,20,54,0.98) 0%, rgba(10,5,20,1) 100%),
            repeating-linear-gradient(180deg, rgba(255,224,102,0.05) 0 1px, transparent 1px 6px);
          border: 1.5px solid rgba(236,72,153,0.65);
          box-shadow: inset 0 0 12px rgba(236,72,153,0.30), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -10px 16px rgba(0,0,0,0.9), 0 0 12px rgba(236,72,153,0.28);
          display: flex; flex-direction: column; justify-content: center; gap: 7px;
          align-items: flex-start; padding-left: 9px;
          pointer-events: none;
          clip-path: polygon(0 10%, 100% 0, 100% 100%, 0 90%);
        }
        .panel-side.left { order: 1; }
        .panel-side.right {
          order: 3; align-items: flex-end; padding-right: 8px; padding-left: 0;
          clip-path: polygon(0 0, 100% 8%, 100% 92%, 0 100%);
        }
        .panel-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #a855f7; box-shadow: 0 0 10px #a855f7, 0 0 3px #f0abfc;
          animation: panelGlow 3.6s ease-in-out infinite;
        }
        .panel-side.right .panel-dot { background: #f0abfc; box-shadow: 0 0 8px #f0abfc, 0 0 2px #a855f7; }
        .panel-dot:nth-child(2) { animation-delay: 1.2s; }
        .panel-dot:nth-child(3) { animation-delay: 2.4s; }
        @keyframes panelGlow { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }

        /* ── Barrido luminoso del marco (solo panel y base, nunca el carrete) ── */
        .control-panel::after, .cab-foot::after {
          content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
          background: linear-gradient(115deg, transparent 44%, rgba(255,224,102,0.16) 50%, rgba(236,72,153,0.10) 54%, transparent 60%);
          background-size: 300% 300%;
          animation: frameSweep 9s ease-in-out infinite;
        }
        @keyframes frameSweep { 0% { background-position: -70% -30%; } 55%,100% { background-position: 170% 130%; } }

        /* ── Pulsación luminosa del botón (solo cuando está disponible) ── */
        .spin-btn::after {
          content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
          background: radial-gradient(ellipse at 50% 130%, rgba(255,255,255,0.55), transparent 62%);
          opacity: 0; animation: btnBreath 3.4s ease-in-out infinite;
        }
        .spin-btn:disabled::after { animation: none; opacity: 0; }
        @keyframes btnBreath { 0%,100% { opacity: 0; } 50% { opacity: 0.45; } }

        @media (prefers-reduced-motion: reduce) {
          .arcane-sigil, .panel-dot, .control-panel::after, .cab-foot::after,
          .spin-btn::after, .mlight { animation: none !important; }
        }

        .glow-common { box-shadow: inset 0 0 30px rgba(129,140,248,0.3), 0 0 20px rgba(129,140,248,0.4); }
        .glow-rare { box-shadow: inset 0 0 30px rgba(6,182,212,0.5), 0 0 30px rgba(6,182,212,0.6); }
        .glow-epic { box-shadow: inset 0 0 40px rgba(168,85,247,0.7), 0 0 40px rgba(168,85,247,0.8); }
        .glow-legendary { box-shadow: inset 0 0 50px rgba(251,191,36,0.8), 0 0 50px rgba(251,191,36,0.9); }
        .glow-mythic { box-shadow: inset 0 0 60px rgba(236,72,153,0.9), 0 0 60px rgba(236,72,153,1); }

        .skip-btn { position: fixed; bottom: 24px; right: 24px; z-index: 200; padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(129,140,248,0.4); background: rgba(7,6,26,0.85); color: rgba(196,181,253,0.8); font-size: 11px; font-weight: 700; cursor: pointer; backdrop-filter: blur(4px); transition: opacity 0.2s; }
        .skip-btn:hover { border-color: rgba(34,211,238,0.6); color: #22d3ee; }

        /* Doble marco luminoso exterior del gabinete (rosa/magenta + dorado) */
        .cabinet::before {
          content: ''; position: absolute; inset: -7px; border-radius: 33px;
          border: 2px solid rgba(236,72,153,0.55);
          box-shadow: 0 0 18px rgba(236,72,153,0.45), inset 0 0 24px rgba(236,72,153,0.16);
          pointer-events: none;
        }
        .cabinet::after {
          content: ''; position: absolute; inset: -2px; border-radius: 28px;
          border: 2px solid rgba(255,196,90,0.75);
          box-shadow: 0 0 14px rgba(255,196,90,0.35), inset 0 0 12px rgba(255,196,90,0.14);
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}
