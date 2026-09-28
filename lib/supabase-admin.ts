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

// ✅ Validación más permisiva: solo verificamos que no esté vacía
// Supabase cambió el formato de las keys en 2024 (ahora pueden empezar
// con sb_publishable_... en vez de eyJ)
const isValidKey = (key: string) => key.length > 40

if (serviceRoleKey && !isValidKey(serviceRoleKey)) {
  console.error('🚨 SUPABASE_SERVICE_ROLE_KEY tiene formato inválido (muy corta).')
}
if (!isValidKey(anonKey)) {
  console.error('🚨 NEXT_PUBLIC_SUPABASE_ANON_KEY tiene formato inválido (muy corta).')
}

if (!serviceRoleKey) {
  console.error(
    '🚨 CRITICAL: SUPABASE_SERVICE_ROLE_KEY no está configurada. ' +
    'Las rutas API usarán la ANON KEY y fallarán al escribir. ' +
    'Añádela en Vercel y REDEPLOYA.'
  )
} else if (isValidKey(serviceRoleKey)) {
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
