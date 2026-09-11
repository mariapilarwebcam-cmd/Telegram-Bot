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
  const [isTelegram, setIsTelegram] = useState(false)

  useEffect(() => {
    import('@twa-dev/sdk').then((WebAppModule) => {
      const WebApp = WebAppModule.default
      WebApp.ready()
      WebApp.expand()
      
      // Marcar que estamos en Telegram
      setIsTelegram(true)
      
      const user = WebApp.initDataUnsafe?.user
      setTgUser(user)
      
      const detectedLang = getLanguage(user?.language_code)
      setLang(detectedLang)
      
      if (user && user.id) {
        loadUserData(user.id, detectedLang)
      } else {
        // Si no hay usuario pero estamos en Telegram, mostrar error
        setLoading(false)
        if (!user) {
          setError('No se pudo cargar tu usuario de Telegram')
        }
      }
    }).catch((err) => {
      console.error('Error cargando Telegram SDK:', err)
      setLoading(false)
      setError('Error al cargar Telegram')
    })
  }, [])

  const loadUserData = async (telegramId: number, language: Language) => {
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId.toString())
        .single()

      if (userError && userError.code !== 'PGRST116') {
        console.error('Error de Supabase:', userError)
        setError('Error al cargar datos')
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
        // Crear usuario nuevo
        const newUser = {
          telegram_id: telegramId.toString(),
          username: tgUser?.username || '',
          first_name: tgUser?.first_name || '',
          language: language,
          gems: 15,
          referral_code: Math.random().toString(36).substring(2, 10).toUpperCase(),
        }
        
        const { error: insertError } = await supabase
          .from('users')
          .insert(newUser)
        
        if (insertError) {
          console.error('Error creando usuario:', insertError)
        }
        
        setUser(newUser)
        setGems(15)
      }
    } catch (error: any) {
      console.error('Error:', error)
      setError('Error al cargar datos')
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

  // Si hay error pero estamos en Telegram, mostrar interfaz limitada
  if (error && isTelegram) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-4 text-white">{error}</h1>
          <p className="text-textMuted mb-6">
            Intenta reiniciar el bot con /start
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-bold"
          >
            Recargar
          </button>
        </div>
      </div>
    )
  }

  // Si no estamos en Telegram
  if (!isTelegram) {
    return (
      <div className="flex items-center justify-center h-screen bg-background p-4">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-4 text-white">
            {t.openFromTelegram}
          </h1>
          <p className="text-textMuted mb-6">
            {t.openFromTelegramDesc}
          </p>
          <div className="space-y-4">
            <a
              href="https://t.me/TabooRealmBot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-gradient-primary text-white px-8 py-4 rounded-xl font-bold text-lg"
            >
              🤖 Abrir TabooRealmBot
            </a>
          </div>
        </div>
      </div>
    )
  }

  // INTERFAZ PRINCIPAL - Estilo Candy.ai
  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      {/* Header */}
      <header className="flex justify-between items-center mb-6 sticky top-0 bg-background/95 backdrop-blur z-10 py-4">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-primary">
            Taboo Realm
          </h1>
          <p className="text-sm text-textMuted">{t.welcome}, {user?.first_name || 'User'} 👋</p>
        </div>
        <div className="flex items-center gap-2 bg-surface px-4 py-2 rounded-full border border-white/10">
          <span className="text-primary">💎</span>
          <span className="font-bold">{gems || 0}</span>
        </div>
      </header>

      {/* Personajes Destacados */}
      <section className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">{t.yourCharacters}</h2>
          <Link href="/characters" className="text-sm text-primary hover:text-primaryDark transition-colors">
            {t.viewAll} →
          </Link>
        </div>

        {characters.length === 0 ? (
          <div className="text-center py-12 bg-gradient-to-br from-surface to-surfaceHighlight rounded-2xl border border-white/10">
            <div className="text-6xl mb-4">✨</div>
            <p className="text-textMuted mb-6">{t.noCharacters}</p>
            <Link 
              href="/characters" 
              className="inline-block bg-gradient-primary text-white px-8 py-4 rounded-xl font-bold text-lg hover:opacity-90 transition-opacity"
            >
              {t.createCharacter}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {characters.slice(0, 4).map((char) => (
              <Link href={`/chat/${char.id}`} key={char.id}>
                <div className="group relative rounded-2xl overflow-hidden bg-gradient-to-br from-surface to-surfaceHighlight border border-white/10 hover:border-primary/50 transition-all duration-300 hover:scale-105">
                  <div className="aspect-[3/4] relative">
                    <div className="absolute inset-0 flex items-center justify-center text-7xl">
                      {char.gender === 'male' ? '👨' : ''}
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
                    
                    {/* Badge Activo */}
                    {char.is_active && (
                      <div className="absolute top-2 right-2 bg-primary/90 text-white text-xs px-3 py-1 rounded-full font-bold">
                        {t.active}
                      </div>
                    )}
                  </div>
                  
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="text-lg font-bold text-white mb-1">{char.character_name}</h3>
                    <p className="text-xs text-textMuted line-clamp-2">
                      {PERSONALITIES[char.archetype] || char.archetype}
                    </p>
                  </div>
                  
                  {/* Overlay hover */}
                  <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Acciones Rápidas */}
      <section className="grid grid-cols-2 gap-4">
        <Link href="/shop" className="group bg-gradient-to-br from-surface to-surfaceHighlight p-6 rounded-2xl border border-white/10 hover:border-primary/50 transition-all duration-300 hover:scale-105">
          <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">🛒</div>
          <h3 className="font-bold mb-1 text-white">{t.shop}</h3>
          <p className="text-xs text-textMuted">{t.buyGems}</p>
        </Link>
        
        <Link href="/characters" className="group bg-gradient-to-br from-surface to-surfaceHighlight p-6 rounded-2xl border border-white/10 hover:border-primary/50 transition-all duration-300 hover:scale-105">
          <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">➕</div>
          <h3 className="font-bold mb-1 text-white">{t.newCharacter}</h3>
          <p className="text-xs text-textMuted">5 </p>
        </Link>
      </section>

      {/* Info */}
      <section className="mt-8 bg-gradient-to-br from-surface/50 to-surfaceHighlight/50 p-6 rounded-2xl border border-white/10">
        <h3 className="font-bold mb-3 text-white">{t.howItWorks}</h3>
        <ul className="text-sm text-textMuted space-y-2">
          <li className="flex items-center gap-2">
            <span className="text-primary"></span>
            {t.chatCost}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-primary">📸</span>
            {t.imageCost}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-primary">🎙️</span>
            {t.audioCost}
          </li>
        </ul>
      </section>
    </div>
  )
}
