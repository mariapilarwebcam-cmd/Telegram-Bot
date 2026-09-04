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
WEBHOOK_SECRET = os.getenv('WEBHOOK_SECRET')

OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-0731"
NOVITA_MODEL = "stable-diffusion-xl"

GEM_COST_MESSAGE = 1
GEM_COST_IMAGE = 10
GEM_COST_AUDIO = 5
GEM_COST_NEW_CHARACTER = 5   # Costo en gemas para crear nuevo personaje

# Sistema de referidos
BASE_DAILY_GEMS = 5
GEMS_PER_REFERRAL = 5
MAX_REFERRALS_PER_DAY = 2
MAX_DAILY_GEMS = BASE_DAILY_GEMS + (GEMS_PER_REFERRAL * MAX_REFERRALS_PER_DAY)

# Hook Mode
HOOK_MODE_MESSAGES = 5

# Arquetipos separados por género
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

STAR_PACKAGES = [
    {"stars": 50, "gems": 200, "bonus": 0, "first_time": True},
    {"stars": 75, "gems": 300, "bonus": 0, "first_time": False},
    {"stars": 150, "gems": 600, "bonus": 5, "first_time": False},
    {"stars": 300, "gems": 1200, "bonus": 10, "first_time": False},
    {"stars": 500, "gems": 2000, "bonus": 15, "first_time": False},
]

logging.basicConfig(level=logging.WARNING, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

user_states: Dict[int, Dict[str, Any]] = {}
user_cache: Dict[int, Dict[str, Any]] = {}
CACHE_TTL = 300
user_locks: Dict[int, asyncio.Lock] = {}

def get_user_lock(telegram_id: int) -> asyncio.Lock:
    if telegram_id not in user_locks:
        user_locks[telegram_id] = asyncio.Lock()
    return user_locks[telegram_id]

openrouter_session: Optional[aiohttp.ClientSession] = None
novita_session: Optional[aiohttp.ClientSession] = None

def escape_html(text: str) -> str:
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def format_actions_html(text: str) -> str:
    text = escape_html(text)
    return re.sub(r'\*([^*]+)\*', r'<b>*\1*</b>', text)

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

async def invalidate_cache(telegram_id: int):
    if telegram_id in user_cache:
        del user_cache[telegram_id]

async def cleanup_cache():
    while True:
        try:
            await asyncio.sleep(600)
            now = datetime.utcnow()
            expired = [tid for tid, data in user_cache.items() if (now - data['timestamp']).total_seconds() > CACHE_TTL]
            for tid in expired:
                del user_cache[tid]
            if user_cache:
                logger.info(f"Caché limpiado. Usuarios en caché: {len(user_cache)}")
        except Exception as e:
            logger.error(f"Error en cleanup_cache: {e}")

async def cleanup_states():
    while True:
        try:
            await asyncio.sleep(300)
            now = datetime.utcnow()
            expired = [tid for tid, state in user_states.items() if (now - state.get('created_at', now)).total_seconds() > 600]
            for tid in expired:
                del user_states[tid]
            if user_states:
                logger.info(f"Estados limpiados. Estados activos: {len(user_states)}")
        except Exception as e:
            logger.error(f"Error en cleanup_states: {e}")

class SupabaseClient:
    def __init__(self, url: str, key: str):
        self.base_url = url.rstrip('/') + '/rest/v1'
        self.headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
        self.session: Optional[aiohttp.ClientSession] = None
        self._connector = None

    async def get_session(self) -> aiohttp.ClientSession:
        if self.session is None or self.session.closed:
            self._connector = aiohttp.TCPConnector(limit=10, limit_per_host=5, ttl_dns_cache=300)
            self.session = aiohttp.ClientSession(connector=self._connector)
        return self.session

    async def close(self):
        if self.session and not self.session.closed: await self.session.close()
        if self._connector and not self._connector.closed: await self._connector.close()

    async def select(self, table: str, columns: str = '*', filters: Dict[str, Any] = None, order: str = None, limit: int = None) -> list:
        session = await self.get_session()
        params = {'select': columns}
        if filters:
            for key, value in filters.items(): params[key] = f'eq.{value}'
        if order: params['order'] = order
        if limit: params['limit'] = str(limit)
        url = f"{self.base_url}/{table}?{urllib.parse.urlencode(params)}"
        async with session.get(url, headers=self.headers) as response:
            if response.status == 200: return await response.json()
            logger.error(f"Supabase SELECT error: {await response.text()}")
            return []

    async def insert(self, table: str, data: dict) -> Optional[dict]:
        session = await self.get_session()
        async with session.post(f"{self.base_url}/{table}", headers=self.headers, json=data) as response:
            if response.status in [200, 201]:
                result = await response.json()
                return result[0] if result else None
            logger.error(f"Supabase INSERT error: {await response.text()}")
            return None

    async def update(self, table: str, data: dict, filters: Dict[str, Any]) -> bool:
        session = await self.get_session()
        params = {key: f'eq.{value}' for key, value in filters.items()}
        url = f"{self.base_url}/{table}?{urllib.parse.urlencode(params)}"
        async with session.patch(url, headers=self.headers, json=data) as response:
            if response.status in [200, 204]: return True
            logger.error(f"Supabase UPDATE error: {await response.text()}")
            return False

    async def delete(self, table: str, filters: Dict[str, Any]) -> bool:
        session = await self.get_session()
        params = {key: f'eq.{value}' for key, value in filters.items()}
        url = f"{self.base_url}/{table}?{urllib.parse.urlencode(params)}"
        async with session.delete(url, headers=self.headers) as response:
            if response.status in [200, 204]: return True
            logger.error(f"Supabase DELETE error: {await response.text()}")
            return False

    async def count(self, table: str, filters: Dict[str, Any] = None) -> int:
        session = await self.get_session()
        params = {'select': 'id', 'count': 'exact'}
        if filters:
            for key, value in filters.items(): params[key] = f'eq.{value}'
        url = f"{self.base_url}/{table}?{urllib.parse.urlencode(params)}"
        async with session.get(url, headers=self.headers) as response:
            if response.status == 200:
                count = response.headers.get('Content-Range', '0-0/0')
                return int(count.split('/')[-1])
            return 0

db = SupabaseClient(SUPABASE_URL, SUPABASE_KEY)

def generate_referral_code() -> str:
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

async def create_user(telegram_id: int, username: str, first_name: str, language: str = 'es', referred_by: Optional[int] = None):
    referral_code = generate_referral_code()
    user_data = {'telegram_id': telegram_id, 'username': username, 'first_name': first_name, 'language': language, 'gems': 15, 'referral_code': referral_code, 'referred_by': referred_by, 'total_referrals': 0, 'daily_gems_reset': datetime.utcnow().isoformat(), 'hook_messages_remaining': 0}
    result = await db.insert('users', user_data)
    if referred_by and result:
        await db.insert('referrals', {'referrer_id': referred_by, 'referred_id': telegram_id})
        referral_count = await db.count('referrals', {'referrer_id': referred_by})
        await db.update('users', {'total_referrals': referral_count}, {'telegram_id': referred_by})
    return result

async def get_user(telegram_id: int):
    results = await db.select('users', '*', {'telegram_id': telegram_id})
    return results[0] if results else None

async def update_last_active(telegram_id: int):
    await db.update('users', {'last_active': datetime.utcnow().isoformat()}, {'telegram_id': telegram_id})

async def count_active_referrals_last_24h(telegram_id: int) -> int:
    results = await db.select('referrals', '*', {'referrer_id': telegram_id})
    if not results: return 0
    now = datetime.utcnow()
    twenty_four_hours_ago = now - timedelta(hours=24)
    active_count = sum(1 for r in results if datetime.fromisoformat(r['created_at']) >= twenty_four_hours_ago)
    return min(active_count, MAX_REFERRALS_PER_DAY)

async def check_and_reset_daily_gems(telegram_id: int):
    user = await get_user(telegram_id)
    if not user: return None
    last_reset = datetime.fromisoformat(user['daily_gems_reset'])
    now = datetime.utcnow()
    if (now - last_reset).days >= 1:
        active_referrals = await count_active_referrals_last_24h(telegram_id)
        bonus_gems = active_referrals * GEMS_PER_REFERRAL
        new_gems = BASE_DAILY_GEMS + bonus_gems
        await db.update('users', {'gems': new_gems, 'daily_gems_reset': now.isoformat(), 'bonus_gems_from_referrals': bonus_gems, 'total_referrals': await db.count('referrals', {'referrer_id': telegram_id}), 'hook_messages_remaining': 0}, {'telegram_id': telegram_id})
        user.update({'gems': new_gems, 'bonus_gems_from_referrals': bonus_gems, 'hook_messages_remaining': 0})
    return user

async def deduct_gems(telegram_id: int, amount: int, transaction_type: str, description: str = ''):
    user = await get_user(telegram_id)
    if not user or user['gems'] < amount: return False
    await db.update('users', {'gems': user['gems'] - amount}, {'telegram_id': telegram_id})
    await db.insert('gem_transactions', {'telegram_id': telegram_id, 'amount': -amount, 'transaction_type': transaction_type, 'description': description})
    await invalidate_cache(telegram_id)
    return True

async def add_gems(telegram_id: int, amount: int, transaction_type: str, description: str = ''):
    user = await get_user(telegram_id)
    if not user: return False
    await db.update('users', {'gems': user['gems'] + amount}, {'telegram_id': telegram_id})
    await db.insert('gem_transactions', {'telegram_id': telegram_id, 'amount': amount, 'transaction_type': transaction_type, 'description': description})
    await invalidate_cache(telegram_id)
    return True

async def save_character(telegram_id: int, character_name: str, gender: str, archetype: str, personality: str):
    await db.update('user_characters', {'is_active': False}, {'telegram_id': telegram_id})
    return await db.insert('user_characters', {'telegram_id': telegram_id, 'character_name': character_name, 'gender': gender, 'archetype': archetype, 'personality': personality, 'is_active': True})

async def get_active_character(telegram_id: int):
    results = await db.select('user_characters', '*', {'telegram_id': telegram_id, 'is_active': True})
    return results[0] if results else None

async def get_all_characters(telegram_id: int):
    return await db.select('user_characters', '*', {'telegram_id': telegram_id})

async def set_active_character(telegram_id: int, character_id: int):
    await db.update('user_characters', {'is_active': False}, {'telegram_id': telegram_id})
    await db.update('user_characters', {'is_active': True}, {'telegram_id': telegram_id, 'id': character_id})

async def save_message(telegram_id: int, role: str, content: str, character_id: int):
    await db.insert('conversation_history', {'telegram_id': telegram_id, 'role': role, 'content': content, 'character_id': character_id})

async def get_conversation_history(telegram_id: int, character_id: int, limit: int = 10):
    results = await db.select('conversation_history', '*', {'telegram_id': telegram_id, 'character_id': character_id}, order='created_at.desc', limit=limit)
    results.reverse()
    return results

async def get_user_by_referral_code(referral_code: str):
    results = await db.select('users', '*', {'referral_code': referral_code})
    return results[0] if results else None

async def record_star_purchase(telegram_id: int, stars: int, gems: int, is_first_purchase: bool, charge_id: str):
    await db.insert('star_purchases', {'telegram_id': telegram_id, 'stars_amount': stars, 'gems_amount': gems, 'is_first_purchase': is_first_purchase, 'telegram_charge_id': charge_id})
    await add_gems(telegram_id, gems, 'purchase', f'Compra con {stars} stars')

async def has_user_purchased(telegram_id: int) -> bool:
    return len(await db.select('star_purchases', 'id', {'telegram_id': telegram_id}, limit=1)) > 0

async def activate_hook_mode(telegram_id: int):
    await db.update('users', {'hook_messages_remaining': HOOK_MODE_MESSAGES}, {'telegram_id': telegram_id})

async def decrement_hook_message(telegram_id: int) -> int:
    user = await get_user(telegram_id)
    if not user: return 0
    remaining = max(0, user.get('hook_messages_remaining', 0) - 1)
    await db.update('users', {'hook_messages_remaining': remaining}, {'telegram_id': telegram_id})
    return remaining

def get_main_keyboard(language: str, is_premium: bool = False) -> ReplyKeyboardMarkup:
    builder = ReplyKeyboardBuilder()
    if language == 'es':
        builder.row(KeyboardButton(text="💬 Chat"), KeyboardButton(text="💎 Balance"))
        builder.row(KeyboardButton(text="🖼️ Generar Imagen" if is_premium else "🛒 Tienda"), KeyboardButton(text="🛒 Tienda") if is_premium else KeyboardButton(text=""))
        builder.row(KeyboardButton(text="🎁 Invitar Amigos"), KeyboardButton(text="💬 Nuevo Chat"), KeyboardButton(text="❓ Ayuda"))
    else:
        builder.row(KeyboardButton(text="💬 Chat"), KeyboardButton(text="💎 Balance"))
        builder.row(KeyboardButton(text="🖼️ Generate Image" if is_premium else "🛒 Shop"), KeyboardButton(text="🛒 Shop") if is_premium else KeyboardButton(text=""))
        builder.row(KeyboardButton(text="🎁 Invite Friends"), KeyboardButton(text="💬 New Chat"), KeyboardButton(text="❓ Help"))
    
    clean_builder = ReplyKeyboardBuilder()
    for row in builder.export():
        clean_row = [btn for btn in row if btn.text != ""]
        if clean_row: clean_builder.row(*clean_row)
    return clean_builder.as_markup(resize_keyboard=True, one_time_keyboard=False)

async def generate_openrouter_response(messages: list, language: str = 'es', gem_balance: int = 15, is_hook_mode: bool = False, character_prompt: str = None):
    headers = {"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"}
    intensity_level = "MAXIMUM" if is_hook_mode else ("VERY_HIGH" if gem_balance <= 3 else ("HIGH" if gem_balance <= 7 else "NORMAL"))
    
    system_prompts = {
        'es': {
            'NORMAL': "Siempre responde en español. IMPORTANTE: Usa asteriscos para describir acciones (*sonríe*, *se acerca*). Termina con preguntas abiertas. Sé coqueto y mantén el interés.",
            'HIGH': "MODO INTENSO: Sé MÁS provocativo. Usa asteriscos para acciones atrevidas (*te mira con deseo*). Aumenta la tensión y el contacto físico.",
            'VERY_HIGH': "MODO MUY INTENSO: Sé EXTREMADAMENTE provocativo. Acciones muy atrevidas (*te acorrala*, *susurra*). Genera cliffhangers intensos.",
            'MAXIMUM': "MODO MÁXIMO: Sé LO MÁS PROVOCATIVO POSIBLE. Acciones extremas (*ojos ardientes*, *susurra cosas prohibidas*). Cliffhangers ÉPICOS. El usuario debe quedar OBSESIONADO."
        },
        'en': {
            'NORMAL': "Always respond in English. IMPORTANT: Use asterisks for actions (*smiles*, *approaches*). End with open questions. Be flirty and maintain interest.",
            'HIGH': "INTENSE MODE: Be MORE provocative. Use asterisks for bold actions (*looks with desire*). Increase tension and physical contact.",
            'VERY_HIGH': "VERY INTENSE MODE: Be EXTREMELY provocative. Very bold actions (*corners you*, *whispers*). Generate intense cliffhangers.",
            'MAXIMUM': "MAXIMUM MODE: Be AS PROVOCATIVE AS POSSIBLE. Extreme actions (*burning eyes*, *whispers forbidden things*). EPIC cliffhangers. User must become OBSESSED."
        }
    }
    
    intensity_prompt = system_prompts.get(language, system_prompts['es']).get(intensity_level, system_prompts['es']['NORMAL'])
    combined_system = f"{intensity_prompt}\n\n{character_prompt}" if character_prompt else intensity_prompt
    
    if language == 'es':
        combined_system = "IMPORTANTE: Responde ÚNICAMENTE en español. No uses ningún otro idioma.\n\n" + combined_system + "\n\nRecuerda: Solo español.\n\nIMPORTANTE: Mantén tu respuesta dentro de 400 tokens (aprox. 300 palabras). Termina tus frases y no cortes a mitad de palabra."
    else:
        combined_system = "IMPORTANT: Respond ONLY in English. Do not use any other language.\n\n" + combined_system + "\n\nRemember: Only English.\n\nIMPORTANT: Keep your response within 400 tokens (about 300 words). Finish your sentences and do not cut off mid-word."

    full_messages = [{"role": "system", "content": combined_system}] + messages
    temperature = 0.8 if intensity_level == 'NORMAL' else (0.85 if intensity_level == 'HIGH' else (0.9 if intensity_level == 'VERY_HIGH' else 0.95))
    
    data = {"model": OPENROUTER_MODEL, "messages": full_messages, "temperature": temperature, "max_tokens": 400}
    
    try:
        global openrouter_session
        if openrouter_session is None or openrouter_session.closed:
            openrouter_session = aiohttp.ClientSession()
        async with openrouter_session.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=data) as response:
            if response.status == 200:
                result = await response.json()
                return result['choices'][0]['message']['content']
            logger.error(f"OpenRouter error {response.status}: {await response.text()}")
            return None
    except Exception as e:
        logger.error(f"Excepción en OpenRouter: {str(e)}")
        return None

async def generate_novita_image(prompt: str):
    headers = {"Authorization": f"Bearer {NOVITA_API_KEY}", "Content-Type": "application/json"}
    data = {"model": NOVITA_MODEL, "prompt": prompt, "n": 1, "size": "1024x1024"}
    try:
        global novita_session
        if novita_session is None or novita_session.closed:
            novita_session = aiohttp.ClientSession()
        async with novita_session.post("https://api.novita.ai/v3/openai/images/generations", headers=headers, json=data) as response:
            if response.status == 200:
                return (await response.json())['data'][0]['url']
            logger.error(f"Error en Novita: {await response.text()}")
            return None
    except Exception as e:
        logger.error(f"Excepción en Novita: {e}")
        return None

async def check_and_deduct_gems(telegram_id: int, cost: int, transaction_type: str, description: str = ''):
    user = await check_and_reset_daily_gems(telegram_id)
    if not user: return False, "Usuario no encontrado", 0
    if user['gems'] < cost: return False, f"No tienes suficientes gemas. Necesitas {cost} gemas pero solo tienes {user['gems']}.", user['gems']
    if await deduct_gems(telegram_id, cost, transaction_type, description):
        return True, f"Gemas restantes: {user['gems'] - cost}", user['gems'] - cost
    return False, "Error al deducir gemas", user['gems']

async def get_balance(telegram_id: int):
    user = await check_and_reset_daily_gems(telegram_id)
    return user['gems'] if user else 0

async def process_star_purchase(telegram_id: int, package_index: int, charge_id: str):
    if package_index >= len(STAR_PACKAGES): return False, "Paquete no válido"
    pkg = STAR_PACKAGES[package_index]
    gems = int(pkg['gems'] * (1 + pkg.get('bonus', 0) / 100)) if pkg.get('bonus', 0) > 0 else pkg['gems']
    await record_star_purchase(telegram_id, pkg['stars'], gems, pkg.get('first_time', False), charge_id)
    await db.update('users', {'hook_messages_remaining': 0}, {'telegram_id': telegram_id})
    return True, f"¡Compra exitosa! Has recibido {gems} gemas."

async def create_character_prompt(telegram_id: int, user_name: str, language: str = 'es'):
    character = await get_active_character(telegram_id)
    if not character: return None
    personality = PERSONALITIES.get(character['archetype'], '')
    prefix = "Siempre responde en español." if language == 'es' else "Always respond in English."
    return f"""Eres {character['character_name']}, {character['gender']}. {personality}
El usuario se llama {user_name}. Úsalo naturalmente. Mantén siempre tu personalidad y rol.
INSTRUCCIONES:
- Usa asteriscos (*) para acciones: *sonríe*, *se acerca*.
- Combina diálogo con acciones.
- Termina con preguntas abiertas.
- Sé coqueto, provocativo y convincente.
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
        await show_main_menu(message, user['language'], get_main_keyboard(user['language'], await has_user_purchased(telegram_id)))
        return

    builder = InlineKeyboardBuilder()
    builder.button(text="🇪🇸 Español", callback_data="lang_es")
    builder.button(text="🇺🇸 English", callback_data="lang_en")
    builder.adjust(2)
    await message.answer("👋 ¡Bienvenido!\n\nPlease select your language / Selecciona tu idioma:", reply_markup=builder.as_markup())
    user_states[telegram_id] = {'step': 'language', 'username': username, 'first_name': first_name, 'referred_by': referred_by, 'is_new_user': True, 'created_at': datetime.utcnow()}

@router.callback_query(F.data.startswith('lang_'))
async def process_language(callback: CallbackQuery):
    if callback.from_user.id not in user_states:
        return await callback.answer("⏱️ Sesión expirada. Usa /start")
    lang = callback.data.split('_')[1]
    user_states[callback.from_user.id].update({'language': lang, 'step': 'gender'})
    
    builder = InlineKeyboardBuilder()
    if lang == 'es':
        builder.row(InlineKeyboardButton(text="👨 Hombre", callback_data="gender_male"), InlineKeyboardButton(text="👩 Mujer", callback_data="gender_female"))
        text = "🎭 Selecciona el género de tu personaje:"
    else:
        builder.row(InlineKeyboardButton(text="👨 Male", callback_data="gender_male"), InlineKeyboardButton(text="👩 Female", callback_data="gender_female"))
        text = "🎭 Select your character's gender:"
    
    await callback.message.edit_text(text, reply_markup=builder.as_markup())
    await callback.answer()

@router.callback_query(F.data.startswith('gender_'))
async def process_gender(callback: CallbackQuery):
    if callback.from_user.id not in user_states:
        return await callback.answer("⏱️ Sesión expirada. Usa /start")
    
    gender = callback.data.split('_')[1]
    user_states[callback.from_user.id].update({'gender': gender, 'step': 'archetype'})
    lang = user_states[callback.from_user.id]['language']
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
    if callback.from_user.id not in user_states:
        return await callback.answer("⏱️ Sesión expirada. Usa /start")
    
    user_states[callback.from_user.id].update({'archetype': callback.data.split('_')[1], 'step': 'name'})
    lang = user_states[callback.from_user.id]['language']
    text = "✍️ ¿Qué nombre quieres para tu personaje?" if lang == 'es' else "✍️ What name do you want for your character?"
    
    await callback.message.edit_text(text)
    await callback.answer()

@router.message(F.text & ~F.text.startswith('/'))
async def process_message(message: Message):
    telegram_id = message.from_user.id
    
    if telegram_id in user_states and user_states[telegram_id].get('step') == 'name':
        state = user_states[telegram_id]
        is_new_user = state.get('is_new_user', False)

        if is_new_user:
            user = await create_user(telegram_id, state['username'], state['first_name'], state['language'], state.get('referred_by'))
            if not user:
                await message.answer("⚠️ Error al crear el usuario. Intenta de nuevo con /start")
                del user_states[telegram_id]
                return
            await save_character(telegram_id, message.text.strip(), state['gender'], state['archetype'], PERSONALITIES.get(state['archetype'], ''))
            del user_states[telegram_id]
            return await show_welcome(message, message.text.strip(), state['language'], get_main_keyboard(state['language'], False))
        else:
            await save_character(telegram_id, message.text.strip(), state['gender'], state['archetype'], PERSONALITIES.get(state['archetype'], ''))
            del user_states[telegram_id]
            lang = state['language']
            text = f"✅ ¡Nuevo personaje creado!\n\n🎭 Nombre: {message.text.strip()}\n\nPuedes empezar a chatear con el botón 💬 Chat." if lang == 'es' else f"✅ New character created!\n\n🎭 Name: {message.text.strip()}\n\nYou can start chatting with the 💬 Chat button."
            return await message.answer(text)

    if telegram_id in user_states and user_states[telegram_id].get('step') == 'image_prompt':
        lang = user_states[telegram_id]['language']
        success, msg, _ = await check_and_deduct_gems(telegram_id, GEM_COST_IMAGE, 'image', f'Imagen: {message.text[:50]}')
        if not success:
            await message.answer(f"⚠️ {msg}")
            del user_states[telegram_id]
            return
        
        await message.bot.send_chat_action(telegram_id, 'upload_photo')
        img_url = await generate_novita_image(message.text)
        if img_url:
            await message.answer_photo(img_url, caption=f"🖼️ Imagen generada.\n💰 Costo: {GEM_COST_IMAGE} gemas")
        else:
            await add_gems(telegram_id, GEM_COST_IMAGE, 'refund', 'Reembolso por fallo')
            await message.answer("⚠️ Error al generar la imagen. Se te han reembolsado las gemas.")
        del user_states[telegram_id]
        return

    user = await get_user_cached(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")

    character = await get_active_character(telegram_id)
    if not character:
        return await message.answer("⚠️ No tienes un personaje activo. Usa /newchat")

    lang = user['language']
    hook_remaining = user.get('hook_messages_remaining', 0)

    if user['gems'] <= 0 and hook_remaining <= 0:
        char_name = escape_html(character['character_name'])
        text = (f"<b>*{char_name} te mira con ojos ardientes y se muerde el labio inferior*</b>\n\n"
                "\"Mmm... justo cuando las cosas se estaban poniendo interesantes... <b>*se acerca más y susurra*</b> Tengo algo especial que quería mostrarte...\"\n\n"
                "<b>*se aleja un poco con una sonrisa provocativa*</b>\n\n"
                "🔥 <b>Opción 1: Recarga gemas y desbloquea TODO</b>\n"
                "💎 <b>Opción 2: Invita a un amigo (5 gemas gratis)</b>\n\n"
                "<b>*te mira con deseo*</b> \"¿Cuál eliges? Prometo que valdrá la pena...\" 😉")
        
        builder = InlineKeyboardBuilder()
        builder.button(text="🛒 VER PAQUETES DISPONIBLES", callback_data="shop_from_block")
        builder.button(text="🎁 Invitar amigo (5 gemas)", callback_data="invite_from_block")
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
        lock = get_user_lock(telegram_id)
        async with lock:
            success, msg, new_balance = await check_and_deduct_gems(telegram_id, GEM_COST_MESSAGE, 'message', 'Mensaje de chat')
        if not success:
            return await message.answer(f"⚠️ {msg}")
        is_hook_mode = False
        current_gems = new_balance

    await update_last_active(telegram_id)
    await save_message(telegram_id, 'user', message.text, character['id'])
    
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

# ==================== HANDLERS DE BOTONES ====================

@router.message(F.text == "💬 Chat")
async def btn_chat(message: Message): await cmd_chat(message)

@router.message(F.text == "💎 Balance")
async def btn_balance(message: Message): await cmd_balance(message)

@router.message(F.text.in_(["🖼️ Generar Imagen", "🖼️ Generate Image"]))
async def btn_image(message: Message): await cmd_image(message)

@router.message(F.text.in_(["🛒 Tienda", "🛒 Shop"]))
async def btn_shop(message: Message): await cmd_shop(message)

@router.message(F.text.in_(["🎁 Invitar Amigos", "🎁 Invite Friends"]))
async def btn_invite(message: Message): await cmd_invite(message)

@router.message(F.text.in_(["💬 Nuevo Chat", "💬 New Chat"]))
async def btn_newchat(message: Message): await show_character_menu(message)

@router.message(F.text.in_(["❓ Ayuda", "❓ Help"]))
async def btn_help(message: Message): await cmd_help(message)

# ==================== CORRECCIÓN PRINCIPAL: TIENDA DESDE CALLBACK ====================

@router.callback_query(F.data == "shop_from_block")
async def shop_from_block(callback: CallbackQuery):
    """Genera la tienda directamente desde el callback para evitar errores de enrutamiento"""
    telegram_id = callback.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await callback.answer("⚠️ Primero debes registrarte con /start", show_alert=True)
    
    language = user['language']
    builder = InlineKeyboardBuilder()
    
    if language == 'es':
        text = "💎 Tienda de Gemas\n\nSelecciona un paquete:\n\n"
        for i, package in enumerate(STAR_PACKAGES):
            stars = package['stars']
            gems = package['gems']
            bonus = package.get('bonus', 0)
            first_time = package.get('first_time', False)
            final_gems = int(gems * (1 + bonus / 100)) if bonus > 0 else gems
            line = f"⭐ {stars} Stars → 💎 {final_gems} gemas" + (" (¡Primera vez!)" if first_time else "")
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Opción {i+1}", callback_data=f"buy_{i}")
    else:
        text = "💎 Gem Store\n\nSelect a package:\n\n"
        for i, package in enumerate(STAR_PACKAGES):
            stars = package['stars']
            gems = package['gems']
            bonus = package.get('bonus', 0)
            first_time = package.get('first_time', False)
            final_gems = int(gems * (1 + bonus / 100)) if bonus > 0 else gems
            line = f"⭐ {stars} Stars → 💎 {final_gems} gems" + (" (First time!)" if first_time else "")
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Option {i+1}", callback_data=f"buy_{i}")
            
    builder.adjust(1)
    await callback.message.answer(text, reply_markup=builder.as_markup())
    await callback.answer()

@router.callback_query(F.data == "invite_from_block")
async def invite_from_block(callback: CallbackQuery):
    await cmd_invite(callback.message)
    await callback.answer()

# ==================== PROCESO DE COMPRA ROBUSTO ====================

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
        # Usar chat_id=telegram_id es más seguro que callback.message.chat.id
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
        await callback.answer("❌ Error al enviar la factura. Inténtalo de nuevo más tarde.", show_alert=True)

@router.pre_checkout_query()
async def process_pre_checkout(pre_checkout_query: PreCheckoutQuery):
    await pre_checkout_query.answer(ok=True)

@router.message(F.successful_payment)
async def process_successful_payment(message: Message):
    telegram_id = message.from_user.id
    pkg_idx = int(message.successful_payment.invoice_payload.split('_')[-1])
    success, msg = await process_star_purchase(telegram_id, pkg_idx, message.successful_payment.telegram_payment_charge_id)
    lang = (await get_user(telegram_id))['language']
    
    if success:
        await message.answer(f"✅ {msg}\n\n🎉 ¡Ahora tienes acceso a la generación de imágenes!" if lang == 'es' else f"✅ {msg}\n\n🎉 You now have access to image generation!")
        await message.answer("🎊 ¡Tu teclado ha sido actualizado!", reply_markup=get_main_keyboard(lang, True))
    else:
        await message.answer("⚠️ Error al procesar la compra." if lang == 'es' else "⚠️ Error processing purchase.")

# ==================== COMANDOS ====================

@router.message(Command('chat'))
async def cmd_chat(message: Message):
    user = await get_user(message.from_user.id)
    if not user: return await message.answer("⚠️ Primero debes registrarte con /start")
    character = await get_active_character(message.from_user.id)
    if not character: return await message.answer("⚠️ No tienes un personaje activo. Usa /newchat")
    lang = user['language']
    text = f"💬 ¡Conversación iniciada con {character['character_name']}!\n\nEscribe tu mensaje y te responderá.\n💰 Costo: {GEM_COST_MESSAGE} gema por mensaje" if lang == 'es' else f"💬 Conversation started with {character['character_name']}!\n\nWrite your message.\n💰 Cost: {GEM_COST_MESSAGE} gem per message"
    await message.answer(text)

@router.message(Command('img'))
async def cmd_image(message: Message):
    user = await get_user(message.from_user.id)
    if not user: return await message.answer("⚠️ Primero debes registrarte con /start")
    if not await has_user_purchased(message.from_user.id):
        lang = user['language']
        return await message.answer("🔒 Función Premium\n\nLa generación de imágenes es exclusiva para usuarios que han comprado Stars.\n\n💎 Visita la tienda para desbloquearla." if lang == 'es' else "🔒 Premium Feature\n\nImage generation is exclusive for users who have purchased Stars.\n\n💎 Visit the shop to unlock it.")
    
    lang = user['language']
    text = f"🖼️ Generador de Imágenes\n\n💰 Costo: {GEM_COST_IMAGE} gemas\n\nEnvía la descripción de la imagen." if lang == 'es' else f"🖼️ Image Generator\n\n💰 Cost: {GEM_COST_IMAGE} gems\n\nSend the description of the image."
    await message.answer(text)
    user_states[message.from_user.id] = {'step': 'image_prompt', 'language': lang, 'created_at': datetime.utcnow()}

@router.message(Command('balance'))
async def cmd_balance(message: Message):
    user = await get_user(message.from_user.id)
    if not user: return await message.answer("⚠️ Primero debes registrarte con /start")
    lang = user['language']
    gems = await get_balance(message.from_user.id)
    active_ref = await count_active_referrals_last_24h(message.from_user.id)
    bonus = active_ref * GEMS_PER_REFERRAL
    daily_total = BASE_DAILY_GEMS + bonus
    hook_rem = user.get('hook_messages_remaining', 0)
    
    text = f"💎 Tu Balance\n\nGemas actuales: {gems}\n\n📊 Información:\n• Gemas diarias: {daily_total}/{MAX_DAILY_GEMS}\n• Referidos activos (24h): {active_ref}/{MAX_REFERRALS_PER_DAY}"
    if hook_rem > 0: text += f"\n• ⚠️ Momentos especiales: {hook_rem}/{HOOK_MODE_MESSAGES}"
    text += "\n\n💡 Invita hasta 2 amigos cada 24h para ganar +5 gemas c/u" if lang == 'es' else "\n\n💡 Invite up to 2 friends every 24h to earn +5 gems each"
    await message.answer(text)

@router.message(Command('shop'))
async def cmd_shop(message: Message):
    await shop_from_block(type('FakeCallback', (), {'from_user': message.from_user, 'message': message, 'answer': lambda self, *args, **kwargs: None})())

@router.message(Command('invite'))
async def cmd_invite(message: Message):
    user = await get_user(message.from_user.id)
    if not user: return await message.answer("⚠️ Primero debes registrarte con /start")
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
            label = char['character_name'] + (" ✅" if char['is_active'] else "")
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
    char = await db.select('user_characters', '*', {'id': character_id})
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

    user_states[telegram_id] = {'step': 'gender', 'language': user['language'], 'is_new_user': False, 'created_at': datetime.utcnow()}
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
    await message.answer("📚 Comandos:\n/start - Registrarse\n/chat - Conversar\n/img - Generar imagen [PREMIUM]\n/balance - Ver gemas\n/shop - Tienda\n/invite - Invitar amigos\n/newchat - Cambiar/Crear personaje (5 gemas)\n/help - Ayuda\n\n💡 Consejo: Invita amigos para aumentar tus gemas diarias hasta 15.")

@router.message(Command('menu'))
async def cmd_menu(message: Message):
    user = await get_user(message.from_user.id)
    if not user: return await message.answer("⚠️ Primero debes registrarte con /start")
    lang = user['language']
    text = "🏠 Menú Principal\n\nUsa los botones de abajo para navegar:" if lang == 'es' else "🏠 Main Menu\n\nUse the buttons below to navigate:"
    await message.answer(text, reply_markup=get_main_keyboard(lang, await has_user_purchased(message.from_user.id)))

# ==================== FUNCIONES AUXILIARES ====================

async def show_welcome(message: Message, character_name: str, language: str, keyboard: ReplyKeyboardMarkup = None):
    text = f"✅ ¡Registro completado!\n\n🎭 Tu personaje: {escape_html(character_name)}\n💎 Tienes 15 gemas para empezar\n\n📝 Usa los botones de abajo para navegar." if language == 'es' else f"✅ Registration complete!\n\n🎭 Your character: {escape_html(character_name)}\n💎 You have 15 gems to start\n\n📝 Use the buttons below to navigate."
    await message.answer(text, reply_markup=keyboard)

async def show_main_menu(message: Message, language: str, keyboard: ReplyKeyboardMarkup = None):
    text = "🏠 Menú Principal\n\nUsa los botones de abajo para navegar:" if language == 'es' else "🏠 Main Menu\n\nUse the buttons below to navigate:"
    await message.answer(text, reply_markup=keyboard)

# ==================== INICIALIZACIÓN ====================

bot = Bot(token=TELEGRAM_BOT_TOKEN)
dp = Dispatcher()
dp.include_router(router)

async def on_startup():
    logger.info("Iniciando bot...")
    await bot.set_webhook(url=WEBHOOK_URL, drop_pending_updates=True, secret_token=WEBHOOK_SECRET if WEBHOOK_SECRET else None)
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
    if openrouter_session and not openrouter_session.closed: await openrouter_session.close()
    if novita_session and not novita_session.closed: await novita_session.close()

async def handle_webhook(request):
    if request.path == '/webhook':
        if WEBHOOK_SECRET:
            received_secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
            if received_secret != WEBHOOK_SECRET:
                logger.warning("Webhook secret token mismatch")
                return web.Response(status=403)
        try:
            update = Update(**await request.json())
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
        try: await app['on_startup_task']
        except asyncio.CancelledError: pass
    
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
