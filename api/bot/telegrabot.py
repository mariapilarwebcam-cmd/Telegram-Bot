import os
import random
import string
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import Command, CommandStart, CommandObject
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery,
    ReplyKeyboardMarkup, KeyboardButton, WebAppInfo,
    InlineKeyboardMarkup,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder

from turso_client import turso_query, turso_query_one, turso_execute

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
MINI_APP_URL = os.getenv('MINI_APP_URL', 'https://tu-dominio.vercel.app')

if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("❌ Falta TELEGRAM_BOT_TOKEN")

# ==================== ECONOMÍA ====================
STARTING_GEMS = 10
DAILY_MESSAGES = 3       # ✅ Ahora se dan Mensajes diarios
REFERRAL_MESSAGES = 15   # ✅ Ahora se dan Mensajes por referido
REFERRAL_MIN_MESSAGES = 10

REFERRAL_PURCHASE_COMMISSION_PCT = 5
REFERRAL_TOP_TIER_THRESHOLD = 5
REFERRAL_TOP_TIER_PCT = 7
REFERRAL_ELITE_TIER_THRESHOLD = 20
REFERRAL_ELITE_TIER_PCT = 10

# ✅ NUEVOS PAQUETES (Basados en lib/constants.ts)
STAR_PACKAGES = [
    {"stars": 100,  "gems": 200,  "bonus": 100, "first_time": True,  "flat_bonus": 0},
    {"stars": 150,  "gems": 300,  "bonus": 20,  "first_time": False, "flat_bonus": 0},
    {"stars": 300,  "gems": 600,  "bonus": 25,  "first_time": False, "flat_bonus": 0},
    {"stars": 500,  "gems": 1000, "bonus": 40,  "first_time": False, "flat_bonus": 0},
    {"stars": 1000, "gems": 2000, "bonus": 50,  "first_time": False, "flat_bonus": 0},
]

MESSAGE_PACKAGES = [
    {"stars": 100,  "messages": 300,  "first_time": False},
    {"stars": 250,  "messages": 800,  "first_time": False},
    {"stars": 500,  "messages": 2000, "first_time": False},
]


def calc_final_gems(pkg: dict) -> int:
    percent = int(pkg['gems'] * pkg['bonus'] / 100) if pkg.get('bonus', 0) > 0 else 0
    flat = pkg.get('flat_bonus', 0)
    return pkg['gems'] + percent + flat


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

router = Router()


# ==================== HELPERS ====================

def generate_referral_code() -> str:
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))


def detect_language(language_code: Optional[str]) -> str:
    if not language_code:
        return 'en'
    return 'es' if language_code.lower().startswith('es') else 'en'


async def get_user(telegram_id: int):
    return turso_query_one(
        "SELECT * FROM users WHERE telegram_id = ? LIMIT 1",
        [str(telegram_id)]
    )


async def get_user_by_referral_code(referral_code: str):
    return turso_query_one(
        "SELECT * FROM users WHERE referral_code = ? LIMIT 1",
        [referral_code]
    )


async def get_user_by_username(username: str):
    clean = username.replace('@', '').strip()
    if not clean:
        return None
    return turso_query_one(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [clean]
    )


async def update_last_active(telegram_id: int):
    try:
        turso_execute(
            "UPDATE users SET last_active = datetime('now') WHERE telegram_id = ?",
            [str(telegram_id)]
        )
    except Exception as e:
        logger.warning(f"update_last_active falló para {telegram_id}: {e}")


async def create_user_immediately(
    telegram_id: int,
    username: str,
    first_name: str,
    language: str,
    pending_referral_code: Optional[str] = None,
):
    referral_code = generate_referral_code()
    starting_gems = STARTING_GEMS

    try:
        already_seen = turso_query_one(
            "SELECT telegram_id FROM telegram_ids_seen WHERE telegram_id = ? LIMIT 1",
            [str(telegram_id)]
        )

        if already_seen:
            starting_gems = 0
            logger.info(f"🛡️ Recreated account for {telegram_id} → 0 free gems")
        else:
            try:
                turso_execute(
                    "INSERT OR IGNORE INTO telegram_ids_seen (telegram_id) VALUES (?)",
                    [str(telegram_id)]
                )
            except Exception as seen_err:
                logger.warning(f"telegram_ids_seen insert failed for {telegram_id}: {seen_err}")
    except Exception as e:
        logger.warning(f"telegram_ids_seen check failed for {telegram_id}: {e}")

    try:
        turso_execute(
            """INSERT INTO users
              (telegram_id, username, first_name, language, gems, purchased_gems,
               referral_code, referred_by, total_referrals, paying_referrals_count,
               hook_messages_remaining, hook_used, age_verified, pending_referral_code,
               gender, interested_in, onboarding_complete, last_active, photo_tokens, photo_tokens_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, NULL, 0, 0, 0, 0, 0, ?, NULL, NULL, 0, datetime('now'), 1, unixepoch())""",
            [
                str(telegram_id),
                username or None,
                first_name or 'User',
                language,
                starting_gems,
                referral_code,
                pending_referral_code,
            ]
        )
        return await get_user(telegram_id)
    except Exception as e:
        err_str = str(e)
        logger.error(f"Error insertando usuario: {err_str}")

        if 'UNIQUE' in err_str or 'unique' in err_str.lower() or 'constraint' in err_str.lower():
            logger.info(f"Usuario {telegram_id} ya existe, recuperando...")
            return await get_user(telegram_id)
        return None


async def add_gems(telegram_id: int, amount: int, transaction_type: str, description: str = ''):
    try:
        turso_query_one(
            """UPDATE users
             SET gems = COALESCE(gems, 0) + ?,
                 updated_at = ?
             WHERE telegram_id = ?
             RETURNING gems""",
            [amount, datetime.now(timezone.utc).isoformat(), str(telegram_id)]
        )
        turso_execute(
            """INSERT INTO gem_transactions
              (telegram_id, amount, transaction_type, description)
             VALUES (?, ?, ?, ?)""",
            [str(telegram_id), amount, transaction_type, description]
        )
        return True
    except Exception as e:
        logger.error(f"Error en add_gems: {e}")
        return False


# ==================== REFERRAL COMMISSION ====================

async def pay_referral_commission(
    buyer_id: int,
    gems_purchased: int,
    source: str,
    reference: str,
):
    try:
        buyer = await get_user(buyer_id)
        if not buyer:
            return

        referrer_id = buyer.get('referred_by')
        if not referrer_id:
            return

        referrer = await get_user(int(referrer_id))
        if not referrer:
            return

        existing_rows = turso_query(
            "SELECT referred_id FROM referral_commissions WHERE referrer_id = ?",
            [str(referrer_id)]
        )

        unique_buyers = set()
        for row in existing_rows:
            unique_buyers.add(str(row['referred_id']))
        unique_buyers.add(str(buyer_id))

        total_unique = len(unique_buyers)

        if total_unique >= REFERRAL_ELITE_TIER_THRESHOLD:
            pct = REFERRAL_ELITE_TIER_PCT
        elif total_unique >= REFERRAL_TOP_TIER_THRESHOLD:
            pct = REFERRAL_TOP_TIER_PCT
        else:
            pct = REFERRAL_PURCHASE_COMMISSION_PCT

        commission = int(gems_purchased * pct / 100)
        if commission <= 0:
            return

        now_iso = datetime.now(timezone.utc).isoformat()
        rpc_row = turso_query_one(
            """UPDATE users
             SET gems = COALESCE(gems, 0) + ?,
                 updated_at = ?
             WHERE telegram_id = ?
             RETURNING gems""",
            [commission, now_iso, str(referrer_id)]
        )
        new_ref_gems = rpc_row['gems'] if rpc_row else 0

        turso_execute(
            "UPDATE users SET paying_referrals_count = ?, updated_at = ? WHERE telegram_id = ?",
            [total_unique, now_iso, str(referrer_id)]
        )

        turso_execute(
            """INSERT INTO gem_transactions
              (telegram_id, amount, transaction_type, description)
             VALUES (?, ?, ?, ?)""",
            [
                str(referrer_id),
                commission,
                'referral_commission',
                f'Comisión {pct}% por compra de referido',
            ]
        )

        turso_execute(
            """INSERT INTO referral_commissions
              (referrer_id, referred_id, purchase_gems, commission_gems,
               commission_pct, source, reference)
             VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                str(referrer_id),
                str(buyer_id),
                gems_purchased,
                commission,
                pct,
                source,
                reference,
            ]
        )

        logger.info(f"Commission paid: {commission} gems to {referrer_id} ({pct}%)")

        try:
            bot = Bot(token=TELEGRAM_BOT_TOKEN)
            lang = referrer.get('language', 'es')
            if lang == 'es':
                text = (
                    f"🎉 *¡Tu referido compró gemas!*\n\n"
                    f"💎 Compra: *{gems_purchased}* gemas\n"
                    f"💰 Comisión ({pct}%): *+{commission}* gemas\n\n"
                    f"💎 Tus gemas totales: *{new_ref_gems}*"
                )
            else:
                text = (
                    f"🎉 *Your referral bought gems!*\n\n"
                    f"💎 Purchase: *{gems_purchased}* gems\n"
                    f"💰 Commission ({pct}%): *+{commission}* gems\n\n"
                    f"💎 Your total gems: *{new_ref_gems}*"
                )
            await bot.send_message(
                chat_id=int(referrer_id),
                text=text,
                parse_mode="Markdown",
            )
            await bot.session.close()
        except Exception as e:
            logger.error(f"Error notificando comisión: {e}")

    except Exception as e:
        logger.error(f"Error pagando comisión: {e}")


# ==================== PURCHASE HELPERS ====================

async def record_star_purchase(telegram_id: int, stars: int, amount: int, is_first_purchase: bool, charge_id: str, is_messages: bool = False) -> bool:
    try:
        turso_execute(
            """INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method)
             VALUES (?, ?, ?, ?, ?, ?)""",
            [str(telegram_id), stars, amount, 1 if is_first_purchase else 0, charge_id, 'messages' if is_messages else 'stars']
        )
    except Exception as e:
        err_str = str(e)
        if 'UNIQUE' in err_str or 'unique' in err_str.lower() or 'constraint' in err_str.lower():
            logger.warning(f"⚠️ Charge {charge_id} ya procesado, ignorando")
            return False
        logger.error(f"Error insertando star_purchase: {err_str}")
        return False

    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        if is_messages:
            turso_query_one(
                """UPDATE users
                 SET bonus_gems = COALESCE(bonus_gems, 0) + ?,
                     hook_messages_remaining = 0,
                     updated_at = ?
                 WHERE telegram_id = ?
                 RETURNING bonus_gems""",
                [amount, now_iso, str(telegram_id)]
            )
        else:
            turso_query_one(
                """UPDATE users
                 SET gems = COALESCE(gems, 0) + ?,
                     purchased_gems = COALESCE(purchased_gems, 0) + ?,
                     hook_messages_remaining = 0,
                     updated_at = ?
                 WHERE telegram_id = ?
                 RETURNING gems, purchased_gems""",
                [amount, amount, now_iso, str(telegram_id)]
            )
    except Exception as e:
        logger.error(f"Error incrementando balance post-compra: {e}")

    turso_execute(
        """INSERT INTO gem_transactions
          (telegram_id, amount, transaction_type, description)
         VALUES (?, ?, ?, ?)""",
        [str(telegram_id), amount, 'purchase', f'Compra con {stars} stars']
    )

    # ✅ Si es compra de mensajes, calculamos la comisión basándonos en el valor aproximado en gemas
    commission_base = amount if not is_messages else int(amount / 2) 
    await pay_referral_commission(telegram_id, commission_base, 'stars', charge_id)
    return True


# ==================== AGE VERIFICATION ====================

def get_age_warning_text(language: str) -> str:
    if language == 'es':
        return (
            "🔞 *Contenido para adultos (+18)*\n\n"
            "Esta experiencia contiene contenido para adultos, incluyendo "
            "temas de romance intenso y situaciones sugerentes.\n\n"
            "Al continuar confirmas que:\n"
            "• Tienes *18 años o más*\n"
            "• Cumples con las leyes de tu país\n"
            "• Aceptas ver contenido para adultos\n\n"
            "*¿Confirmas que eres mayor de edad?*"
        )
    return (
        "🔞 *Adult Content (+18)*\n\n"
        "This experience contains adult content, including "
        "intense romantic themes and suggestive situations.\n\n"
        "By continuing you confirm that:\n"
        "• You are *18 years or older*\n"
        "• You comply with the laws of your country\n"
        "• You accept viewing adult content\n\n"
        "*Do you confirm you are of legal age?*"
    )


def get_age_keyboard(language: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if language == 'es':
        builder.button(text="✅ Sí, soy mayor de 18", callback_data="age_confirm")
        builder.button(text="❌ No, soy menor", callback_data="age_decline")
    else:
        builder.button(text="✅ Yes, I'm 18+", callback_data="age_confirm")
        builder.button(text="❌ No, I'm underage", callback_data="age_decline")
    builder.adjust(1)
    return builder.as_markup()


async def send_age_warning(message: Message, language: str):
    await message.answer(
        get_age_warning_text(language),
        parse_mode="Markdown",
        reply_markup=get_age_keyboard(language),
    )


# ==================== GENDER + INTEREST ====================

def get_gender_text(language: str) -> str:
    if language == 'es':
        return (
            "👤 *¿Cuál es tu género?*\n\n"
            "Nos ayuda a personalizar tu experiencia."
        )
    return (
        "👤 *What is your gender?*\n\n"
        "Helps us personalize your experience."
    )


def get_gender_keyboard(language: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if language == 'es':
        builder.button(text="👨 Hombre", callback_data="gender_male")
        builder.button(text="👩 Mujer", callback_data="gender_female")
    else:
        builder.button(text="👨 Man", callback_data="gender_male")
        builder.button(text="👩 Woman", callback_data="gender_female")
    builder.adjust(2)
    return builder.as_markup()


async def send_gender_question(message: Message, language: str):
    await message.answer(
        get_gender_text(language),
        parse_mode="Markdown",
        reply_markup=get_gender_keyboard(language),
    )


def get_interest_text(language: str) -> str:
    if language == 'es':
        return (
            "💫 *¿Qué buscas?*\n\n"
            "Filtraremos los personajes según tu preferencia."
        )
    return (
        "💫 *What are you looking for?*\n\n"
        "We'll filter characters based on your preference."
    )


def get_interest_keyboard(language: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if language == 'es':
        builder.button(text="👨 Hombres", callback_data="interest_male")
        builder.button(text="👩 Mujeres", callback_data="interest_female")
        builder.button(text="👥 Ambos", callback_data="interest_both")
    else:
        builder.button(text="👨 Men", callback_data="interest_male")
        builder.button(text="👩 Women", callback_data="interest_female")
        builder.button(text="👥 Both", callback_data="interest_both")
    builder.adjust(2, 1)
    return builder.as_markup()


async def send_interest_question(message: Message, language: str):
    await message.answer(
        get_interest_text(language),
        parse_mode="Markdown",
        reply_markup=get_interest_keyboard(language),
    )


# ==================== ONBOARDING ROUTER ====================

async def route_onboarding_state(message: Message, user: dict, language: str, is_new_user: bool = False):
    lang = user.get('language', language) or language

    if not user.get('age_verified'):
        await send_age_warning(message, lang)
        return

    if not user.get('gender'):
        await send_gender_question(message, lang)
        return

    if not user.get('interested_in'):
        await send_interest_question(message, lang)
        return

    await send_mini_app_message(message, lang, is_new_user=is_new_user)


# ==================== REFERRAL APPLICATION ====================

async def apply_pending_referral(telegram_id: int, ref_code: str) -> bool:
    if not ref_code:
        return False

    try:
        referrer = await get_user_by_username(ref_code)
        if not referrer:
            referrer = await get_user_by_referral_code(ref_code)

        if not referrer:
            logger.warning(f"Referrer not found for code: {ref_code}")
            return False

        if str(referrer['telegram_id']) == str(telegram_id):
            return False

        existing = turso_query_one(
            "SELECT id FROM referrals WHERE referred_id = ? LIMIT 1",
            [str(telegram_id)]
        )

        if existing:
            turso_execute(
                "UPDATE users SET pending_referral_code = NULL WHERE telegram_id = ?",
                [str(telegram_id)]
            )
            return False

        try:
            turso_execute(
                """INSERT INTO referrals
                  (referrer_id, referred_id, reward_paid, referred_message_count)
                 VALUES (?, ?, 0, 0)""",
                [str(referrer['telegram_id']), str(telegram_id)]
            )
        except Exception as e:
            err_str = str(e)
            if 'UNIQUE' in err_str or 'unique' in err_str.lower() or 'constraint' in err_str.lower():
                logger.info(f"Referral ya existente para {telegram_id}")
                return False
            raise

        turso_execute(
            """UPDATE users
             SET referred_by = ?, pending_referral_code = NULL
             WHERE telegram_id = ?""",
            [str(referrer['telegram_id']), str(telegram_id)]
        )

        try:
            bot = Bot(token=TELEGRAM_BOT_TOKEN)
            lang = referrer.get('language', 'es')
            if lang == 'es':
                text = (
                    f"🎉 *¡Alguien usó tu código!*\n\n"
                    f"💌 Recibirás *{REFERRAL_MESSAGES} mensajes* cuando mande {REFERRAL_MIN_MESSAGES} mensajes.\n"
                    f"💰 Y *{REFERRAL_PURCHASE_COMMISSION_PCT}%* de todo lo que compre."
                )
            else:
                text = (
                    f"🎉 *Someone used your code!*\n\n"
                    f"💌 You'll receive *{REFERRAL_MESSAGES} messages* once they send {REFERRAL_MIN_MESSAGES} messages.\n"
                    f"💰 Plus *{REFERRAL_PURCHASE_COMMISSION_PCT}%* of everything they buy."
                )
            await bot.send_message(int(referrer['telegram_id']), text, parse_mode="Markdown")
            await bot.session.close()
        except Exception as e:
            logger.error(f"Error notificando referido: {e}")

        logger.info(f"Referral applied (pending): {telegram_id} referred by {referrer['telegram_id']}")
        return True

    except Exception as e:
        logger.error(f"Error applying referral: {e}")
        return False


# ==================== KEYBOARD / MESSAGE ====================

def get_main_keyboard(language: str) -> ReplyKeyboardMarkup:
    builder = ReplyKeyboardBuilder()
    if language == 'es':
        builder.row(KeyboardButton(text="🎭 Abrir Mini App", web_app=WebAppInfo(url=MINI_APP_URL)))
    else:
        builder.row(KeyboardButton(text="🎭 Open Mini App", web_app=WebAppInfo(url=MINI_APP_URL)))
    return builder.as_markup(resize_keyboard=True, one_time_keyboard=False, is_persistent=True)


async def send_mini_app_message(message: Message, lang: str, is_new_user: bool = False):
    if lang == 'es':
        if is_new_user:
            text = (
                "🎭 *¡Bienvenido a Taboo Realm!*\n\n"
                "Aquí podrás chatear con personajes únicos de IA.\n\n"
                f"💎 Te regalamos *{STARTING_GEMS} gemas* para empezar.\n"
                f"🎁 Invita amigos y gana *{REFERRAL_MESSAGES} mensajes* + *5% de sus compras*.\n\n"
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
                f"🎁 Invite friends and earn *{REFERRAL_MESSAGES} messages* + *5% of their purchases*.\n\n"
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

    await update_last_active(telegram_id)

    ref_code: Optional[str] = None
    if command and command.args:
        arg = command.args.strip()
        if arg:
            ref_code = arg

    user = await get_user(telegram_id)
    is_new_user = False

    if not user:
        is_new_user = True
        user = await create_user_immediately(
            telegram_id, username, first_name, language,
            pending_referral_code=ref_code
        )
        if not user:
            user = await get_user(telegram_id)

        if not user:
            logger.error(f"❌ No se pudo crear ni recuperar usuario {telegram_id}")
            await message.answer(
                "❌ Error al crear tu cuenta. Intenta de nuevo con /start\n"
                "Si el problema persiste, contacta soporte."
            )
            return

    if ref_code and not user.get('age_verified'):
        try:
            turso_execute(
                "UPDATE users SET pending_referral_code = ? WHERE telegram_id = ?",
                [ref_code, str(telegram_id)]
            )
            user['pending_referral_code'] = ref_code
        except Exception as e:
            logger.error(f"Error updating pending_referral: {e}")

    await route_onboarding_state(message, user, language, is_new_user=is_new_user)


@router.callback_query(F.data == "age_confirm")
async def on_age_confirm(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    await update_last_active(telegram_id)

    user = await get_user(telegram_id)

    if not user:
        user = await create_user_immediately(
            telegram_id,
            callback.from_user.username or "",
            callback.from_user.first_name or "",
            detect_language(callback.from_user.language_code),
        )
        if not user:
            await callback.answer("⚠️ Usa /start primero", show_alert=True)
            return

    lang = user.get('language', 'es') or 'es'

    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        turso_execute(
            """UPDATE users
             SET age_verified = 1, age_verified_at = ?, updated_at = ?
             WHERE telegram_id = ?""",
            [now_iso, now_iso, str(telegram_id)]
        )
    except Exception as e:
        logger.error(f"Error updating age_verified: {e}")
        await callback.answer("⚠️ Error. Intenta de nuevo", show_alert=True)
        return

    verify = await get_user(telegram_id)
    if not verify or not verify.get('age_verified'):
        logger.error(f"age_verified no se guardó para {telegram_id}")
        await callback.answer("⚠️ Error guardando. Intenta de nuevo", show_alert=True)
        return

    pending_ref = user.get('pending_referral_code')
    if pending_ref:
        await apply_pending_referral(telegram_id, pending_ref)

    try:
        if callback.message:
            await callback.message.delete()
    except Exception:
        pass

    await callback.answer("✅")

    await send_gender_question(callback.message, lang)


@router.callback_query(F.data == "age_decline")
async def on_age_decline(callback: CallbackQuery):
    user = await get_user(callback.from_user.id)
    lang = user.get('language', 'es') if user else 'es'

    try:
        if callback.message:
            await callback.message.delete()
    except Exception:
        pass

    if lang == 'es':
        text = (
            "Entendido. Esta experiencia es solo para mayores de 18 años.\n\n"
            "Vuelve cuando cumplas la mayoría de edad. 👋"
        )
    else:
        text = (
            "Understood. This experience is for users 18 and older only.\n\n"
            "Come back when you're of legal age. 👋"
        )

    await callback.message.answer(text)
    await callback.answer()


@router.callback_query(F.data.in_({"gender_male", "gender_female"}))
async def on_gender_select(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    await update_last_active(telegram_id)

    user = await get_user(telegram_id)

    if not user:
        await callback.answer("⚠️ Usa /start primero", show_alert=True)
        return

    lang = user.get('language', 'es') or 'es'
    gender = "male" if callback.data == "gender_male" else "female"

    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        turso_execute(
            """UPDATE users SET gender = ?, updated_at = ?
             WHERE telegram_id = ?""",
            [gender, now_iso, str(telegram_id)]
        )
    except Exception as e:
        logger.error(f"Error updating gender: {e}")
        await callback.answer("⚠️ Error. Intenta de nuevo", show_alert=True)
        return

    try:
        if callback.message:
            await callback.message.delete()
    except Exception:
        pass

    await callback.answer("✅")

    await send_interest_question(callback.message, lang)


@router.callback_query(F.data.in_({"interest_male", "interest_female", "interest_both"}))
async def on_interest_select(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    await update_last_active(telegram_id)

    user = await get_user(telegram_id)

    if not user:
        await callback.answer("⚠️ Usa /start primero", show_alert=True)
        return

    lang = user.get('language', 'es') or 'es'

    interest_map = {
        "interest_male": "male",
        "interest_female": "female",
        "interest_both": "both",
    }
    interested_in = interest_map.get(callback.data, "both")

    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        turso_execute(
            """UPDATE users
             SET interested_in = ?, onboarding_complete = 1, updated_at = ?
             WHERE telegram_id = ?""",
            [interested_in, now_iso, str(telegram_id)]
        )
    except Exception as e:
        logger.error(f"Error updating interested_in: {e}")
        await callback.answer("⚠️ Error. Intenta de nuevo", show_alert=True)
        return

    try:
        if callback.message:
            await callback.message.delete()
    except Exception:
        pass

    await callback.answer("✅")

    await send_mini_app_message(callback.message, lang, is_new_user=True)


@router.message(Command("balance", "saldo", "gems"))
@router.message(F.text.in_({"💎 Balance", "💎 Saldo"}))
async def cmd_balance(message: Message):
    await update_last_active(message.from_user.id)

    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Usa /start primero")
    lang = user.get('language', 'es')
    if lang == 'es':
        text = f"💎 *Tu Balance*\n\nGemas de Pago: *{user['gems']}*\n💌 Mensajes de Chat: *{user.get('bonus_gems', 0)}*\n\n💡 Abre la Mini App para más detalles."
    else:
        text = f"💎 *Your Balance*\n\nPaid Gems: *{user['gems']}*\n💌 Chat Messages: *{user.get('bonus_gems', 0)}*\n\n💡 Open the Mini App for more details."
    await message.answer(text, parse_mode="Markdown")


@router.message(Command("shop", "tienda", "store"))
@router.message(F.text.in_({"🛒 Tienda", "🛒 Shop"}))
async def cmd_shop(message: Message):
    await update_last_active(message.from_user.id)

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
            builder.button(text=f"Opción {i+1}", callback_data=f"buy_gem_{i}")
    else:
        text = "💎 *Gem Store*\n\nSelect a package:\n\n"
        for i, pkg in enumerate(STAR_PACKAGES):
            final_gems = calc_final_gems(pkg)
            line = f"⭐ {pkg['stars']} Stars → 💎 {final_gems} gems"
            if pkg['first_time']:
                line += " (First time!)"
            text += f"{i+1}. {line}\n"
            builder.button(text=f"Option {i+1}", callback_data=f"buy_gem_{i}")

    builder.adjust(1)
    await message.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")


@router.callback_query(F.data.startswith('buy_gem_'))
async def process_purchase(callback: CallbackQuery):
    telegram_id = callback.from_user.id
    try:
        package_index = int(callback.data.split('_')[-1])
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
    payload = message.successful_payment.invoice_payload
    charge_id = message.successful_payment.telegram_payment_charge_id

    if payload.startswith("vip_sub_"):
        parts = payload.split("_")
        if len(parts) >= 3:
            plan_id = parts[2]
            
            days = 7
            if plan_id == "monthly": days = 30
            elif plan_id == "quarterly": days = 90
            elif plan_id == "annual": days = 365
            
            try:
                current_sub = turso_query_one(
                    "SELECT expires_at FROM subscriptions WHERE telegram_id = ? AND status = 'active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1",
                    [str(telegram_id)]
                )
                
                if current_sub and current_sub.get('expires_at'):
                    current_exp = datetime.fromisoformat(str(current_sub['expires_at']).replace('Z', '+00:00'))
                    new_exp = current_exp + timedelta(days=days)
                    new_exp_str = new_exp.strftime('%Y-%m-%d %H:%M:%S')

                    turso_execute(
                        """UPDATE subscriptions 
                           SET expires_at = ?, telegram_charge_id = ?
                           WHERE telegram_id = ? AND status = 'active'""",
                        [new_exp_str, charge_id, str(telegram_id)]
                    )
                else:
                    new_exp = datetime.now(timezone.utc) + timedelta(days=days)
                    new_exp_str = new_exp.strftime('%Y-%m-%d %H:%M:%S')
                    
                    turso_execute(
                        """INSERT INTO subscriptions
                          (telegram_id, plan, stars_paid, telegram_charge_id, expires_at, status)
                         VALUES (?, ?, ?, ?, ?, 'active')""",
                        [str(telegram_id), plan_id, message.successful_payment.total_amount, charge_id, new_exp_str]
                    )
                
                user = await get_user(telegram_id)
                lang = user.get('language', 'es') if user else 'es'
                text = "✅ ¡Suscripción VIP activada! Gracias por tu apoyo." if lang == 'es' else "✅ VIP Subscription activated! Thanks for your support."
                await message.answer(text, reply_markup=get_main_keyboard(lang))
                return
            except Exception as e:
                logger.error(f"Error activando VIP por stars: {e}")
                await message.answer("⚠️ Pago recibido pero hubo un error activando VIP. Contacta a soporte.")
                return

    # ✅ NUEVO: Diferenciar entre compra de gemas y compra de mensajes
    is_messages = payload.startswith("message_purchase_")
    prefix = "message_purchase_" if is_messages else "gem_purchase_"
    
    try:
        pkg_idx = int(payload.replace(prefix, ""))
    except ValueError:
        return await message.answer("⚠️ Error al procesar la compra.")

    active_packages = MESSAGE_PACKAGES if is_messages else STAR_PACKAGES
    if pkg_idx >= len(active_packages):
        return await message.answer("⚠️ Error al procesar la compra.")

    pkg = active_packages[pkg_idx]
    amount = pkg['messages'] if is_messages else calc_final_gems(pkg)

    success = await record_star_purchase(
        telegram_id, pkg['stars'], amount,
        pkg.get('first_time', False),
        charge_id,
        is_messages
    )

    if not success:
        return await message.answer("⚠️ Esta compra ya fue procesada anteriormente.")

    user = await get_user(telegram_id)
    lang = user.get('language', 'es') if user else 'es'

    if is_messages:
        if lang == 'es':
            text = f"✅ ¡Compra exitosa! Recibiste *{amount} mensajes de chat*.\n\n🎉 ¡Ahora puedes seguir hablando con tus personajes!"
        else:
            text = f"✅ Purchase successful! You received *{amount} chat messages*.\n\n🎉 You can now keep talking with your characters!"
    else:
        if lang == 'es':
            text = f"✅ ¡Compra exitosa! Recibiste *{amount} gemas*.\n\n🎉 ¡Ahora tienes acceso a audio e imágenes!"
        else:
            text = f"✅ Purchase successful! You received *{amount} gems*.\n\n🎉 You now have access to audio and images!"
            
    await message.answer(text, parse_mode="Markdown", reply_markup=get_main_keyboard(lang))


@router.message(Command("invite", "invitar", "referral", "ref"))
@router.message(F.text.in_({"🎁 Invitar", "🎁 Invite"}))
async def cmd_invite(message: Message):
    await update_last_active(message.from_user.id)

    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Usa /start primero")

    lang = user.get('language', 'es')
    bot_info = await message.bot.get_me()

    ref_param = user.get('username') or user['referral_code']
    link = f"https://t.me/{bot_info.username}?start={ref_param}"

    paying_count = user.get('paying_referrals_count') or 0
    if paying_count >= REFERRAL_ELITE_TIER_THRESHOLD:
        current_pct = REFERRAL_ELITE_TIER_PCT
    elif paying_count >= REFERRAL_TOP_TIER_THRESHOLD:
        current_pct = REFERRAL_TOP_TIER_PCT
    else:
        current_pct = REFERRAL_PURCHASE_COMMISSION_PCT

    if lang == 'es':
        text = (
            f"🎁 *Sistema de Referidos*\n\n"
            f"🔗 Tu enlace:\n`{link}`\n\n"
            f"💌 *{REFERRAL_MESSAGES} mensajes* cuando tu amigo mande {REFERRAL_MIN_MESSAGES} mensajes.\n"
            f"💰 *{current_pct}%* de todas sus compras (permanente).\n\n"
            f"📊 Amigos que han comprado: *{paying_count}*\n"
            f"• 5+ → 7% de comisión\n"
            f"• 20+ → 10% de comisión"
        )
    else:
        text = (
            f"🎁 *Referral System*\n\n"
            f"🔗 Your link:\n`{link}`\n\n"
            f"💌 *{REFERRAL_MESSAGES} messages* when your friend sends {REFERRAL_MIN_MESSAGES} messages.\n"
            f"💰 *{current_pct}%* of all their purchases (permanent).\n\n"
            f"📊 Friends who bought: *{paying_count}*\n"
            f"• 5+ → 7% commission\n"
            f"• 20+ → 10% commission"
        )
    await message.answer(text, parse_mode="Markdown")


@router.message(Command("help", "ayuda", "start_help"))
@router.message(F.text.in_({"❓ Ayuda", "❓ Help"}))
async def cmd_help(message: Message):
    await update_last_active(message.from_user.id)

    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Usa /start primero")

    lang = user.get('language', 'es')
    if lang == 'es':
        text = (
            "📚 *Comandos*\n\n"
            "/start - Iniciar\n"
            "/balance - Ver balance\n"
            "/shop - Tienda\n"
            "/invite - Invitar amigos\n"
            "/help - Ayuda\n\n"
            "💡 Usa el botón '🎭 Abrir Mini App' para la experiencia completa."
        )
    else:
        text = (
            "📚 *Commands*\n\n"
            "/start - Start\n"
            "/balance - View balance\n"
            "/shop - Store\n"
            "/invite - Invite friends\n"
            "/help - Help\n\n"
            "💡 Use the '🎭 Open Mini App' button for the full experience."
        )
    await message.answer(text, parse_mode="Markdown")
