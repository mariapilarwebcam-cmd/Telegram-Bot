import os
import random
import string
import logging
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import Command, CommandStart, CommandObject
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery,
    ReplyKeyboardMarkup, KeyboardButton, WebAppInfo
)
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder
from supabase import create_client, Client

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
MINI_APP_URL = os.getenv('MINI_APP_URL', 'https://tu-dominio.vercel.app')

GEM_COST_NEW_CHARACTER = 5
BASE_DAILY_GEMS = 5
GEMS_PER_REFERRAL = 5
MAX_REFERRALS_PER_DAY = 2
MAX_DAILY_GEMS = BASE_DAILY_GEMS + (GEMS_PER_REFERRAL * MAX_REFERRALS_PER_DAY)
STARTING_GEMS = 10

STAR_PACKAGES = [
    {"stars": 50, "gems": 200, "bonus": 0, "first_time": True},
    {"stars": 75, "gems": 300, "bonus": 0, "first_time": False},
    {"stars": 150, "gems": 600, "bonus": 5, "first_time": False},
    {"stars": 300, "gems": 1200, "bonus": 10, "first_time": False},
    {"stars": 500, "gems": 2000, "bonus": 15, "first_time": False},
]

ARCHETYPES_MALE = {
    "es": {
        "schoolmate": "🎓 Compañero de escuela", "stepdad": "👔 Padrastro",
        "stepbrother": "💪 Hermanastro", "teacher": "📚 Profesor",
        "neighbor": "🏠 Vecino", "boss": "💼 Jefe",
        "trainer": "🏋️ Entrenador personal", "model": "📸 Modelo/Influencer",
        "musician": "🎵 Músico", "actor": "🎭 Actor", "doctor": "⚕️ Médico",
        "chef": "👨‍🍳 Chef", "artist": "🎨 Artista", "writer": "✍️ Escritor",
        "bodyguard": "🛡️ Guardaespaldas", "ceo": "💼 CEO/Empresario"
    },
    "en": {
        "schoolmate": "🎓 Schoolmate", "stepdad": "👔 Stepfather",
        "stepbrother": "💪 Stepbrother", "teacher": "📚 Teacher",
        "neighbor": "🏠 Neighbor", "boss": "💼 Boss",
        "trainer": "🏋️ Personal Trainer", "model": "📸 Model/Influencer",
        "musician": "🎵 Musician", "actor": "🎬 Actor", "doctor": "⚕️ Doctor",
        "chef": "👨‍🍳 Chef", "artist": "🎨 Artist", "writer": "✍️ Writer",
        "bodyguard": "🛡️ Bodyguard", "ceo": "💼 CEO/Businessman"
    }
}

ARCHETYPES_FEMALE = {
    "es": {
        "schoolmate": "🎓 Compañera de escuela", "stepmom": "💋 Madrastra",
        "stepsister": "🌸 Hermanastra", "teacher": "📚 Profesora",
        "neighbor": "🏠 Vecina", "boss": "💼 Jefa",
        "trainer": "🏋️ Entrenadora personal", "model": "📸 Modelo/Influencer",
        "musician": "🎵 Músico", "actor": "🎬 Actriz", "doctor": "⚕️ Doctora/Enfermera",
        "chef": "👩‍🍳 Chef", "artist": "🎨 Artista", "writer": "✍️ Escritora",
        "secretary": "💼 Secretaria", "model_student": "🎓 Estudiante popular"
    },
    "en": {
        "schoolmate": "🎓 Schoolmate", "stepmom": "💋 Stepmother",
        "stepsister": "🌸 Stepsister", "teacher": "📚 Teacher",
        "neighbor": "🏠 Neighbor", "boss": "💼 Boss",
        "trainer": "🏋️ Personal Trainer", "model": "📸 Model/Influencer",
        "musician": "🎵 Musician", "actor": "🎬 Actress", "doctor": "⚕️ Doctor/Nurse",
        "chef": "👩‍🍳 Chef", "artist": "🎨 Artist", "writer": "✍️ Writer",
        "secretary": "💼 Secretary", "model_student": "🎓 Popular Student"
    }
}

PERSONALITIES = {
    "schoolmate": "Eres un compañero de escuela travieso, coqueto y juguetón.",
    "stepmom": "Eres una madrastra increíblemente atractiva, seductora y misteriosa.",
    "stepdad": "Eres un padrastro dominante, carismático y magnético.",
    "stepsister": "Eres una hermanastra provocativa, coqueta y rebelde.",
    "stepbrother": "Eres un hermanastro atlético, confiado y provocador.",
    "teacher": "Eres un profesor/a inteligente, sofisticado y con un lado secreto peligroso.",
    "neighbor": "Eres un vecino/a misterioso, cercano y siempre disponible.",
    "boss": "Eres un jefe/a poderoso, dominante y carismático.",
    "trainer": "Eres un entrenador/a físico, motivador y muy cercano.",
    "model": "Eres una modelo/influencer glamorosa, segura y coqueta.",
    "musician": "Eres un músico apasionado, intenso y bohemio.",
    "actor": "Eres un actor/actriz carismático, dramático y magnético.",
    "doctor": "Eres un médico/enfermera profesional pero con un toque íntimo.",
    "chef": "Eres un chef apasionado, sensual y creativo.",
    "artist": "Eres un artista creativo, observador y profundo.",
    "writer": "Eres un escritor/a intelectual, misterioso y elocuente.",
    "bodyguard": "Eres un guardaespaldas fuerte, protector y misterioso.",
    "ceo": "Eres un CEO exitoso, ambicioso y sofisticado.",
    "secretary": "Eres una secretaria eficiente, organizada y muy atractiva.",
    "model_student": "Eres un estudiante popular, carismático y deseado."
}

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

router = Router()

# ==================== HELPERS ====================

def generate_referral_code() -> str:
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

async def get_user(telegram_id: int):
    result = supabase.table('users').select('*').eq('telegram_id', str(telegram_id)).execute()
    return result.data[0] if result.data else None

async def create_user(telegram_id: int, username: str, first_name: str,
                      language: str = 'es', referred_by: Optional[int] = None):
    referral_code = generate_referral_code()
    user_data = {
        'telegram_id': str(telegram_id),
        'username': username,
        'first_name': first_name,
        'language': language,
        'gems': STARTING_GEMS,
        'referral_code': referral_code,
        'referred_by': str(referred_by) if referred_by else None,
        'total_referrals': 0,
        'hook_messages_remaining': 0
    }
    result = supabase.table('users').insert(user_data).execute()

    if referred_by and result.data:
        supabase.table('referrals').insert({
            'referrer_id': str(referred_by),
            'referred_id': str(telegram_id)
        }).execute()
        referrer = await get_user(referred_by)
        if referrer:
            supabase.table('users').update({
                'gems': referrer['gems'] + GEMS_PER_REFERRAL,
                'total_referrals': (referrer.get('total_referrals') or 0) + 1
            }).eq('telegram_id', str(referred_by)).execute()
            supabase.table('gem_transactions').insert({
                'telegram_id': str(referred_by),
                'amount': GEMS_PER_REFERRAL,
                'transaction_type': 'referral',
                'description': 'Nuevo referido'
            }).execute()

    return result.data[0] if result.data else None

async def add_gems(telegram_id: int, amount: int, transaction_type: str, description: str = ''):
    user = await get_user(telegram_id)
    if not user:
        return False
    supabase.table('users').update({'gems': user['gems'] + amount}).eq('telegram_id', str(telegram_id)).execute()
    supabase.table('gem_transactions').insert({
        'telegram_id': str(telegram_id),
        'amount': amount,
        'transaction_type': transaction_type,
        'description': description
    }).execute()
    return True

async def get_user_by_referral_code(referral_code: str):
    result = supabase.table('users').select('*').eq('referral_code', referral_code).execute()
    return result.data[0] if result.data else None

async def record_star_purchase(telegram_id: int, stars: int, gems: int, is_first_purchase: bool, charge_id: str):
    supabase.table('star_purchases').insert({
        'telegram_id': str(telegram_id),
        'stars_amount': stars,
        'gems_amount': gems,
        'is_first_purchase': is_first_purchase,
        'telegram_charge_id': charge_id
    }).execute()
    supabase.table('users').update({'hook_messages_remaining': 0}).eq('telegram_id', str(telegram_id)).execute()
    await add_gems(telegram_id, gems, 'purchase', f'Compra con {stars} stars')

def get_main_keyboard(language: str) -> ReplyKeyboardMarkup:
    builder = ReplyKeyboardBuilder()
    if language == 'es':
        builder.row(KeyboardButton(text="🎭 Abrir App", web_app=WebAppInfo(url=MINI_APP_URL)))
        builder.row(KeyboardButton(text="💎 Balance"), KeyboardButton(text="🛒 Tienda"))
        builder.row(KeyboardButton(text="🎁 Invitar"), KeyboardButton(text="❓ Ayuda"))
    else:
        builder.row(KeyboardButton(text="🎭 Open App", web_app=WebAppInfo(url=MINI_APP_URL)))
        builder.row(KeyboardButton(text="💎 Balance"), KeyboardButton(text="🛒 Shop"))
        builder.row(KeyboardButton(text="🎁 Invite"), KeyboardButton(text="❓ Help"))
    return builder.as_markup(resize_keyboard=True, one_time_keyboard=False)

# ==================== HANDLERS ====================
# IMPORTANTE: los handlers específicos van ANTES del genérico process_name

@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject = None):
    telegram_id = message.from_user.id
    username = message.from_user.username or ""
    first_name = message.from_user.first_name or ""
    referred_by = None

    if command and command.args:
        referrer = await get_user_by_referral_code(command.args)
        if referrer and str(referrer['telegram_id']) != str(telegram_id):
            referred_by = referrer['telegram_id']

    user = await get_user(telegram_id)
    if user:
        lang = user.get('language', 'es')
        if lang == 'es':
            text = (f"¡Bienvenido de vuelta, {first_name}! 👋\n\n"
                    f"💎 Gemas: {user['gems']}\n\n"
                    f"Haz clic en '🎭 Abrir App' para continuar la experiencia.")
        else:
            text = (f"Welcome back, {first_name}! 👋\n\n"
                    f"💎 Gems: {user['gems']}\n\n"
                    f"Click '🎭 Open App' to continue the experience.")
        await message.answer(text, reply_markup=get_main_keyboard(lang))
        return

    builder = InlineKeyboardBuilder()
    builder.button(text="🇪🇸 Español", callback_data="lang_es")
    builder.button(text="🇬🇧 English", callback_data="lang_en")
    builder.adjust(2)

    await message.answer(
        "👋 ¡Bienvenido!\n\n"
        "Por favor selecciona tu idioma / Please select your language:",
        reply_markup=builder.as_markup()
    )

    supabase.table('user_states').upsert({
        'telegram_id': str(telegram_id),
        'step': 'language',
        'username': username,
        'first_name': first_name,
        'referred_by': str(referred_by) if referred_by else None,
        'created_at': datetime.utcnow().isoformat()
    }).execute()

@router.callback_query(F.data.startswith('lang_'))
async def process_language(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    state_result = supabase.table('user_states').select('*').eq('telegram_id', str(telegram_id)).execute()
    if not state_result.data:
        return await callback.answer("⏱️ Sesión expirada. Usa /start", show_alert=True)

    lang = callback.data.split('_')[1]
    supabase.table('user_states').update({'step': 'gender', 'language': lang}).eq('telegram_id', str(telegram_id)).execute()

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
    telegram_id = callback.from_user.id
    state_result = supabase.table('user_states').select('*').eq('telegram_id', str(telegram_id)).execute()
    if not state_result.data:
        return await callback.answer("⏱️ Sesión expirada. Usa /start", show_alert=True)

    state = state_result.data[0]
    gender = callback.data.split('_')[1]
    lang = state.get('language', 'es')

    supabase.table('user_states').update({'step': 'archetype', 'gender': gender}).eq('telegram_id', str(telegram_id)).execute()

    archetypes = ARCHETYPES_MALE[lang] if gender == 'male' else ARCHETYPES_FEMALE[lang]
    builder = InlineKeyboardBuilder()
    for key, name in archetypes.items():
        builder.button(text=name, callback_data=f"arch_{key}")
    builder.adjust(2)

    text = "🎭 Selecciona el tipo de personaje:" if lang == 'es' else "🎭 Select character type:"
    await callback.message.edit_text(text, reply_markup=builder.as_markup())
    await callback.answer()

@router.callback_query(F.data.startswith('arch_'))
async def process_archetype(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    state_result = supabase.table('user_states').select('*').eq('telegram_id', str(telegram_id)).execute()
    if not state_result.data:
        return await callback.answer("⏱️ Sesión expirada. Usa /start", show_alert=True)

    state = state_result.data[0]
    archetype = callback.data.split('_', 1)[1]
    supabase.table('user_states').update({'step': 'name', 'archetype': archetype}).eq('telegram_id', str(telegram_id)).execute()

    lang = state.get('language', 'es')
    text = "✍️ ¿Qué nombre quieres para tu personaje?" if lang == 'es' else "✍️ What name do you want for your character?"
    await callback.message.edit_text(text)
    await callback.answer()

@router.message(F.text.in_({"💎 Balance"}))
async def cmd_balance(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    lang = user.get('language', 'es')
    if lang == 'es':
        text = (f"💎 Tu Balance\n\nGemas actuales: {user['gems']}\n\n"
                f"📊 Info:\n• Diarias: {BASE_DAILY_GEMS}/{MAX_DAILY_GEMS}\n\n"
                f"💡 Abre la App para más detalles.")
    else:
        text = (f"💎 Your Balance\n\nCurrent gems: {user['gems']}\n\n"
                f"📊 Info:\n• Daily: {BASE_DAILY_GEMS}/{MAX_DAILY_GEMS}\n\n"
                f"💡 Open the App for more details.")
    await message.answer(text)

@router.message(F.text.in_({"🛒 Tienda", "🛒 Shop"}))
async def cmd_shop(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")

    language = user.get('language', 'es')
    builder = InlineKeyboardBuilder()

    if language == 'es':
        text = "💎 Tienda de Gemas\n\nSelecciona un paquete:\n\n"
        for i, pkg in enumerate(STAR_PACKAGES):
            final_gems = int(pkg['gems'] * (1 + pkg['bonus'] / 100)) if pkg['bonus'] > 0 else pkg['gems']
            line = f"⭐ {pkg['stars']} Stars → 💎 {final_gems} gemas"
            if pkg['first_time']:
                line += " (¡Primera vez!)"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Opción {i+1}", callback_data=f"buy_{i}")
    else:
        text = "💎 Gem Store\n\nSelect a package:\n\n"
        for i, pkg in enumerate(STAR_PACKAGES):
            final_gems = int(pkg['gems'] * (1 + pkg['bonus'] / 100)) if pkg['bonus'] > 0 else pkg['gems']
            line = f"⭐ {pkg['stars']} Stars → 💎 {final_gems} gems"
            if pkg['first_time']:
                line += " (First time!)"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Option {i+1}", callback_data=f"buy_{i}")

    builder.adjust(1)
    await message.answer(text, reply_markup=builder.as_markup())

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
    gems = int(pkg['gems'] * (1 + pkg['bonus'] / 100)) if pkg['bonus'] > 0 else pkg['gems']

    user = await get_user(telegram_id)
    if not user:
        return await callback.answer("⚠️ Usuario no encontrado", show_alert=True)

    lang = user.get('language', 'es')
    title = f"{gems} Gemas" if lang == 'es' else f"{gems} Gems"
    description = f"Paquete de {gems} gemas" if lang == 'es' else f"Package of {gems} gems"

    try:
        await callback.bot.send_invoice(
            chat_id=telegram_id,
            title=title,
            description=description,
            provider_token="",
            currency="XTR",
            prices=[LabeledPrice(label="Gems", amount=pkg['stars'])],
            payload=f"gem_purchase_{package_index}"
        )
        await callback.answer("✅ Factura enviada")
    except Exception as e:
        logger.error(f"Error al enviar invoice: {e}")
        await callback.answer("❌ Error al enviar la factura", show_alert=True)

@router.pre_checkout_query()
async def process_pre_checkout(pre_checkout_query: PreCheckoutQuery):
    await pre_checkout_query.answer(ok=True)

@router.message(F.successful_payment)
async def process_successful_payment(message: Message):
    telegram_id = message.from_user.id
    pkg_idx = int(message.successful_payment.invoice_payload.split('_')[-1])

    if pkg_idx >= len(STAR_PACKAGES):
        return await message.answer("⚠️ Error al procesar la compra.")

    pkg = STAR_PACKAGES[pkg_idx]
    gems = int(pkg['gems'] * (1 + pkg['bonus'] / 100)) if pkg['bonus'] > 0 else pkg['gems']

    await record_star_purchase(
        telegram_id, pkg['stars'], gems,
        pkg.get('first_time', False),
        message.successful_payment.telegram_payment_charge_id
    )

    user = await get_user(telegram_id)
    lang = user.get('language', 'es') if user else 'es'

    if lang == 'es':
        text = f"✅ ¡Compra exitosa! Has recibido {gems} gemas.\n\n🎉 ¡Disfruta la experiencia completa!"
    else:
        text = f"✅ Purchase successful! You received {gems} gems.\n\n🎉 Enjoy the full experience!"
    await message.answer(text)

@router.message(F.text.in_({"🎁 Invitar", "🎁 Invite"}))
async def cmd_invite(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")

    lang = user.get('language', 'es')
    bot_info = await message.bot.get_me()
    link = f"https://t.me/{bot_info.username}?start={user['referral_code']}"

    if lang == 'es':
        text = (f"🎁 Sistema de Referidos\n\n🔗 Tu enlace:\n{link}\n\n"
                f"💡 ¡Comparte tu enlace y gana 5 gemas por cada amigo que se registre!")
    else:
        text = (f"🎁 Referral System\n\n🔗 Your link:\n{link}\n\n"
                f"💡 Share your link and earn 5 gems for each friend who registers!")
    await message.answer(text)

@router.message(F.text.in_({"❓ Ayuda", "❓ Help"}))
async def cmd_help(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")

    lang = user.get('language', 'es')
    if lang == 'es':
        text = ("📚 Comandos:\n/start - Registrarse\n/balance - Ver gemas\n"
                "/shop - Tienda\n/invite - Invitar amigos\n/help - Ayuda\n\n"
                "💡 Usa el botón '🎭 Abrir App' para la experiencia visual completa.")
    else:
        text = ("📚 Commands:\n/start - Register\n/balance - View gems\n"
                "/shop - Store\n/invite - Invite friends\n/help - Help\n\n"
                "💡 Use the '🎭 Open App' button for the full visual experience.")
    await message.answer(text)

# ESTE VA AL FINAL: captura texto libre solo si estamos pidiendo nombre
@router.message(F.text & ~F.text.startswith('/'))
async def process_name(message: Message):
    telegram_id = message.from_user.id
    state_result = supabase.table('user_states').select('*').eq('telegram_id', str(telegram_id)).execute()
    if not state_result.data or state_result.data[0].get('step') != 'name':
        return

    state = state_result.data[0]
    character_name = (message.text or '').strip()[:30] or 'Personaje'

    referred_by = None
    if state.get('referred_by'):
        try:
            referred_by = int(state['referred_by'])
        except (ValueError, TypeError):
            referred_by = None

    user = await create_user(
        telegram_id,
        state.get('username', ''),
        state.get('first_name', ''),
        state.get('language', 'es'),
        referred_by
    )

    if not user:
        await message.answer("❌ Error al crear el usuario. Intenta con /start")
        return

    personality = PERSONALITIES.get(state.get('archetype', ''), '')
    supabase.table('user_characters').insert({
        'telegram_id': str(telegram_id),
        'character_name': character_name,
        'gender': state.get('gender', 'female'),
        'archetype': state.get('archetype', 'schoolmate'),
        'personality': personality,
        'is_active': True
    }).execute()

    supabase.table('user_states').delete().eq('telegram_id', str(telegram_id)).execute()

    lang = state.get('language', 'es')
    if lang == 'es':
        text = (f"✅ ¡Registro completado!\n\n🎭 Tu personaje: {character_name}\n"
                f"💎 Tienes {STARTING_GEMS} gemas para empezar\n\n"
                f"Haz clic en '🎭 Abrir App' para comenzar.")
    else:
        text = (f"✅ Registration complete!\n\n🎭 Your character: {character_name}\n"
                f"💎 You have {STARTING_GEMS} gems to start\n\n"
                f"Click '🎭 Open App' to start.")
    await message.answer(text, reply_markup=get_main_keyboard(lang))
