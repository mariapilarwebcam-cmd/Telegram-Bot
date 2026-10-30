import sys
import os
import hmac
import logging

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from aiogram import Bot, Dispatcher
from aiogram.types import Update
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from telegrabot import router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_WEBHOOK_SECRET = os.getenv("TELEGRAM_WEBHOOK_SECRET")

if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("Falta TELEGRAM_BOT_TOKEN")
if not TELEGRAM_WEBHOOK_SECRET:
    raise RuntimeError("Falta TELEGRAM_WEBHOOK_SECRET: webhook deshabilitado por seguridad")

dp = Dispatcher()
dp.include_router(router)
app = FastAPI()


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def catch_all(request: Request, path: str):
    if request.method == "GET":
        return {"status": "webhook alive", "path": path}

    received_secret = request.headers.get("x-telegram-bot-api-secret-token", "")
    if not hmac.compare_digest(received_secret, TELEGRAM_WEBHOOK_SECRET):
        logger.warning("Webhook rechazado: secret ausente o invalido")
        raise HTTPException(status_code=403, detail="Forbidden")

    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    try:
        body = await request.json()
        update = Update(**body)
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception:
        logger.exception("Error procesando webhook")
        return JSONResponse({"status": "error"}, status_code=500)
    finally:
        await bot.session.close()
