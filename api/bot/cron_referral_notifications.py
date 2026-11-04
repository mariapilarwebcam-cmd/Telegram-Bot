"""Cron diario del barrido de notificaciones de comisiones Stars.

Ruta dedicada (/api/bot/cron_referral_notifications), independiente del
catch-all del webhook. Solo acepta GET y exige Authorization: Bearer
CRON_SECRET (Vercel la envia automaticamente cuando la variable existe).

No mueve economia: delega en sweep_referral_notifications, que reutiliza el
claim atomico y las guardas de la notificacion inmediata.
"""
import sys
import os
import hmac
import logging

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from aiogram import Bot
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from telegrabot import sweep_referral_notifications

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CRON_SECRET = os.getenv("CRON_SECRET", "").strip()

app = FastAPI()


@app.api_route("/", methods=["GET"])
@app.api_route("/{path:path}", methods=["GET"])
async def run_referral_notifications_cron(request: Request, path: str = ""):
    # Autenticacion ANTES de crear ninguna instancia de Bot.
    if not CRON_SECRET:
        logger.error("CRON_SECRET no configurado")
        return JSONResponse(
            {"status": "error", "reason": "cron_not_configured"}, status_code=503)

    received = request.headers.get("authorization", "")
    if not hmac.compare_digest(received, f"Bearer {CRON_SECRET}"):
        logger.warning("Cron rechazado: secret ausente o invalido")
        raise HTTPException(status_code=403, detail="Forbidden")

    if not TELEGRAM_BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN no configurado")
        return JSONResponse(
            {"status": "error", "reason": "bot_not_configured"}, status_code=503)

    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    try:
        summary = await sweep_referral_notifications(bot)
    except Exception:
        logger.exception("Barrido fallido")
        return JSONResponse(
            {"status": "error", "reason": "sweep_failed"}, status_code=503)
    finally:
        await bot.session.close()

    # Nunca se reporta exito si la consulta global fallo.
    if summary.get("error"):
        return JSONResponse({"status": "error", **summary}, status_code=503)
    return JSONResponse({"status": "ok", **summary})
