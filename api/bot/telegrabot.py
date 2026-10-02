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
from supabase import create_client, Client

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
MINI_APP_URL = os.getenv('MINI_APP_URL', 'https://tu-dominio.vercel.app')

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

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

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
    pending_referral_code: Optional[str] = None,
):
    referral_code = generate_referral_code()
    user_data = {
        'telegram_id': str(telegram_id),
        'username': username or None,
        'first_name': first_name or 'User',
        'language': language,
        'gems': STARTING_GEMS,
        'purchased_gems': 0,
        'referral_code': referral_code,
        'referred_by': None,
        'total_referrals': 0,
        'paying_referrals_count': 0,
        'hook_messages_remaining': 0,
        'hook_used': False,
        'age_verified': False,
        'pending_referral_code': pending_referral_code,
    }

    try:
        result = supabase.table('users').insert(user_data).execute()
    except Exception as e:
        logger.error(f"Error insertando usuario: {e}")
        return None

    return result.data[0] if result.data else None

async def add_gems(telegram_id: int, amount: int, transaction_type: str, description: str = ''):
    """✅ OPTIMIZADO: usa RPC atómico en 1 sola query (antes: SELECT + UPDATE).
    Suma gemas SOLO a 'gems' (no a purchased_gems)."""
    try:
        # 1 query atómica: UPDATE gems = gems + amount RETURNING gems
        supabase.rpc('increment_gems', {
            'p_telegram_id': str(telegram_id),
            'p_amount': amount
        }).execute()

        # Registrar transacción (1 query INSERT)
        supabase.table('gem_transactions').insert({
            'telegram_id': str(telegram_id),
            'amount': amount,
            'transaction_type': transaction_type,
            'description': description
        }).execute()

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
    """Paga comisión al referidor. Tiers por usuarios ÚNICOS:
       1-4 → 5%, 5-19 → 7%, 20+ → 10%. Comisión va SOLO a 'gems'."""
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

        existing = supabase.table('referral_commissions')\
            .select('referred_id')\
            .eq('referrer_id', str(referrer_id))\
            .execute()

        unique_buyers = set()
        for row in (existing.data or []):
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

        # ✅ OPTIMIZADO: 1 sola query atómica para el update de gemas
        rpc_result = supabase.rpc('increment_gems', {
            'p_telegram_id': str(referrer_id),
            'p_amount': commission
        }).execute()

        new_ref_gems = None
        if rpc_result.data is not None:
            new_ref_gems = rpc_result.data if isinstance(rpc_result.data, int) else None
        # Fallback por si el cliente devuelve estructura distinta
        if new_ref_gems is None:
            updated = await get_user(int(referrer_id))
            new_ref_gems = (updated.get('gems') if updated else 0)

        # Actualizar contador de referidos que compraron
        supabase.table('users').update({
            'paying_referrals_count': total_unique,
        }).eq('telegram_id', str(referrer_id)).execute()

        # Registrar transacción
        supabase.table('gem_transactions').insert({
            'telegram_id': str(referrer_id),
            'amount': commission,
            'transaction_type': 'referral_commission',
            'description': f'Comisión {pct}% por compra de referido',
        }).execute()

        # Registrar comisión
        supabase.table('referral_commissions').insert({
            'referrer_id': str(referrer_id),
            'referred_id': str(buyer_id),
            'purchase_gems': gems_purchased,
            'commission_gems': commission,
            'commission_pct': pct,
            'source': source,
            'reference': reference,
        }).execute()

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
    supabase.table('star_purchases').insert({
        'telegram_id': str(telegram_id),
        'stars_amount': stars,
        'gems_amount': gems,
        'is_first_purchase': is_first_purchase,
        'telegram_charge_id': charge_id,
        'payment_method': 'stars'
    }).execute()

    # ✅ Sumar a gems Y purchased_gems + reset hook
    user = await get_user(telegram_id)
    if user:
        supabase.table('users').update({
            'gems': (user.get('gems') or 0) + gems,
            'purchased_gems': (user.get('purchased_gems') or 0) + gems,
            'hook_messages_remaining': 0,
        }).eq('telegram_id', str(telegram_id)).execute()

        supabase.table('gem_transactions').insert({
            'telegram_id': str(telegram_id),
            'amount': gems,
            'transaction_type': 'purchase',
            'description': f'Compra con {stars} stars'
        }).execute()

    # ✅ Pagar comisión al referidor
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
    """Aplica referral pendiente. Las 10 gemas se pagan cuando el referido
    completa 3 mensajes (procesado en /api/chat)."""
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

        existing = supabase.table('referrals').select('id').eq(
            'referred_id', str(telegram_id)
        ).execute()

        if existing.data and len(existing.data) > 0:
            supabase.table('users').update({
                'pending_referral_code': None
            }).eq('telegram_id', str(telegram_id)).execute()
            return False

        supabase.table('referrals').insert({
            'referrer_id': str(referrer['telegram_id']),
            'referred_id': str(telegram_id),
            'reward_paid': False,
            'referred_message_count': 0,
        }).execute()

        supabase.table('users').update({
            'referred_by': str(referrer['telegram_id']),
            'pending_referral_code': None,
        }).eq('telegram_id', str(telegram_id)).execute()

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
                "🎁 Invita amigos y gana *10 gemas* + *5% de sus compras*.\n\n"
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
                "🎁 Invite friends and earn *10 gems* + *5% of their purchases*.\n\n"
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
            await message.answer("❌ Error al crear tu cuenta. Intenta de nuevo con /start")
            return
        await send_age_warning(message, language)
        return

    if ref_code and not user.get('age_verified'):
        try:
            supabase.table('users').update({
                'pending_referral_code': ref_code
            }).eq('telegram_id', str(telegram_id)).execute()
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
        await callback.answer("⚠️ Usa /start primero", show_alert=True)
        return

    lang = user.get('language', 'es') or 'es'

    try:
        supabase.table('users').update({
            'age_verified': True,
            'age_verified_at': datetime.now(timezone.utc).isoformat(),
        }).eq('telegram_id', str(telegram_id)).execute()
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
