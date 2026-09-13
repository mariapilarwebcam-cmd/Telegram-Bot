"use client"

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { GEM_COSTS, getRelationshipLevel } from '@/lib/constants'
import { getTranslations, getLanguage, Language } from '@/lib/i18n'

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

  const [user, setUser] = useState<any>(null)
  const [character, setCharacter] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [gems, setGems] = useState(0)
  const [hookRemaining, setHookRemaining] = useState(0)
  const [isPremium, setIsPremium] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [blockedMessage, setBlockedMessage] = useState('')
  const [lang, setLang] = useState<Language>('es')

  const [showImageModal, setShowImageModal] = useState(false)
  const [imageDescription, setImageDescription] = useState('')
  const [generatingImage, setGeneratingImage] = useState(false)
  const [generatingAudio, setGeneratingAudio] = useState(false)

  const [showRename, setShowRename] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)

  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    import('@twa-dev/sdk').then((mod) => {
      const WebApp = mod.default
      WebApp.ready()
      WebApp.expand()
      const u = WebApp.initDataUnsafe?.user
      if (u?.id) {
        setLang(getLanguage(u.language_code))
        load(u.id)
      }
    })
  }, [characterId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const load = async (telegramId: number) => {
    const tid = telegramId.toString()
    try {
      const { data: u } = await supabase.from('users').select('*').eq('telegram_id', tid).maybeSingle()
      if (!u) return
      setUser(u)
      setGems(u.gems || 0)
      setHookRemaining(u.hook_messages_remaining || 0)

      const { data: p } = await supabase.from('star_purchases').select('id').eq('telegram_id', tid).limit(1)
      setIsPremium(!!p && p.length > 0)

      const { data: c } = await supabase.from('user_characters').select('*').eq('id', characterId).maybeSingle()
      if (c) {
        setCharacter(c)
        setNewName(c.character_name)
      }

      const { data: hist } = await supabase
        .from('conversation_history')
        .select('*')
        .eq('telegram_id', tid)
        .eq('character_id', characterId)
        .order('created_at', { ascending: true })
        .limit(50)
      setMessages(hist || [])
    } catch (e) { console.error(e) }
  }

  const send = async () => {
    if (!input.trim() || !user || loading) return
    if (gems < GEM_COSTS.message && hookRemaining <= 0) { setBlocked(true); return }
    const text = input.trim()
    setInput('')
    setLoading(true)
    setMessages(p => [...p, { role: 'user', content: text }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id.toString(),
          character_id: characterId,
          message: text,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.blocked) {
          setBlockedMessage(data.response || '')
          setBlocked(true)
          setMessages(p => p.slice(0, -1))
        } else {
          setMessages(p => [...p, { role: 'assistant', content: data.response }])
          setGems(data.remaining_gems)
          setHookRemaining(data.hook_messages_remaining ?? 0)
        }
      } else {
        alert(data.error || t.errorGeneric)
        setMessages(p => p.slice(0, -1))
      }
    } catch {
      alert(t.errorConnection)
      setMessages(p => p.slice(0, -1))
    } finally { setLoading(false) }
  }

  const playAudio = async () => {
    const last = [...messages].reverse().find(m => m.role === 'assistant')
    if (!last) return alert(t.noMessageToPlay)
    if (gems < GEM_COSTS.audio) return alert(t.audioNeed)
    setGeneratingAudio(true)
    try {
      const res = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id.toString(),
          character_id: characterId,
          text: last.content,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setGems(data.remaining_gems)
        new Audio(`data:audio/wav;base64,${data.audio}`).play()
      } else alert(data.error || t.errorGeneric)
    } catch { alert(t.errorConnection) }
    finally { setGeneratingAudio(false) }
  }

  const generateImage = async () => {
    if (!imageDescription.trim()) return
    if (!isPremium) { alert(t.premiumImage); router.push('/shop'); return }
    if (gems < GEM_COSTS.image) return alert(t.imageNeed)
    setGeneratingImage(true)
    setShowImageModal(false)
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id.toString(),
          character_id: characterId,
          description: imageDescription,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessages(p => [...p, {
          role: 'assistant',
          content: `*${character.character_name} te envía una foto* 📸\n\n![Selfie](${data.image_url})`,
        }])
        setGems(data.remaining_gems)
        setImageDescription('')
      } else alert(data.message || data.error || t.errorGeneric)
    } catch { alert(t.errorConnection) }
    finally { setGeneratingImage(false) }
  }

  const doRename = async () => {
    if (!newName.trim() || !user || !character) return
    if (newName.trim() === character.character_name) { setShowRename(false); return }
    if (gems < GEM_COSTS.rename_character) return alert(t.renameNeed)
    if (!confirm(t.confirmRename)) return

    setRenaming(true)
    try {
      const newGems = gems - GEM_COSTS.rename_character
      const tid = user.telegram_id.toString()

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
    } finally { setRenaming(false) }
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

  if (!user || !character) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-[#7c5cff] border-t-transparent animate-spin" />
      </div>
    )
  }

  const gradient = getGradient(character.archetype)
  const level = getRelationshipLevel(messages.length)

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0f]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-[#0d0d13]/95 backdrop-blur sticky top-0 z-20">
        <button onClick={() => router.push('/chats')} className="p-1 -ml-1">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="m15 18-6-6 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
          style={{ background: gradient }}
        >
          {character.character_name?.[0]?.toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{character.character_name}</p>
          <div className="flex items-center gap-1.5">
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 rounded"
              style={{ color: level.color, background: `${level.color}20` }}
            >
              {t[level.key as keyof typeof t]}
            </span>
            {hookRemaining > 0 && (
              <span className="text-[10px] text-[#a78bfa]">
                {hookRemaining} {t.specialMoments}
              </span>
            )}
          </div>
        </div>

        <button onClick={() => setShowRename(true)} className="p-1.5 rounded-full hover:bg-white/5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
              stroke="#8b8b9e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex items-center gap-1.5 bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#a78bfa" />
          </svg>
          <span className="text-xs font-semibold">{gems}</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-16 px-6">
            <div
              className="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-white text-2xl font-bold mb-4"
              style={{ background: gradient }}
            >
              {character.character_name?.[0]?.toUpperCase()}
            </div>
            <p className="text-sm text-[#8b8b9e]">
              {t.startConversation} {character.character_name}
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} fade-in`}>
            <div
              className={m.role === 'user' ? 'bubble-user' : 'bubble-ai'}
              dangerouslySetInnerHTML={{ __html: formatMessage(m.content) }}
            />
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bubble-ai flex items-center gap-1.5 py-3">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="border-t border-white/5 bg-[#0d0d13]/95 backdrop-blur px-3 py-3">
        <div className="flex items-end gap-2">
          <button
            onClick={playAudio}
            disabled={generatingAudio || gems < GEM_COSTS.audio}
            className="p-2.5 rounded-full bg-white/5 text-[#a78bfa] disabled:opacity-30 shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M11 5 6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          <button
            onClick={() => {
              if (!isPremium) { alert(t.premiumRequired); router.push('/shop'); return }
              if (gems < GEM_COSTS.image) return alert(t.imageNeed)
              setShowImageModal(true)
            }}
            className="p-2.5 rounded-full bg-white/5 text-[#a78bfa] shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="9" cy="10" r="2" stroke="currentColor" strokeWidth="2" />
              <path d="m4 18 5-5 4 4 3-3 4 4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="flex-1 relative">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder={t.writeMessage}
              disabled={loading}
              className="w-full bg-white/5 border border-white/5 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-[#7c5cff]/50"
            />
          </div>

          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="w-10 h-10 rounded-full bg-gradient-to-r from-[#7c5cff] to-[#a855f7] flex items-center justify-center disabled:opacity-30 shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="m4 4 17 8-17 8V4z" fill="#fff" />
            </svg>
          </button>
        </div>
      </div>

      {/* Rename modal */}
      {showRename && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#16161d] rounded-2xl p-6 max-w-md w-full border border-white/5">
            <h3 className="text-lg font-bold mb-1">{t.renameTitle}</h3>
            <p className="text-xs text-[#8b8b9e] mb-4">{t.renameDesc}</p>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t.renamePlaceholder}
              maxLength={30}
              className="w-full bg-black/30 border border-white/5 rounded-xl p-3 text-sm mb-4 outline-none focus:border-[#7c5cff]/50"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowRename(false); setNewName(character.character_name) }}
                className="flex-1 py-2.5 rounded-xl bg-white/5 text-[#8b8b9e]"
              >
                {t.close}
              </button>
              <button
                onClick={doRename}
                disabled={renaming || !newName.trim() || newName.trim() === character.character_name || gems < GEM_COSTS.rename_character}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#a855f7] text-white font-medium disabled:opacity-40"
              >
                {renaming ? t.saving : `${t.save} (3)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blocked modal */}
      {blocked && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50">
          <div className="bg-[#16161d] rounded-2xl p-6 max-w-md w-full border border-[#7c5cff]/30">
            <h3 className="text-lg font-bold mb-3">{t.blockedTitle}</h3>
            {blockedMessage && (
              <div
                className="bg-black/30 border border-white/5 rounded-xl p-4 mb-4 text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: formatMessage(blockedMessage) }}
              />
            )}
            <p className="text-xs text-[#8b8b9e] mb-4">
              {character.character_name} {t.blockedDesc}
            </p>
            <button
              onClick={() => router.push('/shop')}
              className="w-full bg-gradient-to-r from-[#7c5cff] to-[#a855f7] text-white py-3 rounded-xl font-medium mb-2"
            >
              {t.rechargeUnlock}
            </button>
            <button
              onClick={() => router.push('/')}
              className="w-full bg-white/5 text-white py-3 rounded-xl font-medium mb-2"
            >
              {t.inviteFriend}
            </button>
            <button onClick={() => setBlocked(false)} className="w-full text-[#8b8b9e] py-2 text-sm">
              {t.close}
            </button>
          </div>
        </div>
      )}

      {/* Image modal */}
      {showImageModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#16161d] rounded-2xl p-6 max-w-md w-full border border-white/5">
            <h3 className="text-lg font-bold mb-2">{t.generateSelfie}</h3>
            <p className="text-xs text-[#8b8b9e] mb-4">{t.generateSelfieDesc}</p>
            <textarea
              value={imageDescription}
              onChange={(e) => setImageDescription(e.target.value)}
              placeholder={t.selfiePlaceholder}
              className="w-full bg-black/30 border border-white/5 rounded-xl p-3 text-sm mb-4 outline-none focus:border-[#7c5cff]/50 h-24 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowImageModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 text-[#8b8b9e]"
              >
                {t.close}
              </button>
              <button
                onClick={generateImage}
                disabled={generatingImage || !imageDescription.trim()}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#a855f7] text-white font-medium disabled:opacity-40"
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
