import { NextResponse } from 'next/server'

export async function GET() {
  const manifest = {
    url: 'https://telegram-bot-five-beryl.vercel.app',
    name: 'Taboo Realm',
    iconUrl: 'https://telegram-bot-five-beryl.vercel.app/icon.png',
  }

  // ✅ Devolvemos el JSON con los headers CORS habilitados
  return NextResponse.json(manifest, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
    },
  })
}

// ✅ Manejamos la petición OPTIONS (Preflight de CORS)
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