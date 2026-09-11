"use client"

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { GEM_COSTS, HOOK_MODE_MESSAGES } from '@/lib/constants'

interface Message {
  id?: number
  role: 'user' | 'assistant'
  content: string
  created_at?: string
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

  const [showImageModal, setShowImageModal] = useState(false)
  const [imageDescription, setImageDescription] = useState('')
  const [generatingImage, setGeneratingImage] = useState(false)
  const [generatingAudio, setGeneratingAudio] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    import('@twa-dev/sdk').then((mod) => {
      const WebApp = mod.default
      WebApp.ready()
      WebApp.expand()
      const tgUser = WebApp.initDataUnsafe?.user
      if (tgUser) loadChatData(tgUser.id)
    })
  }, [characterId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadChatData = async (telegramId: number) => {
    const tid = telegramId.toString()
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', tid)
        .maybeSingle()

      if (!userData) return

      setUser(userData)
      setGems(userData.gems || 0)
      setHookRemaining(userData.hook_messages_remaining || 0)

      const { data: purchases } = await supabase
        .from('star_purchases')
        .select('id')
        .eq('telegram_id', tid)
        .limit(1)
      setIsPremium(!!purchases && purchases.length > 0)

      const { data: charData } = await supabase
        .from('user_characters')
        .select('*')
        .eq('id', characterId)
        .maybeSingle()
      if (charData) setCharacter(charData)

      const { data: history } = await supabase
        .from('conversation_history')
        .select('*')
        .eq('telegram_id', tid)
        .eq('character_id', characterId)
        .order('created_at', { ascending: true })
        .limit(50)

      setMessages(history || [])
    } catch (e) {
      console.error(e)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || !user || loading) return
    if (gems < GEM_COSTS.message && hookRemaining <= 0) {
      setBlocked(true)
      return
    }

    const userMessage = input.trim()
    setInput('')
    setLoading(true)
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id.toString(),
          character_id: characterId,
          message: userMessage
        })
      })
      const data = await res.json()

      if (res.ok) {
        if (data.blocked) {
          setBlocked(true)
          setMessages(prev => prev.slice(0, -1))
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
          setGems(data.remaining_gems)
          setHookRemaining(data.hook_messages_remaining ?? 0)
        }
      } else {
        alert(data.error || 'Error')
        setMessages(prev => prev.slice(0, -1))
      }
    } catch {
      alert('Error de conexión')
      setMessages(prev => prev.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  const playAudio = async () => {
    const last = [...messages].reverse().find(m => m.role === 'assistant')
    if (!last) return alert('No hay mensaje para reproducir')
    if (gems < GEM_COSTS.audio) return alert('Necesitas 5 gemas')

    setGeneratingAudio(true)
    try {
      const res = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id.toString(),
          character_id: characterId,
          text: last.content
        })
      })
      const data = await res.json()
      if (res.ok) {
        setGems(data.remaining_gems)
        new Audio(`data:audio/wav;base64,${data.audio}`).play()
      } else {
        alert(data.error || 'Error')
      }
    } catch {
      alert('Error de conexión')
    } finally {
      setGeneratingAudio(false)
    }
  }

  const generateImage = async () => {
    if (!imageDescription.trim()) return
    if (!isPremium) {
      alert('La generación de imágenes es Premium. Compra Stars en la Tienda.')
      router.push('/shop')
      return
    }
    if (gems < GEM_COSTS.image) return alert('Necesitas 10 gemas')

    setGeneratingImage(true)
    setShowImageModal(false)

    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id.toString(),
          character_id: characterId,
          description: imageDescription
        })
      })
      const data = await res.json()
      if (res.ok) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `📸 *${character.character_name} te envía una foto*\n\n![Selfie](${data.image_url})`
        }])
        setGems(data.remaining_gems)
        setImageDescription('')
      } else {
        alert(data.message || data.error || 'Error')
      }
    } catch {
      alert('Error de conexión')
    } finally {
      setGeneratingImage(false)
    }
  }

  const formatMessage = (content: string) => {
    const formatted = content.replace(/\*([^*]+)\*/g, '<b>$1</b>')
    return formatted.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" class="rounded-lg max-w-full mt-2" />'
    )
  }

  if (!user || !character) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between p-4 bg-surface border-b border-white/10">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/')} className="text-textMuted text-xl">←</button>
          <div className="w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center text-xl">
            {character.gender === 'male' ? '👨' : '👩'}
          </div>
          <div>
            <h2 className="font-bold">{character.character_name}</h2>
            <p className="text-xs text-textMuted">
              {hookRemaining > 0
                ? `✨ ${hookRemaining} momentos especiales`
                : 'En línea'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-surfaceHighlight px-3 py-1.5 rounded-full">
          <span className="text-primary">💎</span>
          <span className="font-bold text-sm">{gems}</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12 text-textMuted">
            Inicia la conversación con {character.character_name}
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-br-none'
                  : 'bg-surface border border-white/10 rounded-bl-none'
              }`}
              dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
            />
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface p-3 rounded-2xl border border-white/10">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* MODAL BLOQUEADO */}
      {blocked && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full border border-primary/40">
            <h3 className="text-xl font-bold mb-2 text-white">✨ No te vayas todavía</h3>
            <p className="text-sm text-textMuted mb-4">
              {character.character_name} tiene algo especial que mostrarte. Elige cómo continuar:
            </p>
            <button
              onClick={() => router.push('/shop')}
              className="w-full bg-gradient-primary text-white py-3 rounded-xl font-bold mb-2"
            >
              🔥 Recargar gemas y desbloquear TODO
            </button>
            <button
              onClick={() => router.push('/')}
              className="w-full bg-secondary text-white py-3 rounded-xl font-bold mb-2"
            >
              🎁 Invitar amigo (+5 gemas)
            </button>
            <button
              onClick={() => setBlocked(false)}
              className="w-full bg-surfaceHighlight text-textMuted py-2 rounded-xl text-sm"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* MODAL IMAGEN */}
      {showImageModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full border border-white/10">
            <h3 className="text-xl font-bold mb-4 text-white">📸 Generar Selfie</h3>
            <p className="text-sm text-textMuted mb-4">
              Describe cómo quieres la foto (10 gemas)
            </p>
            <textarea
              value={imageDescription}
              onChange={(e) => setImageDescription(e.target.value)}
              placeholder="Ej: Sonriendo con mirada pícara, luz tenue..."
              className="w-full bg-background border border-white/10 rounded-xl p-3 text-sm mb-4 focus:outline-none focus:border-primary h-24 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowImageModal(false)}
                className="flex-1 py-2 rounded-xl bg-surfaceHighlight text-textMuted"
              >
                Cancelar
              </button>
              <button
                onClick={generateImage}
                disabled={generatingImage || !imageDescription.trim()}
                className="flex-1 py-2 rounded-xl bg-gradient-primary text-white font-bold disabled:opacity-50"
              >
                {generatingImage ? 'Generando...' : 'Generar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INPUT BAR */}
      <div className="p-4 bg-surface border-t border-white/10">
        <div className="flex gap-2">
          <button
            onClick={playAudio}
            disabled={generatingAudio || gems < GEM_COSTS.audio}
            className="p-3 rounded-xl bg-surfaceHighlight text-textMuted disabled:opacity-50"
            title="Audio (5 gemas, EN)"
          >
            {generatingAudio ? '…' : '🔊'}
          </button>
          <button
            onClick={() => {
              if (!isPremium) {
                alert('Función Premium. Compra Stars en la Tienda.')
                router.push('/shop')
                return
              }
              if (gems < GEM_COSTS.image) return alert('Necesitas 10 gemas')
              setShowImageModal(true)
            }}
            className="p-3 rounded-xl bg-surfaceHighlight text-textMuted disabled:opacity-50"
            title="Imagen (10 gemas)"
          >
            📸
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Escribe un mensaje..."
            className="flex-1 bg-background border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary"
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="bg-gradient-primary text-white px-4 py-2 rounded-xl font-bold disabled:opacity-50"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}
