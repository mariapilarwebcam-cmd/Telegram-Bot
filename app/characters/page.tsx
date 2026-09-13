"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ARCHETYPES_MALE, ARCHETYPES_FEMALE, PERSONALITIES, GEM_COSTS } from '@/lib/constants'
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

  // Modal para nuevo personaje
  const [showNameModal, setShowNameModal] = useState(false)
  const [pendingChar, setPendingChar] = useState<{ archetype: string; gender: 'male' | 'female'; defaultName: string } | null>(null)
  const [customName, setCustomName] = useState('')

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

  const handleCharacterClick = async (archetype: string, gender: 'male' | 'female') => {
    if (!user) return
    const tid = user.telegram_id.toString()

    try {
      const { data: existingChar } = await supabase
        .from('user_characters')
        .select('*')
        .eq('telegram_id', tid)
        .eq('archetype', archetype)
        .eq('gender', gender)
        .maybeSingle()

      if (existingChar) {
        // Ya existe: activar gratis
        await supabase
          .from('user_characters')
          .update({ is_active: false })
          .eq('telegram_id', tid)
        await supabase
          .from('user_characters')
          .update({ is_active: true })
          .eq('id', existingChar.id)
        router.push(`/chat/${existingChar.id}`)
      } else {
        // Nuevo: abrir modal
        const map = (gender === 'male' ? ARCHETYPES_MALE : ARCHETYPES_FEMALE)[lang] as Record<string, string>
        const defaultName = (map[archetype] || archetype)
          .replace(/^[^\wáéíóúñ]+\s*/i, '')
          .trim()
        setCustomName(defaultName)
        setPendingChar({ archetype, gender, defaultName })
        setShowNameModal(true)
      }
    } catch (e: any) {
      console.error(e)
    }
  }

  const confirmCreate = async () => {
    if (!pendingChar || !user) return

    if (gems < GEM_COSTS.new_character) {
      alert(`Necesitas ${GEM_COSTS.new_character} gemas para crear un personaje nuevo`)
      return
    }

    const tid = user.telegram_id.toString()
    setCreating(`${pendingChar.gender}_${pendingChar.archetype}`)

    try {
      // Cobrar
      const newGems = gems - GEM_COSTS.new_character
      await supabase.from('users').update({ gems: newGems }).eq('telegram_id', tid)
      await supabase.from('gem_transactions').insert({
        telegram_id: tid,
        amount: -GEM_COSTS.new_character,
        transaction_type: 'new_character',
        description: 'Nuevo personaje'
      })

      // Desactivar todos
      await supabase
        .from('user_characters')
        .update({ is_active: false })
        .eq('telegram_id', tid)

      // Crear
      const charName = customName.trim() || pendingChar.defaultName || 'Personaje'
      const { data, error } = await supabase
        .from('user_characters')
        .insert({
          telegram_id: tid,
          character_name: charName,
          gender: pendingChar.gender,
          archetype: pendingChar.archetype,
          personality: PERSONALITIES[pendingChar.archetype] || '',
          is_active: true
        })
        .select()
        .single()

      if (error) throw error

      setGems(newGems)
      setShowNameModal(false)
      setPendingChar(null)
      router.push(`/chat/${data.id}`)
    } catch (e: any) {
      alert('Error al crear personaje: ' + e.message)
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
          {t.back}
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
          {t.all}
        </button>
        <button
          onClick={() => setSelectedGender('male')}
          className={`flex-1 py-3 rounded-xl font-bold transition-all ${
            selectedGender === 'male'
              ? 'bg-gradient-primary text-white'
              : 'bg-surface text-textMuted border border-white/10'
          }`}
        >
          {t.masculine}
        </button>
        <button
          onClick={() => setSelectedGender('female')}
          className={`flex-1 py-3 rounded-xl font-bold transition-all ${
            selectedGender === 'female'
              ? 'bg-gradient-primary text-white'
              : 'bg-surface text-textMuted border border-white/10'
          }`}
        >
          {t.feminine}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {filteredCharacters.map((char) => (
          <button
            key={`${char.gender}_${char.archetype
