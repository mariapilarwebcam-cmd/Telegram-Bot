import sys
import os
from fastapi import FastAPI, Request, HTTPException
from aiogram import Bot, Dispatcher
from aiogram.types import Update
from dotenv import load_dotenv
import logging

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from support_bot import router  # Importa el router del bot de soporte

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SUPPORT_BOT_TOKEN = os.getenv('SUPPORT_BOT_TOKEN')
SUPPORT_WEBHOOK_SECRET = os.getenv('SUPPORT_WEBHOOK_SECRET')

if not SUPPORT_BOT_TOKEN:
    raise RuntimeError("❌ Falta SUPPORT_BOT_TOKEN")

dp = Dispatcher()
dp.include_router(router)

app = FastAPI()

@app.api_route("/{path:path}", methods=["GET", "POST"])
async def catch_all(request: Request, path: str):
    if request.method == "GET":
        return {"status": "support webhook alive", "path": path}

    if SUPPORT_WEBHOOK_SECRET:
        header_secret = request.headers.get("x-telegram-bot-api-secret-token")
        if header_secret != SUPPORT_WEBHOOK_SECRET:
            client_ip = request.client.host if request.client else "unknown"
            logger.warning(f"🚨 Support webhook rechazado: secret inválido. IP={client_ip}")
            raise HTTPException(status_code=403, detail="Forbidden")

    bot = Bot(token=SUPPORT_BOT_TOKEN)

    try:
        body = await request.json()
        update = Update(**body)
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error en support webhook: {e}", exc_info=True)
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)
    finally:
        try:
            await bot.session.close()
        except Exception:
            pass