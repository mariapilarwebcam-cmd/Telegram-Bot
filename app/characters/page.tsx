"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ARCHETYPES_MALE, ARCHETYPES_FEMALE, PERSONALITIES, GEM_COSTS } from '@/lib/constants'
import Link from 'next/link'

interface Character {
  id: number
  character_name: string
  archetype: string
  gender: string
  is_active: boolean
  personality: string
}

export default function CharactersPage() {
  const [user, setUser] = useState<any>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [gems, setGems] = useState(0)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [step, setStep] = useState<'gender' | 'archetype' | 'name'>('gender')
  const [newCharGender, setNewCharGender] = useState('')
  const [newCharArchetype, setNewCharArchetype] = useState('')
  const [newCharName, setNewCharName] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    // IMPORTACIÓN DINÁMICA: Evita el error "window is not defined"
    import('@twa-dev/sdk').then((WebAppModule) => {
      const WebApp = WebAppModule.default
      WebApp.ready()
      WebApp.expand()
      
      const tgUser = WebApp.initDataUnsafe?.user
      if (tgUser) {
        loadData(tgUser.id)
      }
    })
  }, [])

  const loadData = async (telegramId: number) => {
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

  const createCharacter = async () => {
    if (!newCharName.trim() || !user) return

    setCreating(true)

    try {
      await supabase
        .from('user_characters')
        .update({ is_active: false })
        .eq('telegram_id', user.telegram_id)

      const { data, error } = await supabase
        .from('user_characters')
        .insert({
          telegram_id: user.telegram_id,
          character_name: newCharName.trim(),
          gender: newCharGender,
          archetype: newCharArchetype,
          personality: PERSONALITIES[newCharArchetype] || '',
          is_active: true
        })
        .select()
        .single()

      if (error) throw error

      await supabase
        .from('users')
        .update({ gems: gems - GEM_COSTS.new_character })
        .eq('telegram_id', user.telegram_id)

      setGems(gems - GEM_COSTS.new_character)
      setCharacters([{ ...data, personality: PERSONALITIES[newCharArchetype] || '' }, ...characters])
      
      setShowCreateModal(false)
      setStep('gender')
      setNewCharGender('')
      setNewCharArchetype('')
      setNewCharName('')
    } catch (error: any) {
      alert('Error al crear personaje: ' + error.message)
    } finally {
      setCreating(false)
    }
  }

  const setActiveCharacter = async (charId: number) => {
    try {
      await supabase
        .from('user_characters')
        .update({ is_active: false })
        .eq('telegram_id', user.telegram_id)

      await supabase
        .from('user_characters')
        .update({ is_active: true })
        .eq('id', charId)

      setCharacters(characters.map(c => ({
        ...c,
        is_active: c.id === charId
      })))
    } catch (error) {
      alert('Error al cambiar personaje')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  const lang = (user?.language || 'es') as 'es' | 'en'
  const archetypes = newCharGender === 'male' ? ARCHETYPES_MALE[lang] : ARCHETYPES_FEMALE[lang]

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <header className="flex justify-between items-center mb-6">
        <Link href="/" className="text-textMuted hover:text-textMain">
          ← Volver
        </Link>
        <h1 className="text-xl font-bold">Personajes</h1>
        <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-full">
          <span className="text-primary">💎</span>
          <span className="font-bold text-sm">{gems}</span>
        </div>
      </header>

      <div className="space-y-3 mb-6">
        {characters.map((char) => (
          <div key={char.id} className="bg-surface p-4 rounded-xl border border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-primary flex items-center justify-center text-2xl">
                {char.gender === 'male' ? '👨' : '👩'}
              </div>
              <div>
                <h3 className="font-bold">{char.character_name}</h3>
                <p className="text-xs text-textMuted">{char.archetype}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/chat/${char.id}`} className="bg-primary/20 text-primary px-3 py-1.5 rounded-lg text-sm">
                Chatear
              </Link>
              {!char.is_active && (
                <button
                  onClick={() => setActiveCharacter(char.id)}
                  className="bg-surfaceHighlight text-textMuted px-3 py-1.5 rounded-lg text-sm"
                >
                  Activar
                </button>
              )}
            </div>
          </div>
        ))}

        {characters.length === 0 && (
          <div className="text-center py-12 bg-surface rounded-2xl border border-white/5">
            <p className="text-textMuted mb-4">No tienes personajes aún</p>
          </div>
        )}
      </div>

      <button
        onClick={() => setShowCreateModal(true)}
        disabled={gems < GEM_COSTS.new_character}
        className="w-full bg-gradient-primary text-white py-3 rounded-xl font-bold disabled:opacity-50"
      >
        ➕ Crear Nuevo Personaje ({GEM_COSTS.new_character} gemas)
      </button>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full border border-white/10">
            <h3 className="text-xl font-bold mb-4">Crear Personaje</h3>

            {step === 'gender' && (
              <>
                <p className="text-sm text-textMuted mb-4">Selecciona el género:</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => { setNewCharGender('male'); setStep('archetype') }}
                    className="bg-surfaceHighlight p-4 rounded-xl border border-white/5 hover:border-primary/50"
                  >
                    <div className="text-4xl mb-2">👨</div>
                    <p className="font-bold">Hombre</p>
                  </button>
                  <button
                    onClick={() => { setNewCharGender('female'); setStep('archetype') }}
                    className="bg-surfaceHighlight p-4 rounded-xl border border-white/5 hover:border-primary/50"
                  >
                    <div className="text-4xl mb-2">👩</div>
                    <p className="font-bold">Mujer</p>
                  </button>
                </div>
              </>
            )}

            {step === 'archetype' && (
              <>
                <p className="text-sm text-textMuted mb-4">Selecciona el arquetipo:</p>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {Object.entries(archetypes).map(([key, name]) => (
                    <button
                      key={key}
                      onClick={() => { setNewCharArchetype(key); setStep('name') }}
                      className="bg-surfaceHighlight p-3 rounded-xl border border-white/5 hover:border-primary/50 text-sm"
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setStep('gender')}
                  className="w-full mt-4 py-2 rounded-xl bg-surfaceHighlight text-textMuted"
                >
                  ← Volver
                </button>
              </>
            )}

            {step === 'name' && (
              <>
                <p className="text-sm text-textMuted mb-4">Nombre del personaje:</p>
                <input
                  type="text"
                  value={newCharName}
                  onChange={(e) => setNewCharName(e.target.value)}
                  placeholder="Ej: Valeria, Alejandro..."
                  className="w-full bg-background border border-white/10 rounded-xl p-3 mb-4 focus:outline-none focus:border-primary"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setStep('archetype')}
                    className="flex-1 py-2 rounded-xl bg-surfaceHighlight text-textMuted"
                  >
                    ← Volver
                  </button>
                  <button
                    onClick={createCharacter}
                    disabled={creating || !newCharName.trim()}
                    className="flex-1 py-2 rounded-xl bg-gradient-primary text-white font-bold disabled:opacity-50"
                  >
                    {creating ? 'Creando...' : 'Crear'}
                  </button>
                </div>
              </>
            )}

            <button
              onClick={() => { setShowCreateModal(false); setStep('gender') }}
              className="w-full mt-4 py-2 rounded-xl text-textMuted"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
