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

BASE_DAILY_GEMS = 5
GEMS_PER_REFERRAL = 5
STARTING_GEMS = 15

# ── STARS ────────────────────────────────────────────────────
# Bonus: +5% en todos los planes
# Extra: +75 gemas flat SOLO en el primer paquete (primera compra)
STAR_PACKAGES = [
    {"stars": 75,   "gems": 300,  "bonus": 5, "first_time": True,  "flat_bonus": 75},
    {"stars": 150,  "gems": 600,  "bonus": 5, "first_time": False, "flat_bonus": 0},
    {"stars": 300,  "gems": 1200, "bonus": 5, "first_time": False, "flat_bonus": 0},
    {"stars": 500,  "gems": 2400, "bonus": 5, "first_time": False, "flat_bonus": 0},
    {"stars": 1000, "gems": 5000, "bonus": 5, "first_time": False, "flat_bonus": 0},
]

def calc_final_gems(pkg: dict) -> int:
    """Calcula gemas finales: base + % bonus + flat bonus (si aplica)"""
    percent = int(pkg['gems'] * pkg['bonus'] / 100) if pkg.get('bonus', 0) > 0 else 0
    flat = pkg.get('flat_bonus', 0)
    return pkg['gems'] + percent + flat

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

router = Router()

# ==================== HELPERS ====================

def generate_referral_code() -> str:
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

def detect_language(language_code: Optional[str]) -> str:
    """Detecta idioma de Telegram. Solo 'es' explícito usa español, todo lo demás inglés."""
    if not language_code:
        return 'en'
    return 'es' if language_code.lower().startswith('es') else 'en'

async def get_user(telegram_id: int):
    result = supabase.table('users').select('*').eq('telegram_id', str(telegram_id)).execute()
    return result.data[0] if result.data else None

async def get_user_by_referral_code(referral_code: str):
    result = supabase.table('users').select('*').eq('referral_code', referral_code).execute()
    return result.data[0] if result.data else None

async def get_user_by_username(username: str):
    clean = username.replace('@', '').strip()
    if not clean:
        return None
    result = supabase.table('users').select('*').ilike('username', clean).execute()
    return result.data[0] if result.data else None

async def create_user_immediately(
    telegram_id: int,
    username: str,
    first_name: str,
    language: str,
    referred_by: Optional[int] = None
):
    """Crea usuario con valores por defecto. Sin personaje todavía."""
    referral_code = generate_referral_code()
    user_data = {
        'telegram_id': str(telegram_id),
        'username': username or None,
        'first_name': first_name or 'User',
        'language': language,
        'gems': STARTING_GEMS,
        'referral_code': referral_code,
        'referred_by': str(referred_by) if referred_by else None,
        'total_referrals': 0,
        'hook_messages_remaining': 0
    }

    try:
        result = supabase.table('users').insert(user_data).execute()
    except Exception as e:
        logger.error(f"Error insertando usuario: {e}")
        return None

    if referred_by and result.data:
        try:
            supabase.table('referrals').insert({
                'referrer_id': str(referred_by),
                'referred_id': str(telegram_id),
                'reward_paid': False,
                'referred_message_count': 0
            }).execute()
        except Exception as e:
            logger.error(f"Error creando referral: {e}")

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
    """Solo botón grande de Mini App"""
    builder = ReplyKeyboardBuilder()
    if language == 'es':
        builder.row(KeyboardButton(text="🎭 Abrir Mini App", web_app=WebAppInfo(url=MINI_APP_URL)))
    else:
        builder.row(KeyboardButton(text="🎭 Open Mini App", web_app=WebAppInfo(url=MINI_APP_URL)))
    return builder.as_markup(resize_keyboard=True, one_time_keyboard=False, is_persistent=True)

async def send_mini_app_message(message: Message, lang: str, is_new_user: bool = False):
    """Envía el mensaje principal con el botón a la Mini App"""
    if lang == 'es':
        if is_new_user:
            text = (
                "🎭 *¡Bienvenido a Taboo Realm!*\n\n"
                "Aquí podrás chatear con personajes únicos de IA.\n\n"
                f"💎 Te regalamos *{STARTING_GEMS} gemas* para empezar.\n"
                "🎁 Invita amigos y gana *5 gemas* por cada uno.\n\n"
                "👇 Toca el botón para comenzar:"
            )
        else:
            user = await get_user(message.from_user.id)
            gems = user['gems'] if user else 0
            text = (
                f"👋 *¡Hola de nuevo!*\n\n"
                f"💎 Tus gemas: *{gems}*\n\n"
                "👇 Toca el botón para continuar:"
            )
    else:
        if is_new_user:
            text = (
                "🎭 *Welcome to Taboo Realm!*\n\n"
                "Here you can chat with unique AI characters.\n\n"
                f"💎 We gift you *{STARTING_GEMS} gems* to start.\n"
                "🎁 Invite friends and earn *5 gems* per friend.\n\n"
                "👇 Tap the button to begin:"
            )
        else:
            user = await get_user(message.from_user.id)
            gems = user['gems'] if user else 0
            text = (
                f"👋 *Welcome back!*\n\n"
                f"💎 Your gems: *{gems}*\n\n"
                "👇 Tap the button to continue:"
            )
    await message.answer(text, reply_markup=get_main_keyboard(lang), parse_mode="Markdown")

# ==================== HANDLERS ====================

@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject = None):
    telegram_id = message.from_user.id
    username = message.from_user.username or ""
    first_name = message.from_user.first_name or ""
    language = detect_language(message.from_user.language_code)

    referred_by = None
    if command and command.args:
        arg = command.args
        referrer = await get_user_by_username(arg)
        if not referrer:
            referrer = await get_user_by_referral_code(arg)
        if referrer and str(referrer['telegram_id']) != str(telegram_id):
            referred_by = referrer['telegram_id']

    user = await get_user(telegram_id)

    if not user:
        user = await create_user_immediately(
            telegram_id, username, first_name, language,
            int(referred_by) if referred_by else None
        )
        if not user:
            await message.answer("❌ Error al crear tu cuenta. Intenta de nuevo con /start")
            return
        await send_mini_app_message(message, language, is_new_user=True)
    else:
        lang = user.get('language', language) or language
        await send_mini_app_message(message, lang, is_new_user=False)

@router.message(F.text.in_({"💎 Balance"}))
async def cmd_balance(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Usa /start primero")
    lang = user.get('language', 'es')
    if lang == 'es':
        text = f"💎 *Tu Balance*\n\nGemas: *{user['gems']}*\n\n💡 Abre la Mini App para más detalles."
    else:
        text = f"💎 *Your Balance*\n\nGems: *{user['gems']}*\n\n💡 Open the Mini App for more details."
    await message.answer(text, parse_mode="Markdown")

@router.message(F.text.in_({"🛒 Tienda", "🛒 Shop"}))
async def cmd_shop(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Usa /start primero")

    language = user.get('language', 'es')
    builder = InlineKeyboardBuilder()

    if language == 'es':
        text = "💎 *Tienda de Gemas*\n\nSelecciona un paquete:\n\n"
        for i, pkg in enumerate(STAR_PACKAGES):
            final_gems = calc_final_gems(pkg)
            line = f"⭐ {pkg['stars']} Stars → 💎 {final_gems} gemas"
            if pkg['first_time']:
                line += " (¡Primera vez!)"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Opción {i+1}", callback_data=f"buy_{i}")
    else:
        text = "💎 *Gem Store*\n\nSelect a package:\n\n"
        for i, pkg in enumerate(STAR_PACKAGES):
            final_gems = calc_final_gems(pkg)
            line = f"⭐ {pkg['stars']} Stars → 💎 {final_gems} gems"
            if pkg['first_time']:
                line += " (First time!)"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Option {i+1}", callback_data=f"buy_{i}")

    builder.adjust(1)
    await message.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")

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
    gems = calc_final_gems(pkg)

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
    gems = calc_final_gems(pkg)

    await record_star_purchase(
        telegram_id, pkg['stars'], gems,
        pkg.get('first_time', False),
        message.successful_payment.telegram_payment_charge_id
    )

    user = await get_user(telegram_id)
    lang = user.get('language', 'es') if user else 'es'

    if lang == 'es':
        text = f"✅ ¡Compra exitosa! Recibiste *{gems} gemas*.\n\n🎉 ¡Ahora tienes acceso a audio e imágenes!"
    else:
        text = f"✅ Purchase successful! You received *{gems} gems*.\n\n🎉 You now have access to audio and images!"
    await message.answer(text, parse_mode="Markdown", reply_markup=get_main_keyboard(lang))

@router.message(F.text.in_({"🎁 Invitar", "🎁 Invite"}))
async def cmd_invite(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Usa /start primero")

    lang = user.get('language', 'es')
    bot_info = await message.bot.get_me()

    ref_param = user.get('username') or user['referral_code']
    link = f"https://t.me/{bot_info.username}?startapp={ref_param}"

    if lang == 'es':
        text = (f"🎁 *Sistema de Referidos*\n\n"
                f"🔗 Tu enlace:\n`{link}`\n\n"
                f"💡 Comparte tu enlace. Cuando tu amigo mande 3 mensajes, ganarás *5 gemas*.")
    else:
        text = (f"🎁 *Referral System*\n\n"
                f"🔗 Your link:\n`{link}`\n\n"
                f"💡 Share your link. When your friend sends 3 messages, you'll earn *5 gems*.")
    await message.answer(text, parse_mode="Markdown")

@router.message(F.text.in_({"❓ Ayuda", "❓ Help"}))
async def cmd_help(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Usa /start primero")

    lang = user.get('language', 'es')
    if lang == 'es':
        text = ("📚 *Comandos*\n\n"
                "/start - Iniciar\n"
                "/balance - Ver gemas\n"
                "/shop - Tienda\n"
                "/invite - Invitar amigos\n"
                "/help - Ayuda\n\n"
                "💡 Usa el botón '🎭 Abrir Mini App' para la experiencia completa.")
    else:
        text = ("📚 *Commands*\n\n"
                "/start - Start\n"
                "/balance - View gems\n"
                "/shop - Store\n"
                "/invite - Invite friends\n"
                "/help - Help\n\n"
                "💡 Use the '🎭 Open Mini App' button for the full experience.")
    await message.answer(text, parse_mode="Markdown")
