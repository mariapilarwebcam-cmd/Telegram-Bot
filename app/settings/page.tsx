"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { tgFetch } from '@/lib/telegram-fetch'
import { useUser } from '@/lib/UserContext'
import { getTranslations } from '@/lib/i18n'

type Gender = 'male' | 'female'
type Interest = 'male' | 'female' | 'both'

const SUPPORT_URL = 'https://t.me/TabooRealmSupport'

export default function SettingsPage() {
  const router = useRouter()
  const { user, loading: userLoading, lang, setUser } = useUser()
  const t = getTranslations(lang)

  const [gender, setGender] = useState<Gender | null>(null)
  const [interest, setInterest] = useState<Interest | null>(null)
  const [saving, setSaving] = useState<'gender' | 'interest' | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Estado del modal de eliminación
  const [showDeleteModal, setShowDeleteModal] = useState(false)

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

  const openSupport = () => {
    try {
      const tg = (window as any).Telegram?.WebApp
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(SUPPORT_URL)
      } else {
        window.open(SUPPORT_URL, '_blank')
      }
    } catch {
      window.open(SUPPORT_URL, '_blank')
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
          aria-label={lang === 'es' ? 'Volver' : 'Back'}
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

      {/* ─── Toast "Guardado" ─── */}
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

      {/* ═══════════════════════════════════════════════
          SECCIÓN 1: GÉNERO
      ═══════════════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════════════
          SECCIÓN 2: INTERÉS
      ═══════════════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════════════
          ✅ NUEVA SECCIÓN 3: LEGAL
      ═══════════════════════════════════════════════ */}
      <section style={{ padding: '40px 16px 0' }}>
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
          {lang === 'es' ? 'Legal y soporte' : 'Legal & support'}
        </p>
        <p style={{ fontSize: 12, color: '#8b8b9e', margin: '0 0 12px 0' }}>
          {lang === 'es'
            ? 'Información importante sobre el servicio.'
            : 'Important information about the service.'}
        </p>

        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(168, 85, 247, 0.15)',
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {/* Términos */}
          <button
            onClick={() => router.push('/legal/terms')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(168, 85, 247, 0.1)',
              color: '#f5f0ff',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'rgba(168, 85, 247, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                  stroke="#c4b5fd"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
                  stroke="#c4b5fd"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span style={{ flex: 1 }}>
              {lang === 'es' ? 'Términos de servicio' : 'Terms of Service'}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="m9 6 6 6-6 6"
                stroke="#6b5b8e"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* Privacidad */}
          <button
            onClick={() => router.push('/legal/privacy')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(168, 85, 247, 0.1)',
              color: '#f5f0ff',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'rgba(168, 85, 247, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
                  stroke="#c4b5fd"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span style={{ flex: 1 }}>
              {lang === 'es' ? 'Política de Privacidad' : 'Privacy Policy'}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="m9 6 6 6-6 6"
                stroke="#6b5b8e"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* Soporte */}
          <button
            onClick={openSupport}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              background: 'transparent',
              border: 'none',
              color: '#f5f0ff',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'rgba(168, 85, 247, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                  stroke="#c4b5fd"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span style={{ flex: 1 }}>
              {lang === 'es' ? 'Soporte y ayuda' : 'Support & help'}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="m9 6 6 6-6 6"
                stroke="#6b5b8e"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          ✅ NUEVA SECCIÓN 4: CUENTA
      ═══════════════════════════════════════════════ */}
      <section style={{ padding: '32px 16px 0' }}>
        <p
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 700,
            color: '#fca5a5',
            margin: '0 0 4px 0',
          }}
        >
          {lang === 'es' ? 'Cuenta' : 'Account'}
        </p>
        <p style={{ fontSize: 12, color: '#8b8b9e', margin: '0 0 12px 0' }}>
          {lang === 'es'
            ? 'Acciones permanentes sobre tu cuenta.'
            : 'Permanent actions on your account.'}
        </p>

        <button
          onClick={() => setShowDeleteModal(true)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            background: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid rgba(220, 38, 38, 0.3)',
            borderRadius: 16,
            color: '#fca5a5',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'rgba(220, 38, 38, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
                stroke="#fca5a5"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span style={{ flex: 1 }}>
            {lang === 'es' ? 'Eliminar mi cuenta y datos' : 'Delete my account and data'}
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="m9 6 6 6-6 6"
              stroke="#fca5a5"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
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

      {/* ─── Info footer ─── */}
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
              ? '💡 Los cambios de género e interés se aplican al instante. Los chats existentes se mantienen.'
              : '💡 Gender and interest changes apply instantly. Existing chats stay intact.'}
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          MODAL DE ELIMINACIÓN DE CUENTA
      ═══════════════════════════════════════════════ */}
      {showDeleteModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            className="modal-box danger"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 44 }}>⚠️</div>
            </div>
            <h3 className="modal-title" style={{ textAlign: 'center' }}>
              {lang === 'es'
                ? '¿Eliminar tu cuenta?'
                : 'Delete your account?'}
            </h3>
            <p
              className="modal-desc"
              style={{ textAlign: 'center', lineHeight: 1.55 }}
            >
              {lang === 'es'
                ? 'Esta acción es irreversible. Se eliminarán:'
                : 'This action is irreversible. Will be deleted:'}
            </p>

            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '0 0 20px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {[
                lang === 'es' ? 'Tu perfil y preferencias' : 'Your profile and preferences',
                lang === 'es' ? 'Todos los personajes creados' : 'All created characters',
                lang === 'es' ? 'Historial de conversaciones' : 'Conversation history',
                lang === 'es' ? 'Saldo de gemas restante' : 'Remaining gem balance',
                lang === 'es' ? 'Progreso de racha y referidos' : 'Streak and referral progress',
              ].map((item, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 13,
                    color: '#c4b5fd',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ color: '#fca5a5' }}>✕</span>
                  {item}
                </li>
              ))}
            </ul>

            <p
              style={{
                fontSize: 12,
                color: '#8b8b9e',
                margin: '0 0 16px 0',
                textAlign: 'center',
                lineHeight: 1.55,
              }}
            >
              {lang === 'es'
                ? 'Para completar la eliminación, contacta a soporte. La solicitud se procesará en un plazo máximo de 30 días.'
                : 'To complete deletion, contact support. The request will be processed within a maximum of 30 days.'}
            </p>

            <div className="modal-btn-row">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="modal-btn secondary"
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={() => {
                  setShowDeleteModal(false)
                  openSupport()
                }}
                className="modal-btn primary"
                style={{
                  background:
                    'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                  boxShadow: '0 4px 20px rgba(220, 38, 38, 0.5)',
                }}
              >
                {lang === 'es' ? 'Contactar soporte' : 'Contact support'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
