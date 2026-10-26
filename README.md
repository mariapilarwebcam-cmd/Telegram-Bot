# Taboo Realm — Telegram Mini App

Bot de rol con IA + Mini App de Telegram + sistema de gemas + pagos con Stars y Crypto.

## 🏗️ Arquitectura

- **Frontend**: Next.js 14 (App Router) desplegado en Vercel.
- **Backend bot**: FastAPI + aiogram (Python) para webhooks de Telegram y soporte.
- **Base de datos**: Turso (libSQL).
- **IA Chat**: OpenRouter (DeepSeek V3).
- **IA Imagen**: Runware (`z-image-turbo` + LoRA `taboorealm:elusarca`).
- **IA Audio**: DeepInfra (`Chatterbox Multilingual`).
- **Almacenamiento de imágenes**: Cloudflare R2 (Bucket S3-compatible).
- **Pagos**: Telegram Stars (XTR) + USDT en la red TON.

---

## 📦 Variables de entorno (Vercel → Settings → Environment Variables)

### 🔴 Críticas (obligatorias)

| Variable | Descripción |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token del bot principal de @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secreto para validar las peticiones del webhook de Telegram |
| `OPENROUTER_API_KEY` | API key de OpenRouter para chat IA |
| `DEEPINFRA_TOKEN` | API key de DeepInfra para la generación de audio |
| `RUNWARE_API_KEY` | API key de Runware para la generación de imágenes |
| `TURSO_DATABASE_URL` | URL de conexión a la base de datos Turso (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | Token de autenticación de Turso |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | URL pública del bucket R2 (ej. `https://images.goddessgridhq.com`) |
| `R2_ACCOUNT_ID` | ID de la cuenta de Cloudflare |
| `R2_ACCESS_KEY_ID` | Access key de R2 (S3 API) |
| `R2_SECRET_ACCESS_KEY` | Secret key de R2 (S3 API) |
| `R2_BUCKET_NAME` | Nombre del bucket de Cloudflare R2 |
| `MINI_APP_URL` | URL de la Mini App, ej: `https://tu-app.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | Igual que `MINI_APP_URL` (para headers de OpenRouter y TON) |
| `ADMIN_API_SECRET` | Secreto para proteger el endpoint `/api/debug` y `/api/health` |
| `CRON_SECRET` | Secreto para proteger los Cron Jobs de Vercel |
| `TON_RECIPIENT_WALLET` | Wallet TON para validación de pagos server-side |
| `NEXT_PUBLIC_TON_RECIPIENT_WALLET` | Wallet TON para el cliente |
| `TONAPI_KEY` | API key de tonapi.io (para verificar pagos Crypto) |

### 🔧 Opcionales (Analíticas y Rate Limiting)

| Variable | Descripción |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | URL de Upstash para el Rate Limiting (Middleware) |
| `UPSTASH_REDIS_REST_TOKEN` | Token de Upstash |
| `NEXT_PUBLIC_POSTHOG_KEY` | API Key de PostHog para analíticas |
| `NEXT_PUBLIC_POSTHOG_HOST` | Host de PostHog |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN de Sentry para el monitoreo de errores |

---

## 🗄️ Base de Datos (Turso)

Antes del primer deploy, o si has hecho un reset de la base de datos, asegúrate de que el esquema (schema) esté creado. Aquí tienes el bloque esencial de tablas que usa la aplicación:

```sql
-- 1. Tabla de Usuarios
CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    first_name TEXT,
    username TEXT UNIQUE,
    language TEXT DEFAULT 'es',
    gems INTEGER DEFAULT 10,
    purchased_gems INTEGER DEFAULT 0,
    bonus_gems INTEGER DEFAULT 0,
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    total_referrals INTEGER DEFAULT 0,
    paying_referrals_count INTEGER DEFAULT 0,
    hook_messages_remaining INTEGER DEFAULT 0,
    hook_used INTEGER DEFAULT 0,
    age_verified INTEGER DEFAULT 0,
    pending_referral_code TEXT,
    gender TEXT,
    interested_in TEXT,
    onboarding_complete INTEGER DEFAULT 0,
    photo_tokens INTEGER DEFAULT 1,
    photo_tokens_at INTEGER,
    audio_tokens INTEGER DEFAULT 1,
    audio_last_refill_at TEXT,
    last_active TEXT,
    proactive_count INTEGER DEFAULT 0,
    last_proactive_at TEXT,
    bot_blocked INTEGER DEFAULT 0
);

-- 2. Personajes del Usuario
CREATE TABLE IF NOT EXISTS user_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    character_name TEXT,
    gender TEXT,
    archetype TEXT,
    personality TEXT,
    equipped_outfit TEXT,
    owned_outfits TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Historial de Chat
CREATE TABLE IF NOT EXISTS conversation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    character_id INTEGER,
    role TEXT,
    content TEXT,
    reaction TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Ruleta (Gacha)
CREATE TABLE IF NOT EXISTS gacha_outfits (
    id TEXT PRIMARY KEY,
    name TEXT,
    rarity TEXT DEFAULT 'rare',
    prompt_tag TEXT
);

CREATE TABLE IF NOT EXISTS gacha_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    cost_gems INTEGER,
    reward_tier TEXT,
    reward_details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Inventario del Usuario
CREATE TABLE IF NOT EXISTS user_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    item_type TEXT, -- 'audio_token', 'photo_token', 'fantasy_pass', 'outfit'
    item_key TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Ofertas de Fotos y Pool
CREATE TABLE IF NOT EXISTS photo_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    image_id INTEGER,
    character_id INTEGER,
    price_gems INTEGER,
    source TEXT,
    state TEXT DEFAULT 'locked',
    paid_with TEXT,
    created_at INTEGER,
    unlocked_at INTEGER
);

CREATE TABLE IF NOT EXISTS generated_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_key TEXT,
    archetype TEXT,
    gender TEXT,
    mood TEXT,
    level_bucket TEXT,
    r2_key TEXT,
    blur_r2_key TEXT,
    r2_url TEXT,
    prompt_used TEXT,
    times_used INTEGER DEFAULT 0,
    reports INTEGER DEFAULT 0,
    status TEXT DEFAULT 'candidate',
    max_level INTEGER,
    character_key TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Suscripciones y Transacciones
CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    plan TEXT,
    stars_paid INTEGER,
    telegram_charge_id TEXT UNIQUE,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS gem_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    amount INTEGER,
    transaction_type TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS star_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    stars_amount INTEGER,
    gems_amount INTEGER,
    is_first_purchase INTEGER,
    telegram_charge_id TEXT UNIQUE,
    payment_method TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Sistema de Soporte (Para el bot de Python)
CREATE TABLE IF NOT EXISTS support_conversations (
    admin_message_id TEXT PRIMARY KEY,
    user_id TEXT,
    user_message_id TEXT
);
