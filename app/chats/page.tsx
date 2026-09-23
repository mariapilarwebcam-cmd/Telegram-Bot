"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getTranslations } from '@/lib/i18n'
import { getRelationshipLevel, getDisplayName, getCharacterImageUrl } from '@/lib/constants'
import { useUser } from '@/lib/UserContext'

interface ChatRow {
  id: number
  character_name: string
  archetype: string
  gender: string
  lastMessage?: string
  lastAt?: string
  messageCount: number
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

export default function ChatsPage() {
  const router = useRouter()
  const { user, loading: userLoading, lang } = useUser()
  const [chats, setChats] = useState<ChatRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userLoading) return
    if (!user?.telegram_id) {
      setLoading(false)
      return
    }
    loadChats(user.telegram_id)
  }, [user?.telegram_id, userLoading])

  const loadChats = async (tid: string) => {
    try {
      const { data: chars } = await supabase
        .from('user_characters')
        .select('id, character_name, archetype, gender')
        .eq('telegram_id', tid)

      if (!chars || chars.length === 0) {
        setChats([])
        setLoading(false)
        return
      }

      const { data: history } = await supabase
        .from('conversation_history')
        .select('character_id, content, created_at')
        .eq('telegram_id', tid)
        .order('created_at', { ascending: false })

      const byChar: Record<number, { lastMessage: string; lastAt: string; count: number }> = {}
      for (const h of history || []) {
        if (!byChar[h.character_id]) {
          byChar[h.character_id] = {
            lastMessage: h.content,
            lastAt: h.created_at,
            count: 0,
          }
        }
        byChar[h.character_id].count++
      }

      const rows: ChatRow[] = chars.map((c) => ({
        id: c.id,
        character_name: getDisplayName(c),
        archetype: c.archetype,
        gender: c.gender,
        lastMessage: byChar[c.id]?.lastMessage,
        lastAt: byChar[c.id]?.lastAt,
        messageCount: byChar[c.id]?.count || 0,
      }))

      rows.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''))
      setChats(rows)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const t = getTranslations(lang)

  const formatTime = (iso?: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 3600000
    if (diff < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (diff < 48) return t.yesterday
    return `${Math.floor(diff / 24)} ${t.daysAgo}`
  }

  const cleanPreview = (txt?: string) => {
    if (!txt) return ''
    return txt
      .replace(/\*[^*]*\*/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .trim()
      .slice(0, 60)
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t.chats}</h1>
      </header>

      {loading ? (
        <div className="spinner-wrap">
          <div className="spinner" />
        </div>
      ) : chats.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" />
          <p className="empty-title">{t.noChatsYet}</p>
          <p className="empty-desc">{t.noChatsDesc}</p>
          <button onClick={() => router.push('/characters')} className="btn-primary">
            {t.viewCharacters}
          </button>
        </div>
      ) : (
        <div className="chat-list">
          {chats.map((c) => {
            const level = getRelationshipLevel(c.messageCount)
            const avatar = getCharacterImageUrl(c.archetype, c.gender)
            return (
              <button
                key={c.id}
                onClick={() => router.push(`/chat/${c.id}`)}
                className="chat-row"
              >
                <div
                  className="avatar-lg"
                  style={{
                    background: getGradient(c.archetype),
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {avatar ? (
                    <img
                      src={avatar}
                      alt=""
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: 'center 20%',
                      }}
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    c.character_name?.[0]?.toUpperCase()
                  )}
                </div>
                <div className="chat-row-body">
                  <div className="chat-row-top">
                    <p className="chat-row-name">{c.character_name}</p>
                    <span className="chat-row-time">{formatTime(c.lastAt)}</span>
                  </div>
                  <div className="chat-row-bottom">
                    <span
                      className="level-badge"
                      style={{ color: level.color, background: `${level.color}20` }}
                    >
                      {t[level.key as keyof typeof t]}
                    </span>
                    <p className="chat-row-preview">
                      {c.lastMessage ? cleanPreview(c.lastMessage) : t.startChat}
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
