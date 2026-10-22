// app/api/ton-pay/create-transfer/route.ts

import { NextResponse } from 'next/server'
import { createTonPayTransfer, USDT } from '@ton-pay/api'

export async function POST(request: Request) {
  try {
    // 1. Validar que el usuario esté autenticado (el middleware ya inyecta este header)
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { amount, recipientAddr, reference, senderAddr } = body

    if (!amount || !recipientAddr || !reference || !senderAddr) {
      return NextResponse.json(
        { error: 'Faltan parámetros: amount, recipientAddr, reference, senderAddr' },
        { status: 400 }
      )
    }

    // 2. Crear la transferencia en el servidor
    const transfer = await createTonPayTransfer(
      {
        amount: Number(amount), // Usamos el monto legible (ej. 8.49), no amountUnits
        asset: USDT,
        recipientAddr: recipientAddr,
        senderAddr: senderAddr,
        commentToRecipient: reference,
        commentToSender: `Taboo Realm — ${amount} USDT`,
      },
      { chain: 'mainnet' }
    )

    // 3. Devolver el mensaje construido al frontend
    return NextResponse.json({
      message: transfer.message,
      reference: transfer.reference,
      bodyBase64Hash: transfer.bodyBase64Hash,
    })
  } catch (error: any) {
    console.error('[ton-pay] create-transfer error:', error)
    return NextResponse.json(
      { error: error.message || 'Error interno de TON Pay' },
      { status: 500 }
    )
  }
}