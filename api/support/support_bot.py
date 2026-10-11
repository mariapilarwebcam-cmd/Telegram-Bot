import os
import logging
from datetime import datetime, timezone
from typing import Optional
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import Command, CommandStart
from aiogram.types import Message
from turso_client import turso_execute, turso_query_one

load_dotenv()

SUPPORT_BOT_TOKEN = os.getenv('SUPPORT_BOT_TOKEN')
ADMIN_CHAT_ID = os.getenv('ADMIN_CHAT_ID')

if not SUPPORT_BOT_TOKEN:
    raise RuntimeError("❌ Falta SUPPORT_BOT_TOKEN")
if not ADMIN_CHAT_ID:
    raise RuntimeError("❌ Falta ADMIN_CHAT_ID")

logger = logging.getLogger(__name__)
router = Router()

# --- Helper para guardar el estado en Turso ---
def save_conversation_state(user_id: int, admin_msg_id: int, user_msg_id: int):
    try:
        # Guardamos la relación entre el mensaje del admin y el usuario
        turso_execute(
            "INSERT OR REPLACE INTO support_conversations (admin_message_id, user_id, user_message_id) VALUES (?, ?, ?)",
            [str(admin_msg_id), str(user_id), str(user_msg_id)]
        )
    except Exception as e:
        logger.error(f"Error saving support conversation state: {e}")

# --- Handlers ---

@router.message(CommandStart())
async def cmd_start(message: Message):
    await message.answer(
        "👋 *Soporte de Taboo Realm*\n\n"
        "Describe tu problema o duda y nuestro equipo te responderá lo antes posible. "
        "Si tu consulta es sobre una compra, por favor incluye el ID de la transacción."
    )

@router.message(F.chat.type == "private")
async def handle_user_message(message: Message):
    """Reenvía el mensaje del usuario al grupo de administradores."""
    user = message.from_user
    if not user:
        return

    # Preparamos el encabezado para el admin
    header = (
        f"📩 *Nuevo mensaje de soporte*\n\n"
        f"👤 *Usuario:* {user.full_name}\n"
        f"🆔 `{user.id}`\n"
        f"🕒 {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC\n\n"
        f"--- MENSAJE ---\n"
    )

    # Reenviamos el mensaje original al grupo de admin
   admin_notice = await message.bot.send_message(
    chat_id=ADMIN_CHAT_ID,
    text=header
)

forwarded_msg = await message.forward(chat_id=ADMIN_CHAT_ID)

    # Guardamos la relación en la base de datos para poder responder
    save_conversation_state(user.id, admin_notice.message_id, forwarded_msg.message_id)

    await message.answer("✅ Tu mensaje ha sido enviado al equipo de soporte.")

@router.message(F.chat.id == int(ADMIN_CHAT_ID))
async def handle_admin_reply(message: Message):
    """Reenvía la respuesta del admin al usuario correspondiente."""
    if not message.reply_to_message:
        return

    # Buscamos a qué usuario corresponde este hilo
    admin_msg_id = message.reply_to_message.message_id
    conversation = turso_query_one(
        "SELECT user_id FROM support_conversations WHERE admin_message_id = ?",
        [str(admin_msg_id)]
    )

    if conversation and conversation.get('user_id'):
        user_id = int(conversation['user_id'])
        try:
            await message.copy_to(chat_id=user_id)
            await message.reply("✅ Respuesta enviada al usuario.")
        except Exception as e:
            logger.error(f"Error sending admin reply to {user_id}: {e}")
            await message.reply("❌ No se pudo enviar la respuesta al usuario.")
    else:
        await message.reply("⚠️ No se encontró el usuario para este mensaje.")
