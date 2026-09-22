## 🎨 Sistema de Niveles y Generación con Wiro AI

### Niveles (por cantidad de mensajes)

| Nivel | Mensajes | Imagen | Audio | Intensidad | Badge |
|-------|----------|--------|-------|------------|-------|
| 1 | 0–14 | 15💎 | 5💎 | NORMAL | Conocidos |
| 2 | 15–39 | 20💎 | 10💎 | HIGH | Amigos |
| 3 | 40–89 | 30💎 | 15💎 | VERY_HIGH | Cercanos |
| 4 | 90–179 | 40💎 | 20💎 | MAXIMUM | Íntimos |
| 5 | 180+ | 55💎 | 25💎 | ULTRA | Especiales |

### Generación de imágenes

- **Modelo principal**: Seedream 5.0 Lite Uncensored (Wiro AI)
- **Fallback**: DeepInfra FLUX-1-schnell si Wiro falla o tarda >50s
- **Reference image**: por arquetipo en bucket `character-references` de Supabase Storage
- **Estilo**: anime (cel shading, vibrante)
- **Escalado por nivel**: ropa y escena cambian según el nivel del usuario

### Variables de entorno nuevas

| Variable | Descripción |
|----------|-------------|
| `WIRO_API_KEY` | API Key de Wiro AI |

### Setup inicial

1. Ejecuta `supabase-schema.sql` en el SQL Editor de Supabase
2. Sube las 32 imágenes de referencia (16 fem + 16 masc) al bucket `character-references`
3. Nombra cada imagen como `{gender}_{archetype}.jpg` (ej: `female_stepmom.jpg`, `male_ceo.jpg`)
4. Añade `WIRO_API_KEY` en Vercel → Settings → Environment Variables
5. Redeploy

### Patrón async (para cuando pases a Vercel Pro)

El endpoint `/api/image-status?taskid=xxx` ya está listo. Cuando migres:
1. Cambia `generate-image` para devolver el `taskid` en vez de esperar
2. Frontend hace polling cada 3s a `/api/image-status`
3. Cuando status = `completed`, muestra la imagen
