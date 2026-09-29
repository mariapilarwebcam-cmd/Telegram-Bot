import sys
import os
import traceback
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import logging

# ✅ Fix para Vercel
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════
# ✅ DIAGNÓSTICO: capturamos el error del import para verlo
# ══════════════════════════════════════════════════════════════
IMPORT_ERROR = None
router = None
dp = None

try:
    from aiogram import Bot, Dispatcher
    from aiogram.types import Update
    from telegrabot import router as _router
    router = _router
    dp = Dispatcher()
    dp.include_router(router)
    logger.info("✅ telegrabot importado correctamente")
except Exception as e:
    IMPORT_ERROR = f"{type(e).__name__}: {e}\n\n{traceback.format_exc()}"
    logger.error(f"❌ ERROR IMPORTANDO telegrabot: {IMPORT_ERROR}")

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')

app = FastAPI()


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def catch_all(request: Request, path: str):
    # ✅ Si el import falló, mostrar el error real
    if IMPORT_ERROR:
        return JSONResponse(
            {
                "status": "import_failed",
                "error": IMPORT_ERROR,
                "hint": "Revisa los logs de Vercel para el traceback completo",
            },
            status_code=500,
        )

    if request.method == "GET":
        return {
            "status": "webhook alive",
            "path": path,
            "bot_token_present": bool(TELEGRAM_BOT_TOKEN),
            "supabase_url_present": bool(os.getenv('SUPABASE_URL')),
            "supabase_key_present": bool(os.getenv('SUPABASE_KEY')),
        }

    try:
        from aiogram import Bot
        bot = Bot(token=TELEGRAM_BOT_TOKEN)
        try:
            body = await request.json()
            update = Update(**body)
            await dp.feed_update(bot, update)
            return {"status": "ok"}
        finally:
            try:
                await bot.session.close()
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Error en webhook: {e}", exc_info=True)
        return JSONResponse(
            {"status": "error", "detail": str(e)},
            status_code=500,
        )
    finally:
        # ✅ Cerrar la sesión HTTP del bot para liberar recursos
        try:
            await bot.session.close()
        except Exception:
            pass
