// app/api/ton-pay/create-transfer/route.ts

import { NextResponse } from 'next/server'
import { beginCell, toNano, Address } from '@ton/core'
import { TonClient, JettonMaster } from '@ton/ton'

const USDT_MASTER_ADDRESS = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC' })

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

    const numericAmount = Number(amount)
    if (isNaN(numericAmount)) {
      return NextResponse.json({ error: 'El monto debe ser un número válido' }, { status: 400 })
    }

    // 1. Obtener la dirección de la billetera de USDT (Jetton Wallet) del usuario
    const jettonMaster = client.open(JettonMaster.create(Address.parse(USDT_MASTER_ADDRESS)))
    const userJettonWalletAddress = await jettonMaster.getWalletAddress(Address.parse(senderAddr))

    // 2. Construir el cuerpo del mensaje (Payload de transferencia USDT)
    const forwardPayload = beginCell()
      .storeUint(0, 32) // 0 indica que es un comentario de texto
      .storeStringTail(reference) // El reference para identificar el pago
      .endCell()

    // ✅ FIX CRÍTICO: USDT tiene 6 decimales en la red TON. 
    // toNano() usa 9 decimales (para TON), lo cual enviaba 1000x más USDT.
    // Usamos BigInt(numericAmount * 1_000_000) para enviar la cantidad exacta.
    const usdtAmountInUnits = BigInt(Math.round(numericAmount * 1_000_000))

    const payload = beginCell()
      .storeUint(0xf8a7ea5, 32) // Opcode para transferencia de Jetton
      .storeUint(0, 64) // query_id
      .storeCoins(usdtAmountInUnits) // ✅ Cantidad correcta en unidades mínimas (6 decimales)
      .storeAddress(Address.parse(recipientAddr)) // Destinatario
      .storeAddress(Address.parse(senderAddr)) // Dirección de respuesta (quien envía)
      .storeBit(0) // custom_payload (null)
      .storeCoins(toNano('0.05')) // forward_ton_amount (gas para el forward)
      .storeBit(1) // forward_payload (inline)
      .storeRef(forwardPayload) // El comentario
      .endCell()

    return NextResponse.json({
      // La dirección a la que se enviará el mensaje es la Jetton Wallet del usuario
      address: userJettonWalletAddress.toString({ bounceable: true, testOnly: false }),
      // ✅ Gas en TON para la transacción (0.06 TON es suficiente)
      amount: toNano('0.06').toString(), 
      payload: payload.toBoc().toString('base64'),
    })
  } catch (error: any) {
    console.error('[ton-pay] create-transfer FATAL:', error)
    return NextResponse.json(
      { error: error.message || 'Error construyendo transferencia USDT' },
      { status: 500 }
    )
  }
}
