// app/api/tonconnect-manifest/route.ts

import { NextResponse } from 'next/server'

export async function GET() {
  // ✅ Usamos variable de entorno o fallback a Vercel
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://telegram-bot-five-beryl.vercel.app'
  
  const manifest = {
    url: appUrl,
    name: 'Taboo Realm',
    iconUrl: `${appUrl}/icon.png`,
  }

  return NextResponse.json(manifest, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
    },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
