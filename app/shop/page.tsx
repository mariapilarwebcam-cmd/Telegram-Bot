"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { STAR_PACKAGES } from '@/lib/constants'
import { getTranslations, getLanguage, Language } from '@/lib/i18n'

export default function ShopPage() {
  const [user, setUser] = useState<any>(null)
  const [gems, setGems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState<number | null>(null)
  const [lang, setLang] = useState<Language>('es')

  useEffect(() => {
    import('@twa-dev/sdk').then((mod) => {
      const WebApp = mod.default
      WebApp.ready()
      WebApp.expand()
      const u = WebApp.initDataUnsafe?.user
      if (u?.id) {
        setLang(getLanguage(u.language_code))
        load(u.id)
      } else setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const load = async (telegramId: number) => {
    try {
      const { data } = await supabase
        .from('users').select('*').eq('telegram_id', telegramId.toString()).maybeSingle()
      if (data) { setUser(data); setGems(data.gems || 0) }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const buy = async (idx: number) => {
    if (!user) return
    setPurchasing(idx)
    try {
      const res = await fetch('/api/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id.toString(),
          package_id: idx,
        }),
      })
      const data = await res.json()
      if (res.ok && data.invoice_link) {
        import('@twa-dev/sdk').then((mod) => {
          const WebApp = mod.default
          WebApp.openInvoice(data.invoice_link, async (status: string) => {
            if (status === 'paid') await load(Number(user.telegram_id))
            setPurchasing(null)
          })
        })
      } else {
        alert(data.error || t.errorGeneric)
        setPurchasing(null)
      }
    } catch {
      alert(t.errorConnection)
      setPurchasing(null)
    }
  }

  const t = getTranslations(lang)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-[#7c5cff] border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-20 bg-[#0a0a0f]/95 backdrop-blur px-4 py-4 border-b border-white/5 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t.shop}</h1>
        <div className="flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#a78bfa" />
          </svg>
          <span className="text-sm font-semibold">{gems}</span>
        </div>
      </header>

      <section className="px-4 mt-5">
        <div className="relative rounded-3xl overflow-hidden p-5 bg-gradient-to-br from-[#7c5cff] via-[#a855f7] to-[#d946ef]">
          <div className="absolute top-3 right-3 bg-white/20 backdrop-blur text-[10px] font-bold px-2 py-1 rounded-full text-white uppercase tracking-wider">
            {t.premiumBanner}
          </div>
          <h2 className="text-2xl font-black text-white mb-1">{t.premiumTitle}</h2>
          <p className="text-sm text-white/80 mb-3 max-w-[75%]">{t.premiumDesc}</p>
          <div className="flex items-center gap-2">
            <div className="bg-white/20 backdrop-blur rounded-xl px-3 py-1.5">
              <span className="text-xs font-bold text-white">70% OFF</span>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 mt-6">
        <h2 className="text-base font-semibold mb-3">{t.packages}</h2>
        <div className="space-y-2.5">
          {STAR_PACKAGES.map((pkg, idx) => {
            const finalGems = pkg.bonus > 0
              ? Math.floor(pkg.gems * (1 + pkg.bonus / 100))
              : pkg.gems
            const popular = idx === 2

            return (
              <button
                key={idx}
                onClick={() => buy(idx)}
                disabled={purchasing !== null}
                className={`w-full flex items-center gap-3 p-4 rounded-2xl border text-left transition-all ${
                  popular
                    ? 'bg-gradient-to-r from-[#7c5cff]/20 to-[#a855f7]/10 border-[#7c5cff]/40'
                    : 'bg-white/[0.03] border-white/5'
                } disabled:opacity-50`}
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#a855f7] flex items-center justify-center shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#fff" />
                  </svg>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-base">{finalGems} {t.gems}</p>
                    {popular && (
                      <span className="text-[10px] font-bold uppercase bg-[#a855f7] text-white px-1.5 py-0.5 rounded">
                        {t.popular}
                      </span>
                    )}
                    {pkg.first_time && (
                      <span className="text-[10px] font-bold uppercase bg-[#22c55e] text-white px-1.5 py-0.5 rounded">
                        {t.firstTime}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#8b8b9e] mt-0.5">
                    {pkg.bonus > 0 ? `+${pkg.bonus}% ${t.bonus}` : `${pkg.stars} Stars`}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-bold text-sm">{pkg.stars}</p>
                  <p className="text-[10px] text-[#8b8b9e] uppercase">Stars</p>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section className="px-4 mt-6">
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4">
          <h3 className="text-sm font-semibold mb-3">{t.howItWorks}</h3>
          <ul className="space-y-2 text-sm text-[#8b8b9e]">
            <li className="flex justify-between">
              <span>{t.chatCost}</span><span className="text-white font-semibold">1 {t.gems}</span>
            </li>
            <li className="flex justify-between">
              <span>{t.audioCost}</span><span className="text-white font-semibold">5 {t.gems}</span>
            </li>
            <li className="flex justify-between">
              <span>{t.imageCost}</span><span className="text-white font-semibold">10 {t.gems}</span>
            </li>
            <li className="flex justify-between">
              <span>{t.createCharCost}</span><span className="text-white font-semibold">5 {t.gems}</span>
            </li>
            <li className="flex justify-between">
              <span>{t.renameCost}</span><span className="text-white font-semibold">3 {t.gems}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  )
}
