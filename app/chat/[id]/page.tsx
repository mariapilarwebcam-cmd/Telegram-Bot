"use client"

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { GEM_COSTS, getRelationshipLevel, getDisplayName } from '@/lib/constants'
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

  // Cargar personaje + historial + premium cuando ya tenemos user
  useEffect(() => {
    if (userLoading) return
    if (!user?.telegram_id) return

    const tid = user.telegram_id

    // Cargar todo en paralelo
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

  // Auto-start del personaje
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
        alert(data.error || t.errorGeneric)
        setMessages((p) => p.slice(0, -1))
      }
    } catch {
      alert(t.errorConnection)
      setMessages((p) => p.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  const playAudio = async () => {
    if (!user) return
    const last = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!last) return alert(t.noMessageToPlay)
    if ((user.gems || 0) < GEM_COSTS.audio) return alert(t.audioNeed)
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
      } else alert(data.error || t.errorGeneric)
    } catch {
      alert(t.errorConnection)
    } finally {
      setGeneratingAudio(false)
    }
  }

  const generateImage = async () => {
    if (!user || !character) return
    if (!imageDescription.trim()) return
    if (!isPremium) {
      alert(t.premiumImage)
      router.push('/shop')
      return
    }
    if ((user.gems || 0) < GEM_COSTS.image) return alert(t.imageNeed)
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
      } else alert(data.message || data.error || t.errorGeneric)
    } catch {
      alert(t.errorConnection)
    } finally {
      setGeneratingImage(false)
    }
  }

  const doRename = async () => {
    if (!newName.trim() || !user || !character) return
    if (newName.trim() === getDisplayName(character)) {
      setShowRename(false)
      return
    }
    if ((user.gems || 0) < GEM_COSTS.rename_character) return alert(t.renameNeed)
    if (!confirm(t.confirmRename)) return

    setRenaming(true)
    try {
      const newGems = (user.gems || 0) - GEM_COSTS.rename_character
      const tid = user.telegram_id

      await supabase.from('users').update({ gems: newGems }).eq('telegram_id', tid)
      await supabase.from('gem_transactions').insert({
        telegram_id: tid,
        amount: -GEM_COSTS.rename_character,
        transaction_type: 'rename_character',
        description: 'Renombrar personaje',
      })
      await supabase
        .from('user_characters')
        .update({ character_name: newName.trim() })
        .eq('id', characterId)

      setCharacter({ ...character, character_name: newName.trim() })
      setGems(newGems)
      setShowRename(false)
    } catch (e: any) {
      alert(e.message || t.errorGeneric)
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
      '<img src="$2" alt="$1" style="border-radius:14px;max-width:100%;margin-top:8px;" />'
    )
    html = html.replace(/\*([^*\n]+)\*/g, '<span class="chat-action">*$1*</span>')
    return html
  }

  const t = getTranslations(lang)
  const gems = user?.gems || 0
  const hookRemaining = user?.hook_messages_remaining || 0

  if (userLoading || characterLoading || !character) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  const gradient = getGradient(character.archetype)
  const level = getRelationshipLevel(messages.length)
  const displayName = getDisplayName(character)

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

        <div className="avatar" style={{ background: gradient }}>
          {displayName?.[0]?.toUpperCase()}
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
              style={{ color: level.color, background: `${level.color}20` }}
            >
              {t[level.key as keyof typeof t]}
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
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#a78bfa" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{gems}</span>
        </div>
      </header>

      <div className="chat-messages">
        {loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 24px' }}>
            <div
              className="avatar-xl"
              style={{ background: gradient, margin: '0 auto 16px' }}
            >
              {displayName?.[0]?.toUpperCase()}
            </div>
            <p style={{ fontSize: 14, color: '#8b8b9e', margin: 0 }}>
              {displayName} {t.online.toLowerCase()}...
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
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
        <div className="chat-input-row">
          <button
            onClick={playAudio}
            disabled={generatingAudio || gems < GEM_COSTS.audio}
            className="chat-icon-btn"
            title={t.audioTooltip}
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
            onClick={() => {
              if (!isPremium) {
                alert(t.premiumRequired)
                router.push('/shop')
                return
              }
              if (gems < GEM_COSTS.image) return alert(t.imageNeed)
              setShowImageModal(true)
            }}
            className="chat-icon-btn"
            title={t.imageTooltip}
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

          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={t.writeMessage}
            disabled={loading}
            className="chat-input"
          />

          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="chat-send-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="m4 4 17 8-17 8V4z" fill="#fff" />
            </svg>
          </button>
        </div>
      </div>

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
                  border: '1px solid rgba(255,255,255,0.06)',
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

      {showImageModal && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <h3 className="modal-title">{t.generateSelfie}</h3>
            <p className="modal-desc">{t.generateSelfieDesc}</p>
            <textarea
              value={imageDescription}
              onChange={(e) => setImageDescription(e.target.value)}
              placeholder={t.selfiePlaceholder}
              className="modal-textarea"
            />
            <div className="modal-btn-row">
              <button
                onClick={() => setShowImageModal(false)}
                className="modal-btn secondary"
              >
                {t.close}
              </button>
              <button
                onClick={generateImage}
                disabled={generatingImage || !imageDescription.trim()}
                className="modal-btn primary"
              >
                {generatingImage ? t.generating : t.generate}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
