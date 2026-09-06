import logging
from fastapi import FastAPI, Request
from aiogram import Bot, Dispatcher
from aiogram.types import Update
import os
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Importar router del bot
from telegrabot import router, TELEGRAM_BOT_TOKEN

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Inicializar bot y dispatcher
bot = Bot(token=TELEGRAM_BOT_TOKEN)
dp = Dispatcher()
dp.include_router(router)

app = FastAPI()

@app.post("/api/webhook")
async def webhook_endpoint(request: Request):
    try:
        body = await request.json()
        update = Update(**body)
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error en webhook: {e}", exc_info=True)
        return {"status": "error", "detail": str(e)}, 500

@app.get("/")
async def root():
    return {"message": "Bot is running ✨"}
