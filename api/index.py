import os
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from aiogram import Bot, Dispatcher
from aiogram.types import Update
from dotenv import load_dotenv

load_dotenv()

from telegrabot import router, TELEGRAM_BOT_TOKEN

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "telegram-bot-api"}

# Root devuelve 404: la UI la sirve Next.js, no Python
@app.get("/")
async def root():
    return JSONResponse({"error": "not found"}, status_code=404)
