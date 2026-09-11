import os
import logging
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from aiogram import Bot, Dispatcher
from aiogram.types import Update
from dotenv import load_dotenv

load_dotenv()

# Importar router del bot
from telegrabot import router, TELEGRAM_BOT_TOKEN

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bot = Bot(token=TELEGRAM_BOT_TOKEN)
dp = Dispatcher()
dp.include_router(router)

app = FastAPI()

@app.post("/api/webhook")
async def webhook_endpoint(request: Request):
    """Endpoint principal que recibe los updates de Telegram"""
    try:
        body = await request.json()
        update = Update(**body)
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error en webhook: {e}", exc_info=True)
        return {"status": "error", "detail": str(e)}, 500

@app.get("/api/health")
async def health_check():
    """Endpoint de health check"""
    return {"status": "healthy", "service": "telegram-bot-api"}

@app.get("/")
async def root():
    """Endpoint raíz"""
    return {
        "message": "Telegram Bot API running ✨",
        "miniapp": "https://tu-dominio.vercel.app",
        "docs": "Ver README.md para instrucciones"
    }

@app.on_event("startup")
async def startup():
    """Configurar webhook al iniciar"""
    webhook_url = os.getenv("WEBHOOK_URL", "")
    if webhook_url:
        try:
            await bot.set_webhook(url=webhook_url)
            logger.info(f"Webhook configurado: {webhook_url}")
        except Exception as e:
            logger.error(f"Error configurando webhook: {e}")

@app.on_event("shutdown")
async def shutdown():
    """Cerrar sesión del bot"""
    await bot.session.close()
