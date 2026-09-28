import sys
import os
from fastapi import FastAPI, Request
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

app = FastAPI()


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def catch_all(request: Request, path: str):
    """
    Catch-all: Vercel pasa paths variables a esta función.
    - GET → responder 'webhook alive' (útil para test)
    - POST → procesar update de Telegram

    ✅ IMPORTANTE: Bot y Dispatcher se crean DENTRO del handler
    para evitar 'Event loop is closed' entre invocaciones de Lambda.
    """
    if request.method == "GET":
        return {"status": "webhook alive", "path": path}

    # ✅ Crear Bot y Dispatcher nuevos en CADA petición
    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    dp = Dispatcher()
    dp.include_router(router)

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
        # ✅ Cerrar la sesión HTTP del bot para liberar recursos
        try:
            await bot.session.close()
        except Exception:
            pass
