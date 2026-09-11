"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PERSONALITIES } from '@/lib/constants'
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

  useEffect(() => {
    // IMPORTACIÓN DINÁMICA: Evita el error "window is not defined" en el servidor
    import('@twa-dev/sdk').then((WebAppModule) => {
      const WebApp = WebAppModule.default
      WebApp.ready()
      WebApp.expand()
      
      const tgUser = WebApp.initDataUnsafe?.user
      if (tgUser) {
        loadUserData(tgUser.id)
      }
    })
  }, [])

  const loadUserData = async (telegramId: number) => {
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single()

      if (userData) {
        setUser(userData)
        setGems(userData.gems)

        const { data: chars } = await supabase
          .from('user_characters')
          .select('*')
          .eq('telegram_id', telegramId)
          .order('created_at', { ascending: false })

        setCharacters(chars || [])
      }
    } catch (error) {
      console.error('Error cargando datos:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-textMuted">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">⚠️ Usuario no encontrado</h1>
          <p className="text-textMuted mb-6">
            Por favor, inicia el bot en Telegram primero con /start
          </p>
          <a
            href="https://t.me/tu_bot_username"
            className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-bold inline-block"
          >
            Abrir en Telegram
          </a>
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
          <p className="text-sm text-textMuted">Hola, {user.first_name} 👋</p>
        </div>
        <div className="flex items-center gap-2 bg-surface px-4 py-2 rounded-full border border-white/10">
          <span className="text-primary">💎</span>
          <span className="font-bold">{gems}</span>
        </div>
      </header>

      <section className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Tus Personajes</h2>
          <Link href="/characters" className="text-sm text-primary hover:text-primaryDark transition-colors">
            Ver todos →
          </Link>
        </div>

        {characters.length === 0 ? (
          <div className="text-center py-12 bg-surface rounded-2xl border border-white/5">
            <p className="text-textMuted mb-4">No tienes personajes aún</p>
            <Link href="/characters" className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-bold inline-block">
              Crear Personaje
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
                    <p className="text-xs text-textMuted">
                      {PERSONALITIES[char.archetype]?.substring(0, 30)}...
                    </p>
                    {char.is_active && (
                      <span className="inline-block mt-1 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                        Activo
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
          <h3 className="font-bold mb-1">Tienda</h3>
          <p className="text-xs text-textMuted">Comprar gemas</p>
        </Link>
        
        <Link href="/characters" className="bg-surface p-4 rounded-xl border border-white/5 hover:border-primary/30 transition-all">
          <div className="text-3xl mb-2">➕</div>
          <h3 className="font-bold mb-1">Nuevo Personaje</h3>
          <p className="text-xs text-textMuted">5 gemas</p>
        </Link>
      </section>
    </div>
  )
}
