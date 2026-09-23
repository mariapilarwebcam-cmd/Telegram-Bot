"use client"

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { GEM_COSTS, getDisplayName, getCharacterImageUrl } from '@/lib/constants'
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

  const [showPremiumModal, setShowPremiumModal] = useState(false)
  const [premiumModalReason, setPremiumModalReason] = useState<'audio' | 'image'>('audio')

  const [showImageModal, setShowImageModal] = useState(false)
  const [imageDescription, setImageDescription] = useState('')
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

  useEffect(() => {
    if (userLoading) return
    if (!user?.telegram_id) return

    const tid = user.telegram_id

    Promise.all([
      supabase.from('user_characters').select('*').eq('id', characterId).maybeSingle(),
      supabase.from('conversation_history').select('*').eq('telegram_id', tid).eq('character_id', characterId).order('created_at', { ascending: true }).limit(50),
      supabase.from('star_purchases').select('id').eq('telegram_id', tid).limit(1),
    ]).then(([charRes, histRes, premRes]) => {
      if (charRes.data) {
        setCharacter(charRes.data)
        setNewName(getDisplayName(charRes.data))
      }
      setMessages(histRes.data || [])
      setIsPremium(!!premRes.data && premRes.data.length > 0)
      setCharacterLoading(false)
      setHistoryLoaded(true)
    })
  }, [characterId, user?.telegram_id, userLoading])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
        const res = await fetch('/api/start-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegram_id: user.telegram_id,
            character_id: characterId,
          }),
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

  const send = async () => {
    if (!input.trim() || !user || loading) return
    const gems = user.gems || 0
    const hookRemaining = user.hook_messages_remaining || 0
    if (gems < GEM_COSTS.message && hookRemaining <= 0) {
      setBlocked(true)
      return
    }
    const text = input.trim()
    setInput('')
    setLoading(true)
    setMessages((p) => [...p, { role: 'user', content: text }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
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
        }
      } else {
        alert(data.error || 'Error')
        setMessages((p) => p.slice(0, -1))
      }
    } catch {
      alert('Error de conexión')
      setMessages((p) => p.slice(0, -1))
    } finally {
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
      const res = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
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

  const generateImage = async () => {
    if (!user || !character) return
    if (!imageDescription.trim()) return

    if (!isPremium) {
      setPremiumModalReason('image')
      setShowPremiumModal(true)
      return
    }

    if ((user.gems || 0) < currentImageCost) {
      return alert(`Necesitas ${currentImageCost} gemas`)
    }

    setGeneratingImage(true)
    setShowImageModal(false)
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
          character_id: characterId,
          description: imageDescription,
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
        setImageDescription('')
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

  const tryOpenImageModal = () => {
    if (!isPremium) {
      setPremiumModalReason('image')
      setShowPremiumModal(true)
      return
    }
    if ((user?.gems || 0) < currentImageCost) {
      alert(`Necesitas ${currentImageCost} gemas`)
      return
    }
    setShowImageModal(true)
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
      const res = await fetch('/api/rename-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
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
    return html
  }

  const t = getTranslations(lang)
  const gems = user?.gems || 0
  const hookRemaining = user?.hook_messages_remaining || 0

  const userMessageCount = messages.filter((m) => m.role === 'user').length
  const currentLevel = getLevelFromMessages(userMessageCount)
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
                objectPosition: 'center 20%',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              className="level-badge"
              style={{ color: currentLevel.color, background: `${currentLevel.color}20` }}
            >
              {t[currentLevel.badgeKey as keyof typeof t]}
            </span>
            {hookRemaining > 0 && (
              <span style={{ fontSize: 10, color: '#a78bfa' }}>
                {hookRemaining} {t.specialMoments}
              </span>
            )}
          </div>
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
                <svg width="16" height="16" viewBox="0 0 
