# Taboo Realm — Telegram Mini App

Bot de rol con IA + Mini App de Telegram + sistema de gemas + pagos con Stars.

## 🏗️ Arquitectura

- **Frontend**: Next.js 14 (App Router) desplegado en Vercel
- **Backend bot**: FastAPI + aiogram (Python) en `/api/index.py`
- **Base de datos**: Supabase (PostgreSQL)
- **IA**: OpenRouter (DeepSeek V3) para chat, DeepInfra para imágenes y audio
- **Pagos**: Telegram Stars (XTR)

## 📦 Variables de entorno (Vercel → Settings → Environment Variables)

### 🔴 Críticas (obligatorias)

| Variable | Descripción |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token del bot de @BotFather |
| `OPENROUTER_API_KEY` | API key de OpenRouter para chat IA |
| `DEEPINFRA_TOKEN` | API key de DeepInfra para imágenes y audio |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key pública de Supabase (para el cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key de Supabase (SECRETA, solo servidor) |
| `SUPABASE_URL` | Igual que `NEXT_PUBLIC_SUPABASE_URL` (para el bot Python) |
| `SUPABASE_KEY` | Igual que `SUPABASE_SERVICE_ROLE_KEY` (para el bot Python) |
| `WEBHOOK_URL` | URL pública del webhook, ej: `https://tu-app.vercel.app/api/webhook` |
| `MINI_APP_URL` | URL de la Mini App, ej: `https://tu-app.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | Igual que `MINI_APP_URL` (para OpenRouter headers) |

### ⚠️ IMPORTANTE sobre Supabase

- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**: es pública, se expone en el navegador. Úsala solo en el cliente (`lib/supabase.ts`).
- **`SUPABASE_SERVICE_ROLE_KEY`**: es **SECRETA**. Da acceso total a la base de datos. **NUNCA** la pongas como `NEXT_PUBLIC_*`. Solo se usa en `lib/supabase-admin.ts` para las rutas API del servidor.

## 🗄️ Esquema de base de datos (Supabase)

Tablas necesarias:

- `users` — telegram_id, username, first_name, language, gems, referral_code, referred_by, total_referrals, last_daily_claim, hook_messages_remaining, bonus_gems_from_referrals
- `user_characters` — id, telegram_id, character_name, gender, archetype, personality, is_active
- `conversation_history` — id, telegram_id, character_id, role, content, created_at
- `gem_transactions` — id, telegram_id, amount, transaction_type, description, created_at
- `referrals` — id, referrer_id, referred_id, created_at
- `star_purchases` — id, telegram_id, stars_amount, gems_amount, is_first_purchase, telegram_charge_id
- `user_states` — telegram_id, step, language, gender, archetype, username, first_name, referred_by (para onboarding del bot)

### Row Level Security (RLS)

**Activa RLS en TODAS las tablas.** Las rutas API usan service role y saltan RLS, pero el cliente (`lib/supabase.ts`) usa anon key y necesita políticas. Reglas mínimas recomendadas:

- `users`: SELECT solo si `telegram_id` coincide con el `initData` del usuario (requiere validación adicional).
- `user_characters`: SELECT/UPDATE solo si `telegram_id` coincide.
- `conversation_history`: SELECT solo si `telegram_id` coincide.
- `gem_transactions`, `referrals`, `star_purchases`, `user_states`: **sin acceso público**, solo service role.

## 🚀 Despliegue

1. Sube el repo a GitHub
2. Conecta el repo a Vercel
3. Configura **todas** las variables de entorno de la tabla anterior
4. Vercel detectará Next.js y Python automáticamente
5. Una vez desplegado, registra el webhook del bot:
