# Bot de Telegram en Vercel

## Variables de entorno (en Vercel)

Configura estas variables en el panel de Vercel (Settings > Environment Variables):

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `DEEPINFRA_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `WEBHOOK_URL` (debe ser `https://tu-app.vercel.app/api/webhook`)
- (opcionales) `TTS_PROVIDER`, `DEEPINFRA_VOICE_ES`, `DEEPINFRA_VOICE_EN`

## Despliegue

1. Conecta el repositorio a Vercel.
2. Vercel detectará automáticamente los archivos y desplegará.
3. Una vez desplegado, configura el webhook de Telegram:

curl -X POST "https://api.telegram.org/bot<TU_TOKEN>/setWebhook?url=https://tu-app.vercel.app/api/webhook"

Reemplaza `<TU_TOKEN>` por tu token real.

## Nota

Los estados en memoria (`user_states`) pueden perderse entre instancias. Para producción, considera migrarlos a Supabase.
