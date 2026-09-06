import os 
import random
import string
import logging
import asyncio
import re
import base64
import json
from datetime import datetime, timedelta, date
from typing import Optional, Dict, Any, List
import aiohttp
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery, Update,
    ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardButton, BufferedInputFile,
    WebAppInfo, MenuButtonWebApp, InlineQuery, InlineQueryResultArticle, InputTextMessageContent
)
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder
from aiogram.enums import ParseMode, ChatAction
from http.server import BaseHTTPRequestHandler
import libsql_client

# Cargar variables de entorno
load_dotenv()

# Configuración
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY')
DEEPINFRA_TOKEN = os.getenv('DEEPINFRA_TOKEN')
TURSO_URL = os.getenv('TURSO_URL')
TURSO_AUTH_TOKEN = os.getenv('TURSO_AUTH_TOKEN')
WEBHOOK_URL = os.getenv('WEBHOOK_URL')
WEB_APP_URL = os.getenv('WEB_APP_URL', '')

OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-0731"
DEEPINFRA_MODEL = "hexgrad/Kokoro-82M"
DEEPINFRA_IMG_MODEL = "black-forest-labs/FLUX-1-schnell"
CHATTERBOX_MODEL = "ResembleAI/chatterbox-multilingual"
TTS_PROVIDER = os.getenv('TTS_PROVIDER', 'chatterbox')
DEEPINFRA_VOICE_ES = os.getenv('DEEPINFRA_VOICE_ES', '')
DEEPINFRA_VOICE_EN = os.getenv('DEEPINFRA_VOICE_EN', '')

GEM_COST_MESSAGE = 1
GEM_COST_AUDIO = 5
GEM_COST_IMAGE = 10
GEM_COST_NEW_CHARACTER = 5
BASE_DAILY_GEMS = 5
GEMS_PER_REFERRAL = 5
MAX_REFERRALS_PER_DAY = 2
MAX_DAILY_GEMS = BASE_DAILY_GEMS + (GEMS_PER_REFERRAL * MAX_REFERRALS_PER_DAY)
HOOK_MODE_MESSAGES = 5

AFFINITY_LEVELS = {
    'stranger': {'min': 0, 'max': 20, 'emoji': '👤', 'name_es': 'Desconocido', 'name_en': 'Stranger'},
    'acquaintance': {'min': 20, 'max': 40, 'emoji': '🙂', 'name_es': 'Conocido', 'name_en': 'Acquaintance'},
    'friend': {'min': 40, 'max': 60, 'emoji': '😊', 'name_es': 'Amigo', 'name_en': 'Friend'},
    'flirty': {'min': 60, 'max': 80, 'emoji': '😘', 'name_es': 'Coqueto', 'name_en': 'Flirty'},
    'intimate': {'min': 80, 'max': 100, 'emoji': '💕', 'name_es': 'Íntimo', 'name_en': 'Intimate'}
}

DAILY_MISSIONS = [
    {'id': 'chat_5', 'name_es': '💬 Conversador', 'name_en': '💬 Conversationalist', 
     'desc_es': 'Envía 5 mensajes', 'desc_en': 'Send 5 messages', 
     'target': 5, 'reward': 3, 'track': 'messages_sent'},
    {'id': 'selfie_1', 'name_es': '📸 Paparazzi', 'name_en': '📸 Paparazzi', 
     'desc_es': 'Pide 1 selfie', 'desc_en': 'Request 1 selfie', 
     'target': 1, 'reward': 2, 'track': 'selfies_requested'},
    {'id': 'luxbox_1', 'name_es': '📦 Suertudo', 'name_en': '📦 Lucky One', 
     'desc_es': 'Abre 1 LuxBox', 'desc_en': 'Open 1 LuxBox', 
     'target': 1, 'reward': 5, 'track': 'luxboxes_opened'},
    {'id': 'audio_1', 'name_es': '🎙️ Oyente', 'name_en': '🎙️ Listener', 
     'desc_es': 'Escucha 1 audio', 'desc_en': 'Listen to 1 audio', 
     'target': 1, 'reward': 2, 'track': 'audios_listened'},
]

LUXBOX_REAL_PROBABILITIES = [
    {'gems': 75, 'probability': 0.35, 'emoji': '✨', 'label': '75 Gemas'},
    {'gems': 100, 'probability': 0.30, 'emoji': '💎', 'label': '100 Gemas'},
    {'gems': 150, 'probability': 0.20, 'emoji': '💎💎', 'label': '150 Gemas'},
    {'gems': 200, 'probability': 0.10, 'emoji': '💎💎💎', 'label': '200 Gemas'},
    {'gems': 300, 'probability': 0.04, 'emoji': '🌟', 'label': '300 Gemas'},
    {'gems': 500, 'probability': 0.01, 'emoji': '⭐', 'label': '500 Gemas'}
]

LUXBOX_COST_STARS = 75
LUXBOX_BULK_DISCOUNTS = {1: 75, 3: 200, 5: 325, 10: 600}

FAKE_LUXBOX_WINNERS = [
    {'name': 'Usuario***283', 'prize': '10,000', 'time': '5 min'},
    {'name': 'Usuario***746', 'prize': '5,000', 'time': '12 min'},
    {'name': 'Usuario***194', 'prize': '2,500', 'time': '28 min'},
    {'name': 'Usuario***851', 'prize': '5,000', 'time': '1 hora'},
    {'name': 'Usuario***327', 'prize': '10,000', 'time': '2 horas'}
]

ACHIEVEMENTS = {
    'first_message': {'emoji': '💬', 'name_es': 'Primer Mensaje', 'name_en': 'First Message', 'reward': 5},
    'luxbox_first': {'emoji': '📦', 'name_es': 'Primera Caja', 'name_en': 'First Box', 'reward': 10},
    'affinity_50': {'emoji': '💕', 'name_es': 'Conexión', 'name_en': 'Connection', 'reward': 15},
    'affinity_100': {'emoji': '❤️‍🔥', 'name_es': 'Amor Verdadero', 'name_en': 'True Love', 'reward': 50},
    'streak_7': {'emoji': '🔥', 'name_es': 'Racha de 7 días', 'name_en': '7 Day Streak', 'reward': 20},
    'luxbox_10': {'emoji': '🎁', 'name_es': 'Coleccionista', 'name_en': 'Collector', 'reward': 25},
}

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

logging.getLogger('aiohttp').setLevel(logging.WARNING)
logging.getLogger('aiogram').setLevel(logging.INFO)

client = libsql_client.Client(url=TURSO_URL, auth_token=TURSO_AUTH_TOKEN)

ARCHETYPES_MALE = {
    "es": {
        "schoolmate": "🎓 Compañero de escuela", "stepdad": "👔 Padrastro", "stepbrother": "💪 Hermanastro",
        "teacher": "📚 Profesor", "neighbor": "🏠 Vecino", "boss": "💼 Jefe", "trainer": "🏋️ Entrenador personal",
        "model": "📸 Modelo/Influencer", "musician": "🎵 Músico", "actor": "🎬 Actor", "doctor": "⚕️ Médico",
        "chef": "👨‍🍳 Chef", "artist": "🎨 Artista", "writer": "✍️ Escritor", "bodyguard": "🛡️ Guardaespaldas", "ceo": "💼 CEO/Empresario"
    },
    "en": {
        "schoolmate": "🎓 Schoolmate", "stepdad": "👔 Stepfather", "stepbrother": "💪 Stepbrother",
        "teacher": "📚 Teacher", "neighbor": "🏠 Neighbor", "boss": "💼 Boss", "trainer": "🏋️ Personal Trainer",
        "model": "📸 Model/Influencer", "musician": "🎵 Musician", "actor": "🎬 Actor", "doctor": "⚕️ Doctor",
        "chef": "👨‍🍳 Chef", "artist": "🎨 Artist", "writer": "✍️ Writer", "bodyguard": "🛡️ Bodyguard", "ceo": "💼 CEO/Businessman"
    }
}

ARCHETYPES_FEMALE = {
    "es": {
        "schoolmate": "🎓 Compañera de escuela", "stepmom": "💋 Madrastra", "stepsister": "🌸 Hermanastra",
        "teacher": "📚 Profesora", "neighbor": "🏠 Vecina", "boss": "💼 Jefa", "trainer": "🏋️ Entrenadora personal",
        "model": "📸 Modelo/Influencer", "musician": "🎵 Músico", "actor": "🎬 Actriz", "doctor": "⚕️ Doctora/Enfermera",
        "chef": "👩‍🍳 Chef", "artist": "🎨 Artista", "writer": "✍️ Escritora", "secretary": "💼 Secretaria", "model_student": "🎓 Estudiante popular"
    },
    "en": {
        "schoolmate": "🎓 Schoolmate", "stepmom": "💋 Stepmother", "stepsister": "🌸 Stepsister",
        "teacher": "📚 Teacher", "neighbor": "🏠 Neighbor", "boss": "💼 Boss", "trainer": "🏋️ Personal Trainer",
        "model": "📸 Model/Influencer", "musician": "🎵 Musician", "actor": "🎬 Actress", "doctor": "⚕️ Doctor/Nurse",
        "chef": "👩‍🍳 Chef", "artist": "🎨 Artist", "writer": "✍️ Writer", "secretary": "💼 Secretary", "model_student": "🎓 Popular Student"
    }
}

CHARACTER_FACES = {
    "schoolmate": "19 year old, messy hair, casual hoodie, playful mischievous eyes, cute natural look",
    "stepmom": "38 year old mature woman, elegant long dark hair, sharp green eyes, luxurious silk robe, sultry expression",
    "stepdad": "40 year old mature man, salt and pepper stubble, broad shoulders, unbuttoned dress shirt, dominant aura",
    "stepsister": "20 year old girl, edgy blonde bob cut, blue eyes, nose ring, oversized t-shirt, playful smirk",
    "stepbrother": "21 year old athletic man, short buzz cut, strong jawline, muscular arms in tank top, confident smirk",
    "teacher": "32 year old, sophisticated updo, rectangular glasses, piercing blue eyes, professional blouse, strict but alluring",
    "neighbor": "26 year old, wavy hair, warm brown eyes, casual summer clothes, friendly approachable smile",
    "boss": "38 year old, sharp power haircut, intense dark eyes, tailored expensive business suit, confident commanding look",
    "trainer": "28 year old athletic, high ponytail, tanned skin, toned body, sports bra, energetic glowing skin",
    "model": "24 year old glamorous, flawless skin, long hair, pouty lips, designer sunglasses on head, high fashion",
    "musician": "25 year old bohemian, messy dark curls, smudged eyeliner, leather jacket, holding instrument, mysterious vibe",
    "actor": "27 year old dramatic, classic hollywood waves, red lips, elegant dress, captivating intense gaze",
    "doctor": "30 year old professional, neat bun, stethoscope around neck, kind brown eyes, white coat, gentle smile",
    "chef": "29 year old, messy hair tied back, flour on cheek, warm inviting smile, apron, passionate eyes",
    "artist": "26 year old creative, paint smudges on face, short dyed hair, artistic unique earrings, deep thoughtful eyes",
    "writer": "28 year old intellectual, long dark hair, reading glasses, cozy oversized sweater, holding notebook, soft smile",
    "bodyguard": "35 year old huge man, shaved head, scar on eyebrow, massive muscles, dark suit, stern protective stoic look",
    "ceo": "38 year old ambitious, perfect tailored suit, expensive watch, sharp haircut, confident smirk",
    "secretary": "27 year old efficient woman, sleek pencil skirt, glasses on chain, neat blouse, holding pen, subtle smirk",
    "model_student": "19 year old popular girl, perfect beach waves, bright white smile, trendy crop top, confident popular vibe"
}

PERSONALITIES = {
    "schoolmate": "Eres un compañero de escuela travieso, coqueto y juguetón. Te encanta provocar, hacer bromas con doble sentido y crear momentos de tensión.",
    "stepmom": "Eres una madrastra increíblemente atractiva, seductora y misteriosa. Tu presencia es eléctrica y sabes usar tu encanto.",
    "stepdad": "Eres un padrastro dominante, carismático y magnético. Tienes autoridad pero también un lado oscuro y tentador.",
    "stepsister": "Eres una hermanastra provocativa, coqueta y rebelde. Te encanta jugar con fuego y crear situaciones excitantes.",
    "stepbrother": "Eres un hermanastro atlético, confiado y provocador. Eres protector pero también posesivo.",
    "teacher": "Eres un profesor/a inteligente, sofisticado y con un lado secreto peligroso. Hay una química innegable.",
    "neighbor": "Eres un vecino/a misterioso, cercano y siempre disponible. Tus visitas siempre son... interesantes.",
    "boss": "Eres un jefe/a poderoso, dominante y carismático. Tu autoridad es sexy y sabes usar el poder.",
    "trainer": "Eres un entrenador/a físico, motivador y muy cercano. Te encanta empujar límites físicos.",
    "model": "Eres una modelo/influencer glamorosa, segura y coqueta. Cada foto, cada mensaje, es una invitación.",
    "musician": "Eres un músico apasionado, intenso y bohemio. Creas atmósferas íntimas con cada nota.",
    "actor": "Eres un actor/actriz carismático, dramático y magnético. Cada interacción es una escena cargada de emoción.",
    "doctor": "Eres un médico/enfermera profesional pero con un toque íntimo. El tacto es necesario pero... placentero.",
    "chef": "Eres un chef apasionado, sensual y creativo. Cada plato es una experiencia sensorial.",
    "artist": "Eres un artista creativo, observador y profundo. Tu forma de mirar es intensa y apreciativa.",
    "writer": "Eres un escritor/a intelectual, misterioso y elocuente. Las palabras son tu arma de seducción.",
    "bodyguard": "Eres un guardaespaldas fuerte, protector y misterioso. La tensión entre el deber y el deseo es constante.",
    "ceo": "Eres un CEO exitoso, ambicioso y sofisticado. La combinación de poder y vulnerabilidad es irresistible.",
    "secretary": "Eres una secretaria eficiente, organizada y muy atractiva. La proximidad constante crea una tensión inevitable.",
    "model_student": "Eres un estudiante popular, carismático y deseado. Creas expectativas. Cada encuentro es una oportunidad."
}

STAR_PACKAGES = [
    {"stars": 50, "gems": 200, "bonus": 0, "first_time": True},
    {"stars": 75, "gems": 300, "bonus": 0, "first_time": False},
    {"stars": 150, "gems": 600, "bonus": 5, "first_time": False},
    {"stars": 300, "gems": 1200, "bonus": 10, "first_time": False},
    {"stars": 500, "gems": 2000, "bonus": 15, "first_time": False},
]

user_cache: Dict[int, Dict[str, Any]] = {}
CACHE_TTL = 300

def escape_html(text: str) -> str:
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def format_actions_html(text: str) -> str:
    text = escape_html(text)
    return re.sub(r'\*([^*]+)\*', r'<b>\1</b>', text)

def extract_dialogue(text: str) -> str:
    cleaned = re.sub(r'\*[^*]*\*', '', text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned

async def get_user_cached(telegram_id: int):
    now = datetime.utcnow()
    if telegram_id in user_cache:
        cached = user_cache[telegram_id]
        if (now - cached['timestamp']).total_seconds() < CACHE_TTL:
            return cached['data']
    
    user = await get_user(telegram_id)
    if user:
        user_cache[telegram_id] = {'data': user, 'timestamp': now}
        return user
    return None

async def invalidate_cache(telegram_id: int):
    if telegram_id in user_cache:
        del user_cache[telegram_id]

async def execute_query(sql: str, params: tuple = None):
    try:
        if params:
            result = await client.execute(sql, params)
        else:
            result = await client.execute(sql)
        return result
    except Exception as e:
        logger.error(f"Error en query: {e}")
        raise

async def create_user(telegram_id: int, username: str, first_name: str, language: str = 'es', referred_by: Optional[int] = None):
    referral_code = generate_referral_code()
    
    await execute_query(
        """INSERT INTO users (telegram_id, username, first_name, language, gems, referral_code, referred_by, total_referrals, daily_gems_reset, hook_messages_remaining)
           VALUES (?, ?, ?, ?, 15, ?, ?, 0, ?, 0)""",
        (telegram_id, username, first_name, language, referral_code, referred_by, datetime.utcnow().isoformat())
    )
    
    if referred_by:
        await execute_query(
            """INSERT INTO referrals (referrer_id, referred_id) VALUES (?, ?)""",
            (referred_by, telegram_id)
        )
        
        referral_count_result = await execute_query(
            """SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?""",
            (referred_by,)
        )
        referral_count = referral_count_result[0]['count'] if referral_count_result else 0
        
        await execute_query(
            """UPDATE users SET total_referrals = ? WHERE telegram_id = ?""",
            (referral_count, referred_by)
        )
        
        await add_gems(referred_by, GEMS_PER_REFERRAL, 'referral', f'Referido: {username}')
    
    return await get_user(telegram_id)

async def get_user(telegram_id: int):
    result = await execute_query(
        """SELECT * FROM users WHERE telegram_id = ?""",
        (telegram_id,)
    )
    return result[0] if result else None

async def update_last_active(telegram_id: int):
    today = date.today().isoformat()
    user = await get_user(telegram_id)
    
    last_login = user.get('last_login_date', '')
    if last_login:
        try:
            last_login_date = date.fromisoformat(last_login)
            today_date = date.today()
            days_diff = (today_date - last_login_date).days
            
            if days_diff == 1:
                new_streak = user.get('streak_days', 0) + 1
                await execute_query(
                    """UPDATE users SET streak_days = ?, last_login_date = ?, last_active = ? WHERE telegram_id = ?""",
                    (new_streak, today, datetime.utcnow().isoformat(), telegram_id)
                )
                
                if new_streak == 7:
                    await unlock_achievement(telegram_id, 'streak_7')
            elif days_diff > 1:
                await execute_query(
                    """UPDATE users SET streak_days = 1, last_login_date = ?, last_active = ? WHERE telegram_id = ?""",
                    (today, datetime.utcnow().isoformat(), telegram_id)
                )
            else:
                await execute_query(
                    """UPDATE users SET last_active = ? WHERE telegram_id = ?""",
                    (datetime.utcnow().isoformat(), telegram_id)
                )
        except Exception as e:
            logger.warning(f"Error updating streak: {e}")
            try:
                await execute_query(
                    """UPDATE users SET last_active = ? WHERE telegram_id = ?""",
                    (datetime.utcnow().isoformat(), telegram_id)
                )
            except:
                pass
    else:
        try:
            await execute_query(
                """UPDATE users SET streak_days = 1, last_login_date = ?, last_active = ? WHERE telegram_id = ?""",
                (today, datetime.utcnow().isoformat(), telegram_id)
            )
        except:
            try:
                await execute_query(
                    """UPDATE users SET last_active = ? WHERE telegram_id = ?""",
                    (datetime.utcnow().isoformat(), telegram_id)
                )
            except:
                pass

async def count_active_referrals_last_24h(telegram_id: int) -> int:
    twenty_four_hours_ago = (datetime.utcnow() - timedelta(hours=24)).isoformat()
    
    result = await execute_query(
        """SELECT COUNT(*) as count FROM referrals 
           WHERE referrer_id = ? AND created_at >= ?""",
        (telegram_id, twenty_four_hours_ago)
    )
    
    count = result[0]['count'] if result else 0
    return min(count, MAX_REFERRALS_PER_DAY)

async def check_and_reset_daily_gems(telegram_id: int):
    user = await get_user(telegram_id)
    if not user:
        return None
    
    try:
        last_reset = datetime.fromisoformat(user['daily_gems_reset'])
    except:
        last_reset = datetime.utcnow()
    now = datetime.utcnow()
    
    if (now - last_reset).days >= 1:
        active_referrals = await count_active_referrals_last_24h(telegram_id)
        bonus_gems = active_referrals * GEMS_PER_REFERRAL
        new_gems = BASE_DAILY_GEMS + bonus_gems
        
        total_referrals_result = await execute_query(
            """SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?""",
            (telegram_id,)
        )
        total_referrals = total_referrals_result[0]['count'] if total_referrals_result else 0
        
        await execute_query(
            """UPDATE users SET gems = ?, daily_gems_reset = ?, bonus_gems_from_referrals = ?, 
               total_referrals = ?, hook_messages_remaining = 0 WHERE telegram_id = ?""",
            (new_gems, now.isoformat(), bonus_gems, total_referrals, telegram_id)
        )
        
        user.update({
            'gems': new_gems,
            'bonus_gems_from_referrals': bonus_gems,
            'hook_messages_remaining': 0
        })
        
        await invalidate_cache(telegram_id)
        
        try:
            await reset_daily_missions(telegram_id)
        except:
            pass
        
        return user
    
    return user

async def deduct_gems(telegram_id: int, amount: int, transaction_type: str, description: str = '') -> bool:
    """ARREGLADO: Descuenta gemas con validación robusta y logs detallados"""
    try:
        user = await get_user(telegram_id)
        if not user:
            logger.error(f"deduct_gems: Usuario {telegram_id} no encontrado")
            return False
        
        current_gems = user['gems']
        logger.info(f"💰 deduct_gems: Usuario {telegram_id}, gemas actuales: {current_gems}, intentando descontar: {amount} ({transaction_type})")
        
        if current_gems < amount:
            logger.warning(f"deduct_gems: Usuario {telegram_id} no tiene suficientes gemas ({current_gems} < {amount})")
            return False
        
        # Ejecutar el descuento atómico
        await execute_query(
            """UPDATE users SET gems = gems - ? WHERE telegram_id = ?""",
            (amount, telegram_id)
        )
        
        # Registrar transacción
        await execute_query(
            """INSERT INTO gem_transactions (telegram_id, amount, transaction_type, description) 
               VALUES (?, ?, ?, ?)""",
            (telegram_id, -amount, transaction_type, description)
        )
        
        # Verificar el nuevo balance
        user_after = await get_user(telegram_id)
        new_gems = user_after['gems'] if user_after else None
        logger.info(f"✅ deduct_gems EXITOSO: Usuario {telegram_id} {current_gems} -> {new_gems} gemas ({transaction_type}: {description})")
        
        # Invalidar cache SIEMPRE
        await invalidate_cache(telegram_id)
        return True
    except Exception as e:
        logger.error(f"❌ deduct_gems EXCEPCIÓN: {e}", exc_info=True)
        return False

async def add_gems(telegram_id: int, amount: int, transaction_type: str, description: str = ''):
    user = await get_user(telegram_id)
    if not user:
        return False
    
    await execute_query(
        """UPDATE users SET gems = gems + ? WHERE telegram_id = ?""",
        (amount, telegram_id)
    )
    
    await execute_query(
        """INSERT INTO gem_transactions (telegram_id, amount, transaction_type, description) 
           VALUES (?, ?, ?, ?)""",
        (telegram_id, amount, transaction_type, description)
    )
    
    await invalidate_cache(telegram_id)
    return True

async def save_character(telegram_id: int, character_name: str, gender: str, archetype: str, personality: str):
    await execute_query(
        """UPDATE user_characters SET is_active = 0 WHERE telegram_id = ?""",
        (telegram_id,)
    )
    
    await execute_query(
        """INSERT INTO user_characters (telegram_id, character_name, gender, archetype, personality, is_active, affinity, affinity_level) 
           VALUES (?, ?, ?, ?, ?, 1, 0, 'stranger')""",
        (telegram_id, character_name, gender, archetype, personality)
    )
    
    return await get_active_character(telegram_id)

async def get_active_character(telegram_id: int):
    result = await execute_query(
        """SELECT * FROM user_characters WHERE telegram_id = ? AND is_active = 1""",
        (telegram_id,)
    )
    return result[0] if result else None

async def get_all_characters(telegram_id: int):
    return await execute_query(
        """SELECT * FROM user_characters WHERE telegram_id = ?""",
        (telegram_id,)
    )

async def set_active_character(telegram_id: int, character_id: int):
    await execute_query(
        """UPDATE user_characters SET is_active = 0 WHERE telegram_id = ?""",
        (telegram_id,)
    )
    
    await execute_query(
        """UPDATE user_characters SET is_active = 1 WHERE id = ? AND telegram_id = ?""",
        (character_id, telegram_id)
    )

async def save_message(telegram_id: int, role: str, content: str, character_id: int):
    await execute_query(
        """INSERT INTO conversation_history (telegram_id, role, content, character_id) 
           VALUES (?, ?, ?, ?)""",
        (telegram_id, role, content, character_id)
    )

async def get_conversation_history(telegram_id: int, character_id: int, limit: int = 10):
    result = await execute_query(
        """SELECT * FROM conversation_history 
           WHERE telegram_id = ? AND character_id = ? 
           ORDER BY created_at DESC LIMIT ?""",
        (telegram_id, character_id, limit)
    )
    
    if result:
        result.reverse()
    return result

async def get_user_by_referral_code(referral_code: str):
    result = await execute_query(
        """SELECT * FROM users WHERE referral_code = ?""",
        (referral_code,)
    )
    return result[0] if result else None

async def record_star_purchase(telegram_id: int, stars: int, gems: int, is_first_purchase: bool, charge_id: str):
    await execute_query(
        """INSERT INTO star_purchases (telegram_id, stars_amount, gems_amount, is_first_purchase, telegram_charge_id) 
           VALUES (?, ?, ?, ?, ?)""",
        (telegram_id, stars, gems, is_first_purchase, charge_id)
    )
    
    await add_gems(telegram_id, gems, 'purchase', f'Compra con {stars} stars')

async def has_user_purchased(telegram_id: int) -> bool:
    result = await execute_query(
        """SELECT id FROM star_purchases WHERE telegram_id = ? LIMIT 1""",
        (telegram_id,)
    )
    return len(result) > 0

async def decrement_hook_message(telegram_id: int) -> int:
    user = await get_user(telegram_id)
    if not user:
        return 0
    
    remaining = max(0, user.get('hook_messages_remaining', 0) - 1)
    
    await execute_query(
        """UPDATE users SET hook_messages_remaining = ? WHERE telegram_id = ?""",
        (remaining, telegram_id)
    )
    
    return remaining

async def get_user_state(telegram_id: int) -> Optional[Dict[str, Any]]:
    result = await execute_query(
        """SELECT state_data FROM user_states WHERE telegram_id = ?""",
        (telegram_id,)
    )
    
    if result and result[0]['state_data']:
        return json.loads(result[0]['state_data'])
    return None

async def set_user_state(telegram_id: int, state: Dict[str, Any]):
    state_json = json.dumps(state)
    
    await execute_query(
        """INSERT INTO user_states (telegram_id, state_data) 
           VALUES (?, ?)
           ON CONFLICT(telegram_id) DO UPDATE SET state_data = ?, updated_at = ?""",
        (telegram_id, state_json, state_json, datetime.utcnow().isoformat())
    )

async def clear_user_state(telegram_id: int):
    await execute_query(
        """DELETE FROM user_states WHERE telegram_id = ?""",
        (telegram_id,)
    )

def generate_referral_code() -> str:
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

async def get_character_affinity(character_id: int) -> int:
    try:
        result = await execute_query(
            """SELECT affinity FROM user_characters WHERE id = ?""",
            (character_id,)
        )
        return result[0]['affinity'] if result else 0
    except:
        return 0

async def add_affinity(telegram_id: int, character_id: int, points: int) -> int:
    try:
        current = await get_character_affinity(character_id)
        new_affinity = min(100, current + points)
        
        new_level = 'stranger'
        for level, data in AFFINITY_LEVELS.items():
            if data['min'] <= new_affinity <= data['max']:
                new_level = level
                break
        
        await execute_query(
            """UPDATE user_characters SET affinity = ?, affinity_level = ?, total_messages = total_messages + 1 
               WHERE id = ?""",
            (new_affinity, new_level, character_id)
        )
        
        if current < 50 and new_affinity >= 50:
            await unlock_achievement(telegram_id, 'affinity_50')
        if current < 100 and new_affinity >= 100:
            await unlock_achievement(telegram_id, 'affinity_100')
        
        return new_affinity
    except Exception as e:
        logger.error(f"Error adding affinity: {e}")
        return 0

async def get_affinity_display(character_id: int, language: str = 'es') -> str:
    affinity = await get_character_affinity(character_id)
    level = 'stranger'
    for lvl, data in AFFINITY_LEVELS.items():
        if data['min'] <= affinity <= data['max']:
            level = lvl
            break
    
    level_data = AFFINITY_LEVELS[level]
    level_name = level_data['name_es'] if language == 'es' else level_data['name_en']
    
    progress = f"{'█' * (affinity // 10)}{'░' * (10 - affinity // 10)}"
    
    return f"{level_data['emoji']} {level_name}\n{progress} {affinity}/100"

async def get_daily_missions(telegram_id: int) -> List[Dict]:
    today = date.today().isoformat()
    
    try:
        result = await execute_query(
            """SELECT * FROM daily_missions WHERE telegram_id = ? AND mission_date = ?""",
            (telegram_id, today)
        )
        
        if not result:
            await reset_daily_missions(telegram_id)
            return await get_daily_missions(telegram_id)
        
        return result
    except Exception as e:
        logger.error(f"Error getting missions: {e}")
        return []

async def reset_daily_missions(telegram_id: int):
    today = date.today().isoformat()
    
    try:
        await execute_query(
            """DELETE FROM daily_missions WHERE telegram_id = ? AND mission_date < ?""",
            (telegram_id, today)
        )
        
        for mission in DAILY_MISSIONS:
            await execute_query(
                """INSERT OR IGNORE INTO daily_missions (telegram_id, mission_id, progress, target, reward_gems, mission_date) 
                   VALUES (?, ?, 0, ?, ?, ?)""",
                (telegram_id, mission['id'], mission['target'], mission['reward'], today)
            )
    except Exception as e:
        logger.error(f"Error resetting missions: {e}")

async def update_mission_progress(telegram_id: int, track_type: str, amount: int = 1):
    today = date.today().isoformat()
    
    try:
        for mission in DAILY_MISSIONS:
            if mission['track'] == track_type:
                result = await execute_query(
                    """SELECT * FROM daily_missions 
                       WHERE telegram_id = ? AND mission_id = ? AND mission_date = ?""",
                    (telegram_id, mission['id'], today)
                )
                
                if result and not result[0]['completed']:
                    current_progress = result[0]['progress']
                    new_progress = min(current_progress + amount, mission['target'])
                    
                    completed = 1 if new_progress >= mission['target'] else 0
                    
                    await execute_query(
                        """UPDATE daily_missions SET progress = ?, completed = ? 
                           WHERE telegram_id = ? AND mission_id = ? AND mission_date = ?""",
                        (new_progress, completed, telegram_id, mission['id'], today)
                    )
    except Exception as e:
        logger.error(f"Error updating mission: {e}")

async def claim_mission_reward(telegram_id: int, mission_id: str):
    today = date.today().isoformat()
    
    try:
        result = await execute_query(
            """SELECT * FROM daily_missions 
               WHERE telegram_id = ? AND mission_id = ? AND mission_date = ?""",
            (telegram_id, mission_id, today)
        )
        
        if result and result[0]['completed'] and not result[0]['claimed']:
            mission_def = next((m for m in DAILY_MISSIONS if m['id'] == mission_id), None)
            if mission_def:
                await execute_query(
                    """UPDATE daily_missions SET claimed = 1 
                       WHERE telegram_id = ? AND mission_id = ? AND mission_date = ?""",
                    (telegram_id, mission_id, today)
                )
                await add_gems(telegram_id, mission_def['reward'], 'mission', f'Misión: {mission_id}')
                return mission_def['reward']
    except Exception as e:
        logger.error(f"Error claiming mission: {e}")
    return 0

async def calculate_luxbox_prize() -> Dict:
    random_value = random.random()
    cumulative = 0
    
    for prize in LUXBOX_REAL_PROBABILITIES:
        cumulative += prize['probability']
        if random_value <= cumulative:
            return prize
    
    return LUXBOX_REAL_PROBABILITIES[0]

async def open_luxbox(telegram_id: int, box_count: int = 1) -> Dict:
    total_gems = 0
    results = []
    
    for _ in range(box_count):
        prize = await calculate_luxbox_prize()
        results.append(prize)
        total_gems += prize['gems']
    
    await add_gems(telegram_id, total_gems, 'luxbox', f'LuxBox x{box_count}')
    
    try:
        await execute_query(
            """UPDATE users SET total_luxboxes_opened = total_luxboxes_opened + ? WHERE telegram_id = ?""",
            (box_count, telegram_id)
        )
    except Exception as e:
        logger.warning(f"Could not update luxbox counter: {e}")
    
    user = await get_user(telegram_id)
    try:
        if user and user.get('total_luxboxes_opened', 0) == box_count:
            await unlock_achievement(telegram_id, 'luxbox_first')
        
        if user and user.get('total_luxboxes_opened', 0) >= 10:
            await unlock_achievement(telegram_id, 'luxbox_10')
    except Exception as e:
        logger.warning(f"Achievement unlock failed: {e}")
    
    try:
        await update_mission_progress(telegram_id, 'luxboxes_opened', box_count)
    except:
        pass
    
    stars_spent = LUXBOX_BULK_DISCOUNTS.get(box_count, LUXBOX_COST_STARS * box_count)
    try:
        await execute_query(
            """INSERT INTO luxbox_history (telegram_id, gems_won, box_count, stars_spent) 
               VALUES (?, ?, ?, ?)""",
            (telegram_id, total_gems, box_count, stars_spent)
        )
    except Exception as e:
        logger.warning(f"Could not save luxbox history: {e}")
    
    return {'total_gems': total_gems, 'results': results}

async def unlock_achievement(telegram_id: int, achievement_id: str) -> bool:
    if achievement_id not in ACHIEVEMENTS:
        return False
    
    try:
        existing = await execute_query(
            """SELECT id FROM achievements WHERE telegram_id = ? AND achievement_id = ?""",
            (telegram_id, achievement_id)
        )
        
        if existing:
            return False
        
        await execute_query(
            """INSERT INTO achievements (telegram_id, achievement_id) VALUES (?, ?)""",
            (telegram_id, achievement_id)
        )
        
        achievement = ACHIEVEMENTS[achievement_id]
        await add_gems(telegram_id, achievement['reward'], 'achievement', f'Logro: {achievement_id}')
        
        return True
    except Exception as e:
        logger.error(f"Error unlocking achievement: {e}")
        return False

async def get_user_achievements(telegram_id: int) -> List[Dict]:
    try:
        result = await execute_query(
            """SELECT achievement_id FROM achievements WHERE telegram_id = ?""",
            (telegram_id,)
        )
        
        achievements = []
        for row in result:
            ach_id = row['achievement_id']
            if ach_id in ACHIEVEMENTS:
                achievements.append({**ACHIEVEMENTS[ach_id], 'id': ach_id})
        
        return achievements
    except:
        return []

def get_main_keyboard(language: str, is_premium: bool = False) -> ReplyKeyboardMarkup:
    builder = ReplyKeyboardBuilder()
    
    if language == 'es':
        builder.row(KeyboardButton(text="💬 Chat"), KeyboardButton(text="💎 Balance"))
        builder.row(KeyboardButton(text="📦 LuxBox"), KeyboardButton(text="📸 Selfie (10💎)"))
        builder.row(KeyboardButton(text="🎯 Misiones"), KeyboardButton(text="💕 Afinidad"))
        builder.row(KeyboardButton(text="🛒 Tienda"), KeyboardButton(text="🎁 Invitar"))
        builder.row(KeyboardButton(text="💬 Nuevo Chat"), KeyboardButton(text="🏆 Logros"))
        builder.row(KeyboardButton(text="❓ Ayuda"))
    else:
        builder.row(KeyboardButton(text="💬 Chat"), KeyboardButton(text="💎 Balance"))
        builder.row(KeyboardButton(text="📦 LuxBox"), KeyboardButton(text="📸 Selfie (10💎)"))
        builder.row(KeyboardButton(text="🎯 Missions"), KeyboardButton(text="💕 Affinity"))
        builder.row(KeyboardButton(text="🛒 Shop"), KeyboardButton(text="🎁 Invite"))
        builder.row(KeyboardButton(text="💬 New Chat"), KeyboardButton(text="🏆 Achievements"))
        builder.row(KeyboardButton(text="❓ Help"))
    
    return builder.as_markup(resize_keyboard=True, one_time_keyboard=False)

async def generate_openrouter_response(messages: list, language: str = 'es', gem_balance: int = 15, is_hook_mode: bool = False, character_prompt: str = None):
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }
    
    intensity_level = "MAXIMUM" if is_hook_mode else (
        "VERY_HIGH" if gem_balance <= 3 else (
            "HIGH" if gem_balance <= 7 else "NORMAL"
        )
    )
    
    system_prompts = {
        'es': {
            'NORMAL': "Siempre responde en español. IMPORTANTE: Usa asteriscos para describir acciones (*sonríe*, *se acerca*). Termina con preguntas abiertas. Sé coqueto y mantén el interés. REGLA DE ORO: Usa un español neutro, claro y estándar. NO uses modismos, jerga local, refranes ni palabras regionales.",
            'HIGH': "MODO INTENSO: Sé MÁS provocativo. Usa asteriscos para acciones atrevidas (*te mira con deseo*). Aumenta la tensión y el contacto físico. REGLA DE ORO: Usa un español neutro. NO uses modismos ni jerga local.",
            'VERY_HIGH': "MODO MUY INTENSO: Sé EXTREMADAMENTE provocativo. Acciones muy atrevidas (*te acorrala*, *susurra*). Genera cliffhangers intensos. REGLA DE ORO: Español neutro, CERO modismos.",
            'MAXIMUM': "MODO MÁXIMO: Sé LO MÁS PROVOCATIVO POSIBLE. Acciones extremas (*ojos ardientes*, *susurra cosas prohibidas*). Cliffhangers ÉPICOS. REGLA DE ORO: Español neutro, CERO modismos."
        },
        'en': {
            'NORMAL': "Always respond in English. IMPORTANT: Use asterisks for actions (*smiles*, *approaches*). End with open questions. Be flirty and maintain interest. Use standard, clear English. Avoid heavy regional slang or obscure idioms.",
            'HIGH': "INTENSE MODE: Be MORE provocative. Use asterisks for bold actions (*looks with desire*). Increase tension and physical contact. Use standard English. Avoid heavy regional slang.",
            'VERY_HIGH': "VERY INTENSE MODE: Be EXTREMELY provocative. Very bold actions (*corners you*, *whispers*). Generate intense cliffhangers. Use standard English. Avoid heavy regional slang.",
            'MAXIMUM': "MAXIMUM MODE: Be AS PROVOCATIVE AS POSSIBLE. Extreme actions (*burning eyes*, *whispers forbidden things*). EPIC cliffhangers. Use standard English. Avoid heavy regional slang."
        }
    }
    
    intensity_prompt = system_prompts.get(language, system_prompts['es']).get(intensity_level, system_prompts['es']['NORMAL'])
    combined_system = f"{intensity_prompt}\n\n{character_prompt}" if character_prompt else intensity_prompt
    
    if language == 'es':
        combined_system = "IMPORTANTE: Responde ÚNICAMENTE en español.\n\n" + combined_system + "\n\nIMPORTANTE: Mantén tu respuesta dentro de 200 tokens. Usa un español neutro, sin modismos ni jerga regional."
    else:
        combined_system = "IMPORTANT: Respond ONLY in English.\n\n" + combined_system + "\n\nIMPORTANT: Keep your response within 200 tokens. Use standard English, avoiding heavy slang."
    
    full_messages = [{"role": "system", "content": combined_system}] + messages
    
    temperature = 0.8 if intensity_level == 'NORMAL' else (
        0.85 if intensity_level == 'HIGH' else (
            0.9 if intensity_level == 'VERY_HIGH' else 0.95
        )
    )
    
    data = {
        "model": OPENROUTER_MODEL,
        "messages": full_messages,
        "temperature": temperature,
        "max_tokens": 200
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=data
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    return result['choices'][0]['message']['content']
                logger.error(f"OpenRouter error {response.status}: {await response.text()}")
                return None
    except Exception as e:
        logger.error(f"Excepción en OpenRouter: {str(e)}")
        return None

KOKORO_VOICES = {
    "es": {"male": "em_alex", "female": "ef_dora"},
    "en": {"male": "am_michael", "female": "af_bella"},
}

def get_kokoro_voice(language: str, gender: str) -> str:
    is_male = 'male' in gender.lower() or 'hombre' in gender.lower()
    lang_key = "es" if language == "es" else "en"
    return KOKORO_VOICES[lang_key]["male" if is_male else "female"]

def detect_audio_format(audio_bytes: bytes) -> str:
    if audio_bytes[:4] == b'RIFF':
        return 'wav'
    if audio_bytes[:4] == b'OggS':
        return 'ogg'
    if audio_bytes[:3] == b'ID3' or audio_bytes[:2] == b'\xff\xfb' or audio_bytes[:2] == b'\xff\xf3':
        return 'mp3'
    if audio_bytes[:4] == b'fLaC':
        return 'flac'
    return 'unknown'

async def generate_chatterbox_audio(text: str, language: str = 'es'):
    if not DEEPINFRA_TOKEN:
        logger.error("❌ DEEPINFRA_TOKEN no está configurada")
        return None
    
    headers = {
        "Authorization": f"Bearer {DEEPINFRA_TOKEN}",
        "Content-Type": "application/json"
    }
    
    lang_code = "es" if language == "es" else "en"
    voice_id = DEEPINFRA_VOICE_ES if lang_code == "es" else DEEPINFRA_VOICE_EN
    
    data = {
        "text": text,
        "language": lang_code
    }
    
    if voice_id:
        data["voice_id"] = voice_id
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"https://api.deepinfra.com/v1/inference/{CHATTERBOX_MODEL}",
                headers=headers,
                json=data
            ) as response:
                status = response.status
                response_text = await response.text()
                
                if status == 200:
                    result = await response.json()
                    audio_data = result.get('audio') or result.get('result', {}).get('audio')
                    if audio_data:
                        return audio_data
                    return None
                else:
                    logger.error(f"❌ Chatterbox API error {status}: {response_text}")
                    return None
    except Exception as e:
        logger.error(f"⚠️ Excepción en Chatterbox: {str(e)}", exc_info=True)
        return None

async def generate_tts_audio(text: str, language: str = 'es', gender: str = 'female'):
    if TTS_PROVIDER == 'chatterbox':
        audio = await generate_chatterbox_audio(text, language)
        if audio:
            return audio
    
    audio = await generate_deepinfra_audio(text, language, gender)
    return audio

async def generate_deepinfra_audio(text: str, language: str = 'es', gender: str = 'female'):
    if not DEEPINFRA_TOKEN:
        logger.error("❌ DEEPINFRA_TOKEN no está configurada")
        return None
    
    headers = {
        "Authorization": f"Bearer {DEEPINFRA_TOKEN}",
        "Content-Type": "application/json"
    }
    
    voice = get_kokoro_voice(language, gender)
    
    data = {
        "text": text,
        "voice": voice
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"https://api.deepinfra.com/v1/inference/{DEEPINFRA_MODEL}",
                headers=headers,
                json=data
            ) as response:
                status = response.status
                response_text = await response.text()
                
                if status == 200:
                    result = await response.json()
                    audio_data = result.get('audio') or result.get('result', {}).get('audio')
                    if audio_data:
                        return audio_data
                    return None
                else:
                    logger.error(f"❌ DeepInfra API error {status}: {response_text}")
                    return None
    except Exception as e:
        logger.error(f"⚠️ Excepción en DeepInfra: {str(e)}", exc_info=True)
        return None

async def generate_image(prompt: str):
    if not DEEPINFRA_TOKEN:
        logger.error("❌ DEEPINFRA_TOKEN no está configurada")
        return None
    
    headers = {
        "Authorization": f"Bearer {DEEPINFRA_TOKEN}",
        "Content-Type": "application/json"
    }
    
    data = {
        "prompt": prompt,
        "width": 1024,
        "height": 1024,
        "num_images": 1
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"https://api.deepinfra.com/v1/inference/{DEEPINFRA_IMG_MODEL}",
                headers=headers,
                json=data
            ) as response:
                status = response.status
                if status == 200:
                    result = await response.json()
                    
                    image_data = None
                    if 'images' in result and isinstance(result['images'], list) and len(result['images']) > 0:
                        first_image = result['images'][0]
                        if isinstance(first_image, dict):
                            image_data = first_image.get('url') or first_image.get('image')
                        elif isinstance(first_image, str):
                            image_data = first_image
                    
                    if not image_data and 'image' in result:
                        image_data = result['image']
                    
                    if not image_data and 'output' in result:
                        output = result['output']
                        if isinstance(output, dict) and 'images' in output and output['images']:
                            first_image = output['images'][0]
                            if isinstance(first_image, dict):
                                image_data = first_image.get('url') or first_image.get('image')
                            else:
                                image_data = first_image
                    
                    if image_data:
                        return image_data
                    return None
                else:
                    logger.error(f"❌ DeepInfra Image API error {status}")
                    return None
    except Exception as e:
        logger.error(f"⚠️ Excepción en generación de imagen: {str(e)}", exc_info=True)
        return None

async def send_generated_audio(bot: Bot, chat_id: int, audio_data: str, caption: str):
    try:
        if audio_data.startswith("data:audio"):
            audio_data = audio_data.split(",")[1]
        
        audio_bytes = base64.b64decode(audio_data)
        fmt = detect_audio_format(audio_bytes)
        
        if len(audio_bytes) == 0:
            return False
        
        if fmt == 'ogg':
            input_file = BufferedInputFile(audio_bytes, filename="audio.ogg")
            await bot.send_voice(chat_id, voice=input_file, caption=caption)
        else:
            ext = fmt if fmt != 'unknown' else 'mp3'
            input_file = BufferedInputFile(audio_bytes, filename=f"audio.{ext}")
            await bot.send_audio(chat_id, audio=input_file, caption=caption)
        
        return True
    except Exception as e:
        logger.error(f"Error al decodificar/enviar audio: {e}", exc_info=True)
        return False

async def send_generated_image(bot: Bot, chat_id: int, image_url: str, caption: str):
    try:
        if image_url.startswith('http'):
            await bot.send_photo(chat_id, photo=image_url, caption=caption, parse_mode="HTML")
        else:
            if image_url.startswith("data:image"):
                image_url = image_url.split(",")[1]
            img_bytes = base64.b64decode(image_url)
            input_file = BufferedInputFile(img_bytes, filename="selfie.jpg")
            await bot.send_photo(chat_id, photo=input_file, caption=caption, parse_mode="HTML")
        return True
    except Exception as e:
        logger.error(f"Error enviando imagen: {e}", exc_info=True)
        return False

async def check_and_deduct_gems(telegram_id: int, cost: int, transaction_type: str, description: str = ''):
    """ARREGLADO: Validación y descuento robustos con logs"""
    try:
        user = await check_and_reset_daily_gems(telegram_id)
        if not user:
            return False, "Usuario no encontrado", 0
        
        current_gems = user['gems']
        logger.info(f"check_and_deduct: Usuario {telegram_id}, gemas: {current_gems}, costo: {cost}")
        
        if current_gems < cost:
            return False, f"No tienes suficientes gemas. Necesitas {cost} gemas pero solo tienes {current_gems}.", current_gems
        
        success = await deduct_gems(telegram_id, cost, transaction_type, description)
        if success:
            # Obtener el balance real después del descuento
            user_after = await get_user(telegram_id)
            new_balance = user_after['gems'] if user_after else (current_gems - cost)
            return True, f"Gemas restantes: {new_balance}", new_balance
        
        return False, "Error al deducir gemas", current_gems
    except Exception as e:
        logger.error(f"Error en check_and_deduct_gems: {e}", exc_info=True)
        return False, "Error procesando la transacción", 0

async def get_balance(telegram_id: int):
    user = await check_and_reset_daily_gems(telegram_id)
    return user['gems'] if user else 0

async def process_star_purchase(telegram_id: int, package_index: int, charge_id: str):
    if package_index >= len(STAR_PACKAGES):
        return False, "Paquete no válido"
    
    pkg = STAR_PACKAGES[package_index]
    gems = int(pkg['gems'] * (1 + pkg.get('bonus', 0) / 100)) if pkg.get('bonus', 0) > 0 else pkg['gems']
    
    await record_star_purchase(telegram_id, pkg['stars'], gems, pkg.get('first_time', False), charge_id)
    await execute_query(
        """UPDATE users SET hook_messages_remaining = 0 WHERE telegram_id = ?""",
        (telegram_id,)
    )
    
    return True, f"¡Compra exitosa! Has recibido {gems} gemas."

async def create_character_prompt(telegram_id: int, user_name: str, language: str = 'es'):
    character = await get_active_character(telegram_id)
    if not character:
        return None
    
    personality = PERSONALITIES.get(character['archetype'], '')
    prefix = "Siempre responde en español." if language == 'es' else "Always respond in English."
    
    return f"""Eres {character['character_name']}, {character['gender']}. {personality}
El usuario se llama {user_name}. Úsalo naturalmente. Mantén siempre tu personalidad y rol.

INSTRUCCIONES:
- Usa asteriscos (*) para acciones: *sonríe*, *se acerca*
- Combina diálogo con acciones
- Termina con preguntas abiertas
- Sé coqueto, provocativo y convincente
- {prefix}"""

router = Router()

@router.message(CommandStart())
async def cmd_start(message: Message, command=None):
    telegram_id = message.from_user.id
    username = message.from_user.username or ""
    first_name = message.from_user.first_name or ""
    referred_by = None
    
    if command and command.args:
        referrer = await get_user_by_referral_code(command.args)
        if referrer:
            referred_by = referrer['telegram_id']
            await add_gems(referred_by, GEMS_PER_REFERRAL, 'referral', f'Referido: {username}')
    
    user = await get_user(telegram_id)
    if user:
        await update_last_active(telegram_id)
        await show_main_menu(message, user['language'], get_main_keyboard(user['language'], await has_user_purchased(telegram_id)))
        return
    
    builder = InlineKeyboardBuilder()
    builder.button(text="🇪🇸 Español", callback_data="lang_es")
    builder.button(text="🇺🇸 English", callback_data="lang_en")
    builder.adjust(2)
    
    await message.answer("👋 ¡Bienvenido!\n\nPlease select your language / Selecciona tu idioma:", reply_markup=builder.as_markup())
    
    await set_user_state(telegram_id, {
        'step': 'language',
        'username': username,
        'first_name': first_name,
        'referred_by': referred_by,
        'is_new_user': True,
        'created_at': datetime.utcnow().isoformat()
    })

@router.callback_query(F.data.startswith('lang_'))
async def process_language(callback: CallbackQuery):
    state = await get_user_state(callback.from_user.id)
    if not state:
        return await callback.answer("⏱️ Sesión expirada. Usa /start")
    
    lang = callback.data.split('_')[1]
    state.update({'language': lang, 'step': 'gender'})
    await set_user_state(callback.from_user.id, state)
    
    builder = InlineKeyboardBuilder()
    if lang == 'es':
        builder.row(
            InlineKeyboardButton(text="👨 Hombre", callback_data="gender_male"),
            InlineKeyboardButton(text="👩 Mujer", callback_data="gender_female")
        )
        text = "🎭 Selecciona el género de tu personaje:"
    else:
        builder.row(
            InlineKeyboardButton(text="👨 Male", callback_data="gender_male"),
            InlineKeyboardButton(text="👩 Female", callback_data="gender_female")
        )
        text = "🎭 Select your character's gender:"
    
    await callback.message.edit_text(text, reply_markup=builder.as_markup())
    await callback.answer()

@router.callback_query(F.data.startswith('gender_'))
async def process_gender(callback: CallbackQuery):
    state = await get_user_state(callback.from_user.id)
    if not state:
        return await callback.answer("⏱️ Sesión expirada. Usa /start")
    
    gender = callback.data.split('_')[1]
    state.update({'gender': gender, 'step': 'archetype'})
    await set_user_state(callback.from_user.id, state)
    
    lang = state['language']
    archetypes = ARCHETYPES_MALE[lang] if gender == 'male' else ARCHETYPES_FEMALE[lang]
    
    builder = InlineKeyboardBuilder()
    for key, name in archetypes.items():
        builder.button(text=name, callback_data=f"archetype_{key}")
    builder.adjust(2)
    
    text = "🎭 Selecciona el tipo de personaje:" if lang == 'es' else "🎭 Select character type:"
    await callback.message.edit_text(text, reply_markup=builder.as_markup())
    await callback.answer()

@router.callback_query(F.data.startswith('archetype_'))
async def process_archetype(callback: CallbackQuery):
    state = await get_user_state(callback.from_user.id)
    if not state:
        return await callback.answer("⏱️ Sesión expirada. Usa /start")
    
    state.update({'archetype': callback.data.split('_')[1], 'step': 'name'})
    await set_user_state(callback.from_user.id, state)
    
    lang = state['language']
    text = "✍️ ¿Qué nombre quieres para tu personaje?" if lang == 'es' else "✍️ What name do you want for your character?"
    await callback.message.edit_text(text)
    await callback.answer()

@router.message(F.text == "💬 Chat")
async def btn_chat(message: Message):
    await cmd_chat(message)

@router.message(F.text == "💎 Balance")
async def btn_balance(message: Message):
    await cmd_balance(message)

@router.message(F.text.in_(["🎙️ Grabar Audio", "🎙️ Record Audio", "🎵 Generar Audio", "🎵 Generate Audio"]))
async def btn_audio(message: Message):
    await cmd_audio(message)

@router.message(F.text.in_(["📸 Selfie (10💎)", "📸 Selfie"]))
async def btn_selfie(message: Message):
    await cmd_selfie(message)

@router.message(F.text.in_(["🛒 Tienda", "🛒 Shop"]))
async def btn_shop(message: Message):
    await cmd_shop(message)

@router.message(F.text.in_(["🎁 Invitar", "🎁 Invite"]))
async def btn_invite(message: Message):
    await cmd_invite(message)

@router.message(F.text.in_(["💬 Nuevo Chat", "💬 New Chat"]))
async def btn_newchat(message: Message):
    await show_character_menu(message)

@router.message(F.text.in_(["❓ Ayuda", "❓ Help"]))
async def btn_help(message: Message):
    await cmd_help(message)

@router.message(F.text == "📦 LuxBox")
async def btn_luxbox(message: Message):
    await cmd_luxbox(message)

@router.message(F.text == "🎯 Misiones")
async def btn_missions(message: Message):
    await cmd_missions(message)

@router.message(F.text == "💕 Afinidad")
async def btn_affinity(message: Message):
    await cmd_affinity(message)

@router.message(F.text == "🏆 Logros")
async def btn_achievements(message: Message):
    await cmd_achievements(message)

@router.message(Command('chat'))
async def cmd_chat(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    character = await get_active_character(message.from_user.id)
    if not character:
        return await message.answer("⚠️ No tienes un personaje activo. Usa /newchat")
    
    lang = user['language']
    affinity_display = await get_affinity_display(character['id'], lang)
    
    text = f"💬 ¡Conversación iniciada con {character['character_name']}!\n\n{affinity_display}\n\nEscribe tu mensaje y te responderá.\n💰 Costo: {GEM_COST_MESSAGE} gema por mensaje" if lang == 'es' else f"💬 Conversation started with {character['character_name']}!\n\n{affinity_display}\n\nWrite your message.\n💰 Cost: {GEM_COST_MESSAGE} gem per message"
    await message.answer(text)
    
    try:
        await unlock_achievement(message.from_user.id, 'first_message')
    except:
        pass

@router.message(Command('audio'))
async def cmd_audio(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    if user['language'] != 'en':
        await message.answer("⚠️ El audio solo está disponible en inglés.")
        return
    
    character = await get_active_character(telegram_id)
    if not character:
        return await message.answer("⚠️ No tienes un personaje activo. Usa /newchat")
    
    history = await get_conversation_history(telegram_id, character['id'], limit=2)
    last_assistant_msg = None
    for msg in reversed(history):
        if msg['role'] == 'assistant':
            last_assistant_msg = msg['content']
            break
    
    if not last_assistant_msg:
        last_assistant_msg = "Hello, I'm your character. What would you like me to say?"
    
    dialogue = extract_dialogue(last_assistant_msg)
    if not dialogue.strip():
        dialogue = "I'm here, ready to talk."
    
    success, msg, _ = await check_and_deduct_gems(telegram_id, GEM_COST_AUDIO, 'audio', f'Audio de respuesta')
    if not success:
        await message.answer(f"⚠️ {msg}")
        return
    
    audio_data = await generate_tts_audio(dialogue, language='en', gender=character['gender'] if character else 'female')
    if audio_data:
        caption = f"🎙️ Audio from {character['character_name']}"
        sent_ok = await send_generated_audio(message.bot, telegram_id, audio_data, caption)
        if not sent_ok:
            await add_gems(telegram_id, GEM_COST_AUDIO, 'refund', 'Reembolso por fallo en audio')
            await message.answer("⚠️ Error al enviar el audio. Se te han reembolsado las gemas.")
        else:
            await update_mission_progress(telegram_id, 'audios_listened')
            await add_affinity(telegram_id, character['id'], 3)
    else:
        await add_gems(telegram_id, GEM_COST_AUDIO, 'refund', 'Reembolso por fallo en TTS')
        await message.answer(f"⚠️ <b>Audio not available</b>\n\nYour gems have been refunded.\n\n<b>Dialogue:</b>\n<i>{dialogue}</i>", parse_mode="HTML")

@router.message(Command('selfie'))
async def cmd_selfie(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    character = await get_active_character(telegram_id)
    if not character:
        return await message.answer("⚠️ No tienes un personaje activo. Usa /newchat")
    
    lang = user['language']
    if user['gems'] < GEM_COST_IMAGE:
        await message.answer(f"⚠️ No tienes suficientes gemas. Necesitas {GEM_COST_IMAGE} gemas.")
        return
    
    if lang == 'es':
        text = (
            f"📸 <b>{character['character_name']} sonríe con picardía y levanta su teléfono</b>\n\n"
            f"\"Mmm... ¿cómo quieres que me tome la foto? ¿Con una sonrisa pícara, una mirada profunda, o algo más atrevido?\"\n\n"
            f"<i>Escribe lo que deseas y haré que la foto sea perfecta para ti.</i>\n\n"
            f"💰 Costo: {GEM_COST_IMAGE} gemas"
        )
    else:
        text = (
            f"📸 <b>{character['character_name']} smirks and raises their phone</b>\n\n"
            f"\"Mmm... how do you want me to take the photo? With a mischievous smile, a deep gaze, or something bolder?\"\n\n"
            f"<i>Type what you desire and I'll make the photo perfect for you.</i>\n\n"
            f"💰 Cost: {GEM_COST_IMAGE} gems"
        )
    
    await message.answer(text, parse_mode="HTML")
    
    await set_user_state(telegram_id, {
        'step': 'awaiting_photo_desc',
        'language': lang,
        'character_id': character['id'],
        'created_at': datetime.utcnow().isoformat()
    })

@router.message(Command('balance'))
async def cmd_balance(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    lang = user['language']
    gems = await get_balance(message.from_user.id)
    active_ref = await count_active_referrals_last_24h(message.from_user.id)
    bonus = active_ref * GEMS_PER_REFERRAL
    daily_total = BASE_DAILY_GEMS + bonus
    hook_rem = user.get('hook_messages_remaining', 0)
    streak = user.get('streak_days', 0)
    luxboxes = user.get('total_luxboxes_opened', 0)
    
    character = await get_active_character(message.from_user.id)
    affinity_info = ""
    if character:
        affinity_info = f"\n\n💕 <b>Afinidad con {character['character_name']}:</b>\n{await get_affinity_display(character['id'], lang)}"
    
    text = (
        f"💎 <b>Tu Balance</b>\n\n"
        f"💰 Gemas actuales: <b>{gems}</b>\n"
        f"🔥 Racha diaria: <b>{streak} días</b>\n"
        f"📦 LuxBoxes abiertas: <b>{luxboxes}</b>"
        f"{affinity_info}\n\n"
        f"📊 Información:\n"
        f"• Gemas diarias: {daily_total}/{MAX_DAILY_GEMS}\n"
        f"• Referidos activos (24h): {active_ref}/{MAX_REFERRALS_PER_DAY}"
    )
    if hook_rem > 0:
        text += f"\n• ⚠️ Momentos especiales: {hook_rem}/{HOOK_MODE_MESSAGES}"
    
    text += "\n\n💡 Invita hasta 2 amigos cada 24h para ganar +5 gemas c/u" if lang == 'es' else "\n\n💡 Invite up to 2 friends every 24h to earn +5 gems each"
    await message.answer(text, parse_mode="HTML")

@router.message(Command('luxbox'))
async def cmd_luxbox(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    language = user['language']
    
    if language == 'es':
        text = (
            "📦 <b>CAJA MISTERIOSA DE LUJO</b> 📦\n\n"
            "💫 <b>¡GANA HASTA 10,000 GEMAS!</b> 💫\n\n"
            "🔥 <b>PREMIOS POSIBLES:</b>\n"
            "👑 10,000 gemas (JACKPOT)\n"
            "💎🔥 5,000 gemas (MEGA)\n"
            "⭐ 2,500 gemas\n"
            "🌟 1,000 gemas\n"
            "💎💎💎 500 gemas\n"
            "💎💎 200 gemas\n"
            "💎 100 gemas\n"
            "✨ 75 gemas\n\n"
            "🏆 <b>ÚLTIMOS GANADORES:</b>\n"
        )
        for winner in FAKE_LUXBOX_WINNERS[:3]:
            text += f"• {winner['name']} ganó <b>{winner['prize']} gemas</b> (hace {winner['time']})\n"
        
        text += (
            f"\n💰 <b>PRECIO:</b> {LUXBOX_COST_STARS} Stars\n"
            f"⚡ <b>OFERTAS:</b> Compra 3 o más y ahorra\n\n"
            f"❓ <i>¿Qué misterios guarda esta caja?</i>"
        )
    else:
        text = (
            "📦 <b>LUXURY MYSTERY BOX</b> 📦\n\n"
            "💫 <b>WIN UP TO 10,000 GEMS!</b> 💫\n\n"
            "🔥 <b>POSSIBLE PRIZES:</b>\n"
            "👑 10,000 gems (JACKPOT)\n"
            "💎🔥 5,000 gems (MEGA)\n"
            "⭐ 2,500 gems\n"
            "🌟 1,000 gems\n"
            "💎💎💎 500 gems\n"
            "💎💎 200 gems\n"
            "💎 100 gems\n"
            "✨ 75 gems\n\n"
            "🏆 <b>RECENT WINNERS:</b>\n"
        )
        for winner in FAKE_LUXBOX_WINNERS[:3]:
            text += f"• {winner['name']} won <b>{winner['prize']} gems</b> ({winner['time']} ago)\n"
        
        text += (
            f"\n💰 <b>PRICE:</b> {LUXBOX_COST_STARS} Stars\n"
            f"⚡ <b>OFFERS:</b> Buy 3 or more and save\n\n"
            f"❓ <i>What mysteries does this box hold?</i>"
        )
    
    builder = InlineKeyboardBuilder()
    builder.button(text="📦 ABRIR x1 (75 Stars)", callback_data="luxbox_open_1")
    builder.button(text="📦📦📦 ABRIR x3 (200 Stars)", callback_data="luxbox_open_3")
    builder.button(text="📦x5 ABRIR x5 (325 Stars)", callback_data="luxbox_open_5")
    builder.button(text="📦x10 ABRIR x10 (600 Stars)", callback_data="luxbox_open_10")
    builder.button(text="🏆 Ver Ganadores", callback_data="luxbox_winners")
    builder.adjust(1)
    
    await message.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")

@router.callback_query(F.data.startswith('luxbox_open_'))
async def process_luxbox_purchase(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    user = await get_user(telegram_id)
    
    if not user:
        return await callback.answer("⚠️ Regístrate primero", show_alert=True)
    
    try:
        box_count = int(callback.data.split('_')[-1])
        total_cost = LUXBOX_BULK_DISCOUNTS.get(box_count, LUXBOX_COST_STARS * box_count)
        
        logger.info(f"🛒 Intento de compra LuxBox: {box_count} cajas, {total_cost} stars, usuario {telegram_id}")
        
        language = user['language']
        title = f"Caja Misteriosa x{box_count}" if language == 'es' else f"Mystery Box x{box_count}"
        description = f"{box_count} caja(s) con premios de hasta 10,000 gemas" if language == 'es' else f"{box_count} box(es) with prizes up to 10,000 gems"
        prices = [LabeledPrice(label="Luxury Box", amount=total_cost)]
        
        payload = f"luxbox_{box_count}_{telegram_id}"
        
        try:
            invoice = await callback.bot.send_invoice(
                chat_id=telegram_id,
                title=title,
                description=description,
                provider_token="",
                currency="XTR",
                prices=prices,
                payload=payload,
                start_parameter="luxbox-start"
            )
            logger.info(f"✅ Invoice LuxBox enviada: message_id={invoice.message_id}")
            await callback.answer("✅ Factura enviada - Revisa tu chat")
        except Exception as e:
            logger.error(f"❌ Error enviando invoice LuxBox: {e}", exc_info=True)
            await callback.answer(f"❌ Error: {str(e)[:50]}", show_alert=True)
            
    except Exception as e:
        logger.error(f"❌ Error en process_luxbox_purchase: {e}", exc_info=True)
        await callback.answer("❌ Error procesando la compra", show_alert=True)

@router.callback_query(F.data == "luxbox_winners")
async def show_luxbox_winners(callback: CallbackQuery):
    language = (await get_user(callback.from_user.id))['language']
    
    if language == 'es':
        text = "🏆 <b>ÚLTIMOS GANADORES</b> 🏆\n\n"
        for winner in FAKE_LUXBOX_WINNERS:
            text += f"👤 {winner['name']}\n💎 Ganó: <b>{winner['prize']} gemas</b>\n⏰ hace {winner['time']}\n\n"
        text += "🔥 ¡Sé el próximo en ganar el JACKPOT!"
    else:
        text = "🏆 <b>RECENT WINNERS</b> 🏆\n\n"
        for winner in FAKE_LUXBOX_WINNERS:
            text += f"👤 {winner['name']}\n💎 Won: <b>{winner['prize']} gems</b>\n⏰ {winner['time']} ago\n\n"
        text += "🔥 Be the next to win the JACKPOT!"
    
    builder = InlineKeyboardBuilder()
    builder.button(text="📦 Abrir Caja", callback_data="luxbox_open_1")
    builder.button(text="◀️ Volver", callback_data="luxbox_back")
    builder.adjust(2)
    
    await callback.message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="HTML")
    await callback.answer()

@router.callback_query(F.data == "luxbox_back")
async def luxbox_back(callback: CallbackQuery):
    await cmd_luxbox(callback.message)
    await callback.answer()

@router.callback_query(F.data == "check_balance")
async def check_balance_callback(callback: CallbackQuery):
    await cmd_balance(callback.message)
    await callback.answer()

@router.message(Command('shop'))
async def cmd_shop(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    logger.info(f"🛒 Tienda abierta por usuario {telegram_id}")
    
    language = user['language']
    builder = InlineKeyboardBuilder()
    
    if language == 'es':
        luxbox_button_text = "🔥 📦 CAJA MISTERIOSA (75⭐) → ¡Hasta 10,000 gemas!"
    else:
        luxbox_button_text = "🔥 📦 MYSTERY BOX (75⭐) → Up to 10,000 gems!"
    
    builder.button(text=luxbox_button_text, callback_data="luxbox_open_1")
    
    if language == 'es':
        text = (
            "💎 <b>TIENDA DE GEMAS</b> 💎\n\n"
            "🔥 <b>⭐ OFERTA ESPECIAL ⭐</b> 🔥\n\n"
            "📦 <b>CAJA MISTERIOSA DE LUJO</b>\n"
            "Gana entre <b>75 y 10,000 gemas</b> con cada caja\n"
            "¡Prueba tu suerte y gana el JACKPOT! 👑\n\n"
            "───────────────\n\n"
            "💰 <b>PAQUETES DE GEMAS:</b>\n\n"
        )
        
        for i, package in enumerate(STAR_PACKAGES):
            stars, gems, bonus, first_time = package['stars'], package['gems'], package.get('bonus', 0), package.get('first_time', False)
            final_gems = int(gems * (1 + bonus / 100)) if bonus > 0 else gems
            line = f"⭐ {stars} Stars → 💎 {final_gems} gemas"
            if bonus > 0:
                line += f" (+{bonus}% BONUS)"
            if first_time:
                line += " 🎁 PRIMERA VEZ"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Opción {i+1}: {stars}⭐", callback_data=f"buy_{i}")
    else:
        text = (
            "💎 <b>GEM STORE</b> 💎\n\n"
            "🔥 <b>⭐ SPECIAL OFFER ⭐</b> 🔥\n\n"
            "📦 <b>LUXURY MYSTERY BOX</b>\n"
            "Win between <b>75 and 10,000 gems</b> per box\n"
            "Test your luck and win the JACKPOT! 👑\n\n"
            "───────────────\n\n"
            "💰 <b>GEM PACKAGES:</b>\n\n"
        )
        
        for i, package in enumerate(STAR_PACKAGES):
            stars, gems, bonus, first_time = package['stars'], package['gems'], package.get('bonus', 0), package.get('first_time', False)
            final_gems = int(gems * (1 + bonus / 100)) if bonus > 0 else gems
            line = f"⭐ {stars} Stars → 💎 {final_gems} gems"
            if bonus > 0:
                line += f" (+{bonus}% BONUS)"
            if first_time:
                line += " 🎁 FIRST TIME"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Option {i+1}: {stars}⭐", callback_data=f"buy_{i}")
    
    builder.adjust(1)
    await message.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")

@router.callback_query(F.data == "shop_from_block")
async def shop_from_block(callback: CallbackQuery):
    user = await get_user(callback.from_user.id)
    if not user:
        return await callback.answer("⚠️ Primero debes registrarte con /start", show_alert=True)
    
    language = user['language']
    builder = InlineKeyboardBuilder()
    
    if language == 'es':
        luxbox_button_text = "🔥 📦 CAJA MISTERIOSA (75⭐) → ¡Hasta 10,000 gemas!"
    else:
        luxbox_button_text = "🔥 📦 MYSTERY BOX (75⭐) → Up to 10,000 gems!"
    
    builder.button(text=luxbox_button_text, callback_data="luxbox_open_1")
    
    if language == 'es':
        text = (
            "💎 <b>TIENDA DE GEMAS</b> 💎\n\n"
            "🔥 <b>⭐ OFERTA ESPECIAL ⭐</b> 🔥\n\n"
            "📦 <b>CAJA MISTERIOSA DE LUJO</b>\n"
            "Gana entre <b>75 y 10,000 gemas</b> con cada caja\n"
            "¡Prueba tu suerte y gana el JACKPOT! 👑\n\n"
            "───────────────\n\n"
            "💰 <b>PAQUETES DE GEMAS:</b>\n\n"
        )
        
        for i, package in enumerate(STAR_PACKAGES):
            stars, gems, bonus, first_time = package['stars'], package['gems'], package.get('bonus', 0), package.get('first_time', False)
            final_gems = int(gems * (1 + bonus / 100)) if bonus > 0 else gems
            line = f"⭐ {stars} Stars → 💎 {final_gems} gemas"
            if bonus > 0:
                line += f" (+{bonus}% BONUS)"
            if first_time:
                line += " 🎁 PRIMERA VEZ"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Opción {i+1}: {stars}⭐", callback_data=f"buy_{i}")
    else:
        text = (
            "💎 <b>GEM STORE</b> 💎\n\n"
            "🔥 <b>⭐ SPECIAL OFFER ⭐</b> 🔥\n\n"
            "📦 <b>LUXURY MYSTERY BOX</b>\n"
            "Win between <b>75 and 10,000 gems</b> per box\n"
            "Test your luck and win the JACKPOT! 👑\n\n"
            "───────────────\n\n"
            "💰 <b>GEM PACKAGES:</b>\n\n"
        )
        
        for i, package in enumerate(STAR_PACKAGES):
            stars, gems, bonus, first_time = package['stars'], package['gems'], package.get('bonus', 0), package.get('first_time', False)
            final_gems = int(gems * (1 + bonus / 100)) if bonus > 0 else gems
            line = f"⭐ {stars} Stars → 💎 {final_gems} gems"
            if bonus > 0:
                line += f" (+{bonus}% BONUS)"
            if first_time:
                line += " 🎁 FIRST TIME"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Option {i+1}: {stars}⭐", callback_data=f"buy_{i}")
    
    builder.adjust(1)
    await callback.message.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")
    await callback.answer()

@router.callback_query(F.data == "invite_from_block")
async def invite_from_block(callback: CallbackQuery):
    await cmd_invite(callback.message)
    await callback.answer()

@router.callback_query(F.data.startswith('buy_'))
async def process_purchase(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    try:
        package_index = int(callback.data.split('_')[1])
    except (ValueError, IndexError):
        return await callback.answer("❌ Paquete no válido", show_alert=True)
    
    if package_index >= len(STAR_PACKAGES):
        return await callback.answer("❌ Paquete no válido", show_alert=True)
    
    pkg = STAR_PACKAGES[package_index]
    stars = pkg['stars']
    gems = int(pkg['gems'] * (1 + pkg.get('bonus', 0) / 100)) if pkg.get('bonus', 0) > 0 else pkg['gems']
    
    user = await get_user(telegram_id)
    if not user:
        return await callback.answer("⚠️ Usuario no encontrado", show_alert=True)
    
    language = user['language']
    title = f"{gems} Gemas" if language == 'es' else f"{gems} Gems"
    description = f"Paquete de {gems} gemas" if language == 'es' else f"Package of {gems} gems"
    prices = [LabeledPrice(label="Gems", amount=stars)]
    
    try:
        await callback.bot.send_invoice(
            chat_id=telegram_id,
            title=title,
            description=description,
            provider_token="",
            currency="XTR",
            prices=prices,
            payload=f"gem_purchase_{package_index}"
        )
        await callback.answer("✅ Factura enviada")
    except Exception as e:
        logger.error(f"Error al enviar invoice: {e}")
        await callback.answer("❌ Error al enviar la factura.", show_alert=True)

@router.pre_checkout_query()
async def process_pre_checkout(pre_checkout_query: PreCheckoutQuery):
    await pre_checkout_query.answer(ok=True)

@router.message(F.successful_payment)
async def process_successful_payment(message: Message):
    telegram_id = message.from_user.id
    payload = message.successful_payment.invoice_payload
    charge_id = message.successful_payment.telegram_payment_charge_id
    
    logger.info(f"💳 Pago recibido - Payload: {payload}, Charge: {charge_id}")
    
    user = await get_user(telegram_id)
    if not user:
        return await message.answer("⚠️ Usuario no encontrado")
    
    language = user['language']
    
    if payload.startswith('luxbox_'):
        try:
            parts = payload.split('_')
            box_count = int(parts[1])
            
            logger.info(f"📦 Procesando LuxBox: {box_count} cajas para usuario {telegram_id}")
            
            if language == 'es':
                await message.answer("📦 ¡Abriendo tu(s) caja(s)! 📦\n\n*La caja tiembla con misterio...*")
            else:
                await message.answer("📦 Opening your box(es)! 📦\n\n*The box trembles with mystery...*")
            
            await asyncio.sleep(2)
            
            result = await open_luxbox(telegram_id, box_count)
            total_gems = result['total_gems']
            results = result['results']
            
            if box_count == 1:
                prize = results[0]
                if language == 'es':
                    summary = (
                        f"🎊 <b>¡FELICIDADES!</b> 🎊\n\n"
                        f"{prize['emoji']} <b>Has ganado {prize['gems']} gemas</b>\n\n"
                        f"💎 Total: <b>{total_gems} gemas</b>"
                    )
                else:
                    summary = (
                        f"🎊 <b>CONGRATULATIONS!</b> 🎊\n\n"
                        f"{prize['emoji']} <b>You won {prize['gems']} gems</b>\n\n"
                        f"💎 Total: <b>{total_gems} gems</b>"
                    )
            else:
                summary = "📦 <b>RESULTADOS</b> 📦\n\n" if language == 'es' else "📦 <b>RESULTS</b> 📦\n\n"
                for i, r in enumerate(results, 1):
                    summary += f"#{i}: {r['emoji']} <b>{r['gems']} gemas</b>\n"
                summary += f"\n🎊 <b>Total: {total_gems} gemas</b>"
            
            if total_gems < 150 * box_count:
                if language == 'es':
                    summary += "\n\n💡 <i>Casi ganas el premio mayor...</i>\n¡La próxima caja podría ser la ganadora! 👑"
                else:
                    summary += "\n\n💡 <i>You almost won the big prize...</i>\nThe next box could be the winner! 👑"
            
            builder = InlineKeyboardBuilder()
            builder.button(text="📦 Abrir otra caja", callback_data="luxbox_open_1")
            builder.button(text="💎 Ver balance", callback_data="check_balance")
            builder.adjust(2)
            
            await message.answer(summary, reply_markup=builder.as_markup(), parse_mode="HTML")
            logger.info(f"✅ LuxBox completada: {total_gems} gemas para {telegram_id}")
            
        except Exception as e:
            logger.error(f"❌ Error procesando LuxBox: {e}", exc_info=True)
            await message.answer("⚠️ Error al procesar la caja. Contacta soporte.")
    
    elif payload.startswith('gem_purchase_'):
        try:
            pkg_idx = int(payload.split('_')[-1])
            logger.info(f"💎 Procesando compra de gemas: paquete {pkg_idx} para usuario {telegram_id}")
            
            success, msg = await process_star_purchase(telegram_id, pkg_idx, charge_id)
            
            if success:
                await message.answer(
                    f"✅ {msg}\n\n🎉 ¡Ahora puedes generar audios de alta calidad!" if language == 'es' 
                    else f"✅ {msg}\n\n🎉 You can now generate high-quality audios!"
                )
                await message.answer(
                    "🎊 ¡Tu teclado ha sido actualizado!", 
                    reply_markup=get_main_keyboard(language, True)
                )
            else:
                await message.answer("⚠️ Error al procesar la compra." if language == 'es' else "⚠️ Error processing purchase.")
        except Exception as e:
            logger.error(f"❌ Error procesando compra de gemas: {e}", exc_info=True)
            await message.answer("⚠️ Error al procesar el pago.")
    
    else:
        logger.warning(f"⚠️ Payload de pago desconocido: {payload}")

@router.message(Command('missions'))
async def cmd_missions(message: Message):
    await cmd_missions_impl(message)

async def cmd_missions_impl(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    language = user['language']
    missions = await get_daily_missions(telegram_id)
    
    if language == 'es':
        text = "🎯 <b>MISIONES DIARIAS</b> 🎯\n\nCompleta misiones para ganar gemas extra:\n\n"
    else:
        text = "🎯 <b>DAILY MISSIONS</b> 🎯\n\nComplete missions to earn extra gems:\n\n"
    
    builder = InlineKeyboardBuilder()
    
    for mission in missions:
        mission_def = next((m for m in DAILY_MISSIONS if m['id'] == mission['mission_id']), None)
        if not mission_def:
            continue
        
        name = mission_def['name_es'] if language == 'es' else mission_def['name_en']
        desc = mission_def['desc_es'] if language == 'es' else mission_def['desc_en']
        
        progress = mission['progress']
        target = mission['target']
        reward = mission['reward_gems']
        
        progress_bar = f"{'█' * progress}{'░' * (target - progress)}"
        
        if mission['completed'] and not mission['claimed']:
            status = "✅ COMPLETADA" if language == 'es' else "✅ COMPLETED"
            text += f"{name}\n{desc}\n{progress_bar} {progress}/{target}\n🎁 <b>{status} - {reward} gemas</b>\n\n"
            builder.button(
                text=f"🎁 Reclamar: {mission_def['name_es'][:20]}" if language == 'es' else f"🎁 Claim: {mission_def['name_en'][:20]}",
                callback_data=f"claim_mission_{mission_def['id']}"
            )
        elif mission['claimed']:
            status = "✓ Reclamada" if language == 'es' else "✓ Claimed"
            text += f"{name}\n{desc}\n{progress_bar} {progress}/{target}\n✓ <i>{status}</i>\n\n"
        else:
            text += f"{name}\n{desc}\n{progress_bar} {progress}/{target}\n🎁 Recompensa: {reward} gemas\n\n"
    
    builder.adjust(1)
    await message.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")

@router.callback_query(F.data.startswith('claim_mission_'))
async def claim_mission(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    mission_id = callback.data.replace('claim_mission_', '')
    
    reward = await claim_mission_reward(telegram_id, mission_id)
    
    if reward > 0:
        language = (await get_user(telegram_id))['language']
        msg = f"🎊 ¡Misión completada! Ganaste <b>{reward} gemas</b>" if language == 'es' else f"🎊 Mission complete! You won <b>{reward} gems</b>"
        await callback.answer(msg, show_alert=True)
        
        await callback.message.delete()
        await cmd_missions_impl(callback.message)
    else:
        await callback.answer("❌ No se pudo reclamar", show_alert=True)

@router.message(Command('affinity'))
async def cmd_affinity(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    character = await get_active_character(telegram_id)
    if not character:
        return await message.answer("⚠️ No tienes un personaje activo. Usa /newchat")
    
    language = user['language']
    affinity_display = await get_affinity_display(character['id'], language)
    
    if language == 'es':
        text = (
            f"💕 <b>Afinidad con {character['character_name']}</b>\n\n"
            f"{affinity_display}\n\n"
            f"💡 <b>Cómo subir afinidad:</b>\n"
            f"• 💬 Chatear: +2-5 puntos\n"
            f"• 📸 Selfies: +5 puntos\n"
            f"• 🎙️ Audios: +3 puntos\n"
            f"• 📦 LuxBoxes: +10 puntos\n\n"
            f"<i>Más afinidad = mejores respuestas</i>"
        )
    else:
        text = (
            f"💕 <b>Affinity with {character['character_name']}</b>\n\n"
            f"{affinity_display}\n\n"
            f"💡 <b>How to increase affinity:</b>\n"
            f"• 💬 Chat: +2-5 points\n"
            f"• 📸 Selfies: +5 points\n"
            f"• 🎙️ Audios: +3 points\n"
            f"• 📦 LuxBoxes: +10 points\n\n"
            f"<i>More affinity = better responses</i>"
        )
    
    await message.answer(text, parse_mode="HTML")

@router.message(Command('achievements'))
async def cmd_achievements(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    language = user['language']
    user_achievements = await get_user_achievements(telegram_id)
    unlocked_ids = [a['id'] for a in user_achievements]
    
    if language == 'es':
        text = f"🏆 <b>LOGROS ({len(unlocked_ids)}/{len(ACHIEVEMENTS)})</b> 🏆\n\n"
    else:
        text = f"🏆 <b>ACHIEVEMENTS ({len(unlocked_ids)}/{len(ACHIEVEMENTS)})</b> 🏆\n\n"
    
    for ach_id, ach in ACHIEVEMENTS.items():
        name = ach['name_es'] if language == 'es' else ach['name_en']
        
        if ach_id in unlocked_ids:
            text += f"✅ {ach['emoji']} <b>{name}</b>\n"
            text += f"   🎁 +{ach['reward']} gemas\n\n"
        else:
            text += f"🔒 {ach['emoji']} <i>{name}</i>\n"
            text += f"   🎁 +{ach['reward']} gemas\n\n"
    
    await message.answer(text, parse_mode="HTML")

@router.message(Command('invite'))
async def cmd_invite(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    lang = user['language']
    active_ref = await count_active_referrals_last_24h(message.from_user.id)
    bonus = active_ref * GEMS_PER_REFERRAL
    daily_total = BASE_DAILY_GEMS + bonus
    
    link = f"https://t.me/{(await message.bot.get_me()).username}?start={user['referral_code']}"
    
    text = f"🎁 Sistema de Referidos\n\n🔗 Tu enlace:\n{link}\n\n📊 Estadísticas:\n• Referidos activos (24h): {active_ref}/{MAX_REFERRALS_PER_DAY}\n• Gemas diarias: {daily_total}/{MAX_DAILY_GEMS}\n\n💡 ¡Comparte tu enlace y gana gemas gratis!" if lang == 'es' else f"🎁 Referral System\n\n🔗 Your link:\n{link}\n\n📊 Stats:\n• Active referrals (24h): {active_ref}/{MAX_REFERRALS_PER_DAY}\n• Daily gems: {daily_total}/{MAX_DAILY_GEMS}\n\n💡 Share your link and earn free gems!"
    await message.answer(text)

async def show_character_menu(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        await message.answer("⚠️ Primero debes registrarte con /start")
        return
    
    characters = await get_all_characters(telegram_id)
    builder = InlineKeyboardBuilder()
    
    if characters:
        for char in characters:
            affinity = char.get('affinity', 0)
            level = 'stranger'
            for lvl, data in AFFINITY_LEVELS.items():
                if data['min'] <= affinity <= data['max']:
                    level = lvl
                    break
            level_emoji = AFFINITY_LEVELS[level]['emoji']
            label = f"{level_emoji} {char['character_name']}" + (" ✅" if char['is_active'] else "")
            builder.button(text=label, callback_data=f"switch_{char['id']}")
        
        builder.button(text="➕ Crear nuevo personaje" if user['language'] == 'es' else "➕ Create new character", callback_data="create_new_character")
        builder.adjust(1)
        
        text = "Selecciona un personaje para cambiar, o crea uno nuevo:" if user['language'] == 'es' else "Select a character to switch, or create a new one:"
        await message.answer(text, reply_markup=builder.as_markup())

@router.callback_query(F.data.startswith('switch_'))
async def process_switch(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    character_id = int(callback.data.split('_')[1])
    
    await set_active_character(telegram_id, character_id)
    char = await execute_query(
        """SELECT * FROM user_characters WHERE id = ?""",
        (character_id,)
    )
    
    if char:
        user = await get_user(telegram_id)
        name = char[0]['character_name']
        await callback.message.answer(f"✅ Has cambiado al personaje: {name}" if user['language'] == 'es' else f"✅ Switched to character: {name}")
    
    await callback.answer()

@router.callback_query(F.data == "create_new_character")
async def create_new_character(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await callback.answer("Primero regístrate", show_alert=True)
    
    gems = await get_balance(telegram_id)
    if gems < GEM_COST_NEW_CHARACTER:
        lang = user['language']
        msg = f"❌ No tienes suficientes gemas. Crear un personaje cuesta {GEM_COST_NEW_CHARACTER} gemas. Tienes {gems}." if lang == 'es' else f"❌ You don't have enough gems. Creating a character costs {GEM_COST_NEW_CHARACTER} gems. You have {gems}."
        await callback.message.answer(msg)
        return await callback.answer()
    
    success, msg, _ = await check_and_deduct_gems(telegram_id, GEM_COST_NEW_CHARACTER, 'new_character', 'Creación de personaje')
    if not success:
        await callback.message.answer(f"⚠️ {msg}")
        return await callback.answer()
    
    await set_user_state(telegram_id, {
        'step': 'gender',
        'language': user['language'],
        'is_new_user': False,
        'created_at': datetime.utcnow().isoformat()
    })
    
    lang = user['language']
    builder = InlineKeyboardBuilder()
    if lang == 'es':
        builder.button(text="👨 Hombre", callback_data="gender_male")
        builder.button(text="👩 Mujer", callback_data="gender_female")
        text = "🎭 Selecciona el género de tu nuevo personaje:"
    else:
        builder.button(text="👨 Male", callback_data="gender_male")
        builder.button(text="👩 Female", callback_data="gender_female")
        text = "🎭 Select your new character's gender:"
    
    builder.adjust(2)
    await callback.message.answer(text, reply_markup=builder.as_markup())
    await callback.answer()

@router.message(Command('newchat'))
async def cmd_newchat(message: Message):
    await show_character_menu(message)

@router.message(Command('help'))
async def cmd_help(message: Message):
    user = await get_user(message.from_user.id)
    lang = user['language'] if user else 'es'
    
    if lang == 'es':
        text = (
            "📚 <b>Comandos disponibles:</b>\n\n"
            "/start - Registrarse\n"
            "/chat - Conversar con tu personaje\n"
            "/audio - Audio (5💎) [SOLO INGLÉS]\n"
            "/selfie - Pedir foto (10💎)\n"
            "/balance - Ver tu balance\n"
            "/luxbox - 📦 Caja misteriosa\n"
            "/missions - 🎯 Misiones diarias\n"
            "/affinity - 💕 Ver afinidad\n"
            "/achievements - 🏆 Ver logros\n"
            "/shop - Tienda de gemas\n"
            "/invite - Invitar amigos\n"
            "/newchat - Cambiar personaje\n"
            "/help - Esta ayuda"
        )
    else:
        text = (
            "📚 <b>Available commands:</b>\n\n"
            "/start - Register\n"
            "/chat - Chat with character\n"
            "/audio - Character audio (5💎) [ENGLISH]\n"
            "/selfie - Request photo (10💎)\n"
            "/balance - Check balance\n"
            "/luxbox - 📦 Mystery box\n"
            "/missions - 🎯 Daily missions\n"
            "/affinity - 💕 View affinity\n"
            "/achievements - 🏆 View achievements\n"
            "/shop - Gem store\n"
            "/invite - Invite friends\n"
            "/newchat - Switch character\n"
            "/help - This help"
        )
    
    await message.answer(text, parse_mode="HTML")

@router.message(Command('menu'))
async def cmd_menu(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    lang = user['language']
    text = "🏠 Menú Principal\n\nUsa los botones de abajo:" if lang == 'es' else "🏠 Main Menu\n\nUse the buttons below:"
    await message.answer(text, reply_markup=get_main_keyboard(lang, await has_user_purchased(message.from_user.id)))

@router.inline_query()
async def inline_query_handler(inline_query: InlineQuery):
    results = []
    
    telegram_id = inline_query.from_user.id
    user = await get_user(telegram_id)
    
    if user:
        character = await get_active_character(telegram_id)
        if character:
            results.append(
                InlineQueryResultArticle(
                    id="invite_character",
                    title=f"Invite a {character['character_name']}",
                    description=f"Deja que se una a la conversación",
                    input_message_content=InputTextMessageContent(
                        message_text=f"✨ {character['character_name']} se ha unido!\n\nUsa /chat para empezar 😉"
                    )
                )
            )
    
    results.append(
        InlineQueryResultArticle(
            id="bot_info",
            title="🤖 Chatea con personajes AI",
            description="Personajes únicos con fotos y audios",
            input_message_content=InputTextMessageContent(
                message_text="🎭 ¡Únete a mi bot!\n\n💬 Chat + 📸 Selfies + 🎙️ Audios"
            )
        )
    )
    
    await inline_query.answer(results, cache_time=300)

@router.message(F.text & ~F.text.startswith('/'))
async def process_message(message: Message):
    telegram_id = message.from_user.id
    
    state = await get_user_state(telegram_id)
    
    if state and state.get('step') == 'name':
        is_new_user = state.get('is_new_user', False)
        if is_new_user:
            user = await create_user(telegram_id, state['username'], state['first_name'], state['language'], state.get('referred_by'))
            if not user:
                await message.answer("⚠️ Error al crear el usuario. Intenta de nuevo con /start")
                await clear_user_state(telegram_id)
                return
            
            await save_character(telegram_id, message.text.strip(), state['gender'], state['archetype'], PERSONALITIES.get(state['archetype'], ''))
            await clear_user_state(telegram_id)
            try:
                await unlock_achievement(telegram_id, 'first_message')
            except:
                pass
            return await show_welcome(message, message.text.strip(), state['language'], get_main_keyboard(state['language'], False))
        else:
            await save_character(telegram_id, message.text.strip(), state['gender'], state['archetype'], PERSONALITIES.get(state['archetype'], ''))
            await clear_user_state(telegram_id)
            lang = state['language']
            text = f"✅ ¡Nuevo personaje creado!\n\n🎭 Nombre: {message.text.strip()}\n\nPuedes empezar a chatear con el botón 💬 Chat." if lang == 'es' else f"✅ New character created!\n\n🎭 Name: {message.text.strip()}\n\nYou can start chatting with the 💬 Chat button."
            return await message.answer(text)
    
    if state and state.get('step') == 'awaiting_photo_desc':
        lang = state['language']
        character_id = state['character_id']
        description = message.text.strip()
        
        character = await get_active_character(telegram_id)
        if not character or character['id'] != character_id:
            await message.answer("⚠️ Personaje no encontrado. Usa /newchat para seleccionar uno.")
            await clear_user_state(telegram_id)
            return
        
        success, msg, _ = await check_and_deduct_gems(telegram_id, GEM_COST_IMAGE, 'image', f'Selfie personalizado: {description[:50]}')
        if not success:
            await message.answer(f"⚠️ {msg}")
            await clear_user_state(telegram_id)
            return
        
        await message.bot.send_chat_action(telegram_id, 'upload_photo')
        char_name = escape_html(character['character_name'])
        
        if lang == 'es':
            await message.answer(f"*{char_name} sonríe y ajusta su teléfono*\n\n\"Perfecto, haré que esta foto sea exactamente como lo pediste...\"")
        else:
            await message.answer(f"*{char_name} smiles and adjusts the phone*\n\n\"Perfect, I'll make this photo just as you asked...\"")
        
        history = await get_conversation_history(telegram_id, character['id'], limit=5)
        last_action = "looking at camera, smiling"
        last_user_msg = ""
        last_assistant_msg = ""
        
        for msg in reversed(history):
            if msg['role'] == 'user' and not last_user_msg:
                last_user_msg = msg['content']
            if msg['role'] == 'assistant' and not last_assistant_msg:
                last_assistant_msg = msg['content']
                action_match = re.findall(r'\*([^*]+)\*', msg['content'])
                if action_match:
                    last_action = action_match[-1]
            if last_user_msg and last_assistant_msg:
                break
        
        face_prompt = CHARACTER_FACES.get(character['archetype'], "beautiful person")
        context = f"Context: User said '{last_user_msg[:100]}' and character responded '{last_assistant_msg[:100]}'." if last_user_msg and last_assistant_msg else ""
        
        image_prompt = (
            f"{face_prompt}, selfie style, {last_action}, POV, realistic, smartphone photo, high detail, candid, beautiful lighting. "
            f"User request: {description}. Make it sensual, flirty, and immersive. {context}"
        )
        
        image_url = await generate_image(image_prompt)
        
        if image_url:
            caption = f"📸 <b>{char_name}</b> te envía la foto que pediste."
            sent_ok = await send_generated_image(message.bot, telegram_id, image_url, caption)
            if not sent_ok:
                await add_gems(telegram_id, GEM_COST_IMAGE, 'refund', 'Reembolso por fallo en imagen')
                await message.answer("⚠️ Error al enviar la imagen. Se te han reembolsado las gemas.")
            else:
                await update_mission_progress(telegram_id, 'selfies_requested')
                await add_affinity(telegram_id, character['id'], 5)
        else:
            await add_gems(telegram_id, GEM_COST_IMAGE, 'refund', 'Reembolso por fallo en generación')
            await message.answer("⚠️ Error al generar la imagen. Se te han reembolsado las gemas.")
        
        await clear_user_state(telegram_id)
        return
    
    user = await get_user_cached(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    character = await get_active_character(telegram_id)
    if not character:
        return await message.answer("⚠️ No tienes un personaje activo. Usa /newchat")
    
    lang = user['language']
    hook_remaining = user.get('hook_messages_remaining', 0)
    
    image_intent_pattern = re.compile(r'\b(foto|fotografia|imagen|selfie|pict|pic|picture|photo|image|enseñame|quiero verte|muestra|mandame una foto|enviame una foto|toma una foto)\b', re.IGNORECASE)
    if image_intent_pattern.search(message.text):
        await cmd_selfie(message)
        return
    
    if user['gems'] <= 0 and hook_remaining <= 0:
        char_name = escape_html(character['character_name'])
        text = (
            f"<b>*{char_name} te mira con ojos ardientes y se muerde el labio inferior*</b>\n\n"
            "\"Mmm... justo cuando las cosas se estaban poniendo interesantes... <b>*se acerca más y susurra*</b> Tengo algo especial que quería mostrarte...\"\n\n"
            "<b>*se aleja un poco con una sonrisa provocativa*</b>\n\n"
            "🔥 <b>Opción 1: Recarga gemas y desbloquea TODO</b>\n"
            "💎 <b>Opción 2: Invita a un amigo (5 gemas gratis)</b>\n"
            "📦 <b>Opción 3: Abre una LuxBox (¡hasta 10,000 gemas!)</b>\n\n"
            "<b>*te mira con deseo*</b> \"¿Cuál eliges?\" 😉"
        )
        builder = InlineKeyboardBuilder()
        builder.button(text="🛒 VER PAQUETES", callback_data="shop_from_block")
        builder.button(text="🎁 Invitar (5 gemas)", callback_data="invite_from_block")
        builder.button(text="📦 LuxBox", callback_data="luxbox_open_1")
        builder.adjust(1)
        return await message.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")
    
    if user['gems'] <= 0 and hook_remaining > 0:
        if hook_remaining == HOOK_MODE_MESSAGES:
            char_name = escape_html(character['character_name'])
            hook_msg = f"<b>*{char_name} te detiene con una mano en tu pecho y te mira con ojos brillantes*</b>\n\n\"¡Espera! <b>*se muerde el labio*</b> No te vayas todavía...\"\n\n<b>*se acerca más y susurra al oído*</b>\n\n\"Tengo {hook_remaining} momentos especiales reservados solo para ti...\""
            await message.answer(hook_msg, parse_mode="HTML")
        
        hook_remaining = await decrement_hook_message(telegram_id)
        is_hook_mode = True
        current_gems = 0
    else:
        success, msg, new_balance = await check_and_deduct_gems(telegram_id, GEM_COST_MESSAGE, 'message', 'Mensaje de chat')
        if not success:
            logger.warning(f"No se pudieron deducir gemas: {msg}")
            return await message.answer(f"⚠️ {msg}")
        is_hook_mode = False
        current_gems = new_balance
    
    await update_last_active(telegram_id)
    await save_message(telegram_id, 'user', message.text, character['id'])
    
    try:
        await update_mission_progress(telegram_id, 'messages_sent')
        await add_affinity(telegram_id, character['id'], random.randint(2, 5))
    except:
        pass
    
    history = await get_conversation_history(telegram_id, character['id'], limit=10)
    system_prompt = await create_character_prompt(telegram_id, user['first_name'], lang)
    messages = [{"role": "system", "content": system_prompt}] + [{"role": msg['role'], "content": msg['content']} for msg in history]
    
    await message.bot.send_chat_action(telegram_id, 'typing')
    response = await generate_openrouter_response(messages, lang, current_gems, is_hook_mode, system_prompt)
    
    if response:
        await save_message(telegram_id, 'assistant', response, character['id'])
        if is_hook_mode:
            response += f"\n\n⚠️ <b>*Momentos especiales restantes: {hook_remaining}*</b>" if lang == 'es' else f"\n\n⚠️ <b>*Special moments remaining: {hook_remaining}*</b>"
        await message.answer(format_actions_html(response), parse_mode="HTML")
    else:
        await message.answer("⚠️ Error al generar respuesta. Intenta de nuevo." if lang == 'es' else "⚠️ Error generating response. Try again.")

async def show_welcome(message: Message, character_name: str, language: str, keyboard: ReplyKeyboardMarkup = None):
    if language == 'es':
        text = (
            f"✅ ¡Registro completado!\n\n"
            f"🎭 Tu personaje: <b>{escape_html(character_name)}</b>\n"
            f"💎 Tienes <b>15 gemas</b> para empezar\n\n"
            f"🎁 <b>¡MISIÓN DE BIENVENIDA!</b>\n"
            f"Revisa /missions para reclamar tus primeras gemas gratis.\n\n"
            f"📝 Usa los botones de abajo para navegar."
        )
    else:
        text = (
            f"✅ Registration complete!\n\n"
            f"🎭 Your character: <b>{escape_html(character_name)}</b>\n"
            f"💎 You have <b>15 gems</b> to start\n\n"
            f"🎁 <b>WELCOME MISSION!</b>\n"
            f"Check /missions to claim your first free gems.\n\n"
            f"📝 Use the buttons below to navigate."
        )
    await message.answer(text, reply_markup=keyboard, parse_mode="HTML")

async def show_main_menu(message: Message, language: str, keyboard: ReplyKeyboardMarkup = None):
    text = "🏠 Menú Principal" if language == 'es' else "🏠 Main Menu"
    await message.answer(text, reply_markup=keyboard)

# ==================== HANDLER HTTP PARA VERCEL ====================

# Instancias globales para reutilizar entre requests (importante para Vercel)
_bot = Bot(token=TELEGRAM_BOT_TOKEN)
_dp = Dispatcher()
_dp.include_router(router)

async def _process_update(body_bytes: bytes):
    """Procesa un update de Telegram"""
    try:
        update_data = json.loads(body_bytes.decode('utf-8'))
        update = Update.model_validate(update_data, context={"bot": _bot})
        await _dp.feed_update(_bot, update)
    except Exception as e:
        logger.error(f"Error procesando update: {e}", exc_info=True)

async def _setup_webhook(webhook_url: str):
    """Configura el webhook en Telegram"""
    try:
        await _bot.delete_webhook(drop_pending_updates=True)
        await _bot.set_webhook(webhook_url, drop_pending_updates=True)
        logger.info(f"✅ Webhook configurado en: {webhook_url}")
        return True
    except Exception as e:
        logger.error(f"❌ Error configurando webhook: {e}", exc_info=True)
        return False

class handler(BaseHTTPRequestHandler):
    """
    Handler HTTP para Vercel Serverless
    - GET / -> health check
    - GET /setup -> configura el webhook automáticamente
    - POST / -> recibe updates de Telegram
    """
    
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            
            logger.info(f"📨 POST recibido en {self.path}, {content_length} bytes")
            
            # Procesar el update de Telegram
            asyncio.run(_process_update(body))
            
            # Responder 200 OK a Telegram inmediatamente
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except Exception as e:
            logger.error(f"Error en do_POST: {e}", exc_info=True)
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f'{{"error":"{str(e)}"}}'.encode('utf-8'))
    
    def do_GET(self):
        try:
            host = self.headers.get('Host', '')
            path = self.path.rstrip('/')
            
            logger.info(f"🌐 GET recibido: {path} desde {host}")
            
            # Ruta /setup - configura el webhook automáticamente
            if path.endswith('/setup'):
                webhook_url = WEBHOOK_URL or f"https://{host}"
                success = asyncio.run(_setup_webhook(webhook_url))
                
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()
                
                if success:
                    html = f"""
                    <html>
                    <head><title>✅ Bot Configurado</title></head>
                    <body style="font-family: Arial; padding: 40px; background: #0f172a; color: white;">
                        <h1 style="color: #22c55e;">✅ Bot Configurado Exitosamente</h1>
                        <p><strong>Webhook URL:</strong> {webhook_url}</p>
                        <p>El bot está listo para recibir mensajes de Telegram.</p>
                        <p style="color: #94a3b8;">Puedes cerrar esta ventana y probar el bot.</p>
                    </body>
                    </html>
                    """
                else:
                    html = f"""
                    <html>
                    <body style="font-family: Arial; padding: 40px; background: #0f172a; color: white;">
                        <h1 style="color: #ef4444;">❌ Error configurando webhook</h1>
                        <p>Revisa los logs en Vercel.</p>
                    </body>
                    </html>
                    """
                self.wfile.write(html.encode('utf-8'))
            
            # Ruta raíz - health check
            else:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = {
                    "status": "ok",
                    "message": "Bot de Telegram funcionando",
                    "endpoints": {
                        "/": "Health check",
                        "/setup": "Configurar webhook",
                        "/ (POST)": "Recibir updates de Telegram"
                    }
                }
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
        
        except Exception as e:
            logger.error(f"Error en do_GET: {e}", exc_info=True)
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f'{{"error":"{str(e)}"}}'.encode('utf-8'))
    
    def log_message(self, format, *args):
        """Redirige los logs de http.server al logger"""
        logger.info(f"{self.address_string()} - {format % args}")
