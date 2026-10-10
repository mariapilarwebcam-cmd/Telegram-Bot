"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { tgFetch } from '@/lib/telegram-fetch'
import { useUser } from '@/lib/UserContext'
import { getTranslations } from '@/lib/i18n'

type Gender = 'male' | 'female'
type Interest = 'male' | 'female' | 'both'

export default function SettingsPage() {
  const router = useRouter()
  const { user, loading: userLoading, lang, setUser, refresh } = useUser()
  const t = getTranslations(lang)

  const [gender, setGender] = useState<Gender | null>(null)
  const [interest, setInterest] = useState<Interest | null>(null)
  const [saving, setSaving] = useState<'gender' | 'interest' | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Hidrata los valores actuales
  useEffect(() => {
    if (!user) return
    if (user.gender === 'male' || user.gender === 'female') setGender(user.gender)
    if (
      user.interested_in === 'male' ||
      user.interested_in === 'female' ||
      user.interested_in === 'both'
    ) {
      setInterest(user.interested_in)
    }
  }, [user])

  // Auto-oculta el feedback "guardado"
  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(null), 2000)
    return () => clearTimeout(t)
  }, [savedAt])

  const saveField = async (step: 'gender' | 'interest', value: Gender | Interest) => {
    if (saving) return
    setSaving(step)
    setError(null)

    try {
      const res = await tgFetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, value }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`)
        setSaving(null)
        return
      }

      // Actualizar contexto local
      if (user) {
        if (step === 'gender') {
          setUser({ ...user, gender: value })
        } else {
          setUser({ ...user, interested_in: value, onboarding_complete: true })
        }
      }

      setSavedAt(Date.now())
    } catch (e: any) {
      setError(e?.message || 'Error de conexión')
    } finally {
      setSaving(null)
    }
  }

  if (userLoading && !user) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="spinner-full">
        <p style={{ color: '#8b8b9e' }}>
          {lang === 'es' ? 'Cargando tu cuenta...' : 'Loading your account...'}
        </p>
      </div>
    )
  }

  return (
    <div className="page" style={{ paddingBottom: 32 }}>
      <header className="page-header">
        <button
          onClick={() => router.back()}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="m15 18-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h1 className="page-title" style={{ flex: 1, textAlign: 'center' }}>
          {lang === 'es' ? 'Ajustes' : 'Settings'}
        </h1>
        <div style={{ width: 22 }} />
      </header>

      {savedAt && (
        <div
          style={{
            position: 'fixed',
            top: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 700,
            zIndex: 100,
            boxShadow: '0 8px 24px rgba(34, 197, 94, 0.5)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          ✓ {lang === 'es' ? 'Guardado' : 'Saved'}
        </div>
      )}

      <section style={{ padding: '24px 16px 0' }}>
        <div style={{ marginBottom: 8 }}>
          <p
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 700,
              color: '#a78bfa',
              margin: '0 0 4px 0',
            }}
          >
            {lang === 'es' ? 'Tu género' : 'Your gender'}
          </p>
          <p style={{ fontSize: 12, color: '#8b8b9e', margin: 0 }}>
            {lang === 'es'
              ? 'Los personajes adaptarán sus palabras a tu género.'
              : 'Characters will adapt their words to your gender.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            onClick={() => {
              setGender('male')
              saveField('gender', 'male')
            }}
            disabled={saving !== null}
            style={{
              flex: 1,
              padding: '18px 12px',
              borderRadius: 16,
              background:
                gender === 'male'
                  ? 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)'
                  : 'rgba(168, 85, 247, 0.08)',
              border:
                gender === 'male'
                  ? '2px solid rgba(240, 171, 252, 0.6)'
                  : '2px solid rgba(168, 85, 247, 0.2)',
              color: gender === 'male' ? '#fff' : '#a395c9',
              fontSize: 15,
              fontWeight: 700,
              cursor: saving ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              opacity: saving && saving !== 'gender' ? 0.4 : 1,
              transition: 'all 0.2s ease',
            }}
          >
            <span style={{ fontSize: 28 }}>👨</span>
            {lang === 'es' ? 'Hombre' : 'Man'}
          </button>

          <button
            onClick={() => {
              setGender('female')
              saveField('gender', 'female')
            }}
            disabled={saving !== null}
            style={{
              flex: 1,
              padding: '18px 12px',
              borderRadius: 16,
              background:
                gender === 'female'
                  ? 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)'
                  : 'rgba(168, 85, 247, 0.08)',
              border:
                gender === 'female'
                  ? '2px solid rgba(240, 171, 252, 0.6)'
                  : '2px solid rgba(168, 85, 247, 0.2)',
              color: gender === 'female' ? '#fff' : '#a395c9',
              fontSize: 15,
              fontWeight: 700,
              cursor: saving ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              opacity: saving && saving !== 'gender' ? 0.4 : 1,
              transition: 'all 0.2s ease',
            }}
          >
            <span style={{ fontSize: 28 }}>👩</span>
            {lang === 'es' ? 'Mujer' : 'Woman'}
          </button>
        </div>
      </section>

      <section style={{ padding: '32px 16px 0' }}>
        <div style={{ marginBottom: 8 }}>
          <p
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 700,
              color: '#a78bfa',
              margin: '0 0 4px 0',
            }}
          >
            {lang === 'es' ? 'Qué buscas' : 'What you look for'}
          </p>
          <p style={{ fontSize: 12, color: '#8b8b9e', margin: 0 }}>
            {lang === 'es'
              ? 'Filtra qué personajes ves por defecto en el home.'
              : 'Filters which characters you see by default on the home.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {(
            [
              { id: 'male', emoji: '👨', es: 'Hombres', en: 'Men' },
              { id: 'female', emoji: '👩', es: 'Mujeres', en: 'Women' },
              { id: 'both', emoji: '👥', es: 'Ambos', en: 'Both' },
            ] as const
          ).map((opt) => {
            const active = interest === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => {
                  setInterest(opt.id)
                  saveField('interest', opt.id)
                }}
                disabled={saving !== null}
                style={{
                  flex: 1,
                  padding: '18px 8px',
                  borderRadius: 16,
                  background: active
                    ? 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)'
                    : 'rgba(168, 85, 247, 0.08)',
                  border: active
                    ? '2px solid rgba(240, 171, 252, 0.6)'
                    : '2px solid rgba(168, 85, 247, 0.2)',
                  color: active ? '#fff' : '#a395c9',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  opacity: saving && saving !== 'interest' ? 0.4 : 1,
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ fontSize: 26 }}>{opt.emoji}</span>
                {lang === 'es' ? opt.es : opt.en}
              </button>
            )
          })}
        </div>
      </section>

      {error && (
        <p
          style={{
            padding: '0 16px',
            marginTop: 24,
            fontSize: 13,
            color: '#fecaca',
            textAlign: 'center',
          }}
        >
          ⚠️ {error}
        </p>
      )}

      <section style={{ padding: '40px 16px 0' }}>
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: 'rgba(168, 85, 247, 0.06)',
            border: '1px solid rgba(168, 85, 247, 0.15)',
          }}
        >
          <p
            style={{
              fontSize: 11,
              color: '#8b8b9e',
              margin: 0,
              lineHeight: 1.5,
              textAlign: 'center',
            }}
          >
            {lang === 'es'
              ? '💡 Los cambios se aplican al instante. Los chats existentes se mantienen.'
              : '💡 Changes apply instantly. Existing chats stay intact.'}
          </p>
        </div>
      </section>
    </div>
  )
}