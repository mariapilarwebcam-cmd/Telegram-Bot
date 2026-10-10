// app/api/onboarding/route.ts
// Endpoint único que procesa los 3 pasos del onboarding desde la Mini App.
// Steps: 'age' → 'gender' → 'interest' → done

import { NextResponse } from 'next/server'
import {
  ensureUser,
  setAgeVerified,
  setUserGender,
  setUserInterest,
  completeOnboarding,
} from '@/lib/db-queries'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const step = String(body?.step || '')
    const value = String(body?.value || '')

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    switch (step) {
      case 'age': {
        if (value === 'decline') {
          return NextResponse.json({ ok: true, declined: true })
        }
        if (value !== 'confirm') {
          return NextResponse.json({ error: 'Valor inválido' }, { status: 400 })
        }
        await setAgeVerified(tid)
        return NextResponse.json({ ok: true, next: 'gender' })
      }

      case 'gender': {
        if (value !== 'male' && value !== 'female') {
          return NextResponse.json({ error: 'Género inválido' }, { status: 400 })
        }
        await setUserGender(tid, value)
        return NextResponse.json({ ok: true, next: 'interest' })
      }

      case 'interest': {
        if (!['male', 'female', 'both'].includes(value)) {
          return NextResponse.json({ error: 'Interés inválido' }, { status: 400 })
        }
        await setUserInterest(tid, value)
        await completeOnboarding(tid)
        return NextResponse.json({ ok: true, next: 'done' })
      }

      default:
        return NextResponse.json({ error: 'Step inválido' }, { status: 400 })
    }
  } catch (e: any) {
    console.error('[onboarding] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}