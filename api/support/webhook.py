import sys
import os
import logging
import hmac
import re
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from aiogram import Bot, Dispatcher
from aiogram.types import Update
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SUPPORT_BOT_TOKEN = os.getenv('SUPPORT_BOT_TOKEN')
SUPPORT_WEBHOOK_SECRET = os.getenv('SUPPORT_WEBHOOK_SECRET')

if not SUPPORT_BOT_TOKEN:
    raise RuntimeError("❌ Falta SUPPORT_BOT_TOKEN")


def is_valid_webhook_secret(value: str | None) -> bool:
    return (
        isinstance(value, str)
        and re.fullmatch(r'[A-Za-z0-9_-]{1,256}', value) is not None
    )


if not is_valid_webhook_secret(SUPPORT_WEBHOOK_SECRET):
    raise RuntimeError("SUPPORT_WEBHOOK_SECRET ausente o con formato inválido")

# Validar la configuración antes de importar los handlers y su acceso a Turso.
from support_bot import router

dp = Dispatcher()
dp.include_router(router)

app = FastAPI()


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def catch_all(request: Request, path: str):
    if request.method == "GET":
        return {"status": "support webhook alive", "path": path}

    header_secrets = request.headers.getlist("x-telegram-bot-api-secret-token")
    if (
        len(header_secrets) != 1
        or not is_valid_webhook_secret(header_secrets[0])
        or not hmac.compare_digest(header_secrets[0], SUPPORT_WEBHOOK_SECRET)
    ):
        logger.warning("Support webhook rechazado: autenticación inválida")
        raise HTTPException(status_code=403, detail="Forbidden")

    bot = Bot(token=SUPPORT_BOT_TOKEN)

    try:
        body = await request.json()
        update = Update(**body)
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception:
        logger.error("Error procesando actualización del webhook de soporte")
        return JSONResponse({"status": "error"}, status_code=500)
    finally:
        try:
            await bot.session.close()
        except Exception:
            logger.warning("No se pudo cerrar la sesión del bot de soporte")
