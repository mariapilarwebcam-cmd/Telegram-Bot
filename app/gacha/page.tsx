"use client"

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/UserContext'
import { tgFetch } from '@/lib/telegram-fetch'
import { getTranslations } from '@/lib/i18n'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { GACHA_ARCHETYPES, CHARACTER_NAMES_FEMALE, CHARACTER_NAMES_MALE, getCharacterImageUrl } from '@/lib/constants'

const COST = 50
const ITEM_WIDTH = 100
const STRIP_LEN = 40
const WIN_INDEX = 30
const SPIN_DURATION = 2600

const TIER_COLORS = {
  common: { color: '#a395c9', bg: 'rgba(163, 149, 201, 0.1)', border: 'rgba(163, 149, 201, 0.3)', label: 'COMÚN' },
  rare: { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)', border: 'rgba(6, 182, 212, 0.3)', label: 'RARO' },
  epic: { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.4)', label: 'ÉPICO' },
  legendary: { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.1)', border: 'rgba(251, 191, 36, 0.5)', label: 'LEGENDARIO' },
  mythic: { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.7)', label: 'MÍTICO' },
}

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

function getRandBg(): Prize {
  return PRIZES_BG[Math.floor(Math.random() * PRIZES_BG.length)]
}

function getResultPrize(result: any): Prize {
  const tierColor = (TIER_COLORS as any)[result.tier]?.color || '#a395c9'
  const tier = result.tier
  if (result.reward_type === 'gacha_character') return { icon: tier === 'mythic' ? '🔥' : '👑', imageKey: tier === 'mythic' ? 'icon_mythic' : 'icon_character', label: 'Personaje', color: tierColor, tier }
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

function itemHTML(p: Prize) {
  const g = p.color
  const isMsg = p.icon === '💬'
  return `<div class="reel-item">
    <div class="item-inner" style="
        background: linear-gradient(180deg,${g}22 0%,${g}08 60%,${g}04 100%);
        border: 1.5px solid ${g}55;
        box-shadow: 0 0 16px ${g}20, inset 0 0 10px ${g}10, inset 0 -4px 8px rgba(0,0,0,0.3);">
        <span class="item-icon" style="filter: drop-shadow(0 0 10px ${g}) drop-shadow(0 2px 4px rgba(0,0,0,0.5))">${p.icon}</span>
        ${isMsg
            ? `<span class="item-amount" style="color:${g}; text-shadow:0 0 12px ${g}; -webkit-text-stroke:0.5px ${g}88">${p.label}</span>`
            : `<span class="item-label" style="color:${g}; text-shadow:0 0 10px ${g}80">${p.label}</span>`
        }
    </div>
  </div>`
}

export default function GachaPage() {
  const router = useRouter()
  const { user, loading: userLoading, lang, refresh } = useUser()
  const t = getTranslations(lang)

  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'characters' | 'outfits'>('characters')
  const [ownedCharacters, setOwnedCharacters] = useState<string[]>([])
  
  const [showSkip, setShowSkip] = useState(false)
  const [tierLabel, setTierLabel] = useState('· listo ·')
  const [tierColor, setTierColor] = useState('')
  const [glowClass, setGlowClass] = useState('')
  const [isShaking, setIsShaking] = useState(false)

  const reelRef = useRef<HTMLDivElement>(null)
  const reelWindowRef = useRef<HTMLDivElement>(null)
  const cabinetRef = useRef<HTMLDivElement>(null)
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
    if (!user?.telegram_id) return
    tgFetch('/api/characters')
      .then(res => res.json())
      .then(data => {
        if (data.characters) setOwnedCharacters(data.characters.map((c: any) => c.archetype))
      })
      .catch(console.error)
  }, [user?.telegram_id])

  // BG Stars
  useEffect(() => {
    const cv = bgCanvasRef.current
    if (!cv) return
    const cx = cv.getContext('2d')
    if (!cx) return
    let W = cv.width = window.innerWidth
    let H = cv.height = window.innerHeight

    const stars = Array.from({ length: 120 }, () => ({
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

  // Win Particles
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
    setTierLabel(p.tier === 'common' ? '· común ·' : p.tier === 'rare' ? '· raro ·' : p.tier === 'epic' ? '· épico ·' : p.tier === 'legendary' ? '· legendario ·' : '· mítico ·')
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

    setResult(result) // Guardamos el objeto original para el modal
  }

  const finishSpin = () => {
    cancelAnimationFrame(rafId.current)
    setSpinning(false)
    if (reelRef.current) reelRef.current.style.transform = `translateX(${targetPos.current}px)`
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
    animLever()

    try {
      // 1. Llamada real al backend
      const res = await tgFetch('/api/gacha/spin', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setSpinning(false)
        setError(data.message || 'Error al girar')
        return
      }

      // 2. El backend decide el premio, lo inyectamos en la tira
      const resultPrize = getResultPrize(data)
      currentPrize.current = resultPrize

      // 3. CREAMOS LA TIRA CON LOS SEÑUELOS (NEAR MISS)
      let html = ''
      for (let i = 0; i < STRIP_LEN; i++) {
        if (i === WIN_INDEX) {
          html += itemHTML(resultPrize)
        } else if (i === WIN_INDEX - 1) {
          html += itemHTML(Math.random() < 0.6 ? PRIZES_BG[9] : PRIZES_BG[7]) // Legendario/Épico
        } else if (i === WIN_INDEX - 2) {
          html += itemHTML(Math.random() < 0.3 ? PRIZES_BG[9] : PRIZES_BG[7])
        } else if (i === WIN_INDEX - 3) {
          html += itemHTML(Math.random() < 0.1 ? PRIZES_BG[10] : Math.random() < 0.5 ? PRIZES_BG[9] : PRIZES_BG[7])
        } else {
          html += itemHTML(getRandBg())
        }
      }
      
      if (reelRef.current) {
        reelRef.current.innerHTML = html
        reelRef.current.style.transform = 'translateX(0px)'
      }

      // 4. Calculamos la posición
      const cw = reelWindowRef.current?.offsetWidth || 340
      targetPos.current = (cw / 2) - (WIN_INDEX * ITEM_WIDTH + ITEM_WIDTH / 2)
      startPos.current = 0

      // 5. Arrancamos la animación
      animStart.current = performance.now()
      rafId.current = requestAnimationFrame(frame)
      
      // Seguro anti-cuelgues
      setShowSkip(true)
      setTimeout(() => {
        if (spinning) finishSpin()
      }, SPIN_DURATION + 1000)

      refresh().catch(() => {})
      if (data.reward_type === 'gacha_character') {
        setOwnedCharacters(prev => [...prev, data.item_key])
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

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', marginTop: 24 }}>
        {/* MÁQUINA */}
        <div className={`cabinet ${isShaking ? 'shaking' : ''}`} ref={cabinetRef}>
          {/* Marquesina */}
          <div className="marquee">
            <div className="marquee-wing left"></div>
            <div className="marquee-wing right"></div>
            <div className="marquee-body">
              <p className="marquee-title">Taboo Realm</p>
              <p className="marquee-name">GACHA SPIN</p>
              <div className="marquee-lights">
                {Array.from({ length: 12 }).map((_, i) => <div key={i} className="mlight" />)}
              </div>
            </div>
          </div>

          {/* Cuerpo Central */}
          <div className="cab-body">
            <div className={`reel-panel ${glowClass}`} ref={reelWindowRef}>
              <div className="reel-inner">
                <div className="screw screw-tl"></div><div className="screw screw-tr"></div>
                <div className="screw screw-bl"></div><div className="screw screw-br"></div>
                <div className="reel-window">
                  <div className="selection-zone"></div>
                  <svg className="arrow arrow-top" width="22" height="14" viewBox="0 0 22 14"><polygon points="11,2 21,13 1,13" fill="#22d3ee"/><polygon points="11,0 21,11 1,11" fill="#ffe066" opacity="0.5"/></svg>
                  <svg className="arrow arrow-bottom" width="22" height="14" viewBox="0 0 22 14"><polygon points="11,12 21,1 1,1" fill="#22d3ee"/><polygon points="11,14 21,3 1,3" fill="#ffe066" opacity="0.5"/></svg>
                  
                  <div className="reel-clip">
                    <div className="reel-strip" ref={reelRef} />
                  </div>
                  
                  <div className="reel-glass"></div>
                  <div className="fade-left"></div>
                  <div className="fade-right"></div>
                  <div className="impact-ring" ref={impactRingRef}></div>
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

          {/* Panel de Control */}
          <div className="control-panel">
            <div className="status-lights">
              <div className={`slight ${glowClass.includes('rare') || glowClass.includes('epic') || glowClass.includes('legendary') || glowClass.includes('mythic') ? 'on-c' : ''}`}></div>
              <div className={`slight ${glowClass.includes('epic') || glowClass.includes('legendary') || glowClass.includes('mythic') ? 'on-p' : ''}`}></div>
              <div className={`slight ${glowClass.includes('legendary') || glowClass.includes('mythic') ? 'on-g' : ''}`}></div>
            </div>
            
            <button className="spin-btn" onClick={handleSpin} disabled={spinning}>
              {spinning ? '✦ GIRANDO...' : '⚡ GIRAR'}
            </button>
            
            <div className="coin-slot">
              <div className="slot-hole"></div>
              <span className="slot-label">Insert</span>
            </div>
          </div>
          
          <div className="cab-base"><div className="cab-foot"></div></div>
        </div>

        {/* PALANCA */}
        <div className="lever-wrap" ref={leverRef} onClick={handleSpin}>
          <div className="lever-rail"></div>
          <div className="lever-arm"><div className="lever-ball"></div></div>
          <div className="lever-base"></div>
          <span className="lever-tag">PULL</span>
        </div>
      </div>

      {showSkip && <button className="skip-btn visible" onClick={skipAnim}>⏭ SALTAR</button>}

      {error && <p style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', marginTop: 12, position: 'relative', zIndex: 10 }}>⚠️ {error}</p>}

      {/* RESULT MODAL (Cuando termina la animación) */}
      {result && (
        <div className="modal-backdrop" style={{ zIndex: 9999, background: 'rgba(5, 2, 10, 0.95)', backdropFilter: 'blur(10px)' }}>
          <div className="modal-box level-up-modal" style={{ textAlign: 'center', border: `2px solid ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}`, boxShadow: `0 0 40px ${TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color}40` }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>
              {result.tier === 'common' ? '💬' : result.tier === 'rare' ? '📸' : result.tier === 'epic' ? '🎟️' : result.tier === 'legendary' ? '👑' : '🔥'}
            </div>
            <p style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.2em', color: TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color, margin: 0 }}>
              ¡HAS OBTENIDO UN PREMIO {TIER_COLORS[result.tier as keyof typeof TIER_COLORS].label}!
            </p>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: '#fff', margin: '12px 0' }}>{result.reward_details}</h2>
            <button onClick={() => setResult(null)} className="modal-btn primary" style={{ width: '100%', padding: 16, background: TIER_COLORS[result.tier as keyof typeof TIER_COLORS].color, color: '#000' }}>
              ¡GENIAL!
            </button>
          </div>
        </div>
      )}

      {/* AQUÍ VAN LOS TABS DE OUTFITS Y PERSONAJES (Sin cambios, omitidos por brevedad) */}
      <div style={{ padding: '40px 24px', position: 'relative', zIndex: 10 }}>
          {/* ... Tabs y Grillas iguales que en el código anterior ... */}
      </div>

      <style jsx>{`
        :root {
            --neon-c: #22d3ee;
            --gold-1: #ffe066;
        }
        .cabinet { position: relative; width: 100%; max-width: 400px; display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 20px 40px rgba(0,0,0,0.9)); transition: transform 0.1s; }
        .cabinet.shaking { animation: shake 0.38s ease; }
        @keyframes shake { 0%,100%{transform:translateX(0);} 20%{transform:translateX(-4px);} 40%{transform:translateX(4px);} 60%{transform:translateX(-3px);} 80%{transform:translateX(3px);} }

        /* Marquesina */
        .marquee { width: 100%; position: relative; margin-bottom: -2px; }
        .marquee-body { position: relative; margin: 0 16px; background: linear-gradient(180deg, #0d0b2a 0%, #150f24 100%); border-radius: 16px 16px 0 0; padding: 16px 20px 12px; border: 2px solid #b8860b; border-bottom: none; z-index: 2; }
        .marquee-title { text-align: center; font-size: 10px; font-weight: 700; letter-spacing: 0.28em; color: rgba(255,224,102,0.7); margin-bottom: 4px; }
        .marquee-name { text-align: center; font-size: 22px; font-weight: 900; letter-spacing: 0.08em; background: linear-gradient(135deg, #22d3ee 0%, #ffe066 35%, #e879f9 65%, #f472b6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 16px rgba(255,224,102,0.6)); }
        .marquee-lights { display: flex; justify-content: center; gap: 6px; margin-top: 8px; }
        .mlight { width: 8px; height: 8px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 8px #22d3ee; animation: mflicker 1.4s infinite; }
        .mlight:nth-child(2n) { background: #ec4899; animation-delay: .2s; }
        .mlight:nth-child(3n) { background: #a855f7; animation-delay: .4s; }
        @keyframes mflicker { 0%,100%{opacity:1;} 45%{opacity:0.35;} 50%{opacity:1;} }

        /* Cuerpo */
        .cab-body { width: 100%; position: relative; background: linear-gradient(180deg, #150f24 0%, #1f1733 40%, #0a0510 100%); border-left: 4px solid #7a4f10; border-right: 4px solid #7a4f10; padding: 16px 20px; z-index: 1; }
        .reel-panel { position: relative; background: conic-gradient(from 135deg, #0f0e2a 0deg, #b8860b 60deg, #ffe066 100deg, #c4b5fd 130deg, #ffe066 160deg, #b8860b 200deg, #0f0e2a 240deg, #7a4f10 280deg, #ffe066 310deg, #c4b5fd 340deg, #ffe066 360deg); border-radius: 16px; padding: 4px; transition: box-shadow 0.5s ease; }
        .reel-inner { background: linear-gradient(180deg, #060514 0%, #0d0b22 50%, #060514 100%); border-radius: 12px; padding: 12px 8px; overflow: hidden; }
        
        .screw { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #c4b5fd, #5a3a0c); box-shadow: 0 1px 3px rgba(0,0,0,0.8); z-index: 20; }
        .screw-tl{top:6px;left:6px;} .screw-tr{top:6px;right:6px;} .screw-bl{bottom:6px;left:6px;} .screw-br{bottom:6px;right:6px;}

        /* Ventana y rodillo */
        .reel-window { position: relative; width: 100%; height: 120px; }
        .selection-zone { position: absolute; top: 50%; left: 0; right: 0; transform: translateY(-50%); height: 88px; z-index: 8; pointer-events: none; }
        .selection-zone::before, .selection-zone::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent 0%, #22d3ee 15%, #ffe066 50%, #22d3ee 85%, transparent 100%); box-shadow: 0 0 10px #22d3ee; }
        .selection-zone::before { top: 0; } .selection-zone::after { bottom: 0; }
        
        .arrow { position: absolute; left: 50%; transform: translateX(-50%); z-index: 25; filter: drop-shadow(0 0 8px #22d3ee); }
        .arrow-top { top: -2px; } .arrow-bottom { bottom: -2px; }
        
        .reel-clip { position: absolute; inset: 0; overflow: hidden; border-radius: 6px; }
        .reel-strip { display: flex; height: 120px; will-change: transform; align-items: center; }
        .reel-item { width: 80px; height: 90px; padding: 4px; flex-shrink: 0; }
        
        .item-inner { width: 100%; height: 100%; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; position: relative; overflow: hidden; }
        .item-icon { font-size: 28px; line-height: 1; z-index: 2; }
        .item-amount { font-size: 14px; font-weight: 900; z-index: 2; }
        .item-label { font-size: 9px; font-weight: 900; z-index: 2; }

        .reel-glass { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 40%, rgba(0,0,0,0.2) 100%); pointer-events: none; z-index: 15; }
        .fade-left { position: absolute; top: 0; bottom: 0; left: 0; width: 20%; background: linear-gradient(90deg, #060514 0%, transparent 100%); z-index: 12; pointer-events: none; }
        .fade-right { position: absolute; top: 0; bottom: 0; right: 0; width: 20%; background: linear-gradient(270deg, #060514 0%, transparent 100%); z-index: 12; pointer-events: none; }

        .impact-ring { position: absolute; top: 50%; left: 50%; width: 0; height: 0; border-radius: 50%; border: 2px solid transparent; transform: translate(-50%,-50%); pointer-events: none; z-index: 30; opacity: 0; }
        @keyframes impactWave { 0% { width: 60px; height: 60px; opacity: 0.9; border-color: var(--wave-color,#ec4899); } 100% { width: 400px; height: 160px; opacity: 0; border-color: var(--wave-color,#ec4899); } }

        .cab-info { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding: 8px 12px; background: rgba(0,0,0,0.35); border-radius: 10px; border: 1px solid rgba(129,140,248,0.15); }
        .info-gem { font-size: 11px; color: rgba(129,140,248,0.75); font-weight: 600; }
        .info-gem b { color: #c4b5fd; font-size: 13px; }
        .info-tier { font-size: 9px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 700; transition: color 0.3s; }
        .vents { display: flex; gap: 3px; }
        .vent { width: 2px; height: 10px; border-radius: 1px; background: rgba(255,224,102,0.15); }

        .control-panel { background: linear-gradient(180deg, #1f1733 0%, #150f24 100%); border-left: 4px solid #7a4f10; border-right: 4px solid #7a4f10; padding: 16px 20px 12px; display: flex; align-items: center; justify-content: space-between; }
        .status-lights { display: flex; flex-direction: column; gap: 4px; }
        .slight { width: 8px; height: 20px; border-radius: 4px; background: #1a1535; transition: background 0.3s, box-shadow 0.3s; }
        .slight.on-p { background: #a855f7; box-shadow: 0 0 8px #a855f7; }
        .slight.on-c { background: #06b6d4; box-shadow: 0 0 8px #06b6d4; }
        .slight.on-g { background: #ffe066; box-shadow: 0 0 8px #ffe066; }
        
        .spin-btn { position: relative; width: 140px; height: 48px; border: none; cursor: pointer; border-radius: 12px; font-size: 14px; font-weight: 900; color: #fff; background: linear-gradient(135deg, #e879f9 0%, #ffe066 50%, #e879f9 100%); background-size: 200% 100%; box-shadow: 0 4px 20px rgba(232,121,249,0.5); transition: transform 0.1s; overflow: hidden; }
        .spin-btn:hover { background-position: 100% 0; transform: translateY(-1px); }
        .spin-btn:active { transform: scale(0.97); }
        .spin-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        .coin-slot { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .slot-hole { width: 24px; height: 4px; background: #000; border-radius: 2px; border: 1px solid rgba(129,140,248,0.35); }
        .slot-label { font-size: 8px; color: rgba(255,224,102,0.4); letter-spacing: 0.1em; text-transform: uppercase; }

        .cab-base { width: 100%; }
        .cab-foot { width: 100%; height: 16px; background: linear-gradient(180deg, #0e0b1e 0%, #07050f 100%); border-radius: 0 0 12px 12px; border: 2px solid #7a4f10; border-top: none; }

        /* Palanca */
        .lever-wrap { position: relative; width: 50px; height: 320px; display: flex; flex-direction: column; align-items: center; margin-bottom: 10px; cursor: pointer; user-select: none; }
        .lever-rail { position: absolute; top: 30px; bottom: 30px; left: 50%; transform: translateX(-50%); width: 10px; background: linear-gradient(90deg, #060514, #1f1733, #060514); border-radius: 5px; border: 1px solid rgba(129,140,248,0.2); }
        .lever-arm { position: absolute; top: 40px; left: 50%; transform: translateX(-50%); width: 8px; height: 150px; background: linear-gradient(90deg, #b8860b, #c4b5fd 30%, #a5b4fc 60%, #3730a3); border-radius: 4px; transition: transform 0.15s ease; }
        .lever-ball { position: absolute; top: -15px; left: 50%; transform: translateX(-50%); width: 28px; height: 28px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #f9a8d4 0%, #f472b6 25%, #c026d3 60%, #701a75 100%); box-shadow: 0 4px 16px rgba(244,114,182,0.8), inset 0 -2px 6px rgba(0,0,0,0.4); }
        .lever-base { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); width: 22px; height: 22px; border-radius: 50%; background: conic-gradient(from 90deg, #ffe066, #b8860b, #5a3a0c, #b8860b, #ffe066); }
        .lever-tag { position: absolute; bottom: 0; font-size: 8px; letter-spacing: 0.15em; color: rgba(129,140,248,0.45); text-transform: uppercase; }

        .lever-wrap.pulling .lever-arm { transform: translateX(-50%) rotate(28deg); transition: transform 0.12s ease-in; }
        .lever-wrap.releasing .lever-arm { transform: translateX(-50%) rotate(-5deg); transition: transform 0.25s ease-out; }
        .lever-wrap.back .lever-arm { transform: translateX(-50%) rotate(0deg); transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1); }

        /* Glow Reactivo */
        .glow-common { box-shadow: 0 0 20px rgba(129,140,248,0.4); }
        .glow-rare { box-shadow: 0 0 30px rgba(6,182,212,0.6); }
        .glow-epic { box-shadow: 0 0 40px rgba(168,85,247,0.8); }
        .glow-legendary { box-shadow: 0 0 60px rgba(251,191,36,0.9); }
        .glow-mythic { box-shadow: 0 0 70px rgba(236,72,153,1); }

        .skip-btn { position: fixed; bottom: 24px; right: 24px; z-index: 200; padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(129,140,248,0.4); background: rgba(7,6,26,0.85); color: rgba(196,181,253,0.8); font-size: 11px; font-weight: 700; cursor: pointer; backdrop-filter: blur(4px); transition: opacity 0.2s; }
        .skip-btn:hover { border-color: rgba(34,211,238,0.6); color: #22d3ee; }
      `}</style>
    </div>
  )
}
