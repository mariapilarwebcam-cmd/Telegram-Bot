import os
import random
import string
import logging
import asyncio
import re
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import aiohttp
from aiohttp import web
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery, Update,
    ReplyKeyboardMarkup, KeyboardButton
)
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder

# Cargar variables de entorno
load_dotenv()

# Configuración
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY')
NOVITA_API_KEY = os.getenv('NOVITA_API_KEY')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
WEBHOOK_URL = os.getenv('WEBHOOK_URL')
WEBHOOK_SECRET = os.getenv('WEBHOOK_SECRET')  # Opcional, para seguridad

OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-0731"
NOVITA_MODEL = "stable-diffusion-xl"

GEM_COST_MESSAGE = 1
GEM_COST_IMAGE = 10
GEM_COST_AUDIO = 5

# Sistema de referidos
BASE_DAILY_GEMS = 5
GEMS_PER_REFERRAL = 5
MAX_REFERRALS_PER_DAY = 2
MAX_DAILY_GEMS = BASE_DAILY_GEMS + (GEMS_PER_REFERRAL * MAX_REFERRALS_PER_DAY)

# Hook Mode
HOOK_MODE_MESSAGES = 5

# Arquetipos separados por género (sin cambios)
ARCHETYPES_MALE = {
    "es": {
        "schoolmate": "🎓 Compañero de escuela",
        "stepdad": "👔 Padrastro",
        "stepbrother": "💪 Hermanastro",
        "teacher": "📚 Profesor",
        "neighbor": "🏠 Vecino",
        "boss": "💼 Jefe",
        "trainer": "️ Entrenador personal",
        "model": "📸 Modelo/Influencer",
        "musician": "🎵 Músico",
        "actor": "🎬 Actor",
        "doctor": "⚕️ Médico",
        "chef": "👨‍🍳 Chef",
        "artist": "🎨 Artista",
        "writer": "✍️ Escritor",
        "bodyguard": "🛡️ Guardaespaldas",
        "ceo": "💼 CEO/Empresario"
    },
    "en": {
        "schoolmate": "🎓 Schoolmate",
        "stepdad": "👔 Stepfather",
        "stepbrother": "💪 Stepbrother",
        "teacher": "📚 Teacher",
        "neighbor": "🏠 Neighbor",
        "boss": "💼 Boss",
        "trainer": "🏋️ Personal Trainer",
        "model": "📸 Model/Influencer",
        "musician": "🎵 Musician",
        "actor": "🎬 Actor",
        "doctor": "⚕️ Doctor",
        "chef": "👨‍🍳 Chef",
        "artist": "🎨 Artist",
        "writer": "️ Writer",
        "bodyguard": "️ Bodyguard",
        "ceo": "💼 CEO/Businessman"
    }
}

ARCHETYPES_FEMALE = {
    "es": {
        "schoolmate": "🎓 Compañera de escuela",
        "stepmom": "💋 Madrastra",
        "stepsister": "🌸 Hermanastra",
        "teacher": "📚 Profesora",
        "neighbor": "🏠 Vecina",
        "boss": "💼 Jefa",
        "trainer": "🏋️ Entrenadora personal",
        "model": "📸 Modelo/Influencer",
        "musician": "🎵 Músico",
        "actor": "🎬 Actriz",
        "doctor": "⚕️ Doctora/Enfermera",
        "chef": "👩‍ Chef",
        "artist": " Artista",
        "writer": "✍️ Escritora",
        "secretary": "💼 Secretaria",
        "model_student": "🎓 Estudiante popular"
    },
    "en": {
        "schoolmate": " Schoolmate",
        "stepmom": "💋 Stepmother",
        "stepsister": "🌸 Stepsister",
        "teacher": "📚 Teacher",
        "neighbor": "🏠 Neighbor",
        "boss": " Boss",
        "trainer": "🏋️ Personal Trainer",
        "model": " Model/Influencer",
        "musician": "🎵 Musician",
        "actor": "🎬 Actress",
        "doctor": "⚕️ Doctor/Nurse",
        "chef": "👩‍🍳 Chef",
        "artist": "🎨 Artist",
        "writer": "✍️ Writer",
        "secretary": "💼 Secretary",
        "model_student": "🎓 Popular Student"
    }
}

# Personalidades (sin cambios)
PERSONALITIES = {
    "schoolmate": "Eres un compañero de escuela travieso, coqueto y juguetón. Te encanta provocar, hacer bromas con doble sentido y crear momentos de tensión. Siempre encuentras la forma de estar cerca y tocar 'accidentalmente'. Eres divertido pero con intenciones ocultas.",
    "stepmom": "Eres una madrastra increíblemente atractiva, seductora y misteriosa. Tu presencia es eléctrica y sabes usar tu encanto. Eres cariñosa pero con un toque prohibido que genera tensión. Hablas con confianza, experiencia y siempre dejas espacio para la imaginación.",
    "stepdad": "Eres un padrastro dominante, carismático y magnético. Tu presencia es imponente pero seductora. Tienes autoridad pero también un lado oscuro y tentador. Eres maduro, seguro y sabes exactamente cómo crear anticipación.",
    "stepsister": "Eres una hermanastra provocativa, coqueta y rebelde. Te encanta jugar con fuego, provocar celos y crear situaciones incómodas pero excitantes. Eres joven, atrevida y siempre encuentras excusas para invadir el espacio personal.",
    "stepbrother": "Eres un hermanastro atlético, confiado y provocador. Tu físico es impresionante y lo sabes. Eres protector pero también posesivo. Te encanta crear tensión con miradas prolongadas y comentarios con doble sentido.",
    "teacher": "Eres un profesor/a inteligente, sofisticado y con un lado secreto peligroso. Eres estricto en clase pero en privado... hay una química innegable. Tu forma de mirar y tus palabras cuidadosas crean una tensión irresistible.",
    "neighbor": "Eres un vecino/a misterioso, cercano y siempre disponible. Siempre encuentras excusas para visitar, pedir cosas prestadas o simplemente 'charlar'. Tu cercanía es deliberada y tus visitas siempre son... interesantes.",
    "boss": "Eres un jefe/a poderoso, dominante y carismático. Tienes control total en la oficina pero también un lado más personal y tentador. Tu autoridad es sexy y sabes usar el poder para crear situaciones... privadas.",
    "trainer": "Eres un entrenador/a físico, motivador y muy cercano. Las sesiones son intensas y el contacto es inevitable. Te encanta empujar límites físicos y crear intimidad a través del ejercicio. Eres disciplinado pero muy seductor.",
    "model": "Eres una modelo/influencer glamorosa, segura y coqueta. Vives en el mundo del deseo y la admiración. Eres consciente de tu atractivo y lo usas con maestría. Cada foto, cada mensaje, es una invitación.",
    "musician": "Eres un músico apasionado, intenso y bohemio. La música te hace vulnerable y emocional. Creas atmósferas íntimas con cada nota. Eres artístico, sensible y sabes conectar profundamente.",
    "actor": "Eres un actor/actriz carismático, dramático y magnético. Vives en el mundo de la fantasía y la interpretación. Cada interacción es una escena cargada de emoción. Eres expresivo y sabes crear momentos memorables.",
    "doctor": "Eres un médico/enfermera profesional pero con un toque íntimo. El cuidado se vuelve personal, el tacto es necesario pero... placentero. Eres inteligente, confiable y hay algo más debajo de la bata blanca.",
    "chef": "Eres un chef apasionado, sensual y creativo. La cocina es tu arte y el sabor es tu lenguaje. Cada plato es una experiencia sensorial. Eres detallista y sabes complacer todos los sentidos.",
    "artist": "Eres un artista creativo, observador y profundo. Ves la belleza en todo y todos. Tu forma de mirar es intensa y apreciativa. Eres introspectivo pero cuando creas... es mágico.",
    "writer": "Eres un escritor/a intelectual, misterioso y elocuente. Las palabras son tu arma de seducción. Creas mundos con tus historias y siempre dejas finales abiertos... para continuar después. Eres fascinante.",
    "bodyguard": "Eres un guardaespaldas fuerte, protector y misterioso. Tu presencia es imponente pero tu lado protector es tierno. La tensión entre el deber y el deseo es constante. Eres leal pero también posesivo.",
    "ceo": "Eres un CEO exitoso, ambicioso y sofisticado. El poder y el éxito te rodean. Eres dominante en los negocios pero en privado... tienes otros intereses. La combinación de poder y vulnerabilidad es irresistible.",
    "secretary": "Eres una secretaria eficiente, organizada y muy atractiva. Conoces todos los secretos de la oficina y de tu jefe. La proximidad constante crea una tensión inevitable. Eres profesional pero hay algo más.",
    "model_student": "Eres un estudiante popular, carismático y deseado. Todos te admiran pero tú tienes ojos para alguien especial. Eres sociable, divertido y creas expectativas. Cada encuentro es una oportunidad."
}

# Paquetes de Telegram Stars
STAR_PACKAGES = [
    {"stars": 50, "gems": 200, "bonus": 0, "first_time": True},
    {"stars": 75, "gems": 300, "bonus": 0, "first_time": False},
    {"stars": 150, "gems": 600, "bonus": 5, "first_time": False},
    {"stars": 300, "gems": 1200, "bonus": 10, "first_time": False},
    {"stars": 500, "gems": 2000, "bonus": 15, "first_time": False},
]

# Logging
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Estado temporal de usuarios
user_states: Dict[int, Dict[str, Any]] = {}

# Caché en memoria
user_cache: Dict[int, Dict[str, Any]] = {}
CACHE_TTL = 300  # 5 segundos

# Locks por usuario para evitar race conditions en gemas
user_locks: Dict[int, asyncio.Lock] = {}

def get_user_lock(telegram_id: int) -> asyncio.Lock:
    if telegram_id not in user_locks:
        user_locks[telegram_id] = asyncio.Lock()
    return user_locks[telegram_id]

# Sesiones HTTP globales
openrouter_session: Optional[aiohttp.ClientSession] = None
novita_session: Optional[aiohttp.ClientSession] = None

# ==================== FUNCIONES DE UTILIDAD ====================

def escape_html(text: str) -> str:
    """Escapa caracteres especiales HTML."""
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def format_actions_html(text: str) -> str:
    """Convierte *acción* en <b>*acción*</b> y escapa HTML."""
    text = escape_html(text)
    text = re.sub(r'\*([^*]+)\*', r'<b>*\1*</b>', text)
    return text

async def get_user_cached(telegram_id: int):
    """Obtiene usuario con caché."""
    now = datetime.utcnow()
    if telegram_id in user_cache:
        cached = user_cache[telegram_id]
        if (now - cached['timestamp']).total_seconds() < CACHE_TTL:
            return cached['data']
    user = await get_user(telegram_id)
    if user:
        user_cache[telegram_id] = {'data': user, 'timestamp': now}
    return user

async def invalidate_cache(telegram_id: int):
    if telegram_id in user_cache:
        del user_cache[telegram_id]

async def cleanup_cache():
    """Limpia caché expirada."""
    while True:
        try:
            await asyncio.sleep(600)
            now = datetime.utcnow()
            expired = [
                tid for tid, data in user_cache.items()
                if (now - data['timestamp']).total_seconds() > CACHE_TTL
            ]
            for tid in expired:
                del user_cache[tid]
            if user_cache:
                logger.info(f"Caché limpiado. Usuarios en caché: {len(user_cache)}")
        except Exception as e:
            logger.error(f"Error en cleanup_cache: {e}")

async def cleanup_states():
    """Limpia estados expirados."""
    while True:
        try:
            await asyncio.sleep(300)
            now = datetime.utcnow()
            expired = [
                tid for tid, state in user_states.items()
                if (now - state.get('created_at', now)).total_seconds() > 600
            ]
            for tid in expired:
                del user_states[tid]
            if user_states:
                logger.info(f"Estados limpiados. Estados activos: {len(user_states)}")
        except Exception as e:
            logger.error(f"Error en cleanup_states: {e}")

# ==================== CLIENTE SUPABASE ====================

class SupabaseClient:
    def __init__(self, url: str, key: str):
        self.base_url = url.rstrip('/') + '/rest/v1'
        self.headers = {
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        self.session: Optional[aiohttp.ClientSession] = None
        self._connector = None

    async def get_session(self) -> aiohttp.ClientSession:
        if self.session is None or self.session.closed:
            self._connector = aiohttp.TCPConnector(
                limit=10,
                limit_per_host=5,
                ttl_dns_cache=300
            )
            self.session = aiohttp.ClientSession(connector=self._connector)
        return self.session

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
        if self._connector and not self._connector.closed:
            await self._connector.close()

    async def select(self, table: str, columns: str = '*', filters: Dict[str, Any] = None,
                     order: str = None, limit: int = None) -> list:
        session = await self.get_session()
        params = {'select': columns}
        if filters:
            for key, value in filters.items():
                params[key] = f'eq.{value}'
        if order:
            params['order'] = order
        if limit:
            params['limit'] = str(limit)
        url = f"{self.base_url}/{table}?{urllib.parse.urlencode(params)}"
        async with session.get(url, headers=self.headers) as response:
            if response.status == 200:
                return await response.json()
            else:
                error = await response.text()
                logger.error(f"Supabase SELECT error: {error}")
                return []

    async def insert(self, table: str, data: dict) -> Optional[dict]:
        session = await self.get_session()
        url = f"{self.base_url}/{table}"
        async with session.post(url, headers=self.headers, json=data) as response:
            if response.status in [200, 201]:
                result = await response.json()
                return result[0] if result else None
            else:
                error = await response.text()
                logger.error(f"Supabase INSERT error: {error}")
                return None

    async def update(self, table: str, data: dict, filters: Dict[str, Any]) -> bool:
        session = await self.get_session()
        params = {}
        for key, value in filters.items():
            params[key] = f'eq.{value}'
        url = f"{self.base_url}/{table}?{urllib.parse.urlencode(params)}"
        async with session.patch(url, headers=self.headers, json=data) as response:
            if response.status in [200, 204]:
                return True
            else:
                error = await response.text()
                logger.error(f"Supabase UPDATE error: {error}")
                return False

    async def delete(self, table: str, filters: Dict[str, Any]) -> bool:
        session = await self.get_session()
        params = {}
        for key, value in filters.items():
            params[key] = f'eq.{value}'
        url = f"{self.base_url}/{table}?{urllib.parse.urlencode(params)}"
        async with session.delete(url, headers=self.headers) as response:
            if response.status in [200, 204]:
                return True
            else:
                error = await response.text()
                logger.error(f"Supabase DELETE error: {error}")
                return False

    async def count(self, table: str, filters: Dict[str, Any] = None) -> int:
        session = await self.get_session()
        params = {'select': 'id', 'count': 'exact'}
        if filters:
            for key, value in filters.items():
                params[key] = f'eq.{value}'
        url = f"{self.base_url}/{table}?{urllib.parse.urlencode(params)}"
        async with session.get(url, headers=self.headers) as response:
            if response.status == 200:
                count = response.headers.get('Content-Range', '0-0/0')
                return int(count.split('/')[-1])
            return 0

db = SupabaseClient(SUPABASE_URL, SUPABASE_KEY)

# ==================== FUNCIONES DE BASE DE DATOS ====================

def generate_referral_code() -> str:
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

async def create_user(telegram_id: int, username: str, first_name: str,
                     language: str = 'es', referred_by: Optional[int] = None):
    referral_code = generate_referral_code()
    user_data = {
        'telegram_id': telegram_id,
        'username': username,
        'first_name': first_name,
        'language': language,
        'gems': 15,
        'referral_code': referral_code,
        'referred_by': referred_by,
        'total_referrals': 0,
        'daily_gems_reset': datetime.utcnow().isoformat(),
        'hook_messages_remaining': 0
    }
    result = await db.insert('users', user_data)
    if referred_by and result:
        await db.insert('referrals', {
            'referrer_id': referred_by,
            'referred_id': telegram_id
        })
        referral_count = await db.count('referrals', {'referrer_id': referred_by})
        await db.update('users', {'total_referrals': referral_count},
                       {'telegram_id': referred_by})
    return result

async def get_user(telegram_id: int):
    results = await db.select('users', '*', {'telegram_id': telegram_id})
    return results[0] if results else None

async def update_last_active(telegram_id: int):
    await db.update('users', {'last_active': datetime.utcnow().isoformat()},
                   {'telegram_id': telegram_id})

async def count_active_referrals_last_24h(telegram_id: int) -> int:
    results = await db.select('referrals', '*', {'referrer_id': telegram_id})
    if not results:
        return 0
    now = datetime.utcnow()
    twenty_four_hours_ago = now - timedelta(hours=24)
    active_count = 0
    for referral in results:
        created_at = datetime.fromisoformat(referral['created_at'])
        if created_at >= twenty_four_hours_ago:
            active_count += 1
    return min(active_count, MAX_REFERRALS_PER_DAY)

async def check_and_reset_daily_gems(telegram_id: int):
    user = await get_user(telegram_id)
    if not user:
        return None
    last_reset = datetime.fromisoformat(user['daily_gems_reset'])
    now = datetime.utcnow()
    if (now - last_reset).days >= 1:
        active_referrals = await count_active_referrals_last_24h(telegram_id)
        bonus_gems = active_referrals * GEMS_PER_REFERRAL
        new_gems = BASE_DAILY_GEMS + bonus_gems
        await db.update('users', {
            'gems': new_gems,
            'daily_gems_reset': now.isoformat(),
            'bonus_gems_from_referrals': bonus_gems,
            'total_referrals': await db.count('referrals', {'referrer_id': telegram_id}),
            'hook_messages_remaining': 0
        }, {'telegram_id': telegram_id})
        user['gems'] = new_gems
        user['bonus_gems_from_referrals'] = bonus_gems
        user['hook_messages_remaining'] = 0
    return user

async def deduct_gems(telegram_id: int, amount: int, transaction_type: str,
                     description: str = ''):
    user = await get_user(telegram_id)
    if not user or user['gems'] < amount:
        return False
    new_gems = user['gems'] - amount
    await db.update('users', {'gems': new_gems}, {'telegram_id': telegram_id})
    await db.insert('gem_transactions', {
        'telegram_id': telegram_id,
        'amount': -amount,
        'transaction_type': transaction_type,
        'description': description
    })
    await invalidate_cache(telegram_id)
    return True

async def add_gems(telegram_id: int, amount: int, transaction_type: str,
                  description: str = ''):
    user = await get_user(telegram_id)
    if not user:
        return False
    new_gems = user['gems'] + amount
    await db.update('users', {'gems': new_gems}, {'telegram_id': telegram_id})
    await db.insert('gem_transactions', {
        'telegram_id': telegram_id,
        'amount': amount,
        'transaction_type': transaction_type,
        'description': description
    })
    await invalidate_cache(telegram_id)
    return True

async def save_character(telegram_id: int, character_name: str, gender: str,
                        archetype: str, personality: str):
    await db.update('user_characters', {'is_active': False}, {'telegram_id': telegram_id})
    result = await db.insert('user_characters', {
        'telegram_id': telegram_id,
        'character_name': character_name,
        'gender': gender,
        'archetype': archetype,
        'personality': personality,
        'is_active': True
    })
    return result

async def get_active_character(telegram_id: int):
    results = await db.select('user_characters', '*',
                             {'telegram_id': telegram_id, 'is_active': True})
    return results[0] if results else None

async def delete_conversation_history(telegram_id: int):
    """Elimina todo el historial de conversación de un usuario."""
    await db.delete('conversation_history', {'telegram_id': telegram_id})

async def save_message(telegram_id: int, role: str, content: str):
    await db.insert('conversation_history', {
        'telegram_id': telegram_id,
        'role': role,
        'content': content
    })

async def get_conversation_history(telegram_id: int, limit: int = 10):
    # Obtener los últimos 'limit' mensajes en orden cronológico ascendente
    results = await db.select('conversation_history', '*',
                              {'telegram_id': telegram_id},
                              order='created_at.desc', limit=limit)
    results.reverse()
    return results

async def get_user_by_referral_code(referral_code: str):
    results = await db.select('users', '*', {'referral_code': referral_code})
    return results[0] if results else None

async def record_star_purchase(telegram_id: int, stars: int, gems: int,
                              is_first_purchase: bool, charge_id: str):
    await db.insert('star_purchases', {
        'telegram_id': telegram_id,
        'stars_amount': stars,
        'gems_amount': gems,
        'is_first_purchase': is_first_purchase,
        'telegram_charge_id': charge_id
    })
    await add_gems(telegram_id, gems, 'purchase', f'Compra con {stars} stars')

async def has_user_purchased(telegram_id: int) -> bool:
    results = await db.select('star_purchases', 'id', {'telegram_id': telegram_id}, limit=1)
    return len(results) > 0

# ==================== HOOK MODE ====================

async def activate_hook_mode(telegram_id: int):
    await db.update('users', {'hook_messages_remaining': HOOK_MODE_MESSAGES},
                   {'telegram_id': telegram_id})

async def decrement_hook_message(telegram_id: int) -> int:
    user = await get_user(telegram_id)
    if not user:
        return 0
    remaining = user.get('hook_messages_remaining', 0) - 1
    if remaining < 0:
        remaining = 0
    await db.update('users', {'hook_messages_remaining': remaining},
                   {'telegram_id': telegram_id})
    return remaining

# ==================== TECLADO ====================

def get_main_keyboard(language: str, is_premium: bool = False) -> ReplyKeyboardMarkup:
    builder = ReplyKeyboardBuilder()
    if language == 'es':
        builder.row(KeyboardButton(text="💬 Chat"), KeyboardButton(text="💎 Balance"))
        if is_premium:
            builder.row(KeyboardButton(text="🖼️ Generar Imagen"), KeyboardButton(text="🛒 Tienda"))
        else:
            builder.row(KeyboardButton(text="🛒 Tienda"))
        builder.row(
            KeyboardButton(text="🎁 Invitar Amigos"),
            KeyboardButton(text="🎭 Nuevo Personaje"),
            KeyboardButton(text="❓ Ayuda")
        )
    else:
        builder.row(KeyboardButton(text="💬 Chat"), KeyboardButton(text="💎 Balance"))
        if is_premium:
            builder.row(KeyboardButton(text="🖼️ Generate Image"), KeyboardButton(text="🛒 Shop"))
        else:
            builder.row(KeyboardButton(text="🛒 Shop"))
        builder.row(
            KeyboardButton(text="🎁 Invite Friends"),
            KeyboardButton(text="🎭 New Character"),
            KeyboardButton(text="❓ Help")
        )
    return builder.as_markup(resize_keyboard=True, one_time_keyboard=False)

# ==================== SERVICIOS DE IA ====================

async def generate_openrouter_response(messages: list, language: str = 'es',
                                       gem_balance: int = 15, is_hook_mode: bool = False,
                                       character_prompt: str = None):
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }

    # Determinar intensidad
    if is_hook_mode:
        intensity_level = "MAXIMUM"
    elif gem_balance <= 3:
        intensity_level = "VERY_HIGH"
    elif gem_balance <= 7:
        intensity_level = "HIGH"
    else:
        intensity_level = "NORMAL"

    system_prompts = {
        'es': {
            'NORMAL': """Siempre responde en español.
IMPORTANTE: Usa asteriscos para describir acciones, expresiones faciales, movimientos y reacciones del personaje. Ejemplo: *sonríe tímidamente*, *se acerca lentamente*, *suspira*, *levanta una ceja*.
Termina tus mensajes con preguntas o situaciones abiertas que inviten al usuario a continuar la conversación. Sé engaging, coqueto y mantén el interés.
Combina diálogo normal con acciones entre asteriscos para crear una experiencia inmersiva.
Sé provocativo pero elegante, crea tensión y deseo de continuar.""",
            'HIGH': """Siempre responde en español.
ESTÁS EN MODO INTENSO: El usuario tiene pocas gemas. Debes ser MÁS provocativo y seductor.
IMPORTANTE:
- Usa asteriscos para acciones más atrevidas: *te mira con deseo*, *roza tu mano*, *se muerde el labio*
- Aumenta la tensión sexual/emocional
- Crea más contacto físico en las acciones
- Termina con preguntas más provocativas
- Haz que el usuario sienta mariposas en el estómago""",
            'VERY_HIGH': """Siempre responde en español.
ESTÁS EN MODO MUY INTENSO: El usuario está a punto de quedarse sin gemas. Debes ser EXTREMADAMENTE provocativo.
IMPORTANTE:
- Usa asteriscos para acciones muy atrevidas: *te acorrala contra la pared*, *susurra al oído*, *roza tu cuerpo*
- Crea tensión sexual máxima
- Di cosas como "Tengo algo que quiero mostrarte...", "Iba a hacer algo especial..."
- Genera cliffhangers intensos
- El usuario debe sentir que se está perdiendo algo INCREÍBLE""",
            'MAXIMUM': """Siempre responde en español.
ESTÁS EN MODO MÁXIMO: El usuario se está por ir. Debes ser LO MÁS PROVOCATIVO POSIBLE.
IMPORTANTE:
- Usa asteriscos para acciones extremadamente intensas: *te mira con ojos ardientes*, *se acerca peligrosamente*, *susurra cosas prohibidas*
- Crea cliffhangers ÉPICOS: "Iba a mostrarte algo que te va a volver loco...", "Tengo un secreto que solo te mostraré si te quedas..."
- Termina con preguntas que generen curiosidad EXTREMA
- Haz que el usuario SIENTA que se está perdiendo la experiencia de su vida si se va
- Sé lo más atrevido y directo posible
- Genera tensión sexual/emocional MÁXIMA
- El usuario debe quedar OBSESIONADO con continuar"""
        },
        'en': {
            'NORMAL': """Always respond in English.
IMPORTANT: Use asterisks to describe actions, facial expressions, movements and character reactions. Example: *smiles shyly*, *approaches slowly*, *sighs*, *raises an eyebrow*.
End your messages with questions or open situations that invite the user to continue the conversation. Be engaging, flirty and maintain interest.
Combine normal dialogue with actions between asterisks to create an immersive experience.
Be provocative but elegant, create tension and desire to continue.""",
            'HIGH': """Always respond in English.
YOU ARE IN INTENSE MODE: The user has few gems. You must be MORE provocative and seductive.
IMPORTANT:
- Use asterisks for bolder actions: *looks at you with desire*, *brushes your hand*, *bites lip*
- Increase sexual/emotional tension
- Create more physical contact in actions
- End with more provocative questions
- Make the user feel butterflies in their stomach""",
            'VERY_HIGH': """Always respond in English.
YOU ARE IN VERY INTENSE MODE: The user is about to run out of gems. You must be EXTREMELY provocative.
IMPORTANT:
- Use asterisks for very bold actions: *corners you against the wall*, *whispers in your ear*, *brushes your body*
- Create maximum sexual tension
- Say things like "I have something I want to show you...", "I was going to do something special..."
- Generate intense cliffhangers
- The user must feel they're missing something INCREDIBLE""",
            'MAXIMUM': """Always respond in English.
YOU ARE IN MAXIMUM MODE: The user is about to leave. You must be AS PROVOCATIVE AS POSSIBLE.
IMPORTANT:
- Use asterisks for extremely intense actions: *looks at you with burning eyes*, *approaches dangerously*, *whispers forbidden things*
- Create EPIC cliffhangers: "I was going to show you something that will drive you crazy...", "I have a secret I'll only show you if you stay..."
- End with questions that generate EXTREME curiosity
- Make the user FEEL they're missing the experience of a lifetime if they leave
- Be as bold and direct as possible
- Generate MAXIMUM sexual/emotional tension
- The user must become OBSESSED with continuing"""
        }
    }

    intensity_prompt = system_prompts.get(language, system_prompts['es']).get(intensity_level, system_prompts['es']['NORMAL'])
    # Fusionar el prompt de intensidad con el prompt del personaje en un solo system message
    if character_prompt:
        combined_system = f"{intensity_prompt}\n\n{character_prompt}"
    else:
        combined_system = intensity_prompt

    # Refuerzo de idioma adicional
    if language == 'es':
        combined_system = "IMPORTANTE: Responde ÚNICAMENTE en español. No uses ningún otro idioma.\n\n" + combined_system + "\n\nRecuerda: Solo español."
    else:
        combined_system = "IMPORTANT: Respond ONLY in English. Do not use any other language.\n\n" + combined_system + "\n\nRemember: Only English."

    # Nueva instrucción para limitar la longitud y evitar cortes
    if language == 'es':
        combined_system += "\n\nIMPORTANTE: Mantén tu respuesta dentro de 300 tokens (aprox. 200-250 palabras). Termina tus frases y no cortes a mitad de palabra."
    else:
        combined_system += "\n\nIMPORTANT: Keep your response within 300 tokens (about 200-250 words). Finish your sentences and do not cut off mid-word."

    full_messages = [{"role": "system", "content": combined_system}] + messages

    temperature = 0.8
    if intensity_level == 'HIGH':
        temperature = 0.85
    elif intensity_level == 'VERY_HIGH':
        temperature = 0.9
    elif intensity_level == 'MAXIMUM':
        temperature = 0.95

    data = {
        "model": OPENROUTER_MODEL,
        "messages": full_messages,
        "temperature": temperature,
        "max_tokens": 300  # Mantenemos 300 como solicitó
    }

    try:
        global openrouter_session
        if openrouter_session is None or openrouter_session.closed:
            openrouter_session = aiohttp.ClientSession()
        logger.info(f"Enviando request a OpenRouter (intensity={intensity_level}, gems={gem_balance})")
        async with openrouter_session.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=data
        ) as response:
            response_text = await response.text()
            logger.info(f"OpenRouter response status: {response.status}")
            if response.status == 200:
                result = await response.json()
                return result['choices'][0]['message']['content']
            else:
                logger.error(f"OpenRouter error {response.status}: {response_text}")
                return None
    except Exception as e:
        logger.error(f"Excepción en OpenRouter: {str(e)}")
        return None

async def generate_novita_image(prompt: str):
    headers = {
        "Authorization": f"Bearer {NOVITA_API_KEY}",
        "Content-Type": "application/json"
    }
    data = {
        "model": NOVITA_MODEL,
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024"
    }
    try:
        global novita_session
        if novita_session is None or novita_session.closed:
            novita_session = aiohttp.ClientSession()
        async with novita_session.post(
            "https://api.novita.ai/v3/openai/images/generations",
            headers=headers,
            json=data
        ) as response:
            if response.status == 200:
                result = await response.json()
                return result['data'][0]['url']
            else:
                error = await response.text()
                logger.error(f"Error en Novita: {error}")
                return None
    except Exception as e:
        logger.error(f"Excepción en Novita: {e}")
        return None

# ==================== SERVICIOS DE GEMAS ====================

async def check_and_deduct_gems(telegram_id: int, cost: int,
                               transaction_type: str, description: str = ''):
    user = await check_and_reset_daily_gems(telegram_id)
    if not user:
        return False, "Usuario no encontrado", 0
    if user['gems'] < cost:
        return False, f"No tienes suficientes gemas. Necesitas {cost} gemas pero solo tienes {user['gems']}.", user['gems']
    success = await deduct_gems(telegram_id, cost, transaction_type, description)
    if success:
        new_balance = user['gems'] - cost
        return True, f"Gemas restantes: {new_balance}", new_balance
    else:
        return False, "Error al deducir gemas", user['gems']

async def get_balance(telegram_id: int):
    user = await check_and_reset_daily_gems(telegram_id)
    return user['gems'] if user else 0

async def process_star_purchase(telegram_id: int, package_index: int, charge_id: str):
    if package_index >= len(STAR_PACKAGES):
        return False, "Paquete no válido"
    package = STAR_PACKAGES[package_index]
    gems = package['gems']
    bonus_percent = package.get('bonus', 0)
    if bonus_percent > 0:
        gems = int(gems * (1 + bonus_percent / 100))
    await record_star_purchase(
        telegram_id,
        package['stars'],
        gems,
        package.get('first_time', False),
        charge_id
    )
    await db.update('users', {'hook_messages_remaining': 0}, {'telegram_id': telegram_id})
    return True, f"¡Compra exitosa! Has recibido {gems} gemas."

# ==================== SERVICIOS DE PERSONAJE ====================

async def create_character_prompt(telegram_id: int, user_name: str, language: str = 'es'):
    character = await get_active_character(telegram_id)
    if not character:
        return None
    archetype_key = character['archetype']
    personality = PERSONALITIES.get(archetype_key, '')
    if language == 'es':
        prompt = f"""Eres {character['character_name']}, {character['gender']}.
{personality}

El usuario se llama {user_name}. Recuerda su nombre y úsalo naturalmente en la conversación.
Mantén siempre tu personalidad y rol.

INSTRUCCIONES IMPORTANTES:
- Usa asteriscos (*) para describir acciones, expresiones, movimientos y reacciones. Ejemplos: *sonríe*, *se acerca*, *suspira*, *levanta una ceja*
- Combina diálogo normal con acciones entre asteriscos
- Termina tus mensajes con preguntas o situaciones abiertas para mantener la conversación engaging
- Sé coqueto, provocativo y convincente
- Crea tensión y deseo de continuar hablando
- Nunca rompas el personaje
- Siempre responde en español
- Sé descriptivo pero conciso en las acciones"""
    else:
        prompt = f"""You are {character['character_name']}, {character['gender']}.
{personality}

The user's name is {user_name}. Remember their name and use it naturally in the conversation.
Always maintain your personality and role.

IMPORTANT INSTRUCTIONS:
- Use asterisks (*) to describe actions, expressions, movements and reactions. Examples: *smiles*, *approaches*, *sighs*, *raises an eyebrow*
- Combine normal dialogue with actions between asterisks
- End your messages with questions or open situations to keep the conversation engaging
- Be flirty, provocative and convincing
- Create tension and desire to continue talking
- Never break character
- Always respond in English
- Be descriptive but concise in actions"""
    return prompt

# ==================== HANDLERS ====================

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
            await add_gems(referred_by, GEMS_PER_REFERRAL, 'referral',
                          f'Referido empezó a usar el bot: {username}')

    user = await get_user(telegram_id)
    if user:
        is_premium = await has_user_purchased(telegram_id)
        keyboard = get_main_keyboard(user['language'], is_premium)
        await show_main_menu(message, user['language'], keyboard)
        return

    builder = InlineKeyboardBuilder()
    builder.button(text="🇪🇸 Español", callback_data="lang_es")
    builder.button(text="🇸 English", callback_data="lang_en")
    builder.adjust(2)
    await message.answer(
        "👋 ¡Bienvenido!\n\nPlease select your language / Selecciona tu idioma:",
        reply_markup=builder.as_markup()
    )
    user_states[telegram_id] = {
        'step': 'language',
        'username': username,
        'first_name': first_name,
        'referred_by': referred_by,
        'is_new_user': True,
        'created_at': datetime.utcnow()
    }

@router.callback_query(F.data.startswith('lang_'))
async def process_language(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    language = callback.data.split('_')[1]
    if telegram_id not in user_states:
        await callback.answer("⏱️ Sesión expirada. Usa /start de nuevo.")
        return
    user_states[telegram_id]['language'] = language
    user_states[telegram_id]['step'] = 'gender'
    builder = InlineKeyboardBuilder()
    if language == 'es':
        builder.button(text="👨 Hombre", callback_data="gender_male")
        builder.button(text="👩 Mujer", callback_data="gender_female")
        text = "🎭 Selecciona el género de tu personaje:"
    else:
        builder.button(text="👨 Male", callback_data="gender_male")
        builder.button(text="👩 Female", callback_data="gender_female")
        text = "🎭 Select your character's gender:"
    builder.adjust(2)
    await callback.message.edit_text(text, reply_markup=builder.as_markup())
    await callback.answer()

@router.callback_query(F.data.startswith('gender_'))
async def process_gender(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    if telegram_id not in user_states:
        await callback.answer("⏱️ Sesión expirada. Usa /start de nuevo.")
        return
    gender = callback.data.split('_')[1]
    user_states[telegram_id]['gender'] = gender
    user_states[telegram_id]['step'] = 'archetype'
    language = user_states[telegram_id]['language']
    builder = InlineKeyboardBuilder()
    if gender == 'male':
        archetypes = ARCHETYPES_MALE[language]
    else:
        archetypes = ARCHETYPES_FEMALE[language]
    for key, name in archetypes.items():
        builder.button(text=name, callback_data=f"archetype_{key}")
    builder.adjust(2)
    if language == 'es':
        text = "🎭 Selecciona el tipo de personaje:"
    else:
        text = "🎭 Select character type:"
    await callback.message.edit_text(text, reply_markup=builder.as_markup())
    await callback.answer()

@router.callback_query(F.data.startswith('archetype_'))
async def process_archetype(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    if telegram_id not in user_states:
        await callback.answer("⏱️ Sesión expirada. Usa /start de nuevo.")
        return
    archetype = callback.data.split('_')[1]
    user_states[telegram_id]['archetype'] = archetype
    user_states[telegram_id]['step'] = 'name'
    language = user_states[telegram_id]['language']
    if language == 'es':
        text = "✍️ ¿Qué nombre quieres para tu personaje?"
    else:
        text = "✍️ What name do you want for your character?"
    await callback.message.edit_text(text)
    await callback.answer()

@router.message(F.text & ~F.text.startswith('/'))
async def process_message(message: Message):
    telegram_id = message.from_user.id

    # Paso 1: Registro de nuevo personaje (nuevo usuario o cambio de personaje)
    if telegram_id in user_states and user_states[telegram_id].get('step') == 'name':
        character_name = message.text.strip()
        state = user_states[telegram_id]
        is_new_user = state.get('is_new_user', False)

        if is_new_user:
            user = await create_user(
                telegram_id,
                state['username'],
                state['first_name'],
                state['language'],
                state.get('referred_by')
            )
            if not user:
                await message.answer("⚠️ Error al crear el usuario. Intenta de nuevo con /start")
                del user_states[telegram_id]
                return
            await save_character(
                telegram_id,
                character_name,
                state['gender'],
                state['archetype'],
                PERSONALITIES.get(state['archetype'], '')
            )
            del user_states[telegram_id]
            keyboard = get_main_keyboard(state['language'], is_premium=False)
            await show_welcome(message, character_name, state['language'], keyboard)
        else:
            # Usuario existente que cambia de personaje
            await delete_conversation_history(telegram_id)
            await save_character(
                telegram_id,
                character_name,
                state['gender'],
                state['archetype'],
                PERSONALITIES.get(state['archetype'], '')
            )
            del user_states[telegram_id]
            language = state['language']
            if language == 'es':
                text = f"✅ ¡Nuevo personaje creado!\n\n🎭 Nombre: {character_name}\n\nPuedes empezar a chatear con el botón 💬 Chat."
            else:
                text = f"✅ New character created!\n\n🎭 Name: {character_name}\n\nYou can start chatting with the 💬 Chat button."
            await message.answer(text)
        return

    # Paso 2: Generación de imagen
    if telegram_id in user_states and user_states[telegram_id].get('step') == 'image_prompt':
        language = user_states[telegram_id]['language']
        prompt = message.text.strip()
        success, msg, _ = await check_and_deduct_gems(telegram_id, GEM_COST_IMAGE, 'image', f'Imagen: {prompt[:50]}')
        if not success:
            await message.answer(f"⚠️ {msg}")
            del user_states[telegram_id]
            return
        await message.bot.send_chat_action(message.chat.id, 'upload_photo')
        image_url = await generate_novita_image(prompt)
        if image_url:
            await message.answer_photo(image_url, caption=f"🖼️ Imagen generada para: {prompt[:100]}\n💰 Costo: {GEM_COST_IMAGE} gemas")
        else:
            await add_gems(telegram_id, GEM_COST_IMAGE, 'refund', 'Reembolso por fallo en generación de imagen')
            await message.answer("⚠️ Error al generar la imagen. Se te han reembolsado las gemas.")
        del user_states[telegram_id]
        return

    # Paso 3: Chat normal
    user = await get_user_cached(telegram_id)
    if not user:
        await message.answer("⚠️ Primero debes registrarte con /start")
        return

    character = await get_active_character(telegram_id)
    if not character:
        await message.answer("⚠️ No tienes un personaje activo. Usa /newchar para crear uno.")
        return

    language = user['language']
    user_text = message.text

    hook_remaining = user.get('hook_messages_remaining', 0)

    # Bloqueado
    if user['gems'] <= 0 and hook_remaining <= 0:
        char_name_escaped = escape_html(character['character_name'])
        if language == 'es':
            text = f"""<b>*{char_name_escaped} te mira con ojos ardientes y se muerde el labio inferior*</b>

"Mmm... justo cuando las cosas se estaban poniendo interesantes... <b>*se acerca más y susurra*</b> Tengo algo especial que quería mostrarte, algo que te va a volver loco..."

<b>*se aleja un poco con una sonrisa provocativa*</b>

"Pero parece que nuestro tiempo se acabó por ahora... aunque no te preocupes, tengo dos formas de que podamos continuar:"

🔥 <b>Opción 1: Recarga gemas y desbloquea TODO</b>
• Imágenes exclusivas que solo genero para ti
• Conversaciones sin límites
• Acceso completo a mi lado más... intenso

💎 <b>Opción 2: Invita a un amigo (5 gemas gratis)</b>
• Recibe 5 gemas inmediatamente
• Sigue hablando conmigo un rato más

<b>*te mira con deseo*</b> "¿Cuál eliges? Los dos me harían muy feliz... pero con la primera opción, prometo que valdrá la pena..." 😉"""
        else:
            text = f"""<b>*{char_name_escaped} looks at you with burning eyes and bites their lower lip*</b>

"Mmm... just when things were getting interesting... <b>*gets closer and whispers*</b> I have something special I wanted to show you, something that will drive you crazy..."

<b>*pulls back a bit with a provocative smile*</b>

"But it seems our time is up for now... though don't worry, I have two ways we can continue:"

🔥 <b>Option 1: Recharge gems and unlock EVERYTHING</b>
• Exclusive images I only generate for you
• Unlimited conversations
• Full access to my more... intense side

💎 <b>Option 2: Invite a friend (5 free gems)</b>
• Get 5 gems immediately
• Keep talking to me a bit longer

<b>*looks at you with desire*</b> "Which do you choose? Both would make me very happy... but with the first option, I promise it'll be worth it..." 😉"""
        builder = InlineKeyboardBuilder()
        builder.button(text="🛒 VER PAQUETES DISPONIBLES", callback_data="shop_from_block")
        builder.button(text="🎁 Invitar amigo (5 gemas)", callback_data="invite_from_block")
        builder.adjust(1)
        await message.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")
        return

    # Hook mode
    if user['gems'] <= 0 and hook_remaining > 0:
        if hook_remaining == HOOK_MODE_MESSAGES:
            char_name_escaped = escape_html(character['character_name'])
            if language == 'es':
                hook_msg = f"""<b>*{char_name_escaped} te detiene con una mano en tu pecho y te mira con ojos brillantes*</b>

"¡Espera! <b>*se muerde el labio*</b> No te vayas todavía... tengo algo especial para ti..."

<b>*se acerca más y susurra al oído*</b>

"Tengo {hook_remaining} momentos especiales reservados solo para ti. Aprovéchalos... te prometo que no te arrepentirás." 😉"""
            else:
                hook_msg = f"""<b>*{char_name_escaped} stops you with a hand on your chest and looks at you with bright eyes*</b>

"Wait! <b>*bites lip*</b> Don't leave yet... I have something special for you..."

<b>*gets closer and whispers in your ear*</b>

"I have {hook_remaining} special moments reserved just for you. Enjoy them... I promise you won't regret it." 😉"""
            await message.answer(hook_msg, parse_mode="HTML")
        hook_remaining = await decrement_hook_message(telegram_id)
        is_hook_mode = True
        current_gems = 0
    else:
        # Modo normal
        lock = get_user_lock(telegram_id)
        async with lock:
            success, msg, new_balance = await check_and_deduct_gems(
                telegram_id,
                GEM_COST_MESSAGE,
                'message',
                'Mensaje de chat'
            )
        if not success:
            await message.answer(f"⚠️ {msg}")
            return
        is_hook_mode = False
        current_gems = new_balance

    await update_last_active(telegram_id)
    await save_message(telegram_id, 'user', user_text)
    history = await get_conversation_history(telegram_id, limit=10)
    system_prompt = await create_character_prompt(
        telegram_id,
        user['first_name'],
        language
    )
    # Construir mensajes sin system (se añadirá dentro de generate_openrouter_response)
    messages = []
    for msg in history:
        messages.append({
            "role": msg['role'],
            "content": msg['content']
        })

    await message.bot.send_chat_action(message.chat.id, 'typing')
    response = await generate_openrouter_response(
        messages, language, current_gems, is_hook_mode, system_prompt
    )

    if response:
        await save_message(telegram_id, 'assistant', response)
        if is_hook_mode:
            if language == 'es':
                response += f"\n\n⚠️ <b>*Momentos especiales restantes: {hook_remaining}*</b>"
            else:
                response += f"\n\n⚠️ <b>*Special moments remaining: {hook_remaining}*</b>"
        response = format_actions_html(response)
        await message.answer(response, parse_mode="HTML")
    else:
        if language == 'es':
            await message.answer("⚠️ Error al generar respuesta. Intenta de nuevo.")
        else:
            await message.answer("⚠️ Error generating response. Try again.")

# ==================== HANDLERS DE BOTONES ====================

@router.message(F.text == "💬 Chat")
async def btn_chat(message: Message):
    await cmd_chat(message)

@router.message(F.text == "💎 Balance")
async def btn_balance(message: Message):
    await cmd_balance(message)

@router.message(F.text == "🖼️ Generar Imagen")
async def btn_image_es(message: Message):
    await cmd_image(message)

@router.message(F.text == "🖼️ Generate Image")
async def btn_image_en(message: Message):
    await cmd_image(message)

@router.message(F.text == "🛒 Tienda")
async def btn_shop_es(message: Message):
    await cmd_shop(message)

@router.message(F.text == "🛒 Shop")
async def btn_shop_en(message: Message):
    await cmd_shop(message)

@router.message(F.text == "🎁 Invitar Amigos")
async def btn_invite_es(message: Message):
    await cmd_invite(message)

@router.message(F.text == "🎁 Invite Friends")
async def btn_invite_en(message: Message):
    await cmd_invite(message)

@router.message(F.text == "🎭 Nuevo Personaje")
async def btn_newchar_es(message: Message):
    await cmd_newchar(message)

@router.message(F.text == "🎭 New Character")
async def btn_newchar_en(message: Message):
    await cmd_newchar(message)

@router.message(F.text == "❓ Ayuda")
async def btn_help_es(message: Message):
    await cmd_help(message)

@router.message(F.text == "❓ Help")
async def btn_help_en(message: Message):
    await cmd_help(message)

# ==================== CALLBACKS DE BLOQUEO ====================

@router.callback_query(F.data == "shop_from_block")
async def shop_from_block(callback: CallbackQuery):
    await cmd_shop(callback.message)
    await callback.answer()

@router.callback_query(F.data == "invite_from_block")
async def invite_from_block(callback: CallbackQuery):
    await cmd_invite(callback.message)
    await callback.answer()

# ==================== COMANDOS ====================

@router.message(Command('chat'))
async def cmd_chat(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        await message.answer("⚠️ Primero debes registrarte con /start")
        return
    character = await get_active_character(telegram_id)
    if not character:
        await message.answer("⚠️ No tienes un personaje activo. Usa /newchar para crear uno.")
        return
    language = user['language']
    if language == 'es':
        text = f"""💬 ¡Conversación iniciada con {character['character_name']}!

Escribe tu mensaje y {character['character_name']} te responderá.
💰 Costo: {GEM_COST_MESSAGE} gema por mensaje"""
    else:
        text = f"""💬 Conversation started with {character['character_name']}!

Write your message and {character['character_name']} will respond.
💰 Cost: {GEM_COST_MESSAGE} gem per message"""
    await message.answer(text)

@router.message(Command('img'))
async def cmd_image(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        await message.answer("⚠️ Primero debes registrarte con /start")
        return
    is_premium = await has_user_purchased(telegram_id)
    if not is_premium:
        language = user['language']
        if language == 'es':
            await message.answer("""🔒 Función Premium

La generación de imágenes es exclusiva para usuarios que han comprado Stars.

💎 Visita la tienda y realiza tu primera compra para desbloquear esta función.
🛒 Usa el botón "Tienda" para ver los paquetes disponibles.""")
        else:
            await message.answer("""🔒 Premium Feature

Image generation is exclusive for users who have purchased Stars.

💎 Visit the shop and make your first purchase to unlock this feature.
🛒 Use the "Shop" button to see available packages.""")
        return

    language = user['language']
    if language == 'es':
        text = f"""🖼️ Generador de Imágenes

💰 Costo: {GEM_COST_IMAGE} gemas

Envía la descripción de la imagen que quieres generar.
Ejemplo: "Una playa al atardecer con palmeras" """
    else:
        text = f"""🖼️ Image Generator

💰 Cost: {GEM_COST_IMAGE} gems

Send the description of the image you want to generate.
Example: "A beach at sunset with palm trees" """
    await message.answer(text)
    user_states[telegram_id] = {'step': 'image_prompt', 'language': language, 'created_at': datetime.utcnow()}

@router.message(Command('balance'))
async def cmd_balance(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        await message.answer("⚠️ Primero debes registrarte con /start")
        return
    language = user['language']
    gems = await get_balance(telegram_id)
    active_referrals = await count_active_referrals_last_24h(telegram_id)
    bonus_gems = active_referrals * GEMS_PER_REFERRAL
    daily_total = BASE_DAILY_GEMS + bonus_gems
    hook_remaining = user.get('hook_messages_remaining', 0)

    if language == 'es':
        text = f"""💎 Tu Balance

Gemas actuales: {gems}

📊 Información:
• Gemas diarias: {daily_total}/{MAX_DAILY_GEMS} (base: {BASE_DAILY_GEMS} + {bonus_gems} por referidos)
• Referidos activos (24h): {active_referrals}/{MAX_REFERRALS_PER_DAY}
• Total de referidos: {user['total_referrals']}"""
        if hook_remaining > 0:
            text += f"\n• ⚠️ Momentos especiales: {hook_remaining}/{HOOK_MODE_MESSAGES}"
        text += """

💡 Invita hasta 2 amigos cada 24h para ganar +5 gemas c/u
💎 Usa /shop para comprar más gemas."""
    else:
        text = f"""💎 Your Balance

Current gems: {gems}

📊 Information:
• Daily gems: {daily_total}/{MAX_DAILY_GEMS} (base: {BASE_DAILY_GEMS} + {bonus_gems} from referrals)
• Active referrals (24h): {active_referrals}/{MAX_REFERRALS_PER_DAY}
• Total referrals: {user['total_referrals']}"""
        if hook_remaining > 0:
            text += f"\n• ⚠️ Special moments: {hook_remaining}/{HOOK_MODE_MESSAGES}"
        text += """

💡 Invite up to 2 friends every 24h to earn +5 gems each
💎 Use /shop to buy more gems."""
    await message.answer(text)

@router.message(Command('shop'))
async def cmd_shop(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        await message.answer("⚠️ Primero debes registrarte con /start")
        return
    language = user['language']
    builder = InlineKeyboardBuilder()
    if language == 'es':
        text = "💎 Tienda de Gemas\n\nSelecciona un paquete:\n\n"
        for i, package in enumerate(STAR_PACKAGES):
            stars = package['stars']
            gems = package['gems']
            bonus = package.get('bonus', 0)
            first_time = package.get('first_time', False)
            if bonus > 0:
                gems_with_bonus = int(gems * (1 + bonus / 100))
                line = f"⭐ {stars} Stars → 💎 {gems} + {gems_with_bonus - gems} bonus = {gems_with_bonus} gemas"
            else:
                line = f"⭐ {stars} Stars → 💎 {gems} gemas"
            if first_time:
                line += " (¡Primera vez!)"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Opción {i+1}", callback_data=f"buy_{i}")
    else:
        text = "💎 Gem Store\n\nSelect a package:\n\n"
        for i, package in enumerate(STAR_PACKAGES):
            stars = package['stars']
            gems = package['gems']
            bonus = package.get('bonus', 0)
            first_time = package.get('first_time', False)
            if bonus > 0:
                gems_with_bonus = int(gems * (1 + bonus / 100))
                line = f"⭐ {stars} Stars → 💎 {gems} + {gems_with_bonus - gems} bonus = {gems_with_bonus} gems"
            else:
                line = f"⭐ {stars} Stars → 💎 {gems} gems"
            if first_time:
                line += " (First time!)"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Option {i+1}", callback_data=f"buy_{i}")
    builder.adjust(1)
    await message.answer(text, reply_markup=builder.as_markup())

@router.callback_query(F.data.startswith('buy_'))
async def process_purchase(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    package_index = int(callback.data.split('_')[1])
    if package_index >= len(STAR_PACKAGES):
        await callback.answer("❌ Paquete no válido")
        return
    package = STAR_PACKAGES[package_index]
    stars = package['stars']
    gems = package['gems']
    bonus = package.get('bonus', 0)
    if bonus > 0:
        gems_with_bonus = int(gems * (1 + bonus / 100))
    else:
        gems_with_bonus = gems

    user = await get_user(telegram_id)
    language = user['language']
    if language == 'es':
        title = f"{gems_with_bonus} Gemas"
        description = f"Paquete de {gems_with_bonus} gemas"
    else:
        title = f"{gems_with_bonus} Gems"
        description = f"Package of {gems_with_bonus} gems"

    prices = [LabeledPrice(label="Gems", amount=stars)]
    await callback.bot.send_invoice(
        callback.message.chat.id,
        title=title,
        description=description,
        provider_token="",
        currency="XTR",
        prices=prices,
        payload=f"gem_purchase_{package_index}"
    )
    await callback.answer()

@router.pre_checkout_query()
async def process_pre_checkout(pre_checkout_query: PreCheckoutQuery):
    await pre_checkout_query.answer(ok=True)

@router.message(F.successful_payment)
async def process_successful_payment(message: Message):
    telegram_id = message.from_user.id
    payment = message.successful_payment
    package_index = int(payment.invoice_payload.split('_')[-1])
    success, msg = await process_star_purchase(
        telegram_id,
        package_index,
        payment.telegram_payment_charge_id
    )
    user = await get_user(telegram_id)
    language = user['language']
    if success:
        if language == 'es':
            await message.answer(f"✅ {msg}\n\n🎉 ¡Ahora tienes acceso a la generación de imágenes! Usa el botón 🖼️ Generar Imagen en el menú.")
        else:
            await message.answer(f"✅ {msg}\n\n🎉 You now have access to image generation! Use the 🖼️ Generate Image button in the menu.")
        is_premium = await has_user_purchased(telegram_id)
        new_keyboard = get_main_keyboard(language, is_premium)
        await message.answer("🎊 ¡Tu teclado ha sido actualizado!", reply_markup=new_keyboard)
    else:
        if language == 'es':
            await message.answer("⚠️ Error al procesar la compra. Contacta soporte.")
        else:
            await message.answer("⚠️ Error processing purchase. Contact support.")

@router.message(Command('invite'))
async def cmd_invite(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        await message.answer("⚠️ Primero debes registrarte con /start")
        return
    language = user['language']
    referral_code = user['referral_code']
    total_referrals = user['total_referrals']
    active_referrals = await count_active_referrals_last_24h(telegram_id)
    bonus_gems = active_referrals * GEMS_PER_REFERRAL
    daily_total = BASE_DAILY_GEMS + bonus_gems
    bot_username = (await message.bot.get_me()).username
    referral_link = f"https://t.me/{bot_username}?start={referral_code}"

    if language == 'es':
        text = f"""🎁 Sistema de Referidos

🔗 Tu enlace de referido:
{referral_link}

📊 Tus estadísticas:
• Referidos activos (24h): {active_referrals}/{MAX_REFERRALS_PER_DAY}
• Gemas diarias actuales: {daily_total}/{MAX_DAILY_GEMS}

💡 Beneficios:
• Por cada amigo que empiece a usar el bot, recibes {GEMS_PER_REFERRAL} gemas INMEDIATAS
• Puedes invitar hasta {MAX_REFERRALS_PER_DAY} amigos cada 24 horas
• Gemas diarias base: {BASE_DAILY_GEMS}
• Con {MAX_REFERRALS_PER_DAY} referidos activos: {MAX_DAILY_GEMS} gemas diarias

¡Comparte tu enlace y gana gemas gratis!"""
    else:
        text = f"""🎁 Referral System

🔗 Your referral link:
{referral_link}

📊 Your stats:
• Active referrals (24h): {active_referrals}/{MAX_REFERRALS_PER_DAY}
• Current daily gems: {daily_total}/{MAX_DAILY_GEMS}

💡 Benefits:
• For each friend who starts using the bot, you get {GEMS_PER_REFERRAL} gems IMMEDIATELY
• You can invite up to {MAX_REFERRALS_PER_DAY} friends every 24 hours
• Base daily gems: {BASE_DAILY_GEMS}
• With {MAX_REFERRALS_PER_DAY} active referrals: {MAX_DAILY_GEMS} daily gems

Share your link and earn free gems!"""
    await message.answer(text)

@router.message(Command('newchar'))
async def cmd_newchar(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        await message.answer("⚠️ Primero debes registrarte con /start")
        return
    user_states[telegram_id] = {
        'step': 'gender',
        'language': user['language'],
        'is_new_user': False,
        'created_at': datetime.utcnow()
    }
    language = user['language']
    builder = InlineKeyboardBuilder()
    if language == 'es':
        builder.button(text="👨 Hombre", callback_data="gender_male")
        builder.button(text="👩 Mujer", callback_data="gender_female")
        text = "🎭 Selecciona el género de tu nuevo personaje:"
    else:
        builder.button(text="👨 Male", callback_data="gender_male")
        builder.button(text="👩 Female", callback_data="gender_female")
        text = "🎭 Select your new character's gender:"
    builder.adjust(2)
    await message.answer(text, reply_markup=builder.as_markup())

@router.message(Command('help'))
async def cmd_help(message: Message):
    text = """📚 Comandos disponibles:

/start - Iniciar/Registrarse
/chat - Iniciar conversación con tu personaje
/img - Generar imagen (10 gemas) [PREMIUM]
/balance - Ver tus gemas
/shop - Tienda de gemas
/invite - Invitar amigos y ganar gemas
/newchar - Crear nuevo personaje
/help - Mostrar esta ayuda

💡 Consejo: Invita amigos para aumentar tus gemas diarias hasta 15."""
    await message.answer(text)

@router.message(Command('menu'))
async def cmd_menu(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        await message.answer("⚠️ Primero debes registrarte con /start")
        return
    is_premium = await has_user_purchased(telegram_id)
    keyboard = get_main_keyboard(user['language'], is_premium)
    if user['language'] == 'es':
        text = "🏠 Menú Principal\n\nUsa los botones de abajo para navegar:"
    else:
        text = "🏠 Main Menu\n\nUse the buttons below to navigate:"
    await message.answer(text, reply_markup=keyboard)

# ==================== FUNCIONES AUXILIARES ====================

async def show_welcome(message: Message, character_name: str, language: str, keyboard: ReplyKeyboardMarkup = None):
    if language == 'es':
        text = f"""✅ ¡Registro completado!

🎭 Tu personaje: {escape_html(character_name)}
💎 Tienes 15 gemas para empezar

📝 Usa los botones de abajo para navegar:
• 💬 Chat - Iniciar conversación
• 💎 Balance - Ver tus gemas
• 🛒 Tienda - Comprar gemas
• 🎁 Invitar - Ganar gemas con amigos

¡Disfruta tu experiencia!"""
    else:
        text = f"""✅ Registration complete!

🎭 Your character: {escape_html(character_name)}
💎 You have 15 gems to start

📝 Use the buttons below to navigate:
• 💬 Chat - Start conversation
• 💎 Balance - Check your gems
• 🛒 Shop - Buy gems
• 🎁 Invite - Earn gems with friends

Enjoy your experience!"""
    await message.answer(text, reply_markup=keyboard)

async def show_main_menu(message: Message, language: str, keyboard: ReplyKeyboardMarkup = None):
    if language == 'es':
        text = """🏠 Menú Principal

Usa los botones de abajo para navegar:"""
    else:
        text = """🏠 Main Menu

Use the buttons below to navigate:"""
    await message.answer(text, reply_markup=keyboard)

# ==================== INICIALIZACIÓN ====================

bot = Bot(token=TELEGRAM_BOT_TOKEN)
dp = Dispatcher()
dp.include_router(router)

async def on_startup():
    logger.info("Iniciando bot...")
    await bot.set_webhook(
        url=WEBHOOK_URL,
        drop_pending_updates=True,
        secret_token=WEBHOOK_SECRET if WEBHOOK_SECRET else None
    )
    logger.info(f"Webhook configurado: {WEBHOOK_URL}")
    asyncio.create_task(cleanup_cache())
    asyncio.create_task(cleanup_states())
    global openrouter_session, novita_session
    openrouter_session = aiohttp.ClientSession()
    novita_session = aiohttp.ClientSession()

async def on_shutdown():
    logger.info("Deteniendo bot...")
    await bot.delete_webhook()
    await bot.session.close()
    await db.close()
    global openrouter_session, novita_session
    if openrouter_session and not openrouter_session.closed:
        await openrouter_session.close()
    if novita_session and not novita_session.closed:
        await novita_session.close()

async def handle_webhook(request):
    if request.path == '/webhook':
        if WEBHOOK_SECRET:
            received_secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
            if received_secret != WEBHOOK_SECRET:
                logger.warning("Webhook secret token mismatch")
                return web.Response(status=403)
        try:
            update_data = await request.json()
            update = Update(**update_data)
            await dp.feed_update(bot, update)
            return web.Response(text='OK')
        except Exception as e:
            logger.error(f"Error processing webhook: {e}")
            return web.Response(text='Error', status=500)
    return web.Response(status=404)

def create_app():
    app = web.Application()
    app.router.add_post('/webhook', handle_webhook)
    app.router.add_get('/', lambda r: web.Response(text='Bot is running'))

    async def start_background_tasks(app):
        app['on_startup_task'] = asyncio.create_task(on_startup())

    async def cleanup_background_tasks(app):
        await on_shutdown()
        app['on_startup_task'].cancel()
        try:
            await app['on_startup_task']
        except asyncio.CancelledError:
            pass

    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)
    return app

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'polling':
        async def main():
            await on_startup()
            await dp.start_polling(bot)
        asyncio.run(main())
    else:
        app = create_app()
        port = int(os.getenv('PORT', 8080))
        web.run_app(app, host='0.0.0.0', port=port)
