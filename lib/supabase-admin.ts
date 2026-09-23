// lib/supabase-admin.ts

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  throw new Error('❌ FATAL: Falta NEXT_PUBLIC_SUPABASE_URL en las env vars')
}
if (!anonKey) {
  throw new Error('❌ FATAL: Falta NEXT_PUBLIC_SUPABASE_ANON_KEY en las env vars')
}

// Diagnóstico visible en los logs de Vercel
if (!serviceRoleKey) {
  console.error(
    '🚨 CRITICAL: SUPABASE_SERVICE_ROLE_KEY no está configurada. ' +
    'Las rutas API usarán la ANON KEY y fallarán al escribir por RLS. ' +
    'Añádela en Vercel → Settings → Environment Variables y REDEPLOYA.'
  )
} else {
  console.log('✅ supabaseAdmin usando SERVICE_ROLE_KEY (bypassa RLS)')
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey || anonKey!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
