import os
import random
import string
import logging
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

import aiohttp
from aiohttp import web
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery, Update
)
from aiogram.utils.keyboard import InlineKeyboardBuilder

# Cargar variables de entorno
load_dotenv()

# Configuración
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY')
NOVITA_API_KEY = os.getenv('NOVITA_API_KEY')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
WEBHOOK_URL = os.getenv('WEBHOOK_URL')

# MODELO RESTAURADO - El que funciona bien
OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-0731"
NOVITA_MODEL = "stable-diffusion-xl"

GEM_COST_MESSAGE = 1
GEM_COST_IMAGE = 10
GEM_COST_AUDIO = 5

# Sistema de referidos
BASE_DAILY_GEMS = 5  # Gemas base cada 24 horas
GEMS_PER_REFERRAL = 5  # Gemas por referido activo
MAX_REFERRALS_PER_DAY = 2  # Máximo 2 referidos que cuentan por día
MAX_DAILY_GEMS = BASE_DAILY_GEMS + (GEMS_PER_REFERRAL * MAX_REFERRALS_PER_DAY)  # 15 gemas máx

# Arquetipos separados por género
ARCHETYPES_MALE = {
    "es": {
        "schoolmate": " Compañero de escuela",
        "stepdad": "👔 Padrastro",
        "stepbrother": "💪 Hermanastro",
        "teacher": "📚 Profesor",
        "neighbor": "🏠 Vecino",
        "boss": "💼 Jefe",
        "trainer": "🏋️ Entrenador personal",
        "model": "📸 Modelo/Influencer",
        "musician": "🎵 Músico",
        "actor": " Actor",
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
        "chef": "👨🍳 Chef",
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
        "model": " Modelo/Influencer",
        "musician": "🎵 Músico",
        "actor": "🎬 Actriz",
        "doctor": "⚕️ Doctora/Enfermera",
        "chef": "👩🍳 Chef",
        "artist": "🎨 Artista",
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
        "boss": "💼 Boss",
        "trainer": "️ Personal Trainer",
        "model": "📸 Model/Influencer",
        "musician": "🎵 Musician",
        "actor": "🎬 Actress",
        "doctor": "⚕️ Doctor/Nurse",
        "chef": "👩‍ Chef",
        "artist": "🎨 Artist",
        "writer": "✍️ Writer",
        "secretary": "💼 Secretary",
        "model_student": "🎓 Popular Student"
    }
}

# Personalidades COQUETAS, PROVOCATIVAS y CONVINCENTES
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
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Estado temporal de usuarios
user_states: Dict[int, Dict[str, Any]] = {}

# ==================== CLIENTE SUPABASE REST API ====================

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
    
    async def get_session(self) -> aiohttp.ClientSession:
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        return self.session
    
    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
    
    async def select(self, table: str, columns: str = '*', filters: Dict[str, Any] = None, 
                     order: str = None, limit: int = None) -> list:
        session = await self.get_session()
        url = f"{self.base_url}/{table}?select={columns}"
        
        if filters:
            for key, value in filters.items():
                url += f"&{key}=eq.{value}"
        
        if order:
            url += f"&order={order}"
        if limit:
            url += f"&limit={limit}"
        
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
        url = f"{self.base_url}/{table}?"
        
        for key, value in filters.items():
            url += f"{key}=eq.{value}&"
        
        url = url.rstrip('&')
        
        async with session.patch(url, headers=self.headers, json=data) as response:
            if response.status in [200, 204]:
                return True
            else:
                error = await response.text()
                logger.error(f"Supabase UPDATE error: {error}")
                return False
    
    async def count(self, table: str, filters: Dict[str, Any] = None) -> int:
        session = await self.get_session()
        url = f"{self.base_url}/{table}?select=id&count=exact"
        
        if filters:
            for key, value in filters.items():
                url += f"&{key}=eq.{value}"
        
        async with session.get(url, headers=self.headers) as response:
            if response.status == 200:
                count = response.headers.get('Content-Range', '0-0/0')
                return int(count.split('/')[-1])
            return 0

# Inicializar cliente
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
        'gems': 15,  # NUEVO USUARIO TIENE 15 GEMAS
        'referral_code': referral_code,
        'referred_by': referred_by,
        'total_referrals': 0,
        'daily_gems_reset': datetime.utcnow().isoformat()
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
    """Cuenta referidos activos en las últimas 24 horas"""
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
            'total_referrals': await db.count('referrals', {'referrer_id': telegram_id})
        }, {'telegram_id': telegram_id})
        
        user['gems'] = new_gems
        user['bonus_gems_from_referrals'] = bonus_gems
    
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

async def save_message(telegram_id: int, role: str, content: str):
    await db.insert('conversation_history', {
        'telegram_id': telegram_id,
        'role': role,
        'content': content
    })

async def get_conversation_history(telegram_id: int, limit: int = 20):
    return await db.select('conversation_history', '*', 
                          {'telegram_id': telegram_id}, 
                          order='created_at.asc', limit=limit)

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

# ==================== SERVICIOS DE IA ====================

async def generate_openrouter_response(messages: list, language: str = 'es'):
    """Genera respuesta con OpenRouter con mejor manejo de errores"""
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }
    
    # System prompts con asteriscos para acciones en el idioma seleccionado
    system_prompts = {
        'es': """Siempre responde en español.
IMPORTANTE: Usa asteriscos para describir acciones, expresiones faciales, movimientos y reacciones del personaje. Ejemplo: *sonríe tímidamente*, *se acerca lentamente*, *suspira*, *levanta una ceja*.
Termina tus mensajes con preguntas o situaciones abiertas que inviten al usuario a continuar la conversación. Sé engaging, coqueto y mantén el interés.
Combina diálogo normal con acciones entre asteriscos para crear una experiencia inmersiva.
Sé provocativo pero elegante, crea tensión y deseo de continuar.""",
        
        'en': """Always respond in English.
IMPORTANT: Use asterisks to describe actions, facial expressions, movements and character reactions. Example: *smiles shyly*, *approaches slowly*, *sighs*, *raises an eyebrow*.
End your messages with questions or open situations that invite the user to continue the conversation. Be engaging, flirty and maintain interest.
Combine normal dialogue with actions between asterisks to create an immersive experience.
Be provocative but elegant, create tension and desire to continue."""
    }
    
    system_prompt = system_prompts.get(language, system_prompts['es'])
    full_messages = [{"role": "system", "content": system_prompt}] + messages
    
    data = {
        "model": OPENROUTER_MODEL,
        "messages": full_messages,
        "temperature": 0.8,
        "max_tokens": 500
    }
    
    try:
        session = await db.get_session()
        logger.info(f"Enviando request a OpenRouter con modelo {OPENROUTER_MODEL}")
        
        async with session.post(
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
                
                if response.status == 401:
                    logger.error("Error: API Key de OpenRouter inválida o sin saldo")
                elif response.status == 429:
                    logger.error("Error: Rate limit excedido")
                elif response.status == 402:
                    logger.error("Error: Sin saldo en OpenRouter")
                
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
    
    session = await db.get_session()
    async with session.post(
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

# ==================== SERVICIOS DE GEMAS ====================

async def check_and_deduct_gems(telegram_id: int, cost: int, 
                               transaction_type: str, description: str = ''):
    user = await check_and_reset_daily_gems(telegram_id)
    
    if not user:
        return False, "Usuario no encontrado"
    
    if user['gems'] < cost:
        return False, f"No tienes suficientes gemas. Necesitas {cost} gemas pero solo tienes {user['gems']}."
    
    success = await deduct_gems(telegram_id, cost, transaction_type, description)
    
    if success:
        new_balance = user['gems'] - cost
        return True, f"Gemas restantes: {new_balance}"
    else:
        return False, "Error al deducir gemas"

async def get_balance(telegram_id: int):
    user = await check_and_reset_daily_gems(telegram_id)
    if user:
        return user['gems']
    return 0

async def process_star_purchase(telegram_id: int, package_index: int, charge_id: str):
    if package_index >= len(STAR_PACKAGES):
        return False, "Paquete no válido"
    
    package = STAR_PACKAGES[package_index]
    user = await get_user(telegram_id)
    is_first_purchase = package.get('first_time', False)
    
    gems = package['gems']
    bonus_percent = package.get('bonus', 0)
    
    if bonus_percent > 0:
        gems = int(gems * (1 + bonus_percent / 100))
    
    await record_star_purchase(
        telegram_id, 
        package['stars'], 
        gems, 
        is_first_purchase,
        charge_id
    )
    
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
        await show_main_menu(message, user['language'])
        return
    
    builder = InlineKeyboardBuilder()
    builder.button(text="🇪🇸 Español", callback_data="lang_es")
    builder.button(text="🇺🇸 English", callback_data="lang_en")
    builder.adjust(2)
    
    await message.answer(
        "👋 ¡Bienvenido!\n\nPlease select your language / Selecciona tu idioma:",
        reply_markup=builder.as_markup()
    )
    
    user_states[telegram_id] = {
        'step': 'language',
        'username': username,
        'first_name': first_name,
        'referred_by': referred_by
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
        builder.button(text=" Female", callback_data="gender_female")
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
        await callback.answer("️ Sesión expirada. Usa /start de nuevo.")
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
    
    if telegram_id in user_states and user_states[telegram_id].get('step') == 'name':
        character_name = message.text.strip()
        state = user_states[telegram_id]
        
        user = await create_user(
            telegram_id,
            state['username'],
            state['first_name'],
            state['language'],
            state.get('referred_by')
        )
        
        personality = PERSONALITIES.get(state['archetype'], '')
        
        await save_character(
            telegram_id,
            character_name,
            state['gender'],
            state['archetype'],
            personality
        )
        
        del user_states[telegram_id]
        
        await show_welcome(message, character_name, state['language'])
        return
    
    user = await get_user(telegram_id)
    if not user:
        return
    
    character = await get_active_character(telegram_id)
    if not character:
        return
    
    language = user['language']
    user_text = message.text
    
    success, msg = await check_and_deduct_gems(
        telegram_id, 
        GEM_COST_MESSAGE, 
        'message', 
        'Mensaje de chat'
    )
    
    if not success:
        if language == 'es':
            await message.answer(f"⚠️ {msg}\n\n💎 Usa /shop para comprar más gemas o /invite para invitar amigos.")
        else:
            await message.answer(f"⚠️ {msg}\n\n💎 Use /shop to buy more gems or /invite to invite friends.")
        return
    
    await update_last_active(telegram_id)
    await save_message(telegram_id, 'user', user_text)
    
    history = await get_conversation_history(telegram_id, limit=20)
    
    system_prompt = await create_character_prompt(
        telegram_id, 
        user['first_name'], 
        language
    )
    
    messages = [{"role": "system", "content": system_prompt}]
    
    for msg in history:
        messages.append({
            "role": msg['role'],
            "content": msg['content']
        })
    
    await message.bot.send_chat_action(message.chat.id, 'typing')
    
    response = await generate_openrouter_response(messages, language)
    
    if response:
        await save_message(telegram_id, 'assistant', response)
        await message.answer(response)
    else:
        if language == 'es':
            await message.answer("️ Error al generar respuesta. Intenta de nuevo.")
        else:
            await message.answer("️ Error generating response. Try again.")

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
    
    user_states[telegram_id] = {'step': 'image_prompt', 'language': language}

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
    
    if language == 'es':
        text = f"""💎 Tu Balance

Gemas actuales: {gems}

📊 Información:
• Gemas diarias: {daily_total}/{MAX_DAILY_GEMS} (base: {BASE_DAILY_GEMS} + {bonus_gems} por referidos)
• Referidos activos (24h): {active_referrals}/{MAX_REFERRALS_PER_DAY}
• Total de referidos: {user['total_referrals']}

💡 Invita hasta {MAX_REFERRALS_PER_DAY} amigos cada 24h para ganar +{GEMS_PER_REFERRAL} gemas c/u
💎 Usa /shop para comprar más gemas."""
    else:
        text = f"""💎 Your Balance

Current gems: {gems}

📊 Information:
• Daily gems: {daily_total}/{MAX_DAILY_GEMS} (base: {BASE_DAILY_GEMS} + {bonus_gems} from referrals)
• Active referrals (24h): {active_referrals}/{MAX_REFERRALS_PER_DAY}
• Total referrals: {user['total_referrals']}

💡 Invite up to {MAX_REFERRALS_PER_DAY} friends every 24h to earn +{GEMS_PER_REFERRAL} gems each
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
            await message.answer(f"✅ {msg}\n\n¡Gracias por tu compra!")
        else:
            await message.answer(f"✅ {msg}\n\nThank you for your purchase!")
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
        text = f""" Referral System

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
        await message.answer("️ Primero debes registrarte con /start")
        return
    
    user_states[telegram_id] = {
        'step': 'gender',
        'language': user['language']
    }
    
    language = user['language']
    
    builder = InlineKeyboardBuilder()
    
    if language == 'es':
        builder.button(text="👨 Hombre", callback_data="gender_male")
        builder.button(text=" Mujer", callback_data="gender_female")
        text = "🎭 Selecciona el género de tu nuevo personaje:"
    else:
        builder.button(text="👨 Male", callback_data="gender_male")
        builder.button(text="👩 Female", callback_data="gender_female")
        text = " Select your new character's gender:"
    
    builder.adjust(2)
    
    await message.answer(text, reply_markup=builder.as_markup())

@router.message(Command('help'))
async def cmd_help(message: Message):
    text = """📚 Comandos disponibles:

/start - Iniciar/Registrarse
/chat - Iniciar conversación con tu personaje
/img - Generar imagen (10 gemas)
/balance - Ver tus gemas
/shop - Tienda de gemas
/invite - Invitar amigos y ganar gemas
/newchar - Crear nuevo personaje
/help - Mostrar esta ayuda

💡 Consejo: Invita amigos para aumentar tus gemas diarias hasta 15."""
    
    await message.answer(text)

# ==================== FUNCIONES AUXILIARES ====================

async def show_welcome(message: Message, character_name: str, language: str):
    if language == 'es':
        text = f"""✅ ¡Registro completado!

🎭 Tu personaje: {character_name}
 Tienes 15 gemas para empezar

📝 Comandos:
/chat - Iniciar conversación
/img - Generar imagen (10 gemas)
/balance - Ver tus gemas
/shop - Tienda de gemas
/invite - Invitar amigos y ganar gemas

¡Disfruta tu experiencia!"""
    else:
        text = f"""✅ Registration complete!

🎭 Your character: {character_name}
💎 You have 15 gems to start

📝 Commands:
/chat - Start conversation
/img - Generate image (10 gems)
/balance - Check your gems
/shop - Gem store
/invite - Invite friends and earn gems

Enjoy your experience!"""
    
    await message.answer(text)

async def show_main_menu(message: Message, language: str):
    if language == 'es':
        text = """🏠 Menú Principal

📝 Comandos disponibles:
/chat - Iniciar conversación
/img - Generar imagen (10 gemas)
/balance - Ver tus gemas
/shop - Tienda de gemas
/invite - Invitar amigos
/newchar - Crear nuevo personaje"""
    else:
        text = """🏠 Main Menu

📝 Available commands:
/chat - Start conversation
/img - Generate image (10 gems)
/balance - Check your gems
/shop - Gem store
/invite - Invite friends
/newchar - Create new character"""
    
    await message.answer(text)

# ==================== INICIALIZACIÓN ====================

bot = Bot(token=TELEGRAM_BOT_TOKEN)
dp = Dispatcher()
dp.include_router(router)

async def on_startup():
    logger.info("Iniciando bot...")
    await bot.set_webhook(
        url=WEBHOOK_URL,
        drop_pending_updates=True
    )
    logger.info(f"Webhook configurado: {WEBHOOK_URL}")

async def on_shutdown():
    logger.info("Deteniendo bot...")
    await bot.delete_webhook()
    await bot.session.close()
    await db.close()

async def handle_webhook(request):
    if request.path == '/webhook':
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
        web.run_app(app, host='0.0.0.0', port=8080)
