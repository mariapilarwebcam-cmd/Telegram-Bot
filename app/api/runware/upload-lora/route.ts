// app/api/runware/upload-lora/route.ts

import { NextResponse } from 'next/server'

// Ruta deshabilitada: no cargar modelos ni contactar con proveedores.
export async function GET() {
  return NextResponse.json(
    { error: 'Endpoint no disponible' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  )
}