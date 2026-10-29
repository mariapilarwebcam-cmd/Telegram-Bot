"use client"

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { tgFetch } from '@/lib/telegram-fetch'
import {
  GEM_COSTS,
  getDisplayName,
  getCharacterImageUrl,
  getCharacterDescription,
  VIP_DAILY_MESSAGE_LIMIT,
} from '@/lib/constants'
import { getLevelFromMessages, getImageCost, getAudioCost } from '@/lib/levels'
import { getTranslations } from '@/lib/i18n'
import { useUser } from '@/lib/UserContext'
import { Analytics } from '@/lib/posthog'
import { AnimatedNumber } from '@/components/AnimatedNumber'

interface Message {
  id?: number
  role: 'user' | 'assistant'
  content: string
  created_at?: string
  reaction?: string | null
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

const getItemImageUrl = (itemId: string) => {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  if (!base) return ''
  return `${base.replace(/\/$/, '')}/items/${itemId}.jpg`
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

const REPORT_REASONS = [
  { key: 'inappropriate_content', es: 'Contenido no apropiado', en: 'Inappropriate content' },
  { key: 'offensive', es: 'Ofensivo o discriminatorio', en: 'Offensive or discriminatory' },
  { key: 'harassment', es: 'Acoso', en: 'Harassment' },
  { key: 'non_consensual', es: 'Contenido no consensuado', en: 'Non-consensual content' },
  { key: 'minor_safety', es: 'Seguridad de menores', en: 'Minor safety' },
  { key: 'spam', es: 'Spam', en: 'Spam' },
  { key: 'other', es: 'Otro', en: 'Other' },
] as const

type ReportReason = (typeof REPORT_REASONS)[number]['key']

const SUPPORT_URL = 'https://t.me/TabooRealmSupport'

const TEXTAREA_MAX_HEIGHT = 120

export default function ChatPage() {
  const { id } = useParams()
  const router = useRouter()
  const characterId = parseInt(id as string)

  const { user, loading: userLoading, lang, setGems, setHookRemaining, refresh } = useUser()

  const [character, setCharacter] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isPremium, setIsPremium] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [blockedMessage, setBlockedMessage] = useState('')

  const [totalUserMessages, setTotalUserMessages] = useState(0)
  const [photoOfferActive, setPhotoOfferActive] = useState(false)
  const [seenImageCount, setSeenImageCount] = useState(0)

  const [isVip, setIsVip] = useState(false)
  const [activePass, setActivePass] = useState<any>(null)
  const [vipMessagesToday, setVipMessagesToday] = useState(0)
  const [showVipLimitModal, setShowVipLimitModal] = useState(false)

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
  
  const [unlockingPhoto, setUnlockingPhoto] = useState<number | null>(null)
  const [recentlyUnlocked, setRecentlyUnlocked] = useState<string | null>(null)
  const [activeReactionMsg, setActiveReactionMsg] = useState<number | null>(null)
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const [menuDirection, setMenuDirection] = useState<'top' | 'bottom'>('top')

  const [menuOpen, setMenuOpen] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)

  const [showReportModal, setShowReportModal] = useState(false)
  const [reportReason, setReportReason] = useState<ReportReason | null>(null)
  const [reportDetails, setReportDetails] = useState('')
  const [reportSending, setReportSending] = useState(false)
  const [reportSent, setReportSent] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

  const [characterLoading, setCharacterLoading] = useState(true)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [autoStartAttempted, setAutoStartAttempted] = useState(false)

  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  
  const [hasFantasyPass, setHasFantasyPass] = useState(false)
  const [usingFantasyPass, setUsingFantasyPass] = useState(false)

  const [showWardrobe, setShowWardrobe] = useState(false)
  const [wardrobeData, setWardrobeData] = useState<{ inventory: any[], owned: string[], equipped: string | null }>({ inventory: [], owned: [], equipped: null })
  const [equippingOutfit, setEquippingOutfit] = useState(false)

  // ✅ ESTADOS PARA EL INTERCAMBIO
  const [showExchangeModal, setShowExchangeModal] = useState(false)
  const [exchangeAmount, setExchangeAmount] = useState(2)
  const [exchanging, setExchanging] = useState(false)

  const endRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const longPressFired = useRef(false)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const interval = setInterval(() => setRotationIndex((p) => p + 1), 5000)
    return () => clearInterval(interval)
  }, [])

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

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const newHeight = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)
    el.style.height = `${newHeight}px`
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [input])

  useEffect(() => {
    if (userLoading) return
    if (!user?.telegram_id) return

    tgFetch('/api/subscription')
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        setIsVip(!!data.active)
      })
      .catch((e) => console.warn('[chat] vip load error:', e))
  }, [user?.telegram_id, userLoading])

  useEffect(() => {
    if (userLoading) return
    if (!user?.telegram_id) return

    tgFetch(`/api/character/${characterId}`)
      .then(async (res) => {
        if (!res.ok) {
          console.error('[chat] char load failed:', res.status)
          setCharacterLoading(false)
          return
        }
        const data = await res.json()

        if (data.character) {
          setCharacter(data.character)
          setNewName(getDisplayName(data.character))
        }

        const raw: any[] = data.messages || []
        const sorted = [...raw].sort((a, b) => {
          const cmp = String(a.created_at || '').localeCompare(String(b.created_at || ''))
          if (cmp !== 0) return cmp
          return (a.id || 0) - (b.id || 0)
        })
        
        const deduped = sorted.filter((msg, idx, arr) => {
          if (idx === 0) return true
          const prev = arr[idx - 1]
          if (msg.id && prev.id && msg.id !== prev.id) return true
          return !(prev.role === msg.role && prev.content === msg.content)
        })
        
        setMessages(deduped)
        setIsPremium(!!data.is_premium)
        setSeenImageCount(data.seen_image_count || 0)
        setActivePass(data.active_pass)
        setHasFantasyPass(!!data.has_fantasy_pass)

        const count = data.user_message_count || 0
        setTotalUserMessages(count)

        const currentLvl = getLevelFromMessages(count)
        // ✅ FIX: Umbrales actualizados para coincidir con lib/levels.ts
        const thresholds: Record<number, number | null> = {
          1: 5, 2: 15, 3: 40, 4: 90, 5: null,
        }
        setLevelProgress({
          current: count,
          next: thresholds[currentLvl.level] ?? null,
        })

        setCharacterLoading(false)
        setHistoryLoaded(true)
      })
      .catch((e) => {
        console.error('[chat] char load error:', e)
        setCharacterLoading(false)
      })
  }, [characterId, user?.telegram_id, userLoading])

  useEffect(() => {
    const t = setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 50)
    return () => clearTimeout(t)
  }, [messages, loading])

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
      const bonusGems = (user as any)?.bonus_gems || 0
      const gems = user.gems || 0
      const hookRemaining = user.hook_messages_remaining || 0

      if (!isVip && (bonusGems + gems) < GEM_COSTS.message && hookRemaining <= 0 && !activePass) {
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
          if (data.blocked) { setBlocked(true); return }
          if (data.already_started) return
          if (data.response) {
            setMessages([{ 
              id: data.assistant_message_id, 
              role: 'assistant', 
              content: data.response 
            }])
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
  }, [historyLoaded, user, character, messages.length, isVip, activePass])

  const handleInputFocus = () => {
    setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 300)
  }

  const send = async (acceptPenalty = false) => {
    if (!input.trim() || !user || loading || sendingRef.current) return
    sendingRef.current = true

    const bonusGems = (user as any)?.bonus_gems || 0
    const gems = user.gems || 0
    const hookRemaining = user.hook_messages_remaining || 0

    if (!acceptPenalty && !isVip && (bonusGems + gems) < GEM_COSTS.message && hookRemaining <= 0 && !activePass) {
      sendingRef.current = false
      setBlocked(true)
      return
    }

    const text = input.trim()
    const wasFirstMessage = totalUserMessages === 0
    
    if (!acceptPenalty) {
      setInput('')
      setMessages((p) => [...p, { role: 'user', content: text }])
    }
    
    setLoading(true)
    setActiveReactionMsg(null) 

    try {
      const res = await tgFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          character_id: characterId, 
          message: text,
          accept_penalty: acceptPenalty
        }),
      })
      const data = await res.json()
      
      if (res.ok) {
        if (data.requires_penalty) {
          setLoading(false)
          sendingRef.current = false
          
          const confirmPenalty = window.confirm(data.message)
          if (confirmPenalty) {
            send(true)
          } else {
            setInput(text)
            setMessages((p) => p.slice(0, -1))
          }
          return
        }

        if (data.blocked) {
          if (data.vip_limit_reached) {
            setMessages((p) => p.slice(0, -1))
            setShowVipLimitModal(true)
            if (typeof data.vip_messages_today === 'number') {
              setVipMessagesToday(data.vip_messages_today)
            }
          } else if (data.vip_expired) {
            setBlockedMessage(data.response || '')
            setBlocked(true)
            setMessages((p) => p.slice(0, -1))
            setInput(text)
          } else {
            setBlockedMessage(data.response || '')
            setBlocked(true)
            setMessages((p) => p.slice(0, -1))
            setInput(text)
          }
        } else {
          setMessages((p) => {
            const copy = [...p]
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === 'user' && !copy[i].id) {
                copy[i] = { ...copy[i], id: data.user_message_id }
                break
              }
            }
            return [...copy, { id: data.assistant_message_id, role: 'assistant', content: data.response }]
          })
          
          setGems(data.remaining_gems)
          setHookRemaining(data.hook_messages_remaining ?? 0)
          setTotalUserMessages((prev) => prev + 1)
          
          if (typeof data.remaining_bonus_gems === 'number') {
            await refresh()
          }
          
          setPhotoOfferActive(!!data.photo_offer_available)
          setLowGemsWarning(!!data.low_gems_warning)
          setLowGemsCount(data.low_gems_count || 0)

          if (data.is_vip) {
            setIsVip(true)
            if (typeof data.vip_messages_today === 'number') {
              setVipMessagesToday(data.vip_messages_today)
            }
          }

          if (data.total_user_messages !== undefined) {
            setLevelProgress({
              current: data.total_user_messages,
              next: data.next_level_at ?? null,
            })
          }

          if (wasFirstMessage && character) {
            Analytics.firstMessageSent({
              character_id: characterId,
              archetype: character.archetype,
              level: data.level || 1,
            })
          }

          if (data.level_up && data.new_level && data.new_level_badge) {
            setLevelUpModal({
              level: data.new_level,
              badgeKey: data.new_level_badge,
            })

            Analytics.levelUp({
              character_id: characterId,
              new_level: data.new_level,
              total_messages: data.total_user_messages || 0,
            })
          }
        }
      } else {
        const errMsg = data.detail
          ? `${data.error || 'Error'}: ${data.detail}`
          : (data.error || `Error HTTP ${res.status}`)
        console.error('[chat] API error:', data)
        alert(errMsg)
        if (!acceptPenalty) setMessages((p) => p.slice(0, -1))
      }
    } catch (err: any) {
      console.error('[chat] fetch error:', err)
      alert('Error de conexión: ' + (err?.message || 'desconocido'))
      if (!acceptPenalty) setMessages((p) => p.slice(0, -1))
    } finally {
      sendingRef.current = false
      setLoading(false)
    }
  }

  const useFantasyPass = async () => {
    if (!hasFantasyPass || usingFantasyPass || !character) return

    setUsingFantasyPass(true)
    try {
      const res = await tgFetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: characterId,
          is_fantasy_pass: true,
        }),
      })
      const data = await res.json()

      if (res.ok) {
        setMessages((p) => [
          ...p,
          {
            id: data.message_id,
            role: 'assistant',
            content: `*${getDisplayName(character)} te envía una foto*\n\n![Selfie](${data.image_url})`,
          },
        ])
        setRecentlyUnlocked(data.image_url)
        setTimeout(() => setRecentlyUnlocked(null), 1000)
        
        setHasFantasyPass(false)
        await refresh()
      } else {
        alert(data.error || 'Error al usar el Pase de Fantasía')
      }
    } catch {
      alert('Error de conexión')
    } finally {
      setUsingFantasyPass(false)
    }
  }

  const handleEquipOutfit = async (outfitKey: string) => {
    if (!character || equippingOutfit) return
    setEquippingOutfit(true)

    try {
      const res = await tgFetch('/api/outfits/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: characterId, outfit_key: outfitKey }),
      })
      const data = await res.json()

      if (!res.ok) {
        alert(data.message || data.error || 'Error al equipar')
        setEquippingOutfit(false)
        return
      }

      setWardrobeData(prev => ({
        ...prev,
        equipped: outfitKey,
        inventory: prev.inventory.filter(i => i.item_key !== outfitKey),
        owned: prev.owned.includes(outfitKey) ? prev.owned : [...prev.owned, outfitKey]
      }))

      setShowWardrobe(false)

      if (data.is_new) {
        const imgRes = await tgFetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character_id: characterId,
            is_gift_photo: true,
          }),
        })
        const imgData = await imgRes.json()

        if (imgRes.ok && imgData.image_url) {
          setMessages((p) => [
            ...p,
            {
              id: imgData.message_id,
              role: 'assistant',
              content: `*${getDisplayName(character)} se sonroja y te muestra cómo le queda*\n\n"¡No puedo creer que me hayas comprado esto! Espera, déjame mostrarte..."\n\n![Regalo](${imgData.image_url})`,
            },
          ])
          setRecentlyUnlocked(imgData.image_url)
          setTimeout(() => setRecentlyUnlocked(null), 1000)
          await refresh()
        }
      }
    } catch (e) {
      alert('Error de conexión')
    } finally {
      setEquippingOutfit(false)
    }
  }

  const playAudio = async () => {
    if (!user) return
    if (!isPremium) {
      setPremiumModalReason('audio')
      setShowPremiumModal(true)
      return
    }

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!lastAssistant) return alert(lang === 'es' ? 'No hay mensaje' : 'No message')

    const currentAudioCost = getAudioCost(currentLevel.level)

    const purchasedGems = user.purchased_gems || 0
    if (!isVip && purchasedGems < currentAudioCost) {
      return alert(
        lang === 'es'
          ? `Necesitas ${currentAudioCost} gemas compradas`
          : `You need ${currentAudioCost} purchased gems`
      )
    }

    const recentContext = messages
      .slice(-3)
      .map((m) => ({
        role: m.role,
        content: m.content
          .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
          .replace(/\*+/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      }))
      .filter((m) => m.content.length > 0)

    setGeneratingAudio(true)
    try {
      const res = await tgFetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: characterId,
          recent_messages: recentContext,
          text: lastAssistant.content,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setGems(data.remaining_gems)
        if (data.remaining_purchased_gems !== undefined) {
           await refresh()
        }
        
        const audio = new Audio(`data:audio/wav;base64,${data.audio}`)
        
        setIsPlayingAudio(true)
        audio.onended = () => setIsPlayingAudio(false)
        audio.play()

        Analytics.audioGenerated({
          character_id: characterId,
          cost: data.cost || currentAudioCost,
          level: currentLevel.level,
        })
      } else if (data.error === 'premium_required') {
        setPremiumModalReason('audio')
        setShowPremiumModal(true)
      } else {
        alert(data.message || data.error || 'Error')
      }
    } catch {
      alert(lang === 'es' ? 'Error de conexión' : 'Connection error')
    } finally {
      setGeneratingAudio(false)
    }
  }

  const generateImage = async () => {
    if (!user || !character || generatingImage) return

    const isFirstImage = seenImageCount === 0

    if (!isFirstImage && !isPremium) {
      setPremiumModalReason('image')
      setShowPremiumModal(true)
      return
    }

    const purchasedGems = user.purchased_gems || 0
    if (!isFirstImage && purchasedGems < currentImageCost) {
      return alert(`Necesitas ${currentImageCost} gemas compradas`)
    }

    setGeneratingImage(true)
    try {
      const recentMessages = messages
        .slice(-4)
        .map((m) =>
          m.content
            .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
            .replace(/\*+/g, '')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter((t) => t.length > 0)

      const res = await tgFetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: characterId,
          recent_messages: recentMessages,
          is_direct_request: true,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.is_locked) {
          setMessages((p) => [
            ...p,
            {
              id: data.message_id,
              role: 'assistant',
              content: `*${getDisplayName(character)} te envía una foto*\n\n![Selfie](locked:${data.offer_id}@${data.blur_url})`,
            },
          ])
        } else {
          setMessages((p) => [
            ...p,
            {
              id: data.message_id,
              role: 'assistant',
              content: `*${getDisplayName(character)} te envía una foto*\n\n![Selfie](${data.image_url})`,
            },
          ])
          setRecentlyUnlocked(data.image_url)
          setTimeout(() => setRecentlyUnlocked(null), 1000)
        }

        setGems(data.remaining_gems)
        if (data.remaining_purchased_gems !== undefined) {
           await refresh()
        }
        
        setPhotoOfferActive(false)
        if (data.source === 'r2_static') {
          setSeenImageCount((prev) => prev + 1)
        }

        Analytics.imageGenerated({
          character_id: characterId,
          source: data.source || 'r2_static',
          image_index: data.image_index ?? null,
          cost: data.cost || 0,
          free: !!data.free,
          level: currentLevel.level,
        })
      } else if (data.error === 'premium_required') {
        setPremiumModalReason('image')
        setShowPremiumModal(true)
      } else if (data.error === 'insufficient_gems') {
        alert(data.message || `Necesitas ${data.required || currentImageCost} gemas compradas`)
      } else {
        alert(data.message || data.error || 'Error')
      }
    } catch {
      alert('Error de conexión')
    } finally {
      setGeneratingImage(false)
    }
  }

  const handleUnlockPhoto = async (offerId: number, price: number) => {
    if (!user || unlockingPhoto) return

    if ((user.purchased_gems || 0) < price) {
      alert(`Necesitas ${price} gemas compradas. Ve a la tienda para recargar.`)
      router.push('/shop')
      return
    }

    setUnlockingPhoto(offerId)
    try {
      const res = await tgFetch('/api/unlock-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer_id: offerId }),
      })
      const data = await res.json()

      if (res.ok && data.image_url) {
        setMessages((prev) => 
          prev.map((msg) => {
            if (msg.content.includes(`locked:${offerId}@`)) {
              return {
                ...msg,
                content: msg.content.replace(new RegExp(`\\(locked:${offerId}@[^)]+\\)`), `(${data.image_url})`)
              }
            }
            return msg
          })
        )
        
        setRecentlyUnlocked(data.image_url)
        setTimeout(() => setRecentlyUnlocked(null), 1000)
        await refresh()
      } else {
        alert(data.message || data.error || 'Error al desbloquear')
      }
    } catch {
      alert('Error de conexión')
    } finally {
      setUnlockingPhoto(null)
    }
  }

  const handleReaction = async (msg: Message, emoji: string) => {
    setActiveReactionMsg(null)
    if (!msg.id) return
    
    const prev = msg.reaction ?? null
    const next = prev === emoji ? null : emoji

    const apply = (r: string | null) =>
      setMessages((p) => p.map((m) => (m.id === msg.id ? { ...m, reaction: r } : m)))

    apply(next)

    try {
      const res = await tgFetch('/api/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: msg.id, reaction: next }),
      })
      if (!res.ok) throw new Error('react failed')
    } catch {
      apply(prev)
    }
  }

  const startPress = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-reaction-ui]')) return
    cancelPress()
    longPressFired.current = false
    pressOrigin.current = { x: e.clientX, y: e.clientY }
    const rect = e.currentTarget.getBoundingClientRect()
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setMenuDirection(rect.top < 150 ? 'bottom' : 'top')
      setActiveReactionMsg(i)
      navigator.vibrate?.(50)
    }, 400)
  }

  const movePress = (e: React.PointerEvent) => {
    const o = pressOrigin.current
    if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) cancelPress()
  }

  const cancelPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
    pressOrigin.current = null
  }

  const handleBannerTap = () => {
    const isFirstImage = seenImageCount === 0
    const purchasedGems = user?.purchased_gems || 0

    if (!isFirstImage && !isPremium) {
      setPremiumModalReason('image')
      setShowPremiumModal(true)
      return
    }
    if (!isFirstImage && purchasedGems < currentImageCost) {
      router.push('/shop')
      return
    }
    generateImage()
  }

  const handleLevelUpCTA = () => {
    setLevelUpModal(null)
    setTimeout(() => handleBannerTap(), 200)
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

  const submitReport = async () => {
    if (!reportReason) {
      setReportError(lang === 'es' ? 'Selecciona una razón' : 'Select a reason')
      return
    }
    if (reportSending) return

    setReportSending(true)
    setReportError(null)

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')

    try {
      const res = await tgFetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: characterId,
          message_content: lastAssistant?.content || null,
          reason: reportReason,
          details: reportDetails.trim() || null,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setReportError(data?.error || `Error HTTP ${res.status}`)
        setReportSending(false)
        return
      }

      setReportSent(true)
      setTimeout(() => {
        setShowReportModal(false)
        setReportReason(null)
        setReportDetails('')
        setReportSent(false)
      }, 2000)
    } catch (e: any) {
      setReportError(e?.message || 'Error de conexión')
    } finally {
      setReportSending(false)
    }
  }

  const openSupport = () => {
    try {
      const tg = (window as any).Telegram?.WebApp
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(SUPPORT_URL)
      } else {
        window.open(SUPPORT_URL, '_blank')
      }
    } catch {
      window.open(SUPPORT_URL, '_blank')
    }
  }

  const formatMessage = (content: string) => {
    const images: string[] = []
    
    let text = content.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_, alt, url) => {
        const idx = images.length
        const safeAlt = String(alt)
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        
        if (url.startsWith('locked:')) {
          const match = url.match(/^locked:(\d+)@(https?:\/\/.+)$/)
          if (!match) return '@@INVALID@@'
          
          const [, offerId, blurUrl] = match
          const price = currentImageCost
          
          images.push(
            `<div 
              data-locked-id="${offerId}"
              data-unlock-price="${price}"
              role="button"
              style="
                position: relative;
                width: 100%; 
                aspect-ratio: 832 / 1216; 
                border-radius: 16px; 
                margin-top: 8px; 
                overflow: hidden;
                box-shadow: 0 8px 24px rgba(168,85,247,0.3);
                cursor: pointer;
                background-image: url('${blurUrl}');
                background-size: cover;
                background-position: center;
                -webkit-touch-callout: none;
                -webkit-user-select: none;
                user-select: none;
              "
            >
              <div style="
                position: absolute; inset: 0;
                background: rgba(10, 5, 16, 0.55);
              "></div>
              
              <div style="
                position: absolute; inset: 0;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                gap: 12px;
              ">
                <div style="font-size: 48px; filter: drop-shadow(0 0 20px rgba(236,72,153,0.9)); animation: float 2s infinite ease-in-out;">🔒</div>
                <div style="
                  background: linear-gradient(135deg, #ec4899 0%, #a855f7 100%);
                  padding: 10px 20px; border-radius: 12px;
                  color: white; font-weight: 800; font-size: 15px;
                  box-shadow: 0 4px 16px rgba(236,72,153,0.6);
                  display: flex; align-items: center; gap: 8px;
                  pointer-events: none;
                ">
                  <span style="font-size: 18px;">💎</span>
                  Desbloquear por ${price}
                </div>
              </div>
            </div>`
          )
        } else {
          if (!url.match(/^https?:\/\//)) return '@@INVALID@@'
          const safeUrl = encodeURI(url).replace(/"/g, '&quot;')

          const isRecentlyUnlocked = url === recentlyUnlocked
          const animStyle = isRecentlyUnlocked ? 'animation: unlockReveal 0.8s ease-out;' : ''

          images.push(
            `<div 
              data-image-url="${safeUrl}"
              role="img" 
              aria-label="${safeAlt}" 
              style="
                width: 100%; 
                aspect-ratio: 832 / 1216; 
                background-image: url('${safeUrl}'); 
                background-size: cover; 
                background-position: center; 
                border-radius: 16px; 
                margin-top: 8px; 
                box-shadow: 0 8px 24px rgba(168,85,247,0.3);
                -webkit-touch-callout: none;
                -webkit-user-select: none;
                user-select: none;
                cursor: pointer;
                ${animStyle}
              "
            ></div>`
          )
        }
        
        return `@@IMG${idx}@@`
      }
    )

    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

    text = text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    text = text.replace(/\*([^*\n]+)\*/g, '<span class="chat-action">*$1*</span>')
    text = text.replace(/_([^_\n]+)_/g, '<em style="color:#c4b5fd;">$1</em>')

    text = text.replace(/@@IMG(\d+)@@/g, (_, idx) => images[parseInt(idx)] || '')

    return text
  }

  const handleExchange = async () => {
    if (!user || exchanging) return
    if (exchangeAmount < 2 || exchangeAmount % 2 !== 0) {
      alert(lang === 'es' ? 'Debes cambiar un número par de gemas (mínimo 2).' : 'You must exchange an even number of gems (min 2).')
      return
    }
    if (user.gems < exchangeAmount) {
      alert(lang === 'es' ? 'No tienes suficientes gemas.' : 'Not enough gems.')
      return
    }

    setExchanging(true)
    try {
      const res = await tgFetch('/api/exchange-gems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gems: exchangeAmount }),
      })
      const data = await res.json()

      if (res.ok) {
        await refresh()
        setShowExchangeModal(false)
        setExchangeAmount(2)
        setBlocked(false) // Cierra el modal de bloqueo para que pueda seguir chateando
        alert(lang === 'es' 
          ? `✅ ¡Cambio exitoso! Has recibido ${data.exchanged.messages} mensajes.` 
          : `✅ Success! You received ${data.exchanged.messages} messages.`)
      } else {
        alert(data.error || 'Error al cambiar')
      }
    } catch {
      alert('Error de conexión')
    } finally {
      setExchanging(false)
    }
  }

  const t = getTranslations(lang)
  const gems = user?.gems || 0
  const bonusGems = (user as any)?.bonus_gems || 0
  const purchasedGems = user?.purchased_gems || 0
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
  const characterDescription = getCharacterDescription(character.archetype, character.gender, lang)

  const isFirstImage = seenImageCount === 0
  const canAfford = purchasedGems >= currentImageCost || isFirstImage

  let headerBadgeText = ''
  let headerBadgeVariant: 'hook' | 'low-gems' | null = null

  if (isVip) {
    headerBadgeVariant = null
    headerBadgeText = ''
  } else if (hookRemaining > 0) {
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

  const vipMessagesLeft = isVip ? Math.max(0, VIP_DAILY_MESSAGE_LIMIT - vipMessagesToday) : 0
  const vipUsagePercent = isVip
    ? Math.min(100, (vipMessagesToday / VIP_DAILY_MESSAGE_LIMIT) * 100)
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
            <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="avatar" style={{ background: gradient, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
          {characterAvatar ? (
            <img src={characterAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 10%' }} />
          ) : (
            displayName?.[0]?.toUpperCase()
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 14, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {isVip ? (
              <span
                className="level-badge"
                style={{
                  color: '#fbbf24',
                  background: 'linear-gradient(135deg, rgba(251,191,36,0.25) 0%, rgba(217,119,6,0.2) 100%)',
                  border: '1px solid rgba(251,191,36,0.5)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                👑 VIP
              </span>
            ) : (
              <span className="level-badge" style={{ color: currentLevel.color, background: `${currentLevel.color}20` }}>
                {t[currentLevel.badgeKey as keyof typeof t]}
              </span>
            )}

            {activePass && (
              <span 
                className="level-badge" 
                style={{ 
                  color: '#000', 
                  background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                  border: '1px solid #fbbf24',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  animation: 'pulseSoft 2s ease-in-out infinite',
                }}
              >
                🎟️ {activePass.messages_limit - activePass.messages_used} msgs
              </span>
            )}

            {headerBadgeVariant === 'hook' && (
              <span className="status-badge status-badge-hook">{headerBadgeText}</span>
            )}
            {headerBadgeVariant === 'low-gems' && (
              <span className="status-badge status-badge-low">
                <span style={{ fontSize: 10 }}>💎</span>
                {headerBadgeText}
              </span>
            )}
          </div>

          {/* ✅ BARRAS DE PROGRESO: VIP Y RELACIÓN APILADAS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {isVip && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ flex: 1, height: 3, background: 'rgba(251, 191, 36, 0.15)', borderRadius: 2, overflow: 'hidden', maxWidth: 90 }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${vipUsagePercent}%`,
                      background:
                        vipUsagePercent >= 90
                          ? 'linear-gradient(90deg, #f59e0b, #dc2626)'
                          : 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
                <span style={{ fontSize: 9, color: '#fbbf24', fontWeight: 700, letterSpacing: '0.02em' }}>
                  {vipMessagesToday}/{VIP_DAILY_MESSAGE_LIMIT} VIP
                </span>
              </div>
            )}

            {showLevelProgress && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ flex: 1, height: 3, background: 'rgba(168, 85, 247, 0.15)', borderRadius: 2, overflow: 'hidden', maxWidth: 70 }}>
                  <div style={{ height: '100%', width: `${levelProgressPercent}%`, background: 'linear-gradient(90deg, #a855f7, #ec4899)', transition: 'width 0.4s ease' }} />
                </div>
                <span style={{ fontSize: 9, color: '#8b8b9e', fontWeight: 600, letterSpacing: '0.02em' }}>
                  {levelProgress.current}/{levelProgress.next} Nivel
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="menu-wrap" ref={menuRef}>
          <button className="menu-trigger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="5" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="19" r="1.6" fill="currentColor" />
            </svg>
          </button>

          {menuOpen && (
            <div className="menu-dropdown" style={{ minWidth: 220 }}>
              <button
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  setShowRename(true)
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t.renameTitle}
              </button>

              <button
                className="menu-item"
                onClick={async () => {
                  setMenuOpen(false)
                  setShowWardrobe(true)
                  try {
                    const res = await tgFetch(`/api/outfits/available?character_id=${characterId}`)
                    if (res.ok) {
                      const data = await res.json()
                      setWardrobeData({
                        inventory: data.inventory_items || [],
                        owned: data.character_owned || [],
                        equipped: data.character_equipped || null
                      })
                    }
                  } catch (e) {
                    console.error(e)
                  }
                }}
              >
                <span style={{ fontSize: 16 }}>👗</span>
                {lang === 'es' ? 'Armario / Regalos' : 'Wardrobe / Gifts'}
              </button>

              <div style={{ height: 1, background: 'rgba(168, 85, 247, 0.15)', margin: '4px 8px' }} />

              <button
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  setShowReportModal(true)
                  setReportReason(null)
                  setReportDetails('')
                  setReportError(null)
                  setReportSent(false)
                }}
                style={{ color: '#fca5a5' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {lang === 'es' ? 'Reportar' : 'Report'}
              </button>

              <div style={{ height: 1, background: 'rgba(168, 85, 247, 0.15)', margin: '4px 8px' }} />

              <button className="menu-item" onClick={() => { setMenuOpen(false); router.push('/legal/terms') }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {lang === 'es' ? 'Términos de servicio' : 'Terms of Service'}
              </button>

              <button className="menu-item" onClick={() => { setMenuOpen(false); router.push('/legal/privacy') }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {lang === 'es' ? 'Privacidad' : 'Privacy'}
              </button>

              <button className="menu-item" onClick={() => { setMenuOpen(false); openSupport() }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {lang === 'es' ? 'Soporte' : 'Support'}
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(34, 197, 94, 0.15)', padding: '5px 8px', borderRadius: 20, border: '1px solid rgba(34, 197, 94, 0.4)' }}>
            <span style={{ fontSize: 10 }}>💌</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>
              <AnimatedNumber value={bonusGems} />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', padding: '5px 10px', borderRadius: 20, border: '1px solid rgba(168,85,247,0.3)' }}>
            <span style={{ fontSize: 12 }}>💎</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              <AnimatedNumber value={gems} />
            </span>
          </div>
        </div>
      </header>

      <div 
        className="chat-messages"
        onClick={(e) => {
          if (longPressFired.current) { 
            longPressFired.current = false; 
            return 
          }
          const target = e.target as HTMLElement
          
          const lockedTarget = target.closest('[data-locked-id]')
          if (lockedTarget) {
            const lockedId = parseInt(lockedTarget.getAttribute('data-locked-id') || '0')
            const price = parseInt(lockedTarget.getAttribute('data-unlock-price') || '0')
            handleUnlockPhoto(lockedId, price)
            return
          }

          const imgTarget = target.closest('[data-image-url]')
          if (imgTarget) {
            setSelectedImage(imgTarget.getAttribute('data-image-url'))
          }
        }}
      >
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
            <div className="avatar-xl" style={{ background: gradient, margin: '0 auto 16px', overflow: 'hidden', position: 'relative' }}>
              {characterAvatar ? (
                <img src={characterAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 10%' }} />
              ) : (
                displayName?.[0]?.toUpperCase()
              )}
            </div>
            <p style={{ fontSize: 14, color: '#8b8b9e', margin: 0 }}>
              {displayName} {t.online.toLowerCase()}...
            </p>
          </div>
        )}

        {messages.map((m, i) => {
          const isUser = m.role === 'user'
          return (
            <div
              key={m.id ?? `tmp-${i}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
                marginBottom: m.reaction ? 26 : 16,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  maxWidth: '85%',
                  touchAction: 'pan-y',
                  WebkitTouchCallout: 'none',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                }}
                onPointerDown={(e) => startPress(i, e)}
                onPointerMove={movePress}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(e) => e.preventDefault()}
              >
                <div
                  className={isUser ? 'bubble-user' : 'bubble-ai'}
                  style={{ maxWidth: '100%' }}
                  dangerouslySetInnerHTML={{ __html: formatMessage(m.content) }}
                />

                {m.reaction && (
                  <button
                    data-reaction-ui
                    onClick={() => setActiveReactionMsg(activeReactionMsg === i ? null : i)}
                    style={{
                      position: 'absolute',
                      bottom: -14,
                      [isUser ? 'left' : 'right']: 8,
                      background: '#1f1733',
                      border: '1px solid rgba(168,85,247,0.5)',
                      borderRadius: 12,
                      padding: '1px 6px',
                      fontSize: 14,
                      height: 24,
                      minWidth: 26,
                      lineHeight: 1,
                      cursor: 'pointer',
                      zIndex: 5,
                    }}
                  >
                    {m.reaction}
                  </button>
                )}

                {activeReactionMsg === i && (
                  <>
                    <div
                      data-reaction-ui
                      onClick={() => setActiveReactionMsg(null)}
                      style={{ position: 'fixed', inset: 0, zIndex: 10 }}
                    />
                    <div
                      data-reaction-ui
                      style={{
                        position: 'absolute',
                        [isUser ? 'right' : 'left']: 0,
                        [menuDirection === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 8px)',
                        width: 'max-content',
                        maxWidth: 'calc(100vw - 24px)',
                        background: '#1f1733',
                        borderRadius: 28,
                        padding: '4px 6px',
                        display: 'flex',
                        gap: 2,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(168,85,247,0.3)',
                        zIndex: 20,
                      }}
                    >
                      {['❤️', '🔥', '😈', '💦', '🍆', '🍑', '🥵', '💋'].map((emoji) => (
                        <button
                          key={emoji}
                          data-reaction-ui
                          onClick={(e) => { e.stopPropagation(); handleReaction(m, emoji) }}
                          style={{
                            width: 36,
                            height: 36,
                            fontSize: 22,
                            border: 'none',
                            borderRadius: '50%',
                            cursor: 'pointer',
                            background: m.reaction === emoji ? 'rgba(236,72,153,0.3)' : 'transparent',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })}

        {loading && messages.length > 0 && (
          <div className="bubble-ai" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="chat-input-bar">
        {hasFantasyPass && (
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={useFantasyPass}
              disabled={usingFantasyPass || generatingImage}
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: 16,
                background: 'linear-gradient(135deg, #fbbf24 0%, #ec4899 100%)',
                border: '2px solid #fbbf24',
                color: '#fff',
                fontSize: 14,
                fontWeight: 900,
                cursor: usingFantasyPass ? 'wait' : 'pointer',
                boxShadow: '0 0 30px rgba(251, 191, 36, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                animation: 'pulseGlow 2s infinite',
                textShadow: '0 2px 4px rgba(0,0,0,0.4)'
              }}
            >
              <span style={{ fontSize: 20 }}>🎟️</span>
              {usingFantasyPass ? (lang === 'es' ? 'Invocando fantasía...' : 'Summoning fantasy...') : (lang === 'es' ? 'Usar Pase de Fantasía (Nivel 5)' : 'Use Fantasy Pass (Level 5)')}
            </button>
          </div>
        )}

        {photoOfferActive && !hasFantasyPass && (
          <div
            onClick={handleBannerTap}
            style={{
              position: 'relative',
              marginBottom: 12,
              borderRadius: 20,
              overflow: 'hidden',
              cursor: 'pointer',
              boxShadow: isFirstImage 
                ? '0 8px 32px rgba(34, 197, 94, 0.4)' 
                : '0 8px 32px rgba(236, 72, 153, 0.4)',
              border: isFirstImage 
                ? '1.5px solid rgba(34, 197, 94, 0.6)' 
                : '1.5px solid rgba(236, 72, 153, 0.6)',
              animation: isFirstImage || (canAfford && isPremium) 
                ? 'pulseGlow 1.8s ease-in-out infinite' 
                : 'pulseSoft 2.4s ease-in-out infinite',
            }}
          >
            <div style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url('${characterAvatar}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center 20%',
              filter: 'blur(24px) brightness(0.4)',
              transform: 'scale(1.2)',
              zIndex: 0,
            }} />

            <div style={{
              position: 'absolute',
              inset: 0,
              background: isFirstImage 
                ? 'linear-gradient(to top, rgba(10, 5, 16, 0.95), rgba(34, 197, 94, 0.2))'
                : 'linear-gradient(to top, rgba(10, 5, 16, 0.95), rgba(236, 72, 153, 0.2))',
              zIndex: 1,
            }} />

            <div style={{
              position: 'relative',
              zIndex: 2,
              padding: '20px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}>
              <div style={{
                fontSize: 42,
                filter: isFirstImage 
                  ? 'drop-shadow(0 0 16px rgba(34, 197, 94, 0.9))' 
                  : 'drop-shadow(0 0 16px rgba(236, 72, 153, 0.9))',
                animation: 'float 2s ease-in-out infinite',
              }}>
                {isFirstImage ? '🎁' : '🔒'}
              </div>

              <div style={{ textAlign: 'center' }}>
                <p style={{
                  fontSize: 18,
                  fontWeight: 900,
                  color: '#fff',
                  margin: 0,
                  textShadow: '0 2px 10px rgba(0,0,0,0.8)',
                  lineHeight: 1.2,
                }}>
                  {isFirstImage 
                    ? (lang === 'es' ? '¡Regalo de bienvenida!' : 'Welcome gift!')
                    : (lang === 'es' ? `${displayName} te envió una foto` : `${displayName} sent you a photo`)}
                </p>
                <p style={{
                  fontSize: 13,
                  color: isFirstImage ? '#86efac' : '#fbcfe8',
                  margin: '4px 0 0 0',
                  fontWeight: 600,
                  textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                }}>
                  {isFirstImage 
                    ? (lang === 'es' ? 'Reclama tu foto gratis ahora' : 'Claim your free photo now')
                    : (lang === 'es' ? 'Contenido exclusivo esperando' : 'Exclusive content waiting')}
                </p>
              </div>

              <div style={{
                marginTop: 6,
                padding: '12px 24px',
                borderRadius: 14,
                background: isFirstImage 
                  ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' 
                  : 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
                color: '#fff',
                fontSize: 15,
                fontWeight: 800,
                boxShadow: isFirstImage 
                  ? '0 4px 16px rgba(34, 197, 94, 0.5)' 
                  : '0 4px 16px rgba(236, 72, 153, 0.5)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                pointerEvents: 'none',
              }}>
                {isFirstImage ? (
                  <>{lang === 'es' ? 'Reclamar Gratis' : 'Claim Free'}</>
                ) : (
                  <>
                    <span>💎 {currentImageCost}</span>
                    <span style={{ opacity: 0.6 }}>|</span>
                    <span>{lang === 'es' ? 'Desbloquear' : 'Unlock'}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="chat-input-row">
          <button onClick={playAudio} disabled={generatingAudio || (!isVip && isPremium && purchasedGems < currentAudioCost) || isPlayingAudio} className="chat-icon-btn" title={`${t.audioTooltip} (${currentAudioCost} gemas)`} style={{ opacity: (!isVip && isPremium && purchasedGems < currentAudioCost) || isPlayingAudio ? 0.5 : 1 }}>
            {isPlayingAudio ? (
              <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 20 }}>
                <div className="audio-wave-bar" />
                <div className="audio-wave-bar" />
                <div className="audio-wave-bar" />
                <div className="audio-wave-bar" />
              </div>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M11 5 6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>

          <button onClick={handleBannerTap} disabled={generatingImage} className="chat-icon-btn" title={`${t.imageTooltip} (${currentImageCost} gemas)`} style={{ opacity: !isFirstImage && !isVip && isPremium && purchasedGems < currentImageCost ? 0.4 : 1, boxShadow: photoOfferActive ? '0 0 20px rgba(236,72,153,0.9), 0 0 30px rgba(168,85,247,0.6)' : undefined, borderColor: photoOfferActive ? '#ec4899' : undefined }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="9" cy="10" r="2" stroke="currentColor" strokeWidth="2" />
              <path d="m4 18 5-5 4 4 3-3 4 4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
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
            maxLength={750}
          />

          <button onClick={() => send()} disabled={loading || !input.trim()} className="chat-send-btn" title="Enviar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="m4 4 17 8-17 8V4z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {showWardrobe && (
        <div className="modal-backdrop" onClick={() => setShowWardrobe(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 className="modal-title" style={{ textAlign: 'center' }}>
              {lang === 'es' ? 'Armario y Regalos' : 'Wardrobe & Gifts'}
            </h3>
            <p className="modal-desc" style={{ textAlign: 'center', marginBottom: 16 }}>
              {lang === 'es' 
                ? `Viste a ${displayName} con tus outfits.` 
                : `Dress up ${displayName} with your outfits.`}
            </p>

            {wardrobeData.inventory.length === 0 && wardrobeData.owned.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#8b8b9e', fontSize: 13, padding: '20px 0' }}>
                {lang === 'es' ? 'No tienes outfits. ¡Consíguelos en la Ruleta!' : 'You have no outfits. Get them in the Roulette!'}
              </p>
            ) : (
              <>
                {wardrobeData.inventory.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <p style={{ fontSize: 12, color: '#a395c9', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase' }}>
                      🎁 Para regalar (se consume)
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {wardrobeData.inventory.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleEquipOutfit(item.item_key)}
                          disabled={equippingOutfit}
                          style={{
                            padding: 0, borderRadius: 12,
                            background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)',
                            color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            overflow: 'hidden'
                          }}
                        >
                          <div style={{ 
                            width: '100%', aspectRatio: '3/4', 
                            backgroundImage: `url('${getItemImageUrl(item.item_key)}')`, 
                            backgroundSize: 'cover', backgroundPosition: 'center' 
                          }} />
                          <div style={{ padding: 8, textAlign: 'center', width: '100%' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', display: 'block' }}>
                              {item.item_key.replace('outfit_', '').replace('_', ' ')}
                            </span>
                            <span style={{ fontSize: 9, color: '#fbbf24', fontWeight: 800, display: 'block', marginTop: 4 }}>
                              REGALAR
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {wardrobeData.owned.length > 0 && (
                  <div>
                    <p style={{ fontSize: 12, color: '#a395c9', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase' }}>
                      👗 Armario del personaje (alternar)
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {wardrobeData.owned.map((key) => (
                        <button
                          key={key}
                          onClick={() => handleEquipOutfit(key)}
                          disabled={equippingOutfit}
                          style={{
                            padding: 0, borderRadius: 12,
                            background: wardrobeData.equipped === key ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                            border: wardrobeData.equipped === key ? '2px solid #22c55e' : '1px solid rgba(255,255,255,0.1)',
                            color: wardrobeData.equipped === key ? '#22c55e' : '#fff',
                            cursor: 'pointer', fontFamily: 'inherit',
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            overflow: 'hidden'
                          }}
                        >
                          <div style={{ 
                            width: '100%', aspectRatio: '3/4', 
                            backgroundImage: `url('${getItemImageUrl(key)}')`, 
                            backgroundSize: 'cover', backgroundPosition: 'center',
                            opacity: wardrobeData.equipped === key ? 1 : 0.7
                          }} />
                          <div style={{ padding: 8, textAlign: 'center', width: '100%' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', display: 'block' }}>
                              {key.replace('outfit_', '').replace('_', ' ')}
                            </span>
                            {wardrobeData.equipped === key && (
                              <span style={{ fontSize: 9, fontWeight: 800, display: 'block', marginTop: 4 }}>
                                EQUIPADO
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            
            <button
              onClick={() => setShowWardrobe(false)}
              className="modal-btn secondary"
              style={{ width: '100%', marginTop: 20 }}
            >
              {lang === 'es' ? 'Cerrar' : 'Close'}
            </button>
          </div>
        </div>
      )}

      {levelUpModal && (
        <div className="modal-backdrop">
          <div className="modal-box level-up-modal">
            <div style={{ fontSize: 52, textAlign: 'center', marginBottom: 4, animation: 'levelUpSparkle 1.6s ease-in-out infinite', filter: 'drop-shadow(0 0 20px rgba(240,171,252,0.9))' }}>✨</div>
            <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', color: '#f0abfc', textAlign: 'center', margin: 0, textShadow: '0 0 12px rgba(236,72,153,0.6)' }}>
              {lang === 'es' ? 'HAS SUBIDO DE NIVEL' : 'LEVEL UP'}
            </p>
            <h2 className="modal-title" style={{ textAlign: 'center', fontSize: 26, marginTop: 6, marginBottom: 0, background: 'linear-gradient(135deg, #f0abfc, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              {t[levelUpModal.badgeKey as keyof typeof t]}
            </h2>
            <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)' }}>
              <p style={{ fontSize: 14, color: '#f5f0ff', margin: 0, textAlign: 'center', lineHeight: 1.55 }}>
                {lang === 'es' ? LEVEL_UP_COPY_ES[levelUpModal.level]?.(displayName) : LEVEL_UP_COPY_EN[levelUpModal.level]?.(displayName)}
              </p>
            </div>
            <div className="modal-btn-row" style={{ marginTop: 20 }}>
              <button onClick={() => setLevelUpModal(null)} className="modal-btn secondary">
                {lang === 'es' ? 'Seguir' : 'Continue'}
              </button>
              <button onClick={handleLevelUpCTA} className="modal-btn primary" style={{ background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)', boxShadow: '0 4px 24px rgba(236,72,153,0.7)' }}>
                {lang === 'es' ? '📸 Ver sorpresa' : '📸 See surprise'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVipLimitModal && (
        <div className="modal-backdrop">
          <div className="modal-box level-up-modal">
            <div style={{ fontSize: 60, textAlign: 'center', marginBottom: 8 }}>🌙</div>
            <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', color: '#fbbf24', textAlign: 'center', margin: 0 }}>
              {lang === 'es' ? 'LÍMITE DIARIO' : 'DAILY LIMIT'}
            </p>
            <h2
              className="modal-title"
              style={{
                textAlign: 'center',
                fontSize: 22,
                marginTop: 6,
                marginBottom: 0,
                background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {lang === 'es' ? 'Necesitas un descanso' : 'You need a break'}
            </h2>
            <div
              style={{
                marginTop: 20,
                padding: 16,
                borderRadius: 14,
                background: 'rgba(251, 191, 36, 0.1)',
                border: '1px solid rgba(251, 191, 36, 0.3)',
              }}
            >
              <p
                style={{
                  fontSize: 14,
                  color: '#f5f0ff',
                  margin: 0,
                  textAlign: 'center',
                  lineHeight: 1.6,
                }}
              >
                {lang === 'es'
                  ? `${displayName} y tú han hablado MUCHO hoy. Incluso lo mejor necesita un descanso. Vuelve mañana y seguirán donde lo dejaron. ✨`
                  : `You and ${displayName} have talked A LOT today. Even the best needs a break. Come back tomorrow and pick up where you left off. ✨`}
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 16,
                padding: '10px 14px',
                borderRadius: 12,
                background: 'rgba(0,0,0,0.2)',
              }}
            >
              <span style={{ fontSize: 12, color: '#a395c9' }}>
                {lang === 'es' ? 'Mensajes hoy' : 'Messages today'}
              </span>
              <span style={{ fontSize: 13, color: '#fbbf24', fontWeight: 800 }}>
                {vipMessagesToday}/{VIP_DAILY_MESSAGE_LIMIT}
              </span>
            </div>

            <button
              onClick={() => setShowVipLimitModal(false)}
              className="modal-btn primary"
              style={{
                width: '100%',
                marginTop: 20,
                background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                boxShadow: '0 4px 20px rgba(251, 191, 36, 0.5)',
              }}
            >
              {lang === 'es' ? 'Entendido' : 'Got it'}
            </button>
          </div>
        </div>
      )}

      {showPremiumModal && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px', background: 'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
              {premiumModalReason === 'audio' ? '🔊' : '📸'}
            </div>
            <h3 className="modal-title" style={{ textAlign: 'center' }}>{t.premiumFeatureTitle}</h3>
            <p className="modal-desc" style={{ textAlign: 'center', marginBottom: 20 }}>
              {premiumModalReason === 'audio' ? t.premiumAudio : t.premiumImage}
            </p>
            <div className="modal-btn-row">
              <button onClick={() => setShowPremiumModal(false)} className="modal-btn secondary">{t.close}</button>
              <button onClick={() => { setShowPremiumModal(false); router.push('/shop') }} className="modal-btn primary">
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
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t.renamePlaceholder} maxLength={30} className="modal-input" />
            <div className="modal-btn-row">
              <button onClick={() => { setShowRename(false); setNewName(displayName) }} className="modal-btn secondary">{t.close}</button>
              <button onClick={doRename} disabled={renaming || !newName.trim() || newName.trim() === displayName || gems < GEM_COSTS.rename_character} className="modal-btn primary">
                {renaming ? t.saving : `${t.save} (${GEM_COSTS.rename_character})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReportModal && (
        <div className="modal-backdrop" onClick={() => !reportSending && setShowReportModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            {reportSent ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                <h3 className="modal-title" style={{ textAlign: 'center', marginBottom: 8 }}>
                  {lang === 'es' ? 'Reporte recibido' : 'Report received'}
                </h3>
                <p className="modal-desc" style={{ textAlign: 'center', margin: 0 }}>
                  {lang === 'es'
                    ? 'Nuestro equipo lo revisará en un plazo máximo de 48 horas. Gracias por ayudarnos a mantener la comunidad segura.'
                    : 'Our team will review it within a maximum of 48 hours. Thanks for helping us keep the community safe.'}
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 28 }}>🚨</div>
                  <h3 className="modal-title" style={{ margin: 0, flex: 1 }}>
                    {lang === 'es' ? 'Reportar contenido' : 'Report content'}
                  </h3>
                </div>

                <p className="modal-desc" style={{ marginBottom: 16 }}>
                  {lang === 'es'
                    ? '¿Qué quieres reportar? Tu reporte es anónimo.'
                    : 'What do you want to report? Your report is anonymous.'}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                  {REPORT_REASONS.map((r) => {
                    const active = reportReason === r.key
                    const isUrgent = r.key === 'minor_safety'
                    return (
                      <button
                        key={r.key}
                        onClick={() => setReportReason(r.key)}
                        disabled={reportSending}
                        style={{
                          textAlign: 'left',
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: active
                            ? 'linear-gradient(135deg, rgba(236,72,153,0.25) 0%, rgba(168,85,247,0.2) 100%)'
                            : 'rgba(168, 85, 247, 0.06)',
                          border: active
                            ? '1.5px solid rgba(236,72,153,0.6)'
                            : '1.5px solid rgba(168,85,247,0.15)',
                          color: active ? '#fff' : '#c4b5fd',
                          fontSize: 13,
                          fontWeight: active ? 700 : 500,
                          cursor: reportSending ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          transition: 'all 0.15s ease',
                          opacity: reportSending ? 0.5 : 1,
                        }}
                      >
                        <span
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            border: active
                              ? '5px solid #ec4899'
                              : '1.5px solid rgba(168,85,247,0.4)',
                            flexShrink: 0,
                            transition: 'all 0.15s ease',
                          }}
                        />
                        <span style={{ flex: 1 }}>
                          {lang === 'es' ? r.es : r.en}
                        </span>
                        {isUrgent && (
                          <span style={{ fontSize: 10, color: '#fca5a5', fontWeight: 700 }}>
                            ⚠️
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                <p style={{ fontSize: 11, color: '#8b8b9e', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                  {lang === 'es' ? 'Detalles (opcional)' : 'Details (optional)'}
                </p>
                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value.slice(0, 500))}
                  placeholder={lang === 'es' ? 'Cuéntanos más sobre el problema...' : 'Tell us more about the issue...'}
                  disabled={reportSending}
                  maxLength={500}
                  className="modal-textarea"
                  style={{ marginBottom: 6 }}
                />
                <p style={{ fontSize: 10, color: '#6b6b7e', margin: '0 0 16px 0', textAlign: 'right' }}>
                  {reportDetails.length}/500
                </p>

                {reportError && (
                  <p style={{ fontSize: 12, color: '#fca5a5', margin: '0 0 12px 0', textAlign: 'center' }}>
                    ⚠️ {reportError}
                  </p>
                )}

                <div className="modal-btn-row">
                  <button onClick={() => setShowReportModal(false)} disabled={reportSending} className="modal-btn secondary">
                    {t.cancel || (lang === 'es' ? 'Cancelar' : 'Cancel')}
                  </button>
                  <button
                    onClick={submitReport}
                    disabled={reportSending || !reportReason}
                    className="modal-btn primary"
                    style={{
                      background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
                      boxShadow: reportReason ? '0 4px 20px rgba(236,72,153,0.5)' : 'none',
                    }}
                  >
                    {reportSending
                      ? (lang === 'es' ? 'Enviando...' : 'Sending...')
                      : (lang === 'es' ? 'Enviar reporte' : 'Send report')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {blocked && (
        <div className="modal-backdrop">
          <div className="modal-box danger">
            <h3 className="modal-title">{t.blockedTitle}</h3>
            {blockedMessage && (
              <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 12, padding: 16, marginBottom: 16, fontSize: 14, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: formatMessage(blockedMessage) }} />
            )}
            <p className="modal-desc">{displayName} {t.blockedDesc}</p>
            
            {/* ✅ OPCIÓN 1: COMPRAR MENSAJES */}
            <button onClick={() => router.push('/shop')} className="modal-btn primary" style={{ width: '100%', marginBottom: 8, background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', boxShadow: '0 4px 16px rgba(34, 197, 94, 0.4)' }}>
              💌 {lang === 'es' ? 'Comprar Mensajes' : 'Buy Messages'}
            </button>

            {/* ✅ OPCIÓN 2: CAMBIAR GEMAS POR MENSAJES */}
            <button onClick={() => { setShowExchangeModal(true); setBlocked(false); }} className="modal-btn primary" style={{ width: '100%', marginBottom: 8, background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)', boxShadow: '0 4px 16px rgba(236, 72, 153, 0.4)' }}>
              🔄 {lang === 'es' ? 'Cambiar Gemas por Mensajes' : 'Exchange Gems for Messages'}
            </button>

            <button onClick={() => router.push('/')} className="modal-btn secondary" style={{ width: '100%', background: 'rgba(255,255,255,0.05)', color: '#fff', marginBottom: 8 }}>
              🎁 {t.inviteFriend}
            </button>
            
            <button onClick={() => setBlocked(false)} style={{ width: '100%', background: 'transparent', border: 'none', color: '#8b8b9e', padding: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{t.close}</button>
          </div>
        </div>
      )}

      {/* ✅ MODAL DE INTERCAMBIO EN EL CHAT */}
      {showExchangeModal && (
        <div className="modal-backdrop" onClick={() => !exchanging && setShowExchangeModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>🔄</div>
            <h3 className="modal-title" style={{ textAlign: 'center', marginBottom: 4 }}>
              {lang === 'es' ? 'Cambia tus gemas' : 'Exchange your gems'}
            </h3>
            <p className="modal-desc" style={{ textAlign: 'center', marginBottom: 16 }}>
              {lang === 'es' ? 'Convierte tus Gemas de Pago en Mensajes de Chat.' : 'Convert your Paid Gems into Chat Messages.'}
            </p>

            <div style={{ background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#a395c9' }}>{lang === 'es' ? 'Tus gemas:' : 'Your gems:'}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#f5f0ff' }}>💎 {gems}</span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <p style={{ fontSize: 11, color: '#8b8b9e', margin: '0 0 4px 0' }}>{lang === 'es' ? 'Entregas' : 'You give'}</p>
                  <p style={{ fontSize: 20, fontWeight: 900, color: '#a855f7', margin: 0 }}>💎 {exchangeAmount}</p>
                </div>
                <div style={{ fontSize: 20, color: '#6b6b7e' }}>➡️</div>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <p style={{ fontSize: 11, color: '#8b8b9e', margin: '0 0 4px 0' }}>{lang === 'es' ? 'Recibes' : 'You get'}</p>
                  <p style={{ fontSize: 20, fontWeight: 900, color: '#22c55e', margin: 0 }}>💌 {Math.floor((exchangeAmount / 2) * 3)}</p>
                </div>
              </div>
            </div>

            <p style={{ fontSize: 11, color: '#a395c9', textAlign: 'center', marginBottom: 8, fontWeight: 600 }}>
              {lang === 'es' ? 'Selecciona cuántas gemas cambiar:' : 'Select how many gems to exchange:'}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
              {[2, 10, 50, 100].map((amt) => {
                const isDisabled = gems < amt
                return (
                  <button
                    key={amt}
                    onClick={() => setExchangeAmount(amt)}
                    disabled={isDisabled}
                    style={{
                      padding: '10px 0',
                      borderRadius: 10,
                      background: exchangeAmount === amt ? 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)' : 'rgba(255,255,255,0.05)',
                      border: exchangeAmount === amt ? 'none' : '1px solid rgba(255,255,255,0.1)',
                      color: isDisabled ? '#6b6b7e' : '#fff',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      opacity: isDisabled ? 0.5 : 1,
                    }}
                  >
                    {amt} 💎
                  </button>
                )
              })}
            </div>

            <div className="modal-btn-row">
              <button onClick={() => setShowExchangeModal(false)} disabled={exchanging} className="modal-btn secondary">
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button 
                onClick={handleExchange} 
                disabled={exchanging || exchangeAmount < 2 || exchangeAmount % 2 !== 0 || gems < exchangeAmount} 
                className="modal-btn primary"
                style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', boxShadow: '0 4px 16px rgba(34, 197, 94, 0.4)' }}
              >
                {exchanging 
                  ? (lang === 'es' ? 'Cambiando...' : 'Exchanging...') 
                  : (lang === 'es' ? 'Confirmar Cambio' : 'Confirm Exchange')}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedImage && (
        <div 
          className="modal-backdrop" 
          style={{ 
            zIndex: 9999, 
            padding: 0, 
            background: 'rgba(0, 0, 0, 0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out'
          }}
          onClick={() => setSelectedImage(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div style={{
            width: '100%',
            height: '100%',
            backgroundImage: `url('${selectedImage}')`,
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            position: 'relative',
            pointerEvents: 'none',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              opacity: 0.09, 
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='280' height='280' xmlns='http://www.w3.org/2000/svg'%3E%3Ctext x='50%25' y='50%25' font-size='22' font-family='sans-serif' font-weight='700' fill='%23ffffff' text-anchor='middle' dominant-baseline='middle' transform='rotate(-45 140 140)'%3ETABOO REALM%3C/text%3E%3C/svg%3E")`,
              backgroundRepeat: 'repeat',
            }} />
          </div>
        </div>
      )}

      {generatingImage && !usingFantasyPass && (
        <div 
          className="modal-backdrop" 
          style={{ 
            zIndex: 9000, 
            background: 'rgba(10, 5, 16, 0.85)', 
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16
          }}
        >
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 36,
            boxShadow: '0 0 40px rgba(236, 72, 153, 0.6)',
            animation: 'pulseGlow 1.5s ease-in-out infinite'
          }}>
            📸
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0 }}>
              {lang === 'es' ? `${displayName} está preparando la cámara...` : `${displayName} is preparing the camera...`}
            </p>
            <p style={{ color: '#a395c9', fontSize: 13, marginTop: 4 }}>
              {lang === 'es' ? 'Esto puede tardar un poco más...' : 'This may take a little longer...'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
