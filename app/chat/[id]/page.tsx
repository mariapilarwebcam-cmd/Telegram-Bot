"use client"

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { tgFetch } from '@/lib/telegram-fetch'
import {
  GEM_COSTS,
  getDisplayName,
  getCharacterImageUrl,
  getCharacterDescription,
} from '@/lib/constants'
import { getLevelFromMessages, getImageCost, getAudioCost } from '@/lib/levels'
import { getTranslations } from '@/lib/i18n'
import { useUser } from '@/lib/UserContext'

interface Message {
  id?: number
  role: 'user' | 'assistant'
  content: string
  created_at?: string
}

const GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)',
]

function getGradient(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return GRADIENTS[Math.abs(h) % GRADIENTS.length]
}

const HOOK_ROTATIONS_ES: Array<(n: number) => string> = [
  (n) => `🎁 ${n} gratis`,
  (n) => `✨ ${n} restantes`,
  (n) => `⏳ ${n} mensajes`,
  (n) => `🎁 ${n} por disfrutar`,
]

const HOOK_ROTATIONS_EN: Array<(n: number) => string> = [
  (n) => `🎁 ${n} free`,
  (n) => `✨ ${n} left`,
  (n) => `⏳ ${n} messages`,
  (n) => `🎁 ${n} to enjoy`,
]

const LOW_GEMS_ROTATIONS_ES: Array<(n: number) => string> = [
  (n) => `Quedan ${n}`,
  (n) => `Solo ${n}`,
  (n) => `${n} gemas`,
  (n) => `Últimas ${n}`,
]

const LOW_GEMS_ROTATIONS_EN: Array<(n: number) => string> = [
  (n) => `${n} left`,
  (n) => `Only ${n}`,
  (n) => `${n} gems`,
  (n) => `Last ${n}`,
]

const LEVEL_UP_COPY_ES: Record<number, (name: string) => string> = {
  2: (n) => `✨ ${n} empieza a abrirse contigo. Sus mensajes serán más cercanos.`,
  3: (n) => `🔥 ${n} ya no te ve como un desconocido. Esto se pone interesante...`,
  4: (n) => `💜 Confianza absoluta. Ahora ${n} sí te muestra quién es de verdad.`,
  5: (n) => `😈 Algo prohibido. Nadie ha llegado tan lejos con ${n}.`,
}

const LEVEL_UP_COPY_EN: Record<number, (name: string) => string> = {
  2: (n) => `✨ ${n} is opening up to you. Her messages will be closer.`,
  3: (n) => `🔥 ${n} no longer sees you as a stranger. Things are getting interesting...`,
  4: (n) => `💜 Absolute trust. Now ${n} truly shows you who she is.`,
  5: (n) => `😈 Something forbidden. No one has gotten this far with ${n}.`,
}

const TEXTAREA_MAX_HEIGHT = 120

export default function ChatPage() {
  const { id } = useParams()
  const router = useRouter()
  const characterId = parseInt(id as string)

  const { user, loading: userLoading, lang, setGems, setHookRemaining } = useUser()

  const [character, setCharacter] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isPremium, setIsPremium] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [blockedMessage, setBlockedMessage] = useState('')

  const [totalUserMessages, setTotalUserMessages] = useState(0)
  const [photoOfferActive, setPhotoOfferActive] = useState(false)

  const [lowGemsWarning, setLowGemsWarning] = useState(false)
  const [lowGemsCount, setLowGemsCount] = useState(0)

  const [levelProgress, setLevelProgress] = useState<{ current: number; next: number | null }>({
    current: 0,
    next: 15,
  })

  const [rotationIndex, setRotationIndex] = useState(0)

  const [levelUpModal, setLevelUpModal] = useState<{
    level: number
    badgeKey: string
  } | null>(null)

  const [showPremiumModal, setShowPremiumModal] = useState(false)
  const [premiumModalReason, setPremiumModalReason] = useState<'audio' | 'image'>('audio')

  const [generatingImage, setGeneratingImage] = useState(false)
  const [generatingAudio, setGeneratingAudio] = useState(false)

  const [menuOpen, setMenuOpen] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)

  const [characterLoading, setCharacterLoading] = useState(true)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [autoStartAttempted, setAutoStartAttempted] = useState(false)

  const endRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ✅ Rotación de badges del header cada 5s
  useEffect(() => {
    const interval = setInterval(() => {
      setRotationIndex((prev) => prev + 1)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // ✅ FIX: Scroll al último mensaje cuando se abre el teclado
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const handleViewportResize = () => {
      setTimeout(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }, 150)
    }

    vv.addEventListener('resize', handleViewportResize)
    return () => vv.removeEventListener('resize', handleViewportResize)
  }, [])

  // ✅ FIX: Auto-resize del textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const newHeight = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)
    el.style.height = `${newHeight}px`
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [input])

  // Carga inicial
  useEffect(() => {
    if (userLoading) return
    if (!user?.telegram_id) return

    const tid = user.telegram_id

    Promise.all([
      supabase.from('user_characters').select('*').eq('id', characterId).maybeSingle(),
      supabase
        .from('conversation_history')
        .select('*')
        .eq('telegram_id', tid)
        .eq('character_id', characterId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(50),
      supabase.from('star_purchases').select('id').eq('telegram_id', tid).limit(1),
      supabase
        .from('conversation_history')
        .select('*', { count: 'exact', head: true })
        .eq('telegram_id', tid)
        .eq('character_id', characterId)
        .eq('role', 'user'),
    ]).then(([charRes, histRes, premRes, countRes]) => {
      if (charRes.data) {
        setCharacter(charRes.data)
        setNewName(getDisplayName(charRes.data))
      }
      const raw = histRes.data || []
      const sorted = [...raw].sort((a: any, b: any) => {
        const cmp = String(a.created_at).localeCompare(String(b.created_at))
        if (cmp !== 0) return cmp
        return (a.id || 0) - (b.id || 0)
      })
      const deduped = sorted.filter((msg: any, idx: number, arr: any[]) => {
        if (idx === 0) return true
        const prev = arr[idx - 1]
        return !(prev.role === msg.role && prev.content === msg.content)
      })
      setMessages(deduped)
      setIsPremium(!!premRes.data && premRes.data.length > 0)
      const count = countRes.count || 0
      setTotalUserMessages(count)

      const currentLvl = getLevelFromMessages(count)
      const thresholds: Record<number, number | null> = {
        1: 15, 2: 40, 3: 90, 4: 180, 5: null,
      }
      setLevelProgress({
        current: count,
        next: thresholds[currentLvl.level] ?? null,
      })

      setCharacterLoading(false)
      setHistoryLoaded(true)
    })
  }, [characterId, user?.telegram_id, userLoading])

  useEffect(() => {
    const t = setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 50)
    return () => clearTimeout(t)
  }, [messages])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => {
          endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
        }, 150)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
    }
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  useEffect(() => {
    if (!historyLoaded || !user || !character) return
    if (messages.length > 0 || autoStartAttempted || loading) return

    const startChat = async () => {
      setAutoStartAttempted(true)
      const gems = user.gems || 0
      const hookRemaining = user.hook_messages_remaining || 0

      if (gems < GEM_COSTS.message && hookRemaining <= 0) {
        setBlocked(true)
        return
      }

      setLoading(true)
      try {
        const res = await tgFetch('/api/start-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ character_id: characterId }),
        })
        const data = await res.json()
        if (res.ok) {
          if (data.blocked) {
            setBlocked(true)
            return
          }
          if (data.already_started) return
          if (data.response) {
            setMessages([{ role: 'assistant', content: data.response }])
            setGems(data.remaining_gems)
          }
        }
      } catch (e) {
        console.error('Error auto-start:', e)
      } finally {
        setLoading(false)
      }
    }

    startChat()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoaded, user, character, messages.length])

  const handleInputFocus = () => {
    setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 300)
  }

  const send = async () => {
    if (!input.trim() || !user || loading || sendingRef.current) return
    sendingRef.current = true

    const gems = user.gems || 0
    const hookRemaining = user.hook_messages_remaining || 0
    if (gems < GEM_COSTS.message && hookRemaining <= 0) {
      sendingRef.current = false
      setBlocked(true)
      return
    }
    const text = input.trim()
    setInput('')
    setLoading(true)
    setMessages((p) => [...p, { role: 'user', content: text }])

    try {
      const res = await tgFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: characterId,
          message: text,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.blocked) {
          setBlockedMessage(data.response || '')
          setBlocked(true)
          setMessages((p) => p.slice(0, -1))
        } else {
          setMessages((p) => [...p, { role: 'assistant', content: data.response }])
          setGems(data.remaining_gems)
          setHookRemaining(data.hook_messages_remaining ?? 0)
          setTotalUserMessages((prev) => prev + 1)
          setPhotoOfferActive(!!data.photo_offer_available)

          setLowGemsWarning(!!data.low_gems_warning)
          setLowGemsCount(data.low_gems_count || 0)

          if (data.total_user_messages !== undefined) {
            setLevelProgress({
              current: data.total_user_messages,
              next: data.next_level_at ?? null,
            })
          }

          if (data.level_up && data.new_level && data.new_level_badge) {
            setLevelUpModal({
              level: data.new_level,
              badgeKey: data.new_level_badge,
            })
          }
        }
      } else {
        const errMsg = data.detail
          ? `${data.error || 'Error'}: ${data.detail}`
          : (data.error || `Error HTTP ${res.status}`)
        console.error('[chat] API error:', data)
        alert(errMsg)
        setMessages((p) => p.slice(0, -1))
      }
    } catch (err: any) {
      console.error('[chat] fetch error:', err)
      alert('Error de conexión: ' + (err?.message || 'desconocido'))
      setMessages((p) => p.slice(0, -1))
    } finally {
      sendingRef.current = false
      setLoading(false)
    }
  }

  const playAudio = async () => {
    if (!user) return
    if (!isPremium) {
      setPremiumModalReason('audio')
      setShowPremiumModal(true)
      return
    }
    const last = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!last) return alert('No hay mensaje')

    const currentAudioCost = getAudioCost(currentLevel.level)
    if ((user.gems || 0) < currentAudioCost) {
      return alert(`Necesitas ${currentAudioCost} gemas`)
    }

    setGeneratingAudio(true)
    try {
      const res = await tgFetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: characterId,
          text: last.content,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setGems(data.remaining_gems)
        new Audio(`data:audio/wav;base64,${data.audio}`).play()
      } else if (data.error === 'premium_required') {
        setPremiumModalReason('audio')
        setShowPremiumModal(true)
      } else {
        alert(data.message || data.error || 'Error')
      }
    } catch {
      alert('Error de conexión')
    } finally {
      setGeneratingAudio(false)
    }
  }

  // ═══════════════════════════════════════════════════════
  // ✅ FUNCIÓN ACTUALIZADA: envía los últimos 4 mensajes
  // ═══════════════════════════════════════════════════════
  const generateImage = async () => {
    if (!user || !character || generatingImage) return
    if (!isPremium) {
      setPremiumModalReason('image')
      setShowPremiumModal(true)
      return
    }
    if ((user.gems || 0) < currentImageCost) {
      return alert(`Necesitas ${currentImageCost} gemas`)
    }

    setGeneratingImage(true)
    try {
      // ✅ NUEVO: extraer últimos 4 mensajes (limpios) para contexto
      const recentMessages = messages
        .slice(-4)
        .map((m) => {
          return m.content
            .replace(/!\[[^\]]*\]\([^)]+\)/g, '') // quitar imágenes markdown
            .replace(/\*+/g, '')                  // quitar asteriscos
            .replace(/\s+/g, ' ')                 // colapsar espacios
            .trim()
        })
        .filter((t) => t.length > 0)

      const res = await tgFetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: characterId,
          recent_messages: recentMessages,  // ✅ NUEVO
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessages((p) => [
          ...p,
          {
            role: 'assistant',
            content: `*${getDisplayName(character)} te envía una foto*\n\n![Selfie](${data.image_url})`,
          },
        ])
        setGems(data.remaining_gems)
        setPhotoOfferActive(false)
      } else if (data.error === 'premium_required') {
        setPremiumModalReason('image')
        setShowPremiumModal(true)
      } else {
        alert(data.message || data.error || 'Error')
      }
    } catch {
      alert('Error de conexión')
    } finally {
      setGeneratingImage(false)
    }
  }

  const handleBannerTap = () => {
    if (!isPremium) {
      setPremiumModalReason('image')
      setShowPremiumModal(true)
      return
    }
    if ((user?.gems || 0) < currentImageCost) {
      router.push('/shop')
      return
    }
    generateImage()
  }

  const handleLevelUpCTA = () => {
    setLevelUpModal(null)
    setTimeout(() => {
      handleBannerTap()
    }, 200)
  }

  const doRename = async () => {
    if (!newName.trim() || !user || !character) return
    if (newName.trim() === getDisplayName(character)) {
      setShowRename(false)
      return
    }
    if ((user.gems || 0) < GEM_COSTS.rename_character) {
      return alert(`Necesitas ${GEM_COSTS.rename_character} gemas`)
    }
    if (!confirm('¿Renombrar por 3 gemas?')) return

    setRenaming(true)
    try {
      const res = await tgFetch('/api/rename-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: characterId,
          new_name: newName.trim(),
        }),
      })
      const data = await res.json()

      if (res.ok && data.ok) {
        setCharacter({ ...character, character_name: data.character_name })
        setGems(data.remaining_gems)
        setShowRename(false)
      } else {
        alert(data.message || data.error || 'Error')
      }
    } catch {
      alert('Error de conexión')
    } finally {
      setRenaming(false)
    }
  }

  const formatMessage = (content: string) => {
    let html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    html = html.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" style="border-radius:16px;max-width:100%;margin-top:8px;box-shadow:0 8px 24px rgba(168,85,247,0.3);" />'
    )
    html = html.replace(/\*([^*\n]+)\*/g, '<span class="chat-action">*$1*</span>')
    html = html.replace(/_([^_\n]+)_/g, '<em style="color:#c4b5fd;">$1</em>')
    return html
  }

  const t = getTranslations(lang)
  const gems = user?.gems || 0
  const hookRemaining = user?.hook_messages_remaining || 0

  const currentLevel = getLevelFromMessages(totalUserMessages)
  const currentImageCost = getImageCost(currentLevel.level)
  const currentAudioCost = getAudioCost(currentLevel.level)

  if (userLoading || characterLoading || !character) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  const gradient = getGradient(character.archetype)
  const displayName = getDisplayName(character)
  const characterAvatar = getCharacterImageUrl(character.archetype, character.gender)
  const characterDescription = getCharacterDescription(character.archetype, lang)

  const canAfford = gems >= currentImageCost
  const missingGems = Math.max(0, currentImageCost - gems)

  let headerBadgeText = ''
  let headerBadgeVariant: 'hook' | 'low-gems' | null = null

  if (hookRemaining > 0) {
    const rotations = lang === 'es' ? HOOK_ROTATIONS_ES : HOOK_ROTATIONS_EN
    headerBadgeText = rotations[rotationIndex % rotations.length](hookRemaining)
    headerBadgeVariant = 'hook'
  } else if (lowGemsWarning && lowGemsCount > 0) {
    const rotations = lang === 'es' ? LOW_GEMS_ROTATIONS_ES : LOW_GEMS_ROTATIONS_EN
    headerBadgeText = rotations[rotationIndex % rotations.length](lowGemsCount)
    headerBadgeVariant = 'low-gems'
  }

  const showLevelProgress =
    levelProgress.next !== null &&
    levelProgress.current < levelProgress.next &&
    levelProgress.current > 0

  const levelProgressPercent =
    levelProgress.next && levelProgress.next > 0
      ? Math.min(100, (levelProgress.current / levelProgress.next) * 100)
      : 0

  return (
    <div className="chat-page">
      <header className="chat-header">
        <button
          onClick={() => router.push('/chats')}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="m15 18-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div
          className="avatar"
          style={{ background: gradient, overflow: 'hidden', position: 'relative', flexShrink: 0 }}
        >
          {characterAvatar ? (
            <img
              src={characterAvatar}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center 10%',
              }}
            />
          ) : (
            displayName?.[0]?.toUpperCase()
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontWeight: 600,
              fontSize: 14,
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              className="level-badge"
              style={{ color: currentLevel.color, background: `${currentLevel.color}20` }}
            >
              {t[currentLevel.badgeKey as keyof typeof t]}
            </span>

            {headerBadgeVariant === 'hook' && (
              <span className="status-badge status-badge-hook">
                {headerBadgeText}
              </span>
            )}
            {headerBadgeVariant === 'low-gems' && (
              <span className="status-badge status-badge-low">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="currentColor" />
                </svg>
                {headerBadgeText}
              </span>
            )}
          </div>

          {showLevelProgress && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 4,
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: 3,
                  background: 'rgba(168, 85, 247, 0.15)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  maxWidth: 70,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${levelProgressPercent}%`,
                    background: 'linear-gradient(90deg, #a855f7, #ec4899)',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 9,
                  color: '#8b8b9e',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                }}
              >
                {levelProgress.current}/{levelProgress.next}
              </span>
            </div>
          )}
        </div>

        <div className="menu-wrap" ref={menuRef}>
          <button
            className="menu-trigger"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="5" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="19" r="1.6" fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <div className="menu-dropdown">
              <button
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  setShowRename(true)
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {t.renameTitle}
              </button>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(255,255,255,0.05)',
            padding: '5px 10px',
            borderRadius: 20,
            border: '1px solid rgba(168,85,247,0.3)',
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#a78bfa" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{gems}</span>
        </div>
      </header>

      <div className="chat-messages">
        {characterDescription && (
          <div className="character-intro">
            <div className="character-intro-header">
              <span className="character-intro-icon">✨</span>
              <span className="character-intro-badge">
                {lang === 'es'
                  ? (character.gender === 'male' ? 'SOBRE ÉL' : 'SOBRE ELLA')
                  : (character.gender === 'male' ? 'ABOUT HIM' : 'ABOUT HER')}
              </span>
            </div>
            <p className="character-intro-text">{characterDescription}</p>
          </div>
        )}

        {loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 24px' }}>
            <div
              className="avatar-xl"
              style={{
                background: gradient,
                margin: '0 auto 16px',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {characterAvatar ? (
                <img
                  src={characterAvatar}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center 10%',
                  }}
                />
              ) : (
                displayName?.[0]?.toUpperCase()
              )}
            </div>
            <p style={{ fontSize: 14, color: '#8b8b9e', margin: 0 }}>
              {displayName} {t.online.toLowerCase()}...
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={m.id || i}
            className={m.role === 'user' ? 'bubble-user' : 'bubble-ai'}
            dangerouslySetInnerHTML={{ __html: formatMessage(m.content) }}
          />
        ))}

        {loading && messages.length > 0 && (
          <div
            className="bubble-ai"
            style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          >
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="chat-input-bar">
        {photoOfferActive && (
          <div
            onClick={handleBannerTap}
            className="photo-offer-banner"
            style={{
              position: 'relative',
              marginBottom: 10,
              padding: '14px 16px',
              borderRadius: 16,
              background: canAfford && isPremium
                ? 'linear-gradient(135deg, rgba(236,72,153,0.4) 0%, rgba(168,85,247,0.3) 50%, rgba(236,72,153,0.4) 100%)'
                : 'linear-gradient(135deg, rgba(124,92,255,0.35) 0%, rgba(168,85,247,0.25) 100%)',
              backgroundSize: '200% 200%',
              border: canAfford && isPremium
                ? '2px solid rgba(236,72,153,0.85)'
                : '2px solid rgba(168,85,247,0.6)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              overflow: 'hidden',
              animation: canAfford && isPremium
                ? 'pulseGlow 1.8s ease-in-out infinite, shimmer 3s linear infinite'
                : 'pulseSoft 2.4s ease-in-out infinite',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(110deg, transparent 40%, rgba(255,255,255,0.2) 50%, transparent 60%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 2.5s linear infinite',
                pointerEvents: 'none',
              }}
            />

            <div
              style={{
                fontSize: 30,
                animation: 'float 1.8s ease-in-out infinite',
                filter: 'drop-shadow(0 0 10px rgba(236,72,153,1))',
                flexShrink: 0,
                position: 'relative',
                zIndex: 1,
              }}
            >
              {isPremium ? '📸' : '🔒'}
            </div>

            <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 900,
                    letterSpacing: '0.1em',
                    background: canAfford && isPremium
                      ? 'linear-gradient(90deg, #f0abfc, #ec4899)'
                      : 'linear-gradient(90deg, #a78bfa, #7c5cff)',
                    color: '#fff',
                    padding: '2px 8px',
                    borderRadius: 6,
                    animation: 'badgePulse 1.2s ease-in-out infinite',
                    textShadow: '0 0 4px rgba(0,0,0,0.3)',
                  }}
                >
                  {!isPremium
                    ? (lang === 'es' ? 'DESBLOQUEA' : 'UNLOCK')
                    : canAfford
                    ? (lang === 'es' ? 'REGALO · TOCA' : 'GIFT · TAP')
                    : (lang === 'es' ? 'BLOQUEADO' : 'LOCKED')}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: '#fbcfe8',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                  }}
                >
                  {!isPremium
                    ? 'PREMIUM'
                    : canAfford
                    ? '→'
                    : (lang === 'es' ? 'IR A TIENDA' : 'GO TO SHOP')}
                </span>
              </div>

              <p
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#fff',
                  margin: 0,
                  textShadow: '0 1px 4px rgba(0,0,0,0.5)',
                  lineHeight: 1.25,
                }}
              >
                {lang === 'es'
                  ? `${displayName} quiere mandarte algo especial`
                  : `${displayName} wants to send you something special`}
              </p>

              <p
                style={{
                  fontSize: 11,
                  color: canAfford && isPremium ? '#f0abfc' : '#fbbf24',
                  margin: '3px 0 0 0',
                  fontWeight: 800,
                }}
              >
                {!isPremium
                  ? (lang === 'es' ? 'Compra gemas para verla' : 'Buy gems to see it')
                  : canAfford
                  ? `📸 ${currentImageCost} — ${lang === 'es' ? 'reclamar ahora' : 'claim now'}`
                  : `⚠️ ${lang === 'es' ? 'Te faltan' : "You're missing"} ${missingGems} gemas`}
              </p>
            </div>

            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              style={{
                animation: 'badgePulse 1.2s ease-in-out infinite',
                flexShrink: 0,
                filter: 'drop-shadow(0 0 8px rgba(240,171,252,1))',
                position: 'relative',
                zIndex: 1,
              }}
            >
              <path
                d="m9 6 6 6-6 6"
                stroke="#f0abfc"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}

        <div className="chat-input-row">
          <button
            onClick={playAudio}
            disabled={generatingAudio || (isPremium && gems < currentAudioCost)}
            className="chat-icon-btn"
            title={`${t.audioTooltip} (${currentAudioCost} gemas)`}
            style={{
              opacity: isPremium && gems < currentAudioCost ? 0.3 : 1,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M11 5 6 9H2v6h4l5 4V5z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <button
            onClick={handleBannerTap}
            disabled={generatingImage}
            className="chat-icon-btn"
            title={`${t.imageTooltip} (${currentImageCost} gemas)`}
            style={{
              opacity: isPremium && gems < currentImageCost ? 0.4 : 1,
              boxShadow: photoOfferActive
                ? '0 0 20px rgba(236,72,153,0.9), 0 0 30px rgba(168,85,247,0.6)'
                : undefined,
              borderColor: photoOfferActive ? '#ec4899' : undefined,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="9" cy="10" r="2" stroke="currentColor" strokeWidth="2" />
              <path
                d="m4 18 5-5 4 4 3-3 4 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            onFocus={handleInputFocus}
            placeholder={t.writeMessage}
            disabled={loading}
            className="chat-input"
            rows={1}
          />

          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="chat-send-btn"
            title="Enviar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="m4 4 17 8-17 8V4z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {levelUpModal && (
        <div className="modal-backdrop">
          <div className="modal-box level-up-modal">
            <div
              style={{
                fontSize: 52,
                textAlign: 'center',
                marginBottom: 4,
                animation: 'levelUpSparkle 1.6s ease-in-out infinite',
                filter: 'drop-shadow(0 0 20px rgba(240,171,252,0.9))',
              }}
            >
              ✨
            </div>

            <p
              style={{
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: '0.18em',
                color: '#f0abfc',
                textAlign: 'center',
                margin: 0,
                textShadow: '0 0 12px rgba(236,72,153,0.6)',
              }}
            >
              {lang === 'es' ? 'HAS SUBIDO DE NIVEL' : 'LEVEL UP'}
            </p>

            <h2
              className="modal-title"
              style={{
                textAlign: 'center',
                fontSize: 26,
                marginTop: 6,
                marginBottom: 0,
                background: 'linear-gradient(135deg, #f0abfc, #ec4899)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {t[levelUpModal.badgeKey as keyof typeof t]}
            </h2>

            <div
              style={{
                marginTop: 20,
                padding: 16,
                borderRadius: 14,
                background: 'rgba(168,85,247,0.12)',
                border: '1px solid rgba(168,85,247,0.3)',
              }}
            >
              <p
                style={{
                  fontSize: 14,
                  color: '#f5f0ff',
                  margin: 0,
                  textAlign: 'center',
                  lineHeight: 1.55,
                }}
              >
                {lang === 'es'
                  ? LEVEL_UP_COPY_ES[levelUpModal.level]?.(displayName)
                  : LEVEL_UP_COPY_EN[levelUpModal.level]?.(displayName)}
              </p>
            </div>

            <div className="modal-btn-row" style={{ marginTop: 20 }}>
              <button
                onClick={() => setLevelUpModal(null)}
                className="modal-btn secondary"
              >
                {lang === 'es' ? 'Seguir' : 'Continue'}
              </button>
              <button
                onClick={handleLevelUpCTA}
                className="modal-btn primary"
                style={{
                  background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
                  boxShadow: '0 4px 24px rgba(236,72,153,0.7)',
                }}
              >
                {lang === 'es' ? '📸 Ver sorpresa' : '📸 See surprise'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPremiumModal && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                margin: '0 auto 16px',
                background: 'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
              }}
            >
              {premiumModalReason === 'audio' ? '🔊' : '📸'}
            </div>
            <h3 className="modal-title" style={{ textAlign: 'center' }}>
              {t.premiumFeatureTitle}
            </h3>
            <p className="modal-desc" style={{ textAlign: 'center', marginBottom: 20 }}>
              {premiumModalReason === 'audio' ? t.premiumAudio : t.premiumImage}
            </p>
            <div className="modal-btn-row">
              <button onClick={() => setShowPremiumModal(false)} className="modal-btn secondary">
                {t.close}
              </button>
              <button
                onClick={() => {
                  setShowPremiumModal(false)
                  router.push('/shop')
                }}
                className="modal-btn primary"
              >
                {t.goToShop}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRename && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <h3 className="modal-title">{t.renameTitle}</h3>
            <p className="modal-desc">{t.renameDesc}</p>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t.renamePlaceholder}
              maxLength={30}
              className="modal-input"
            />
            <div className="modal-btn-row">
              <button
                onClick={() => {
                  setShowRename(false)
                  setNewName(displayName)
                }}
                className="modal-btn secondary"
              >
                {t.close}
              </button>
              <button
                onClick={doRename}
                disabled={
                  renaming ||
                  !newName.trim() ||
                  newName.trim() === displayName ||
                  gems < GEM_COSTS.rename_character
                }
                className="modal-btn primary"
              >
                {renaming ? t.saving : `${t.save} (${GEM_COSTS.rename_character})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {blocked && (
        <div className="modal-backdrop">
          <div className="modal-box danger">
            <h3 className="modal-title">{t.blockedTitle}</h3>
            {blockedMessage && (
              <div
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(168,85,247,0.2)',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
                dangerouslySetInnerHTML={{ __html: formatMessage(blockedMessage) }}
              />
            )}
            <p className="modal-desc">
              {displayName} {t.blockedDesc}
            </p>
            <button
              onClick={() => router.push('/shop')}
              className="modal-btn primary"
              style={{ width: '100%', marginBottom: 8 }}
            >
              {t.rechargeUnlock}
            </button>
            <button
              onClick={() => router.push('/')}
              className="modal-btn secondary"
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                color: '#fff',
                marginBottom: 8,
              }}
            >
              {t.inviteFriend}
            </button>
            <button
              onClick={() => setBlocked(false)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#8b8b9e',
                padding: 8,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t.close}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
