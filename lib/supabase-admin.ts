// lib/supabase-admin.ts

import { createClient } from '@supabase/supabase-js'

// .trim() elimina saltos de línea/espacios invisibles al copiar/pegar
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

if (!supabaseUrl) {
  throw new Error('❌ FATAL: Falta NEXT_PUBLIC_SUPABASE_URL')
}
if (!anonKey) {
  throw new Error('❌ FATAL: Falta NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

const looksLikeJWT = (key: string) => key.startsWith('eyJ') && key.length > 100

if (serviceRoleKey && !looksLikeJWT(serviceRoleKey)) {
  console.error('🚨 SUPABASE_SERVICE_ROLE_KEY tiene formato inválido. Debe empezar con "eyJ".')
}
if (!looksLikeJWT(anonKey)) {
  console.error('🚨 NEXT_PUBLIC_SUPABASE_ANON_KEY tiene formato inválido.')
}

if (!serviceRoleKey) {
  console.error(
    '🚨 CRITICAL: SUPABASE_SERVICE_ROLE_KEY no está configurada. ' +
    'Las rutas API usarán la ANON KEY y fallarán al escribir. ' +
    'Añádela en Vercel y REDEPLOYA.'
  )
} else if (looksLikeJWT(serviceRoleKey)) {
  console.log('✅ supabaseAdmin inicializado con SERVICE_ROLE_KEY')
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey || anonKey!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        'X-Client-Info': 'taboo-realm-admin',
      },
    },
  }
)
