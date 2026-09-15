from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from aiogram import Bot, Dispatcher
from aiogram.types import Update
from dotenv import load_dotenv
import os
import logging

load_dotenv()

from telegrabot import router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')

bot = Bot(token=TELEGRAM_BOT_TOKEN)
dp = Dispatcher()
dp.include_router(router)

app = FastAPI()


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def catch_all(request: Request, path: str):
    """
    Catch-all: Vercel pasa paths variables a esta función.
    - GET → responder 'webhook alive' (útil para test)
    - POST → procesar update de Telegram
    """
    if request.method == "GET":
        return {"status": "webhook alive", "path": path}

    # POST: procesar update de Telegram
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
