"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PERSONALITIES } from '@/lib/constants'
import { getTranslations, getLanguage, Language } from '@/lib/i18n'
import Link from 'next/link'

interface Character {
  id: number
  character_name: string
  archetype: string
  gender: string
  is_active: boolean
  personality: string
}

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [gems, setGems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tgUser, setTgUser] = useState<any>(null)
  const [lang, setLang] = useState<Language>('en')

  useEffect(() => {
    import('@twa-dev/sdk').then((WebAppModule) => {
      const WebApp = WebAppModule.default
      WebApp.ready()
      WebApp.expand()
      
      const user = WebApp.initDataUnsafe?.user
      setTgUser(user)
      
      const detectedLang = getLanguage(user?.language_code)
      setLang(detectedLang)
      
      if (user) {
        loadUserData(user.id, detectedLang)
      } else {
        setLoading(false)
        setError('openFromTelegram')
      }
    }).catch((err) => {
      console.error('Error cargando Telegram SDK:', err)
      setLoading(false)
      setError('Error al cargar el SDK de Telegram')
    })
  }, [])

  const loadUserData = async (telegramId: number, language: Language) => {
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId.toString())
        .single()

      if (userError) {
        setError('Error al cargar usuario')
        setLoading(false)
        return
      }

      if (userData) {
        setUser(userData)
        setGems(userData.gems)

        const { data: chars } = await supabase
          .from('user_characters')
          .select('*')
          .eq('telegram_id', telegramId.toString())
          .order('created_at', { ascending: false })

        setCharacters(chars || [])
      } else {
        await supabase.from('users').insert({
          telegram_id: telegramId.toString(),
          username: tgUser?.username || '',
          first_name: tgUser?.first_name || '',
          language: language,
          gems: 15,
          referral_code: Math.random().toString(36).substring(2, 10).toUpperCase(),
        })
        
        const { data: newUser } = await supabase
          .from('users')
          .select('*')
          .eq('telegram_id', telegramId.toString())
          .single()
        
        if (newUser) {
          setUser(newUser)
          setGems(newUser.gems)
        }
      }
    } catch (error: any) {
      setError('Error: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const t = getTranslations(lang)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-textMuted">{t.loading}</p>
        </div>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background p-4">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">️</div>
          <h1 className="text-2xl font-bold mb-4 text-white">
            {t.openFromTelegram}
          </h1>
          <p className="text-textMuted mb-6">
            {t.openFromTelegramDesc}
          </p>
          <div className="bg-surface p-4 rounded-xl border border-white/10 mb-6">
            <p className="text-sm text-textMuted mb-2">
              <strong className="text-primary">Status:</strong> {tgUser ? 'Telegram detected ✅' : t.notInTelegram}
            </p>
          </div>
          
          <div className="space-y-4">
            <a
              href="https://t.me/TabooRealmBot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-gradient-primary text-white px-8 py-4 rounded-xl font-bold text-lg hover:opacity-90 transition-opacity"
            >
              🤖 Abrir TabooRealmBot
            </a>
            
            <p className="text-xs text-textMuted">
              Luego haz clic en "Abrir App" desde el bot
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-primary">
            AI Roleplay
          </h1>
          <p className="text-sm text-textMuted">{t.welcome}, {user.first_name} 👋</p>
        </div>
        <div className="flex items-center gap-2 bg-surface px-4 py-2 rounded-full border border-white/10">
          <span className="text-primary">💎</span>
          <span className="font-bold">{gems}</span>
        </div>
      </header>

      <section className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">{t.yourCharacters}</h2>
          <Link href="/characters" className="text-sm text-primary hover:text-primaryDark transition-colors">
            {t.viewAll} →
          </Link>
        </div>

        {characters.length === 0 ? (
          <div className="text-center py-12 bg-surface rounded-2xl border border-white/5">
            <p className="text-textMuted mb-4">{t.noCharacters}</p>
            <Link href="/characters" className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-bold inline-block">
              {t.createCharacter}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {characters.slice(0, 4).map((char) => (
              <Link href={`/chat/${char.id}`} key={char.id}>
                <div className="group relative rounded-xl overflow-hidden bg-surface border border-white/5 hover:border-primary/50 transition-all">
                  <div className="aspect-[3/4] bg-surfaceHighlight relative">
                    <div className="absolute inset-0 flex items-center justify-center text-6xl">
                      {char.gender === 'male' ? '👨' : '👩'}
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <h3 className="text-lg font-bold text-white">{char.character_name}</h3>
                    {char.is_active && (
                      <span className="inline-block mt-1 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                        {t.active}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4">
        <Link href="/shop" className="bg-surface p-4 rounded-xl border border-white/5 hover:border-primary/30 transition-all">
          <div className="text-3xl mb-2">🛒</div>
          <h3 className="font-bold mb-1">{t.shop}</h3>
          <p className="text-xs text-textMuted">{t.buyGems}</p>
        </Link>
        
        <Link href="/characters" className="bg-surface p-4 rounded-xl border border-white/5 hover:border-primary/30 transition-all">
          <div className="text-3xl mb-2">➕</div>
          <h3 className="font-bold mb-1">{t.newCharacter}</h3>
          <p className="text-xs text-textMuted">5 {t.gems}</p>
        </Link>
      </section>
    </div>
  )
}
