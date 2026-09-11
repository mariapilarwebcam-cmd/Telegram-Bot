import os
import random
import string
import logging
import re
from datetime import datetime, timedelta
from typing import Optional
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery,
    ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardButton, WebAppInfo
)
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder
from supabase import create_client, Client

load_dotenv()

# Configuración
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
MINI_APP_URL = os.getenv('MINI_APP_URL', 'https://tu-dominio.vercel.app')

# Constantes
GEM_COST_NEW_CHARACTER = 5
BASE_DAILY_GEMS = 5
GEMS_PER_REFERRAL = 5
MAX_REFERRALS_PER_DAY = 2
MAX_DAILY_GEMS = BASE_DAILY_GEMS + (GEMS_PER_REFERRAL * MAX_REFERRALS_PER_DAY)

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
        "musician": "🎵 Musician", "actor": "🎭 Actor", "doctor": "️ Doctor",
        "chef": "‍🍳 Chef", "artist": "🎨 Artist", "writer": "️ Writer",
        "bodyguard": "️ Bodyguard", "ceo": "💼 CEO/Businessman"
    }
}

ARCHETYPES_FEMALE = {
    "es": {
        "schoolmate": "🎓 Compañera de escuela", "stepmom": "💋 Madrastra",
        "stepsister": " Hermanastra", "teacher": "📚 Profesora",
        "neighbor": "🏠 Vecina", "boss": "💼 Jefa",
        "trainer": "🏋️ Entrenadora personal", "model": "📸 Modelo/Influencer",
        "musician": " Músico", "actor": " Actriz", "doctor": "⚕️ Doctora/Enfermera",
        "chef": "👩‍🍳 Chef", "artist": "🎨 Artista", "writer": "✍️ Escritora",
        "secretary": "💼 Secretaria", "model_student": "🎓 Estudiante popular"
    },
    "en": {
        "schoolmate": "🎓 Schoolmate", "stepmom": " Stepmother",
        "stepsister": "🌸 Stepsister", "teacher": " Teacher",
        "neighbor": "🏠 Neighbor", "boss": "💼 Boss",
        "trainer": "🏋️ Personal Trainer", "model": "📸 Model/Influencer",
        "musician": "🎵 Musician", "actor": "🎭 Actress", "doctor": "⚕️ Doctor/Nurse",
        "chef": "👩‍ Chef", "artist": "🎨 Artist", "writer": "✍️ Writer",
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

# Cliente Supabase
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

router = Router()

# ==================== FUNCIONES AUXILIARES ====================

def generate_referral_code() -> str:
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

async def get_user(telegram_id: int):
    result = supabase.table('users').select('*').eq('telegram_id', telegram_id).execute()
    return result.data[0] if result.data else None

async def create_user(telegram_id: int, username: str, first_name: str, language: str = 'es', referred_by: Optional[int] = None):
    referral_code = generate_referral_code()
    user_data = {
        'telegram_id': telegram_id, 'username': username, 'first_name': first_name,
        'language': language, 'gems': 15, 'referral_code': referral_code,
        'referred_by': referred_by, 'total_referrals': 0,
        'daily_gems_reset': datetime.utcnow().isoformat(), 'hook_messages_remaining': 0
    }
    result = supabase.table('users').insert(user_data).execute()
    
    if referred_by and result.data:
        supabase.table('referrals').insert({'referrer_id': referred_by, 'referred_id': telegram_id}).execute()
        referral_count = supabase.table('referrals').select('*', count='exact').eq('referrer_id', referred_by).execute().count
        supabase.table('users').update({'total_referrals': referral_count}).eq('telegram_id', referred_by).execute()
        supabase.table('users').update({'gems': supabase.table('users').select('gems').eq('telegram_id', referred_by).single().execute().data['gems'] + GEMS_PER_REFERRAL}).eq('telegram_id', referred_by).execute()
    
    return result.data[0] if result.data else None

async def add_gems(telegram_id: int, amount: int, transaction_type: str, description: str = ''):
    user = await get_user(telegram_id)
    if not user:
        return False
    supabase.table('users').update({'gems': user['gems'] + amount}).eq('telegram_id', telegram_id).execute()
    supabase.table('gem_transactions').insert({
        'telegram_id': telegram_id, 'amount': amount,
        'transaction_type': transaction_type, 'description': description
    }).execute()
    return True

async def get_user_by_referral_code(referral_code: str):
    result = supabase.table('users').select('*').eq('referral_code', referral_code).execute()
    return result.data[0] if result.data else None

async def record_star_purchase(telegram_id: int, stars: int, gems: int, is_first_purchase: bool, charge_id: str):
    supabase.table('star_purchases').insert({
        'telegram_id': telegram_id, 'stars_amount': stars, 'gems_amount': gems,
        'is_first_purchase': is_first_purchase, 'telegram_charge_id': charge_id
    }).execute()
    await add_gems(telegram_id, gems, 'purchase', f'Compra con {stars} stars')

def get_main_keyboard(language: str) -> ReplyKeyboardMarkup:
    builder = ReplyKeyboardBuilder()
    if language == 'es':
        builder.row(KeyboardButton(text="🎭 Abrir App", web_app=WebAppInfo(url=MINI_APP_URL)))
        builder.row(KeyboardButton(text="💎 Balance"), KeyboardButton(text=" Tienda"))
        builder.row(KeyboardButton(text="🎁 Invitar"), KeyboardButton(text="❓ Ayuda"))
    else:
        builder.row(KeyboardButton(text="🎭 Open App", web_app=WebAppInfo(url=MINI_APP_URL)))
        builder.row(KeyboardButton(text="💎 Balance"), KeyboardButton(text="🛒 Shop"))
        builder.row(KeyboardButton(text=" Invite"), KeyboardButton(text="❓ Help"))
    return builder.as_markup(resize_keyboard=True, one_time_keyboard=False)

# ==================== HANDLERS ====================

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
    
    user = await get_user(telegram_id)
    if user:
        await message.answer(
            f"¡Bienvenido de vuelta, {first_name}! 👋\n\n"
            f"💎 Gemas: {user['gems']}\n\n"
            f"Haz clic en '🎭 Abrir App' para comenzar la experiencia visual.",
            reply_markup=get_main_keyboard(user['language'])
        )
        return
    
    # Nuevo usuario - mostrar selector de idioma
    builder = InlineKeyboardBuilder()
    builder.button(text="🇪🇸 Español", callback_data="lang_es")
    builder.button(text="🇸 English", callback_data="lang_en")
    builder.adjust(2)
    
    await message.answer(
        "👋 ¡Bienvenido!\n\n"
        "Por favor selecciona tu idioma / Please select your language:",
        reply_markup=builder.as_markup()
    )
    
    # Guardar estado temporal en Supabase (no en memoria)
    supabase.table('user_states').upsert({
        'telegram_id': telegram_id,
        'step': 'language',
        'username': username,
        'first_name': first_name,
        'referred_by': referred_by,
        'created_at': datetime.utcnow().isoformat()
    }).execute()

@router.callback_query(F.data.startswith('lang_'))
async def process_language(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    
    # Obtener estado de Supabase
    state_result = supabase.table('user_states').select('*').eq('telegram_id', telegram_id).execute()
    if not state_result.data:
        return await callback.answer("⏱️ Sesión expirada. Usa /start", show_alert=True)
    
    state = state_result.data[0]
    lang = callback.data.split('_')[1]
    
    # Actualizar estado
    supabase.table('user_states').update({'step': 'gender', 'language': lang}).eq('telegram_id', telegram_id).execute()
    
    builder = InlineKeyboardBuilder()
    if lang == 'es':
        builder.row(
            InlineKeyboardButton(text=" Hombre", callback_data="gender_male"),
            InlineKeyboardButton(text="👩 Mujer", callback_data="gender_female")
        )
        text = " Selecciona el género de tu personaje:"
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
    
    state_result = supabase.table('user_states').select('*').eq('telegram_id', telegram_id).execute()
    if not state_result.data:
        return await callback.answer("⏱️ Sesión expirada. Usa /start", show_alert=True)
    
    state = state_result.data[0]
    gender = callback.data.split('_')[1]
    lang = state.get('language', 'es')
    
    supabase.table('user_states').update({'step': 'archetype', 'gender': gender}).eq('telegram_id', telegram_id).execute()
    
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
    telegram_id = callback.from_user.id
    
    state_result = supabase.table('user_states').select('*').eq('telegram_id', telegram_id).execute()
    if not state_result.data:
        return await callback.answer("⏱️ Sesión expirada. Usa /start", show_alert=True)
    
    state = state_result.data[0]
    archetype = callback.data.split('_', 1)[1]
    
    supabase.table('user_states').update({'step': 'name', 'archetype': archetype}).eq('telegram_id', telegram_id).execute()
    
    lang = state.get('language', 'es')
    text = "✍️ ¿Qué nombre quieres para tu personaje?" if lang == 'es' else "✍️ What name do you want for your character?"
    await callback.message.edit_text(text)
    await callback.answer()

@router.message(F.text & ~F.text.startswith('/'))
async def process_name(message: Message):
    telegram_id = message.from_user.id
    
    state_result = supabase.table('user_states').select('*').eq('telegram_id', telegram_id).execute()
    if not state_result.data or state_result.data[0].get('step') != 'name':
        return
    
    state = state_result.data[0]
    character_name = message.text.strip()
    
    # Crear usuario
    user = await create_user(
        telegram_id,
        state.get('username', ''),
        state.get('first_name', ''),
        state.get('language', 'es'),
        state.get('referred_by')
    )
    
    if not user:
        await message.answer("❌ Error al crear el usuario. Intenta de nuevo con /start")
        return
    
    # Guardar personaje
    personality = PERSONALITIES.get(state.get('archetype', ''), '')
    supabase.table('user_characters').insert({
        'telegram_id': telegram_id,
        'character_name': character_name,
        'gender': state.get('gender', 'female'),
        'archetype': state.get('archetype', 'schoolmate'),
        'personality': personality,
        'is_active': True
    }).execute()
    
    # Limpiar estado
    supabase.table('user_states').delete().eq('telegram_id', telegram_id).execute()
    
    lang = state.get('language', 'es')
    text = (
        f"✅ ¡Registro completado!\n\n"
        f"🎭 Tu personaje: {character_name}\n"
        f"💎 Tienes 15 gemas para empezar\n\n"
        f"Haz clic en '🎭 Abrir App' para comenzar la experiencia visual."
    ) if lang == 'es' else (
        f"✅ Registration complete!\n\n"
        f"🎭 Your character: {character_name}\n"
        f"💎 You have 15 gems to start\n\n"
        f"Click '🎭 Open App' to start the visual experience."
    )
    
    await message.answer(text, reply_markup=get_main_keyboard(lang))

@router.message(F.text == "💎 Balance" or F.text == "💎 Balance")
async def cmd_balance(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    lang = user['language']
    gems = user['gems']
    
    text = (
        f"💎 Tu Balance\n\n"
        f"Gemas actuales: {gems}\n\n"
        f"📊 Información:\n"
        f"• Gemas diarias: {BASE_DAILY_GEMS}/{MAX_DAILY_GEMS}\n\n"
        f"💡 Abre la App para ver más detalles y comprar gemas con Stars."
    ) if lang == 'es' else (
        f"💎 Your Balance\n\n"
        f"Current gems: {gems}\n\n"
        f"📊 Info:\n"
        f"• Daily gems: {BASE_DAILY_GEMS}/{MAX_DAILY_GEMS}\n\n"
        f"💡 Open the App to see more details and buy gems with Stars."
    )
    
    await message.answer(text)

@router.message(F.text == "🛒 Tienda" or F.text == "🛒 Shop")
async def cmd_shop(message: Message):
    telegram_id = message.from_user.id
    user = await get_user(telegram_id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    language = user['language']
    builder = InlineKeyboardBuilder()
    
    if language == 'es':
        text = "💎 Tienda de Gemas\n\nSelecciona un paquete:\n\n"
        for i, package in enumerate(STAR_PACKAGES):
            stars, gems, bonus, first_time = package['stars'], package['gems'], package.get('bonus', 0), package.get('first_time', False)
            final_gems = int(gems * (1 + bonus / 100)) if bonus > 0 else gems
            line = f"⭐ {stars} Stars → 💎 {final_gems} gemas" + (" (¡Primera vez!)" if first_time else "")
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Opción {i+1}", callback_data=f"buy_{i}")
    else:
        text = "💎 Gem Store\n\nSelect a package:\n\n"
        for i, package in enumerate(STAR_PACKAGES):
            stars, gems, bonus, first_time = package['stars'], package['gems'], package.get('bonus', 0), package.get('first_time', False)
            final_gems = int(gems * (1 + bonus / 100)) if bonus > 0 else gems
            line = f"⭐ {stars} Stars → 💎 {final_gems} gems" + (" (First time!)" if first_time else "")
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
    pkg_idx = int(message.successful_payment.invoice_payload.split('_')[-1])
    
    if pkg_idx >= len(STAR_PACKAGES):
        return await message.answer("️ Error al procesar la compra.")
    
    pkg = STAR_PACKAGES[pkg_idx]
    gems = int(pkg['gems'] * (1 + pkg.get('bonus', 0) / 100)) if pkg.get('bonus', 0) > 0 else pkg['gems']
    
    await record_star_purchase(
        telegram_id,
        pkg['stars'],
        gems,
        pkg.get('first_time', False),
        message.successful_payment.telegram_payment_charge_id
    )
    
    user = await get_user(telegram_id)
    lang = user['language'] if user else 'es'
    
    await message.answer(
        f"✅ ¡Compra exitosa! Has recibido {gems} gemas.\n\n"
        f"🎉 ¡Ahora puedes disfrutar de la experiencia completa en la App!"
    )

@router.message(F.text == "🎁 Invitar" or F.text == "🎁 Invite")
async def cmd_invite(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("️ Primero debes registrarte con /start")
    
    lang = user['language']
    link = f"https://t.me/{(await message.bot.get_me()).username}?start={user['referral_code']}"
    
    text = (
        f"🎁 Sistema de Referidos\n\n"
        f"🔗 Tu enlace:\n{link}\n\n"
        f"💡 ¡Comparte tu enlace y gana 5 gemas por cada amigo que se registre!"
    ) if lang == 'es' else (
        f" Referral System\n\n"
        f" Your link:\n{link}\n\n"
        f"💡 Share your link and earn 5 gems for each friend who registers!"
    )
    
    await message.answer(text)

@router.message(F.text == "❓ Ayuda" or F.text == "❓ Help")
async def cmd_help(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Primero debes registrarte con /start")
    
    lang = user['language']
    
    text = (
        "📚 Comandos:\n"
        "/start - Registrarse\n"
        "/balance - Ver gemas\n"
        "/shop - Tienda\n"
        "/invite - Invitar amigos\n"
        "/help - Ayuda\n\n"
        "💡 Consejo: Usa el botón ' Abrir App' para la experiencia visual completa con chat, imágenes y más."
    ) if lang == 'es' else (
        " Commands:\n"
        "/start - Register\n"
        "/balance - View gems\n"
        "/shop - Store\n"
        "/invite - Invite friends\n"
        "/help - Help\n\n"
        "💡 Tip: Use the '🎭 Open App' button for the full visual experience with chat, images and more."
    )
    
    await message.answer(text)
