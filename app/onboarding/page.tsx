"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { tgFetch } from '@/lib/telegram-fetch'
import { useUser } from '@/lib/UserContext'
import { getTranslations } from '@/lib/i18n'
import { Analytics } from '@/lib/posthog'                       // ✅ PostHog

type Step = 'loading' | 'age' | 'gender' | 'interest' | 'declined'

export default function OnboardingPage() {
  const router = useRouter()
  const { user, loading: userLoading, lang, setUser } = useUser()
  const t = getTranslations(lang)

  const [step, setStep] = useState<Step>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ✅ PostHog: medir tiempo del onboarding
  const [onboardingStartTime] = useState(Date.now())

  // Detecta en qué paso está el usuario al entrar
  useEffect(() => {
    if (userLoading) return
    if (!user) return

    const ageOk = user.age_verified === true || (user.age_verified as any) === 1
    const hasGender = !!user.gender
    const hasInterest = !!user.interested_in
    const onboarded =
      user.onboarding_complete === true ||
      (user.onboarding_complete as any) === 1

    if (onboarded) {
      router.replace('/')
      return
    }

    if (!ageOk) setStep('age')
    else if (!hasGender) setStep('gender')
    else if (!hasInterest) setStep('interest')
    else setStep('interest')
  }, [user, userLoading, router])

  const submit = async (stepName: 'age' | 'gender' | 'interest', value: string) => {
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      const res = await tgFetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepName, value }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`)
        setSaving(false)
        return
      }

      // Actualizar el user local para que el gate no redirija en bucle
      if (user) {
        if (stepName === 'age') {
          setUser({ ...user, age_verified: true })
          setStep('gender')
        } else if (stepName === 'gender') {
          setUser({ ...user, gender: value })
          setStep('interest')
        } else if (stepName === 'interest') {
          setUser({
            ...user,
            interested_in: value,
            onboarding_complete: true,
          })

          // ✅ PostHog: onboarding completado
          Analytics.onboardingCompleted({
            gender: user.gender || 'unknown',
            interested_in: value,
            time_seconds: Math.round((Date.now() - onboardingStartTime) / 1000),
          })

          router.replace('/')
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Error de conexión')
    } finally {
      setSaving(false)
    }
  }

  const handleDecline = () => {
    setStep('declined')
    try {
      const tg = (window as any).Telegram?.WebApp
      tg?.close?.()
    } catch {}
  }

  if (step === 'loading' || userLoading) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  const stepIndex = step === 'age' ? 1 : step === 'gender' ? 2 : 3

  return (
    <div className="onb-wrap">
      <style jsx>{`
        .onb-wrap {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          padding: 32px 20px;
          max-width: 480px;
          margin: 0 auto;
        }
        .onb-progress {
          display: flex;
          gap: 6px;
          justify-content: center;
          margin-bottom: 40px;
        }
        .onb-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(168, 85, 247, 0.25);
          transition: all 0.3s ease;
        }
        .onb-dot.active {
          background: linear-gradient(135deg, #a855f7, #ec4899);
          box-shadow: 0 0 12px rgba(236, 72, 153, 0.7);
          width: 24px;
          border-radius: 4px;
        }
        .onb-dot.done {
          background: #a855f7;
        }
        .onb-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .onb-icon {
          font-size: 64px;
          text-align: center;
          margin-bottom: 24px;
          filter: drop-shadow(0 0 24px rgba(236, 72, 153, 0.5));
        }
        .onb-title {
          font-size: 24px;
          font-weight: 800;
          text-align: center;
          margin: 0 0 12px 0;
          background: linear-gradient(135deg, #f0abfc, #a855f7);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .onb-desc {
          font-size: 15px;
          color: #c4b5fd;
          text-align: center;
          line-height: 1.55;
          margin: 0 0 32px 0;
        }
        .onb-list {
          list-style: none;
          padding: 0;
          margin: 0 0 32px 0;
          text-align: left;
        }
        .onb-list li {
          font-size: 14px;
          color: #a395c9;
          padding: 8px 0 8px 24px;
          position: relative;
        }
        .onb-list li::before {
          content: '✓';
          position: absolute;
          left: 0;
          color: #22c55e;
          font-weight: 700;
        }
        .onb-buttons {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .onb-btn {
          padding: 16px;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.2s ease;
          color: #fff;
        }
        .onb-btn.primary {
          background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
          box-shadow: 0 8px 28px rgba(236, 72, 153, 0.5);
        }
        .onb-btn.primary:disabled {
          opacity: 0.5;
          box-shadow: none;
          cursor: not-allowed;
        }
        .onb-btn.primary:active:not(:disabled) {
          transform: scale(0.98);
        }
        .onb-btn.secondary {
          background: rgba(168, 85, 247, 0.1);
          color: #a395c9;
          border: 1px solid rgba(168, 85, 247, 0.25);
        }
        .onb-btn.icon {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-size: 16px;
        }
        .onb-error {
          font-size: 13px;
          color: #fecaca;
          text-align: center;
          margin-top: 16px;
        }
      `}</style>

      {step !== 'declined' && (
        <div className="onb-progress">
          <div className={`onb-dot ${stepIndex >= 1 ? 'active' : ''} ${stepIndex > 1 ? 'done' : ''}`} />
          <div className={`onb-dot ${stepIndex >= 2 ? 'active' : ''} ${stepIndex > 2 ? 'done' : ''}`} />
          <div className={`onb-dot ${stepIndex >= 3 ? 'active' : ''}`} />
        </div>
      )}

      <div className="onb-content">
        {step === 'age' && (
          <>
            <div className="onb-icon">🔞</div>
            <h1 className="onb-title">
              {lang === 'es' ? 'Contenido para adultos' : 'Adult content'}
            </h1>
            <p className="onb-desc">
              {lang === 'es'
                ? 'Esta experiencia está reservada para mayores de 18 años.'
                : 'This experience is reserved for adults 18+.'}
            </p>
            <ul className="onb-list">
              <li>{lang === 'es' ? 'Tienes 18 años o más' : 'You are 18 or older'}</li>
              <li>
                {lang === 'es'
                  ? 'Cumples con las leyes de tu país'
                  : 'You comply with your country laws'}
              </li>
              <li>
                {lang === 'es'
                  ? 'Aceptas ver contenido para adultos'
                  : 'You accept viewing adult content'}
              </li>
            </ul>
            <div className="onb-buttons">
              <button
                className="onb-btn primary"
                disabled={saving}
                onClick={() => submit('age', 'confirm')}
              >
                {saving
                  ? '...'
                  : lang === 'es'
                  ? '✅ Sí, soy mayor de 18'
                  : '✅ Yes, I am 18+'}
              </button>
              <button
                className="onb-btn secondary"
                disabled={saving}
                onClick={handleDecline}
              >
                {lang === 'es' ? '❌ No, soy menor' : '❌ No, I am underage'}
              </button>
            </div>
          </>
        )}

        {step === 'gender' && (
          <>
            <div className="onb-icon">👤</div>
            <h1 className="onb-title">
              {lang === 'es' ? '¿Cuál es tu género?' : 'What is your gender?'}
            </h1>
            <p className="onb-desc">
              {lang === 'es'
                ? 'Nos ayuda a personalizar tu experiencia.'
                : 'Helps us personalize your experience.'}
            </p>
            <div className="onb-buttons">
              <button
                className="onb-btn primary icon"
                disabled={saving}
                onClick={() => submit('gender', 'male')}
              >
                👨 {lang === 'es' ? 'Hombre' : 'Man'}
              </button>
              <button
                className="onb-btn primary icon"
                disabled={saving}
                onClick={() => submit('gender', 'female')}
              >
                👩 {lang === 'es' ? 'Mujer' : 'Woman'}
              </button>
            </div>
          </>
        )}

        {step === 'interest' && (
          <>
            <div className="onb-icon">💫</div>
            <h1 className="onb-title">
              {lang === 'es' ? '¿Qué buscas?' : 'What are you looking for?'}
            </h1>
            <p className="onb-desc">
              {lang === 'es'
                ? 'Filtraremos los personajes según tu preferencia.'
                : "We'll filter characters based on your preference."}
            </p>
            <div className="onb-buttons">
              <button
                className="onb-btn primary icon"
                disabled={saving}
                onClick={() => submit('interest', 'male')}
              >
                👨 {lang === 'es' ? 'Hombres' : 'Men'}
              </button>
              <button
                className="onb-btn primary icon"
                disabled={saving}
                onClick={() => submit('interest', 'female')}
              >
                👩 {lang === 'es' ? 'Mujeres' : 'Women'}
              </button>
              <button
                className="onb-btn primary icon"
                disabled={saving}
                onClick={() => submit('interest', 'both')}
              >
                👥 {lang === 'es' ? 'Ambos' : 'Both'}
              </button>
            </div>
          </>
        )}

        {step === 'declined' && (
          <>
            <div className="onb-icon">👋</div>
            <h1 className="onb-title">
              {lang === 'es' ? 'Hasta pronto' : 'See you soon'}
            </h1>
            <p className="onb-desc">
              {lang === 'es'
                ? 'Esta experiencia es solo para mayores de 18 años. Vuelve cuando cumplas la mayoría de edad.'
                : 'This experience is only for users 18 and older. Come back when you are of legal age.'}
            </p>
          </>
        )}

        {error && <p className="onb-error">⚠️ {error}</p>}
      </div>
    </div>
  )
}
