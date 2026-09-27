// app/api/daily-claim/route.ts
// Puente: reexporta el handler de /api/daily para que ambos endpoints funcionen.
export { POST } from '../daily/route'