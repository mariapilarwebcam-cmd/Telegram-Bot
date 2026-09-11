"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ARCHETYPES_MALE, ARCHETYPES_FEMALE, PERSONALITIES } from '@/lib/constants'
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

interface PredefinedCharacter {
  archetype: string
  name: string
  gender: 'male' | 'female'
  personality: string
}

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null)
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
      
      setIsTelegram(true)
      
      const user = WebApp.initDataUnsafe?.user
      setTgUser(user)
      
      const detectedLang = getLanguage(user?.language_code)
      setLang(detectedLang)
      
      if (user && user.id) {
        loadUserData(user.id, detectedLang)
      } else {
        setLoading(false)
        setError('No se pudo cargar tu usuario')
      }
    }).catch((err) => {
      console.error('Error cargando Telegram SDK:', err)
      setLoading(false)
      setError('Error al cargar Telegram')
    })
  }, [])

  const loadUserData = async (telegramId: number, language: Language) => {
    try {
      // Obtener usuario
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId.toString())
        .single()

      if (userData) {
        setUser(userData)
        setGems(userData.gems)

        // Obtener personaje activo
        const { data: activeChar } = await supabase
          .from('user_characters')
          .select('*')
          .eq('telegram_id', telegramId.toString())
          .eq('is_active', true)
          .single()

        if (activeChar) {
          setActiveCharacter(activeChar)
        }
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
        
        await supabase.from('users').insert(newUser)
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

  if (error && isTelegram) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-4 text-white">{error}</h1>
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

  if (!isTelegram) {
    return (
      <div className="flex items-center justify-center h-screen bg-background p-4">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-4 text-white">
            Abre esta app desde Telegram
          </h1>
          <p className="text-textMuted mb-6">
            Esta es una Mini App de Telegram. Para usarla, abre tu bot en Telegram y haz clic en "Abrir App".
          </p>
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
    )
  }

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

      {/* Personaje Activo */}
      {activeCharacter ? (
        <section className="mb-8">
          <div className="bg-gradient-to-br from-primary/20 to-primary/5 p-6 rounded-2xl border border-primary/30">
            <h2 className="text-lg font-bold mb-2 text-white">✨ Tu Personaje Activo</h2>
            <div className="flex items-center gap-4">
              <div className="text-5xl">
                {activeCharacter.gender === 'male' ? '' : '👩'}
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">{activeCharacter.character_name}</h3>
                <p className="text-sm text-textMuted">{PERSONALITIES[activeCharacter.archetype]}</p>
              </div>
            </div>
            <Link
              href={`/chat/${activeCharacter.id}`}
              className="mt-4 inline-block bg-gradient-primary text-white px-6 py-3 rounded-xl font-bold"
            >
              💬 Continuar Chat
            </Link>
          </div>
        </section>
      ) : (
        <section className="mb-8">
          <div className="bg-surface p-6 rounded-2xl border border-white/10 text-center">
            <div className="text-6xl mb-4">🎭</div>
            <h2 className="text-xl font-bold mb-2 text-white">Selecciona un Personaje</h2>
            <p className="text-textMuted mb-4">Elige con quién quieres chatear</p>
            <Link
              href="/characters"
              className="inline-block bg-gradient-primary text-white px-8 py-4 rounded-xl font-bold text-lg"
            >
              Ver Personajes Disponibles
            </Link>
          </div>
        </section>
      )}

      {/* Acciones Rápidas */}
      <section className="grid grid-cols-2 gap-4">
        <Link href="/characters" className="group bg-gradient-to-br from-surface to-surfaceHighlight p-6 rounded-2xl border border-white/10 hover:border-primary/50 transition-all duration-300 hover:scale-105">
          <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">🎭</div>
          <h3 className="font-bold mb-1 text-white">Personajes</h3>
          <p className="text-xs text-textMuted">Explorar y chatear</p>
        </Link>
        
        <Link href="/shop" className="group bg-gradient-to-br from-surface to-surfaceHighlight p-6 rounded-2xl border border-white/10 hover:border-primary/50 transition-all duration-300 hover:scale-105">
          <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">🛒</div>
          <h3 className="font-bold mb-1 text-white">{t.shop}</h3>
          <p className="text-xs text-textMuted">{t.buyGems}</p>
        </Link>
      </section>

      {/* Info */}
      <section className="mt-8 bg-gradient-to-br from-surface/50 to-surfaceHighlight/50 p-6 rounded-2xl border border-white/10">
        <h3 className="font-bold mb-3 text-white">💡 ¿Cómo funciona?</h3>
        <ul className="text-sm text-textMuted space-y-2">
          <li>• Selecciona un personaje de la lista</li>
          <li>• Chatea gratis (1 mensaje = 1 gema)</li>
          <li>• Genera imágenes (10 gemas)</li>
          <li>• Recibe 15 gemas gratis al registrarte</li>
        </ul>
      </section>
    </div>
  )
}
