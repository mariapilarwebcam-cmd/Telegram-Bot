"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ARCHETYPES_MALE, ARCHETYPES_FEMALE, PERSONALITIES } from '@/lib/constants'
import { getTranslations, getLanguage, Language } from '@/lib/i18n'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface PredefinedCharacter {
  archetype: string
  name: string
  gender: 'male' | 'female'
  personality: string
  icon: string
}

export default function CharactersPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [gems, setGems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lang, setLang] = useState<Language>('es')
  const [selectedGender, setSelectedGender] = useState<'all' | 'male' | 'female'>('all')
  const [creating, setCreating] = useState<string | null>(null)

  useEffect(() => {
    import('@twa-dev/sdk').then((mod) => {
      const WebApp = mod.default
      WebApp.ready()
      WebApp.expand()
      const tgUser = WebApp.initDataUnsafe?.user
      if (tgUser) {
        setLang(getLanguage(tgUser.language_code))
        loadUserData(tgUser.id)
      } else {
        setLoading(false)
      }
    })
  }, [])

  const loadUserData = async (telegramId: number) => {
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId.toString())
        .maybeSingle()

      if (userData) {
        setUser(userData)
        setGems(userData.gems || 0)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const selectCharacter = async (archetype: string, gender: 'male' | 'female') => {
    if (!user) return
    setCreating(`${gender}_${archetype}`)
    try {
      const tid = user.telegram_id.toString()

      const { data: existingChar } = await supabase
        .from('user_characters')
        .select('*')
        .eq('telegram_id', tid)
        .eq('archetype', archetype)
        .eq('gender', gender)
        .maybeSingle()

      await supabase
        .from('user_characters')
        .update({ is_active: false })
        .eq('telegram_id', tid)

      let characterId: number

      if (existingChar) {
        await supabase
          .from('user_characters')
          .update({ is_active: true })
          .eq('id', existingChar.id)
        characterId = existingChar.id
      } else {
        const map = (gender === 'male' ? ARCHETYPES_MALE : ARCHETYPES_FEMALE)[lang] as Record<string, string>
        const charName = (map[archetype] || archetype)
          .replace(/^[^\wáéíóúñ]+\s*/i, '')
          .trim()

        const { data, error } = await supabase
          .from('user_characters')
          .insert({
            telegram_id: tid,
            character_name: charName || archetype,
            gender,
            archetype,
            personality: PERSONALITIES[archetype] || '',
            is_active: true
          })
          .select()
          .single()

        if (error) throw error
        characterId = data.id
      }

      router.push(`/chat/${characterId}`)
    } catch (e: any) {
      alert('Error al seleccionar personaje: ' + e.message)
    } finally {
      setCreating(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  const t = getTranslations(lang)

  const predefinedCharacters: PredefinedCharacter[] = []
  const maleList = ARCHETYPES_MALE[lang] as Record<string, string>
  const femaleList = ARCHETYPES_FEMALE[lang] as Record<string, string>

  Object.entries(maleList).forEach(([key, name]) => {
    predefinedCharacters.push({
      archetype: key,
      name,
      gender: 'male',
      personality: PERSONALITIES[key] || '',
      icon: '👨'
    })
  })

  Object.entries(femaleList).forEach(([key, name]) => {
    predefinedCharacters.push({
      archetype: key,
      name,
      gender: 'female',
      personality: PERSONALITIES[key] || '',
      icon: '👩'
    })
  })

  const filteredCharacters = selectedGender === 'all'
    ? predefinedCharacters
    : predefinedCharacters.filter(c => c.gender === selectedGender)

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <header className="flex justify-between items-center mb-6">
        <Link href="/" className="text-textMuted hover:text-textMain">
          ← {t.back}
        </Link>
        <h1 className="text-xl font-bold">{t.characters}</h1>
        <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-full">
          <span className="text-primary">💎</span>
          <span className="font-bold text-sm">{gems}</span>
        </div>
      </header>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setSelectedGender('all')}
          className={`flex-1 py-3 rounded-xl font-bold transition-all ${
            selectedGender === 'all'
              ? 'bg-gradient-primary text-white'
              : 'bg-surface text-textMuted border border-white/10'
          }`}
        >
          Todos
        </button>
        <button
          onClick={() => setSelectedGender('male')}
          className={`flex-1 py-3 rounded-xl font-bold transition-all ${
            selectedGender === 'male'
              ? 'bg-gradient-primary text-white'
              : 'bg-surface text-textMuted border border-white/10'
          }`}
        >
          👨 Masculinos
        </button>
        <button
          onClick={() => setSelectedGender('female')}
          className={`flex-1 py-3 rounded-xl font-bold transition-all ${
            selectedGender === 'female'
              ? 'bg-gradient-primary text-white'
              : 'bg-surface text-textMuted border border-white/10'
          }`}
        >
          👩 Femeninos
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {filteredCharacters.map((char) => (
          <button
            key={`${char.gender}_${char.archetype}`}
            onClick={() => selectCharacter(char.archetype, char.gender)}
            disabled={creating !== null}
            className="group relative rounded-2xl overflow-hidden bg-gradient-to-br from-surface to-surfaceHighlight border border-white/10 hover:border-primary/50 transition-all duration-300 hover:scale-105 disabled:opacity-50 text-left"
          >
            <div className="aspect-[3/4] relative p-4">
              <div className="text-6xl mb-2">{char.icon}</div>
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-4">
              <h3 className="text-lg font-bold text-white mb-1">{char.name}</h3>
              <p className="text-xs text-textMuted line-clamp-2">{char.personality}</p>
            </div>

            {creating === `${char.gender}_${char.archetype}` && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
