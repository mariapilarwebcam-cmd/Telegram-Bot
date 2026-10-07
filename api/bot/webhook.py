import sys
import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from aiogram import Bot, Dispatcher
from aiogram.types import Update
from dotenv import load_dotenv
import logging

# ✅ Fix para Vercel: añadir la carpeta del archivo al sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

load_dotenv()

from telegrabot import router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
TELEGRAM_WEBHOOK_SECRET = os.getenv('TELEGRAM_WEBHOOK_SECRET')

if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("❌ Falta TELEGRAM_BOT_TOKEN")

if not TELEGRAM_WEBHOOK_SECRET:
    logger.warning(
        "⚠️ TELEGRAM_WEBHOOK_SECRET no configurado. "
        "El webhook es vulnerable a updates falsos. "
        "Configúralo en Vercel y regístralo con setWebhook."
    )

# ✅ Dispatcher a nivel de módulo — NO tiene estado del event loop
dp = Dispatcher()
dp.include_router(router)

app = FastAPI()


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def catch_all(request: Request, path: str):
    if request.method == "GET":
        return {"status": "webhook alive", "path": path}

    # ══════════════════════════════════════════════════════
    # ✅ VALIDACIÓN DEL SECRET DE TELEGRAM
    # ══════════════════════════════════════════════════════
    if TELEGRAM_WEBHOOK_SECRET:
        header_secret = request.headers.get("x-telegram-bot-api-secret-token")
        if header_secret != TELEGRAM_WEBHOOK_SECRET:
            client_ip = request.client.host if request.client else "unknown"
            logger.warning(
                f"🚨 Webhook rechazado: secret inválido. IP={client_ip}"
            )
            raise HTTPException(status_code=403, detail="Forbidden")

    bot = Bot(token=TELEGRAM_BOT_TOKEN)

    try:
        body = await request.json()
        update = Update(**body)
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error en webhook: {e}", exc_info=True)
        return JSONResponse(
            {"status": "error", "detail": str(e)},
            status_code=500,
        )
    finally:
        try:
            await bot.session.close()
        except Exception:
            pass
