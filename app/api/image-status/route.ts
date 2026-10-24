// app/api/image-status/route.ts

import { NextResponse } from 'next/server'

export const maxDuration = 10

export async function GET(request: Request) {
  // ✅ RUTA OBSOLETA
  // Ya no usamos Wiro (que era asíncrono y requería consultar el estado).
  // Ahora usamos Runware, que devuelve la imagen terminada en la misma petición.
  // Mantenemos esta ruta solo para no romper el build de Vercel.
  
  return NextResponse.json({ 
    status: 'obsolete', 
    message: 'La generación de imágenes ahora es síncrona (Runware).' 
  }, { status: 200 })
}
