"use client"

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PERSONALITIES, CHARACTER_FACES, GEM_COSTS } from '@/lib/constants'

interface Message {
  id?: number
  role: 'user' | 'assistant'
  content: string
  created_at?: string
}

export default function ChatPage() {
  const { id } = useParams()
  const characterId = parseInt(id as string)
  
  const [user, setUser] = useState<any>(null)
  const [character, setCharacter] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [gems, setGems] = useState(0)
  const [showImageModal, setShowImageModal] = useState(false)
  const [imageDescription, setImageDescription] = useState('')
  const [generatingImage, setGeneratingImage] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // IMPORTACIÓN DINÁMICA: Evita el error "window is not defined"
    import('@twa-dev/sdk').then((WebAppModule) => {
      const WebApp = WebAppModule.default
      WebApp.ready()
      WebApp.expand()
      
      const tgUser = WebApp.initDataUnsafe?.user
      if (tgUser) {
        loadChatData(tgUser.id)
      }
    })
  }, [characterId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadChatData = async (telegramId: number) => {
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single()

      if (userData) {
        setUser(userData)
        setGems(userData.gems)

        const { data: charData } = await supabase
          .from('user_characters')
          .select('*')
          .eq('id', characterId)
          .single()

        if (charData) {
          setCharacter(charData)

          const { data: history } = await supabase
            .from('conversation_history')
            .select('*')
            .eq('telegram_id', telegramId)
            .eq('character_id', characterId)
            .order('created_at', { ascending: true })
            .limit(50)

          setMessages(history || [])
        }
      }
    } catch (error) {
      console.error('Error cargando chat:', error)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || !user || gems < GEM_COSTS.message) {
      if (gems < GEM_COSTS.message) {
        alert('No tienes suficientes gemas. Compra más en la tienda.')
      }
      return
    }

    const userMessage = input.trim()
    setInput('')
    setLoading(true)

    const newUserMsg: Message = { role: 'user', content: userMessage }
    setMessages(prev => [...prev, newUserMsg])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
          character_id: characterId,
          message: userMessage
        })
      })

      const data = await res.json()

      if (res.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
        setGems(data.remaining_gems)
      } else {
        alert(data.error || 'Error al enviar mensaje')
        setMessages(prev => prev.slice(0, -1))
      }
    } catch (error) {
      alert('Error de conexión')
      setMessages(prev => prev.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  const generateImage = async () => {
    if (!imageDescription.trim() || !user || gems < GEM_COSTS.image) {
      if (gems < GEM_COSTS.image) {
        alert('Necesitas 10 gemas para generar una imagen')
      }
      return
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
        alert(data.error || 'Error al generar imagen')
      }
    } catch (error) {
      alert('Error de conexión')
    } finally {
      setGeneratingImage(false)
    }
  }

  const formatMessage = (content: string) => {
    const formatted = content.replace(/\*([^*]+)\*/g, '<b>$1</b>')
    const withImages = formatted.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="rounded-lg max-w-full mt-2" />')
    return withImages
  }

  if (!user || !character) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-textMuted">Cargando chat...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between p-4 bg-surface border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center text-xl">
            {character.gender === 'male' ? '👨' : '👩'}
          </div>
          <div>
            <h2 className="font-bold">{character.character_name}</h2>
            <p className="text-xs text-textMuted">En línea</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-surfaceHighlight px-3 py-1.5 rounded-full">
          <span className="text-primary">💎</span>
          <span className="font-bold text-sm">{gems}</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-textMuted">
              Inicia la conversación con {character.character_name}
            </p>
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
            <div className="bg-surface p-3 rounded-2xl rounded-bl-none border border-white/10">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {showImageModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full border border-white/10">
            <h3 className="text-xl font-bold mb-4">📸 Generar Selfie</h3>
            <p className="text-sm text-textMuted mb-4">
              Describe cómo quieres que sea la foto (10 gemas)
            </p>
            <textarea
              value={imageDescription}
              onChange={(e) => setImageDescription(e.target.value)}
              placeholder="Ej: Sonriendo con una mirada pícara, luz tenue..."
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

      <div className="p-4 bg-surface border-t border-white/10">
        <div className="flex gap-2">
          <button
            onClick={() => setShowImageModal(true)}
            disabled={gems < GEM_COSTS.image}
            className="p-3 rounded-xl bg-surfaceHighlight text-textMuted hover:text-accent disabled:opacity-50 transition-colors"
            title="Generar imagen (10 gemas)"
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
            
          </button>
        </div>
      </div>
    </div>
  )
}
