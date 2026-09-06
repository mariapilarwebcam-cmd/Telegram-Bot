# Bot de Telegram en Vercel

## Configuración de variables de entorno

En el panel de Vercel (Settings > Environment Variables), agrega:

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `DEEPINFRA_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `WEBHOOK_URL` (debe ser `https://tu-app.vercel.app/api/webhook`)
- (opcionales) `TTS_PROVIDER`, `DEEPINFRA_VOICE_ES`, `DEEPINFRA_VOICE_EN`

## Despliegue

1. Conecta el repositorio a Vercel.
2. Despliega automáticamente con cada push.

## Configurar webhook de Telegram

Una vez desplegado, ejecuta:

curl -X POST "https://api.telegram.org/bot<TU_TOKEN>/setWebhook?url=https://tu-app.vercel.app/api/webhook"

Reemplaza `<TU_TOKEN>` con tu token.

## Nota sobre los estados en memoria

El bot usa `user_states` en memoria. En Vercel, esto puede causar problemas si se escalan múltiples instancias. Para producción se recomienda migrar los estados a Supabase o Redis.