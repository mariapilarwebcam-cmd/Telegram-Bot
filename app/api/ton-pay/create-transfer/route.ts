// app/api/ton-pay/create-transfer/route.ts

import { NextResponse } from 'next/server'
import { createTonPayTransfer, USDT } from '@ton-pay/api'

export async function POST(request: Request) {
  try {
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

    // ✅ Aseguramos que el monto sea un número
    const numericAmount = Number(amount)
    if (isNaN(numericAmount)) {
      return NextResponse.json({ error: 'El monto debe ser un número válido' }, { status: 400 })
    }

    // ✅ Intentamos crear la transferencia
    const transfer = await createTonPayTransfer(
      {
        amount: numericAmount,
        asset: USDT,
        recipientAddr: recipientAddr,
        senderAddr: senderAddr,
        commentToRecipient: reference,
        commentToSender: `Taboo Realm — ${numericAmount} USDT`,
      },
      { 
        chain: 'mainnet',
        // Si tienes una API Key de TON Pay, agrégala aquí. Si no, déjalo así.
        // apiKey: process.env.TON_PAY_API_KEY, 
      }
    )

    return NextResponse.json({
      message: transfer.message,
      reference: transfer.reference,
      bodyBase64Hash: transfer.bodyBase64Hash,
    })
  } catch (error: any) {
    // ✅ Logueamos el error completo para verlo en los logs de Vercel
    console.error('[ton-pay] create-transfer FATAL:', error)
    
    // ✅ Devolvemos el mensaje de error exacto de TON Pay al frontend
    return NextResponse.json(
      { error: error.message || 'Error interno de TON Pay' },
      { status: 500 }
    )
  }
}
