import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl) {
  throw new Error('Missing env.NEXT_PUBLIC_SUPABASE_URL')
}

if (!serviceRoleKey) {
  console.warn(
    '⚠️ SUPABASE_SERVICE_ROLE_KEY no está configurada. Las rutas API usarán la anon key (INSEGURO).'
  )
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey || anonKey,
  { auth: { persistSession: false, autoRefreshToken: false } }
)