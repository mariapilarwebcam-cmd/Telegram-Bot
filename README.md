# Taboo Realm — Telegram Mini App

Bot de rol con IA + Mini App de Telegram + sistema de gemas + pagos con Stars.

## 🏗️ Arquitectura

- **Frontend**: Next.js 14 (App Router) desplegado en Vercel
- **Backend bot**: FastAPI + aiogram (Python) en `/api/index.py`
- **Base de datos**: Supabase (PostgreSQL)
- **IA chat**: OpenRouter (DeepSeek V3)
- **IA imagen**: Wiro AI (Seedream 5.0 Lite Uncensored) + fallback DeepInfra (FLUX-1-schnell)
- **IA audio**: DeepInfra (Kokoro-82M)
- **Almacenamiento de imágenes**: Cloudflare R2 (bucket `taboo-realm-references`)
- **Pagos**: Telegram Stars (XTR)

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

### ⚠️ IMPORTANTE sobre Supabase

- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**: es pública, se expone en el navegador. Úsala solo en el cliente (`lib/supabase.ts`).
- **`SUPABASE_SERVICE_ROLE_KEY`**: es **SECRETA**. Da acceso total a la base de datos. **NUNCA** la pongas como `NEXT_PUBLIC_*`. Solo se usa en `lib/supabase-admin.ts` para las rutas API del servidor.

## 🗄️ Esquema de base de datos (Supabase)

Tablas necesarias:

- `users` — telegram_id, username, first_name, language, gems, referral_code, referred_by, total_referrals, last_daily_claim, hook_messages_remaining, bonus_gems_from_referrals
- `user_characters` — id, telegram_id, character_name, gender, archetype, personality, is_active
- `conversation_history` — id, telegram_id, character_id, role, content, created_at
- `gem_transactions` — id, telegram_id, amount, transaction_type, description, created_at
- `referrals` — id, referrer_id, referred_id, reward_paid, referred_message_count, created_at
- `star_purchases` — id, telegram_id, stars_amount, gems_amount, is_first_purchase, telegram_charge_id
- `user_states` — telegram_id, step, language, gender, archetype, username, first_name, referred_by

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

```
https://api.telegram.org/bot<TU_BOT_TOKEN>/setWebhook?url=https://tu-app.vercel.app/api/webhook
```

---

## 🎨 Sistema de Niveles y Generación con Wiro AI

### Niveles (por cantidad de mensajes)

| Nivel | Mensajes | Imagen | Audio | Intensidad | Badge |
|-------|----------|--------|-------|------------|-------|
| 1 | 0–14 | 15💎 | 5💎 | NORMAL | Conocidos |
| 2 | 15–39 | 20💎 | 10💎 | HIGH | Amigos |
| 3 | 40–89 | 30💎 | 15💎 | VERY_HIGH | Cercanos |
| 4 | 90–179 | 40💎 | 20💎 | MAXIMUM | Íntimos |
| 5 | 180+ | 55💎 | 25💎 | ULTRA | Especiales |

Los niveles son **invisibles para el usuario** en cuanto a lógica (no ve "Nivel 3"), pero **sí ve badges emocionales** (Conocidos → Amigos → Cercanos → Íntimos → Especiales). Los precios de imagen y audio escalan silenciosamente con el nivel.

### Generación de imágenes

- **Modelo principal**: Seedream 5.0 Lite Uncensored (Wiro AI)
- **Fallback**: DeepInfra FLUX-1-schnell si Wiro falla o tarda >50s
- **Reference image**: desde Cloudflare R2 (bucket `taboo-realm-references`)
- **Estilo**: anime (cel shading, vibrante, ojos detallados)
- **Escalado por nivel**: ropa y escena cambian según el nivel del usuario
- **Patrón de ejecución**: síncrono con timeout interno de 50s, luego fallback a DeepInfra

### Gate Premium

La generación de imágenes y audio está **bloqueada hasta la primera compra** con Stars:
- Usuario sin compras → al tocar audio o imagen, ve modal "Función Premium" con botón a la tienda.
- Una vez compra con Stars → desbloquea ambos features para siempre.

### Variables de entorno nuevas

| Variable | Descripción |
|----------|-------------|
| `WIRO_API_KEY` | API Key de Wiro AI |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | URL pública del bucket R2 |

---

## 🖼️ Almacenamiento de imágenes — Cloudflare R2

Las 32 imágenes de referencia se almacenan en Cloudflare R2 y se sirven a través del dominio público `https://goddessgridhq.com`.

### Variable de entorno

- `NEXT_PUBLIC_R2_PUBLIC_URL`: URL pública del bucket (ej. `https://goddessgridhq.com`)

### Convención de nombres

Cada imagen se sube con formato `{gender}_{archetype}.jpg` en la raíz del bucket:

**Femeninas (16):**
- `female_stepmom.jpg` — Victoria
- `female_tsundere.jpg` — Valeria
- `female_yandere.jpg` — Yumi
- `female_stepsister.jpg` — Chloe
- `female_boss.jpg` — Amanda
- `female_teacher.jpg` — Emma
- `female_model_student.jpg` — Harper
- `female_model.jpg` — Isabella
- `female_secretary.jpg` — Brooke
- `female_trainer.jpg` — Jessica
- `female_schoolmate.jpg` — Mia
- `female_neighbor.jpg` — Sophie
- `female_doctor.jpg` — Olivia
- `female_actor.jpg` — Scarlett
- `female_musician.jpg` — Luna
- `female_chef.jpg` — Valentina

**Masculinos (16):**
- `male_stepdad.jpg` — Richard
- `male_ceo.jpg` — Christian
- `male_stepbrother.jpg` — Jake
- `male_boss.jpg` — Alexander
- `male_bodyguard.jpg` — Marcus
- `male_childhood_friend.jpg` — Lucas
- `male_teacher.jpg` — Daniel
- `male_doctor.jpg` — James
- `male_trainer.jpg` — Brandon
- `male_musician.jpg` — Dylan
- `male_chef.jpg` — Marco
- `male_actor.jpg` — Nathan
- `male_artist.jpg` — Leo
- `male_writer.jpg` — Sebastian
- `male_schoolmate.jpg` — Ethan
- `male_neighbor.jpg` — Michael

### Uso

- **Frontend**: `getCharacterImageUrl(archetype, gender)` construye la URL pública (home, characters, chat avatar).
- **Backend**: la misma URL se pasa a Wiro como `inputImage` para mantener consistencia visual.

### Por qué R2 y no GitHub / Supabase Storage

- **GitHub**: prohíbe servir archivos como CDN y tiene rate limits bajos (~60 req/hora por IP). Inviable.
- **Supabase Storage**: funciona, pero cobra egress tras 250 GB. Innecesario para este volumen.
- **R2**: egress **gratuito siempre**, 10 GB de almacenamiento gratis, caché automático en el edge de Cloudflare.

### Cómo subir las imágenes a R2

1. Ve al dashboard de Cloudflare → R2 → bucket `taboo-realm-references`.
2. Arrastra las 32 imágenes a la raíz del bucket (sin subcarpetas).
3. Verifica abriendo `https://goddessgridhq.com/female_stepmom.jpg` en el navegador.

---

## 🎭 Personajes

El proyecto incluye 32 personajes (16 femeninos + 16 masculinos) con arquetipos variados:

### Femeninos (16)
`stepmom`, `tsundere`, `yandere`, `stepsister`, `boss`, `teacher`, `model_student`, `model`, `secretary`, `trainer`, `schoolmate`, `neighbor`, `doctor`, `actor`, `musician`, `chef`

### Masculinos (16)
`stepdad`, `ceo`, `stepbrother`, `boss`, `bodyguard`, `childhood_friend`, `teacher`, `doctor`, `trainer`, `musician`, `chef`, `actor`, `artist`, `writer`, `schoolmate`, `neighbor`

Los arquetipos `tsundere`, `yandere` y `childhood_friend` tienen **personalidades por nivel** definidas en `LEVEL_PERSONALITIES` (progresión narrativa de 5 niveles). El resto usa la personalidad base de `PERSONALITIES`.

---

## 📝 Setup inicial

1. **Ejecuta `supabase-schema.sql`** en el SQL Editor de Supabase (crea tablas, índices, RLS, trigger `updated_at`).
2. **Crea el bucket `taboo-realm-references`** en Cloudflare R2 y configura un dominio público (`R2_PUBLIC_URL`).
3. **Sube las 32 imágenes de referencia** al bucket R2 con el formato `{gender}_{archetype}.jpg`.
4. **Añade `WIRO_API_KEY` y `NEXT_PUBLIC_R2_PUBLIC_URL`** en Vercel → Settings → Environment Variables (Production).
5. **Registra el webhook** de Telegram con `/setWebhook`.
6. **Redeploy** en Vercel.

---

## 🔄 Patrón async (para cuando pases a Vercel Pro)

El endpoint `/api/image-status?taskid=xxx` ya está listo. Cuando migres a un patrón no bloqueante:

1. Cambia `generate-image` para devolver el `taskid` en vez de esperar la imagen.
2. Frontend hace polling cada 3s a `/api/image-status?taskid=xxx`.
3. Cuando `status === 'completed'`, muestra la imagen en el chat.

**Ventaja**: elimina el riesgo de timeout de Vercel cuando Wiro tarda más de 60s y libera la función serverless durante la espera.

---

## 💰 Precios y monetización

### Paquetes de gemas (Telegram Stars)

| Stars | Gemas | Bonus | Notas |
|-------|-------|-------|-------|
| 75 | 300 | +100 gemas | Solo primera compra |
| 150 | 600 | +10% | |
| 300 | 1200 | +20% | |
| 500 | 2400 | +25% | |
| 1000 | 5000 | +25% | |

### Costos en gemas

- Mensaje de chat: **1 gema**
- Imagen (por nivel): **15 / 20 / 30 / 40 / 55**
- Audio (por nivel): **5 / 10 / 15 / 20 / 25**
- Renombrar personaje: **3 gemas**

### Sistema de referidos

- 5 gemas por cada amigo que se registre Y envíe 3 mensajes.
- Máximo 2 referidos recompensados por día.
- Se verifica automáticamente en cada mensaje del referido.

### Hook mode

Cuando un usuario se queda sin gemas, recibe **5 mensajes gratis** con intensidad MAXIMUM (para maximizar conversión). Al agotarse, se bloquea y se le invita a recargar o invitar amigos.

---

## 🛠️ Comandos del bot (Telegram)

- `/start` — Inicia el bot y crea usuario
- `/balance` — Ver gemas actuales
- `/shop` — Abrir tienda de paquetes
- `/invite` — Obtener enlace de referidos
- `/help` — Ayuda

El bot muestra un botón persistente **"🎭 Abrir Mini App"** que abre la experiencia completa en Telegram WebApp.
