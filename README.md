# Taboo Realm — Telegram Mini App

Bot de rol con IA + Mini App de Telegram + sistema de gemas + pagos con Stars.

## 🏗️ Arquitectura

- **Frontend**: Next.js 14 (App Router) desplegado en Vercel
- **Backend bot**: FastAPI + aiogram (Python) en `api/bot/webhook.py`
- **Base de datos**: Supabase (PostgreSQL)
- **IA chat**: OpenRouter (DeepSeek V3)
- **IA imagen**: Wiro AI (Seedream 5.0 Lite Uncensored) + fallback DeepInfra (FLUX-1-schnell)
- **IA audio**: DeepInfra (Kokoro-82M)
- **Almacenamiento de imágenes**: Cloudflare R2 (bucket `taboo-realm-references`)
- **Pagos**: Telegram Stars (XTR) + USDT en TON

## 📦 Variables de entorno (Vercel → Settings → Environment Variables)

### 🔴 Críticas (obligatorias)

| Variable | Descripción |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token del bot de @BotFather |
| `OPENROUTER_API_KEY` | API key de OpenRouter para chat IA |
| `DEEPINFRA_TOKEN` | API key de DeepInfra para imágenes y audio |
| `WIRO_API_KEY` | API key de Wiro AI para generación de imágenes |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key pública de Supabase (para el cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key de Supabase (SECRETA, solo servidor) |
| `SUPABASE_URL` | Igual que `NEXT_PUBLIC_SUPABASE_URL` (para el bot Python) |
| `SUPABASE_KEY` | Igual que `SUPABASE_SERVICE_ROLE_KEY` (para el bot Python) |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | URL pública del bucket R2 (ej. `https://goddessgridhq.com`) |
| `WEBHOOK_URL` | URL pública del webhook, ej: `https://tu-app.vercel.app/api/webhook` |
| `MINI_APP_URL` | URL de la Mini App, ej: `https://tu-app.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | Igual que `MINI_APP_URL` (para OpenRouter headers) |
| `NEXT_PUBLIC_TON_RECIPIENT_WALLET` | Wallet TON para pagos con crypto (opcional) |
| `TON_RECIPIENT_WALLET` | Wallet TON para validación server-side (opcional) |
| `TONAPI_KEY` | API key de tonapi.io (opcional, recomendado) |

### ⚠️ IMPORTANTE sobre Supabase

- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**: es pública, se expone en el navegador. Úsala solo en el cliente (`lib/supabase.ts`).
- **`SUPABASE_SERVICE_ROLE_KEY`**: es **SECRETA**. Da acceso total a la base de datos. **NUNCA** la pongas como `NEXT_PUBLIC_*`. Solo se usa en `lib/supabase-admin.ts` para las rutas API del servidor.

## 📦 Migración SQL requerida

Antes del primer deploy (o si actualizas desde una versión previa), ejecuta en el SQL Editor de Supabase:

```sql
-- Rachas diarias
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS streak_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_daily_claim TIMESTAMPTZ;

-- Método de pago en compras
ALTER TABLE star_purchases
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'stars';

CREATE INDEX IF NOT EXISTS idx_star_purchases_payment_method
  ON star_purchases(payment_method);
