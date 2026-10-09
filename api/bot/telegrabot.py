import os
import random
import string
import logging
from datetime import datetime, timezone
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
BASE_DAILY_GEMS = 3
GEMS_PER_REFERRAL = 10
STARTING_GEMS = 10

REFERRAL_PURCHASE_COMMISSION_PCT = 5
REFERRAL_TOP_TIER_THRESHOLD = 5
REFERRAL_TOP_TIER_PCT = 7
REFERRAL_ELITE_TIER_THRESHOLD = 20
REFERRAL_ELITE_TIER_PCT = 10

STAR_PACKAGES = [
    {"stars": 100,  "gems": 300,  "bonus": 5, "first_time": True,  "flat_bonus": 50},
    {"stars": 150,  "gems": 600,  "bonus": 5, "first_time": False, "flat_bonus": 0},
    {"stars": 300,  "gems": 1200, "bonus": 5, "first_time": False, "flat_bonus": 0},
    {"stars": 500,  "gems": 2400, "bonus": 5, "first_time": False, "flat_bonus": 0},
    {"stars": 1000, "gems": 5000, "bonus": 5, "first_time": False, "flat_bonus": 0},
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
    # SQLite no tiene ILIKE; usamos LOWER(col) = LOWER(?)
    return turso_query_one(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [clean]
    )


async def create_user_immediately(
    telegram_id: int,
    username: str,
    first_name: str,
    language: str,
    pending_referral_code: Optional[str] = None,
):
    """Crea el usuario. Maneja duplicados (fix race con Mini App)."""
    referral_code = generate_referral_code()

    try:
        turso_execute(
            """INSERT INTO users
              (telegram_id, username, first_name, language, gems, purchased_gems,
               referral_code, referred_by, total_referrals, paying_referrals_count,
               hook_messages_remaining, hook_used, age_verified, pending_referral_code)
             VALUES (?, ?, ?, ?, ?, 0, ?, NULL, 0, 0, 0, 0, 0, ?)""",
            [
                str(telegram_id),
                username or None,
                first_name or 'User',
                language,
                STARTING_GEMS,
                referral_code,
                pending_referral_code,
            ]
        )
        return await get_user(telegram_id)
    except Exception as e:
        err_str = str(e)
        logger.error(f"Error insertando usuario: {err_str}")

        # UNIQUE constraint → ya existe, recuperar
        if 'UNIQUE' in err_str or 'unique' in err_str.lower() or 'constraint' in err_str.lower():
            logger.info(f"Usuario {telegram_id} ya existe, recuperando...")
            return await get_user(telegram_id)
        return None


async def add_gems(telegram_id: int, amount: int, transaction_type: str, description: str = ''):
    """Suma gemas SOLO a 'gems' (no a purchased_gems)."""
    try:
        row = turso_query_one(
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
    """Paga comisión al referidor. Tiers: 1-4→5%, 5-19→7%, 20+→10%."""
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

        # Contar compradores únicos del referidor
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

        # Pagar comisión (solo a gems)
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

        # Actualizar contador de referidos que compraron
        turso_execute(
            "UPDATE users SET paying_referrals_count = ?, updated_at = ? WHERE telegram_id = ?",
            [total_unique, now_iso, str(referrer_id)]
        )

        # Registrar transacción
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

        # Registrar comisión
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

        # Notificar al referidor
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

async def record_star_purchase(telegram_id: int, stars: int, gems: int, is_first_purchase: bool, charge_id: str):
    """Acredita la compra. Suma a gems Y purchased_gems atómicamente."""
    try:
        turso_execute(
            """INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method)
             VALUES (?, ?, ?, ?, ?, 'stars')""",
            [str(telegram_id), stars, gems, 1 if is_first_purchase else 0, charge_id]
        )
    except Exception as e:
        err_str = str(e)
        # Anti doble-acreditación: charge_id ya existe
        if 'UNIQUE' in err_str or 'unique' in err_str.lower() or 'constraint' in err_str.lower():
            logger.warning(f"⚠️ Charge {charge_id} ya procesado, ignorando")
            return
        logger.error(f"Error insertando star_purchase: {err_str}")
        return

    # ✅ Atómico: sumar a gems + purchased_gems + reset hook
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        turso_query_one(
            """UPDATE users
             SET gems = COALESCE(gems, 0) + ?,
                 purchased_gems = COALESCE(purchased_gems, 0) + ?,
                 hook_messages_remaining = 0,
                 updated_at = ?
             WHERE telegram_id = ?
             RETURNING gems, purchased_gems""",
            [gems, gems, now_iso, str(telegram_id)]
        )
    except Exception as e:
        logger.error(f"Error incrementando gemas post-compra: {e}")

    turso_execute(
        """INSERT INTO gem_transactions
          (telegram_id, amount, transaction_type, description)
         VALUES (?, ?, ?, ?)""",
        [str(telegram_id), gems, 'purchase', f'Compra con {stars} stars']
    )

    await pay_referral_commission(telegram_id, gems, 'stars', charge_id)


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
                    f"💎 Recibirás *{GEMS_PER_REFERRAL} gemas* cuando mande 3 mensajes.\n"
                    f"💰 Y *{REFERRAL_PURCHASE_COMMISSION_PCT}%* de todo lo que compre."
                )
            else:
                text = (
                    f"🎉 *Someone used your code!*\n\n"
                    f"💎 You'll receive *{GEMS_PER_REFERRAL} gems* once they send 3 messages.\n"
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
                f"🎁 Invita amigos y gana *{GEMS_PER_REFERRAL} gemas* + *5% de sus compras*.\n\n"
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
                f"🎁 Invite friends and earn *{GEMS_PER_REFERRAL} gems* + *5% of their purchases*.\n\n"
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

    ref_code: Optional[str] = None
    if command and command.args:
        arg = command.args.strip()
        if arg:
            ref_code = arg

    user = await get_user(telegram_id)

    if not user:
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

        if not user.get('age_verified'):
            await send_age_warning(message, language)
            return

        await send_mini_app_message(message, language, is_new_user=True)
        return

    # Usuario existente
    if ref_code and not user.get('age_verified'):
        try:
            turso_execute(
                "UPDATE users SET pending_referral_code = ? WHERE telegram_id = ?",
                [ref_code, str(telegram_id)]
            )
            user['pending_referral_code'] = ref_code
        except Exception as e:
            logger.error(f"Error updating pending_referral: {e}")

    if not user.get('age_verified'):
        await send_age_warning(message, user.get('language', language) or language)
        return

    lang = user.get('language', language) or language
    await send_mini_app_message(message, lang, is_new_user=False)


@router.callback_query(F.data == "age_confirm")
async def on_age_confirm(callback: CallbackQuery):
    telegram_id = callback.from_user.id
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
    await send_mini_app_message(callback.message, lang, is_new_user=True)


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


@router.message(Command("balance", "saldo", "gems"))
@router.message(F.text.in_({"💎 Balance", "💎 Saldo"}))
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


@router.message(Command("shop", "tienda", "store"))
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


@router.message(Command("invite", "invitar", "referral", "ref"))
@router.message(F.text.in_({"🎁 Invitar", "🎁 Invite"}))
async def cmd_invite(message: Message):
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
            f"💎 *{GEMS_PER_REFERRAL} gemas* cuando tu amigo mande 3 mensajes.\n"
            f"💰 *{current_pct}%* de todas sus compras (permanente).\n\n"
            f"📊 Amigos que han comprado: *{paying_count}*\n"
            f"• 5+ → 7% de comisión\n"
            f"• 20+ → 10% de comisión"
        )
    else:
        text = (
            f"🎁 *Referral System*\n\n"
            f"🔗 Your link:\n`{link}`\n\n"
            f"💎 *{GEMS_PER_REFERRAL} gems* when your friend sends 3 messages.\n"
            f"💰 *{current_pct}%* of all their purchases (permanent).\n\n"
            f"📊 Friends who bought: *{paying_count}*\n"
            f"• 5+ → 7% commission\n"
            f"• 20+ → 10% commission"
        )
    await message.answer(text, parse_mode="Markdown")


@router.message(Command("help", "ayuda", "start_help"))
@router.message(F.text.in_({"❓ Ayuda", "❓ Help"}))
async def cmd_help(message: Message):
    user = await get_user(message.from_user.id)
    if not user:
        return await message.answer("⚠️ Usa /start primero")

    lang = user.get('language', 'es')
    if lang == 'es':
        text = (
            "📚 *Comandos*\n\n"
            "/start - Iniciar\n"
            "/balance - Ver gemas\n"
            "/shop - Tienda\n"
            "/invite - Invitar amigos\n"
            "/help - Ayuda\n\n"
            "💡 Usa el botón '🎭 Abrir Mini App' para la experiencia completa."
        )
    else:
        text = (
            "📚 *Commands*\n\n"
            "/start - Start\n"
            "/balance - View gems\n"
            "/shop - Store\n"
            "/invite - Invite friends\n"
            "/help - Help\n\n"
            "💡 Use the '🎭 Open Mini App' button for the full experience."
        )
    await message.answer(text, parse_mode="Markdown")
