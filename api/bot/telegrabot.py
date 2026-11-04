import os
import random
import string
import logging
import asyncio
import time
import httpx
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
from aiogram.exceptions import (
    TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter,
    TelegramServerError, TelegramNetworkError,
)

from turso_client import turso_query, turso_query_one, turso_execute

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
MINI_APP_URL = os.getenv('MINI_APP_URL', 'https://tu-dominio.vercel.app')

if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("❌ Falta TELEGRAM_BOT_TOKEN")

# ==================== ECONOMÍA ====================
STARTING_GEMS = 10
DAILY_MESSAGES = 3
REFERRAL_MESSAGES = 15
REFERRAL_MIN_MESSAGES = 10

REFERRAL_PURCHASE_COMMISSION_PCT = 5
REFERRAL_TOP_TIER_THRESHOLD = 5
REFERRAL_TOP_TIER_PCT = 7
REFERRAL_ELITE_TIER_THRESHOLD = 20
REFERRAL_ELITE_TIER_PCT = 10

STAR_PACKAGES = [
    {"stars": 100,  "gems": 200,  "bonus": 100, "first_time": True,  "flat_bonus": 0},
    {"stars": 150,  "gems": 300,  "bonus": 5,   "first_time": False, "flat_bonus": 0},
    {"stars": 300,  "gems": 600,  "bonus": 5,   "first_time": False, "flat_bonus": 0},
    {"stars": 500,  "gems": 1000, "bonus": 5,   "first_time": False, "flat_bonus": 0},
    {"stars": 1000, "gems": 2000, "bonus": 5,   "first_time": False, "flat_bonus": 0},
]

MESSAGE_PACKAGES = [
    {"stars": 100,  "messages": 315,  "first_time": False},   # 300 base + 5% = 315
    {"stars": 250,  "messages": 840,  "first_time": False},   # 800 base + 5% = 840
    {"stars": 500,  "messages": 2100, "first_time": False},   # 2000 base + 5% = 2100
]

HYBRID_PACKAGES = [
    {"stars": 200,  "gems": 155,  "messages": 315,  "first_time": False},
    {"stars": 350,  "gems": 315,  "messages": 630,  "first_time": False},
    {"stars": 650,  "gems": 630,  "messages": 1260, "first_time": False},
]

VIP_PLAN_DAYS = {
    "weekly": 7,
    "monthly": 30,
    "quarterly": 90,
    "annual": 365,
}


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


async def has_prior_purchase(telegram_id: int) -> bool:
    """Verifica compras previas Y suscripciones VIP."""
    try:
        row = turso_query_one(
            """SELECT id FROM star_purchases WHERE telegram_id = ? LIMIT 1
               UNION
               SELECT id FROM subscriptions WHERE telegram_id = ? LIMIT 1
               LIMIT 1""",
            [str(telegram_id), str(telegram_id)]
        )
        return row is not None
    except Exception as e:
        logger.warning(f"has_prior_purchase failed for {telegram_id}: {e}")
        return False


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


# add_gems se retiro (R4): acreditaba gemas en dos escrituras independientes
# (saldo + asiento) y no tenia llamadores. Toda acreditacion pasa por el
# procesador transaccional.


# ==================== REFERRAL COMMISSION ====================
# pay_referral_commission se retiro (R4): pagaba la comision con cuatro
# escrituras HTTP independientes (saldo, contador, asiento y comision) y no
# tenia llamadores. La comision la acredita ahora applyGemPurchaseAtomic en una
# unica transaccion; la notificacion usa _notify_referral_commission.


# ==================== PURCHASE HELPERS ====================

class StarPurchaseTransientError(RuntimeError):
    """Fallo recuperable al aplicar un pago de Stars.

    El procesador no registra nada si falla, así que el cargo NO queda
    consumido y un reintento posterior puede acreditarlo.
    """


GEM_PROCESSOR_TIMEOUT = 20.0
GEM_PROCESSOR_ATTEMPTS = 3


async def _call_gem_processor(payment_facts: dict) -> dict:
    """Llama al procesador interno (TypeScript) que aplica el pago de forma atómica.

    Autenticación entre servicios con GEM_PROCESSOR_SECRET. Solo se envían
    hechos del pago: el procesador deriva paquete, gemas y mensajes del
    catálogo y jamás acepta importes del llamador.
    """
    secret = os.getenv('GEM_PROCESSOR_SECRET', '').strip()
    if not secret:
        # Sin secreto no hay acreditación posible: nunca se cae a escrituras
        # directas ni se confirma la compra al usuario.
        raise StarPurchaseTransientError('GEM_PROCESSOR_SECRET no configurado')

    url = f"{MINI_APP_URL.rstrip('/')}/api/bot/gem-payments"
    headers = {
        'Authorization': f'Bearer {secret}',
        'Content-Type': 'application/json',
    }

    last_error: Optional[Exception] = None

    for attempt in range(1, GEM_PROCESSOR_ATTEMPTS + 1):
        try:
            # AsyncClient: no bloquea el event loop del bot.
            async with httpx.AsyncClient(timeout=GEM_PROCESSOR_TIMEOUT) as client:
                response = await client.post(url, headers=headers, json=payment_facts)
        except Exception as e:  # red, DNS, timeout
            last_error = e
            logger.warning(f'[stars] procesador inaccesible (intento {attempt}): {e}')
            await asyncio.sleep(0.5 * attempt)
            continue

        if response.status_code == 200:
            try:
                return response.json()
            except Exception as e:
                last_error = e
                logger.warning(f'[stars] respuesta no-JSON (intento {attempt}): {e}')
                await asyncio.sleep(0.5 * attempt)
                continue

        if response.status_code == 409:
            # El cargo existe pero no se puede probar su acreditación: requiere
            # conciliación. NO es un rechazo: se conserva como conflicto.
            reason = ''
            try:
                reason = str((response.json() or {}).get('reason') or '')
            except Exception:
                reason = ''
            logger.error(f'[stars] cargo en conflicto (HTTP 409): {reason}')
            return {'status': 'conflict', 'reason': reason, 'http_status': 409}

        if response.status_code in (400, 401, 404):
            # Rechazo definitivo: no se reintenta y nunca se confirma.
            return {'status': 'rejected', 'http_status': response.status_code}

        last_error = RuntimeError(f'HTTP {response.status_code}')
        logger.warning(f'[stars] procesador HTTP {response.status_code} (intento {attempt})')
        await asyncio.sleep(0.5 * attempt)

    raise StarPurchaseTransientError(f'procesador no disponible: {last_error}')


# _pay_purchase_commission se retiro (R4): calculaba la base con los importes
# del procesador y delegaba en pay_referral_commission. Ambos quedaron sin
# llamadores cuando la comision paso a applyGemPurchaseAtomic (transaccional).


# ==================== REFERRAL NOTIFICATION (Stars) ====================
# Python NO mueve dinero: solo lee referral_commissions/users y escribe en
# referral_commission_notifications. La comisión la acredita TypeScript.
#
# Taxonomía de last_error (no cambia el esquema de 006):
#   rejected_permanent  → Telegram rechazó definitivamente. No se entregó.
#   attempts_exhausted  → 5 intentos sin rechazo definitivo. Entrega DESCONOCIDA.
#   unknown_delivery    → red/timeout/400 no reconocido. Entrega INCIERTA.
#   db_error            → fallo de preparación; nada se envió.
#   referrer_missing    → el referidor ya no existe; nada se envió.
# IMPORTANTE: status='failed' NO prueba que Telegram no entregara el mensaje;
# significa "sin más intentos automáticos" y requiere revisión manual.

NOTIFICATION_LEASE_MINUTES = 15
NOTIFICATION_MAX_ATTEMPTS = 5
NOTIFICATION_UNKNOWN_DELAY_SECONDS = 900  # 15 min para entrega incierta

_PERMANENT_BAD_REQUEST = (
    'chat not found',
    'user not found',
    'bot was blocked',
    'peer_id_invalid',
    'chat_id is empty',
    'message is too long',
    "can't parse entities",
    'unsupported parse_mode',
)


def _iso_ms(dt: datetime) -> str:
    """ISO-8601 UTC con milisegundos (mismo formato que strftime('%f') de SQLite)."""
    return dt.strftime('%Y-%m-%dT%H:%M:%S.') + f'{dt.microsecond // 1000:03d}Z'


def _backoff_seconds(attempts: int) -> int:
    return min(2 ** max(attempts, 1), 16) * 60


def _notification_state() -> Optional[dict]:
    return turso_query_one(
        "SELECT enabled, min_commission_id FROM referral_notification_state WHERE id = 1"
    )


def _star_commission(buyer_id: int, charge_id: str) -> Optional[dict]:
    return turso_query_one(
        """SELECT id, referrer_id, referred_id, reference, purchase_gems,
                  commission_gems, commission_pct
             FROM referral_commissions
            WHERE referred_id = ? AND reference = ? AND source = 'stars'
            LIMIT 1""",
        [str(buyer_id), str(charge_id)],
    )


def _claim_notification(notification_id: int, now: str) -> Optional[str]:
    """Claim atómico: verifica enabled=1, source='stars', corte y attempt_count."""
    token = os.urandom(16).hex()
    lease = _iso_ms(datetime.now(timezone.utc) + timedelta(minutes=NOTIFICATION_LEASE_MINUTES))
    res = turso_execute(
        """UPDATE referral_commission_notifications
              SET status = 'sending', claim_token = ?, lease_until = ?,
                  attempt_count = attempt_count + 1, updated_at = ?
            WHERE id = ?
              AND attempt_count < ?
              AND EXISTS (
                    SELECT 1
                      FROM referral_notification_state s
                      JOIN referral_commissions c
                        ON c.id = referral_commission_notifications.referral_commission_id
                     WHERE s.id = 1
                       AND s.enabled = 1
                       AND c.source = 'stars'
                       AND c.id > s.min_commission_id
              )
              AND (
                   (status = 'pending'
                    AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
                   OR
                   (status = 'sending'
                    AND lease_until IS NOT NULL AND lease_until <= ?)
              )""",
        [token, lease, now, notification_id, NOTIFICATION_MAX_ATTEMPTS, now, now],
    )
    return token if int(res.get('affected_row_count') or 0) == 1 else None


def _finish_notification(notification_id: int, token: str, status: str,
                         error: Optional[str] = None,
                         next_attempt_at: Optional[str] = None) -> int:
    """Devuelve affected_row_count. 0 ⇒ el token ya no es nuestro (claim_lost)."""
    now = _iso_ms(datetime.now(timezone.utc))
    if status == 'sent':
        res = turso_execute(
            """UPDATE referral_commission_notifications
                  SET status = 'sent', sent_at = ?, updated_at = ?,
                      claim_token = NULL, lease_until = NULL, last_error = NULL
                WHERE id = ? AND claim_token = ? AND status = 'sending'""",
            [now, now, notification_id, token],
        )
        return int(res.get('affected_row_count') or 0)
    res = turso_execute(
        """UPDATE referral_commission_notifications
              SET status = ?, claim_token = NULL, lease_until = NULL,
                  next_attempt_at = ?, last_error = ?, updated_at = ?
            WHERE id = ? AND claim_token = ? AND status = 'sending'""",
        [status, next_attempt_at, error, now, notification_id, token],
    )
    return int(res.get('affected_row_count') or 0)


def _exhaust_notification(notification_id: int) -> int:
    """Punto de entrada de 4b-3 para filas agotadas: marca 'failed' SIN reenviar.

    Solo actúa sobre 'pending' o 'sending' con lease vencido: nunca roba un envío vivo.
    """
    now = _iso_ms(datetime.now(timezone.utc))
    res = turso_execute(
        """UPDATE referral_commission_notifications
              SET status = 'failed', claim_token = NULL, lease_until = NULL,
                  last_error = 'attempts_exhausted', updated_at = ?
            WHERE id = ?
              AND attempt_count >= ?
              AND (
                   status = 'pending'
                   OR (status = 'sending'
                       AND lease_until IS NOT NULL AND lease_until <= ?)
              )""",
        [now, notification_id, NOTIFICATION_MAX_ATTEMPTS, now],
    )
    return int(res.get('affected_row_count') or 0)


def _release_preparation_claim(notification_id: int, token: str, attempts: int) -> None:
    """Libera un claim cuando la preparación falló (nada se envió).

    Si ya se consumió el último intento, marca 'failed' (sin sexto envío).
    """
    try:
        if attempts >= NOTIFICATION_MAX_ATTEMPTS:
            if _finish_notification(notification_id, token, 'failed',
                                    'attempts_exhausted') == 0:
                logger.error(f'[notify] claim_lost al marcar failed id={notification_id}')
            return
        nxt = _iso_ms(datetime.now(timezone.utc)
                      + timedelta(seconds=_backoff_seconds(attempts)))
        if _finish_notification(notification_id, token, 'pending', 'db_error', nxt) == 0:
            logger.error(f'[notify] claim_lost en preparación id={notification_id}')
    except Exception:
        logger.error(f'[notify] no se pudo liberar el claim id={notification_id}')


def _classify_telegram_error(exc: Exception):
    """Devuelve (clase, código, retry_after_segundos). Sin datos sensibles."""
    if isinstance(exc, TelegramRetryAfter):
        return 'transient', 'retry_after', int(getattr(exc, 'retry_after', 1) or 1)
    if isinstance(exc, TelegramForbiddenError):
        return 'permanent', 'forbidden', None
    if isinstance(exc, TelegramBadRequest):
        text = str(getattr(exc, 'message', '') or exc).lower()
        for marker in _PERMANENT_BAD_REQUEST:
            if marker in text:
                return 'permanent', 'bad_request_permanent', None
        return 'unknown', 'bad_request_unknown', None
    if isinstance(exc, TelegramServerError):
        return 'transient', 'server_error', None
    if isinstance(exc, TelegramNetworkError):
        return 'unknown', 'unknown_delivery', None
    return 'unknown', 'unknown_delivery', None


def _build_notification_text(commission: dict, referrer: dict) -> str:
    pct = int(commission['commission_pct'] or 0)
    gems = int(commission['commission_gems'] or 0)
    purchased = int(commission['purchase_gems'] or 0)
    total = int(referrer.get('gems') or 0)
    if referrer.get('language', 'es') == 'es':
        return (f"🎉 *¡Tu referido compró gemas!*\n\n"
                f"💎 Compra: *{purchased}* gemas\n"
                f"💰 Comisión ({pct}%): *+{gems}* gemas\n\n"
                f"💎 Tus gemas totales: *{total}*")
    return (f"🎉 *Your referral bought gems!*\n\n"
            f"💎 Purchase: *{purchased}* gems\n"
            f"💰 Commission ({pct}%): *+{gems}* gems\n\n"
            f"💎 Your total gems: *{total}*")


async def _notify_referral_commission(result: dict, buyer_id: int,
                                      charge_id: str, bot: Optional[Bot] = None) -> None:
    """Notifica al referidor una comisión YA acreditada. Nunca lanza.

    Fases: A preparación (nada enviado) · B envío · C confirmación (estado incierto).
    """
    try:
        if bot is None:
            return
        if result.get('commission_pending'):
            return
        if not result.get('commission_applied'):
            return

        state = _notification_state()
        if not state or int(state.get('enabled') or 0) != 1:
            return

        commission = _star_commission(buyer_id, charge_id)
        if not commission:
            return
        if int(commission['id']) <= int(state.get('min_commission_id') or 0):
            return

        now = _iso_ms(datetime.now(timezone.utc))
        turso_execute(
            """INSERT OR IGNORE INTO referral_commission_notifications
                 (referral_commission_id, referrer_id, referred_id, reference,
                  status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'pending', ?, ?)""",
            [commission['id'], str(commission['referrer_id']),
             str(commission['referred_id']), str(commission['reference']), now, now],
        )

        row = turso_query_one(
            """SELECT id, status, attempt_count
                 FROM referral_commission_notifications
                WHERE referral_commission_id = ?""",
            [commission['id']],
        )
        if not row:
            return
        if row['status'] in ('sent', 'failed'):
            return
        if int(row['attempt_count'] or 0) >= NOTIFICATION_MAX_ATTEMPTS:
            _exhaust_notification(int(row['id']))
            return

        token = _claim_notification(int(row['id']), now)
        if not token:
            return

        notification_id = int(row['id'])

        # attempt_count REAL tras el claim: nunca el de la lectura previa.
        try:
            claimed = turso_query_one(
                """SELECT attempt_count FROM referral_commission_notifications
                    WHERE id = ? AND claim_token = ?""",
                [notification_id, token],
            )
        except Exception as e:
            # No conocemos el intento real: NO se libera el claim, NO se devuelve
            # a 'pending' y NO se envía nada. La fila queda 'sending' con su
            # claim_token y lease_until hasta que venza el lease (recuperación 4b-3).
            logger.error(f'[notify] error leyendo attempt_count id={notification_id}: '
                         f'{type(e).__name__}')
            return

        if not claimed:
            logger.error(f'[notify] claim_lost tras reclamar id={notification_id}')
            return

        attempts = int(claimed['attempt_count'] or 0)


        # FASE A: preparación (post-claim, pre-envío).
        # A1. Lectura del referidor (solo lectura).
        try:
            referrer = turso_query_one(
                "SELECT gems, language FROM users WHERE telegram_id = ? LIMIT 1",
                [str(commission['referrer_id'])],
            )
        except Exception as e:
            _release_preparation_claim(notification_id, token, attempts)
            logger.error(f'[notify] error de preparación id={notification_id}: '
                         f'{type(e).__name__}')
            return

        # A2. Referidor inexistente: clasificación PROPIA, fuera del except de
        # preparación. Un fallo al registrar 'failed' no se reclasifica.
        if not referrer:
            try:
                if _finish_notification(notification_id, token, 'failed',
                                        'referrer_missing') == 0:
                    logger.error(f'[notify] claim_lost al marcar referrer_missing '
                                 f'id={notification_id}')
            except Exception:
                logger.error(f'[notify] no se pudo registrar referrer_missing '
                             f'id={notification_id}')
            return

        # A3. Construcción del texto (si falla, es preparación).
        try:
            text = _build_notification_text(commission, referrer)
        except Exception as e:
            _release_preparation_claim(notification_id, token, attempts)
            logger.error(f'[notify] error de preparación id={notification_id}: '
                         f'{type(e).__name__}')
            return

        # FASE B: envío.
        try:
            await bot.send_message(chat_id=int(commission['referrer_id']),
                                   text=text, parse_mode="Markdown")
        except Exception as exc:
            kind, code, retry_after = _classify_telegram_error(exc)
            if kind == 'permanent':
                next_status, final_code, delay = 'failed', 'rejected_permanent', None
            elif attempts >= NOTIFICATION_MAX_ATTEMPTS:
                next_status, final_code, delay = 'failed', 'attempts_exhausted', None
            else:
                next_status, final_code = 'pending', code
                if retry_after:
                    delay = retry_after
                elif kind == 'unknown':
                    delay = NOTIFICATION_UNKNOWN_DELAY_SECONDS
                else:
                    delay = _backoff_seconds(attempts)
            nxt = (_iso_ms(datetime.now(timezone.utc) + timedelta(seconds=delay))
                   if delay else None)
            try:
                if _finish_notification(notification_id, token, next_status,
                                        final_code, nxt) == 0:
                    logger.error(f'[notify] claim_lost al registrar fallo id={notification_id}')
            except Exception:
                logger.error(f'[notify] no se pudo registrar el fallo id={notification_id}')
            logger.error(f'[notify] entrega no confirmada id={notification_id} code={code}')
            return

        # FASE C: confirmación (Telegram YA aceptó).
        # Si falla, el estado es INCIERTO: no se libera ni se devuelve a pending.
        try:
            confirmed = _finish_notification(notification_id, token, 'sent')
        except Exception as e:
            logger.error(f'[notify] confirmación fallida id={notification_id} '
                         f'code=confirm_error type={type(e).__name__}')
            return
        if confirmed == 0:
            logger.error(f'[notify] claim_lost al confirmar id={notification_id}')
        return

    except Exception as e:
        # Nunca altera el resultado de la compra.
        logger.error(f'[notify] error no controlado: {type(e).__name__}')


# ==================== REFERRAL NOTIFICATION SWEEP (4b-3) ====================
# Una sola pasada acotada por invocacion, disparada por el cron diario.
# No crea tareas en segundo plano ni bucles infinitos.
#
# LIMITE DE DURACION (importante): turso_client usa httpx SINCRONO dentro de
# funciones async. Una consulta de BD bloqueada NO puede ser interrumpida por
# asyncio.wait_for ni por el deadline: ambos solo deciden si se INICIA un nuevo
# elemento. La duracion real la acota el timeout HTTP de turso_client (30 s por
# llamada) y el maxDuration de la plataforma. La proteccion frente a un corte es
# la IDEMPOTENCIA: la fila queda 'pending'/'sending' y la siguiente pasada la
# recupera. SWEEP_ITEM_TIMEOUT solo puede cancelar la llamada async a Telegram.

SWEEP_LIMIT = 20
SWEEP_BUDGET_SECONDS = 25.0
SWEEP_ITEM_TIMEOUT = 10

_sweep_lock = asyncio.Lock()

SWEEP_STATE_SQL = (
    "SELECT enabled, min_commission_id, activated_at "
    "FROM referral_notification_state WHERE id = 1"
)

SWEEP_DISCOVERY_SQL = """INSERT OR IGNORE INTO referral_commission_notifications
    (referral_commission_id, referrer_id, referred_id, reference,
     status, created_at, updated_at)
SELECT c.id, c.referrer_id, c.referred_id, c.reference, 'pending', ?, ?
  FROM referral_commissions c
 WHERE c.source = 'stars'
   AND EXISTS (
        SELECT 1 FROM referral_notification_state s
         WHERE s.id = 1
           AND s.enabled = 1
           AND s.activated_at IS NOT NULL
           AND c.id > s.min_commission_id
   )
   AND NOT EXISTS (
        SELECT 1 FROM referral_commission_notifications n
         WHERE n.referral_commission_id = c.id
   )
 LIMIT ?"""

SWEEP_CANDIDATES_SQL = """SELECT n.id AS notification_id,
       n.referral_commission_id AS commission_id,
       n.status, n.attempt_count,
       c.referred_id, c.reference
  FROM referral_commission_notifications n
  JOIN referral_commissions c ON c.id = n.referral_commission_id
 WHERE c.source = 'stars'
   AND EXISTS (
        SELECT 1 FROM referral_notification_state s
         WHERE s.id = 1
           AND s.enabled = 1
           AND s.activated_at IS NOT NULL
           AND c.id > s.min_commission_id
   )
   AND (
        (n.status = 'pending'
         AND (n.next_attempt_at IS NULL OR n.next_attempt_at <= ?))
        OR
        (n.status = 'sending'
         AND n.lease_until IS NOT NULL AND n.lease_until <= ?)
   )
 ORDER BY n.id
 LIMIT ?"""


async def sweep_referral_notifications(bot, limit: int = SWEEP_LIMIT) -> dict:
    """Una pasada acotada del barrido de notificaciones. Nunca lanza.

    Reutiliza _notify_referral_commission: no duplica claim, envio ni confirmacion.
    `limit` solo admite 1..SWEEP_LIMIT (nunca negativos, cero ni ampliaciones).
    """
    summary = {'processed': 0, 'sent': 0, 'failed': 0, 'skipped': 0,
               'truncated': False, 'error': None, 'skipped_reason': None}

    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > SWEEP_LIMIT:
        summary['error'] = 'invalid_limit'
        logger.error('[sweep] limite invalido rechazado')
        return summary

    if _sweep_lock.locked():
        summary['skipped_reason'] = 'in_progress'
        return summary

    async with _sweep_lock:
        # El presupuesto arranca ANTES de cualquier consulta.
        deadline = time.monotonic() + SWEEP_BUDGET_SECONDS

        try:
            state = turso_query_one(SWEEP_STATE_SQL)
        except Exception as e:
            summary['error'] = 'lookup_failed'
            logger.error(f'[sweep] estado ilegible: {type(e).__name__}')
            return summary

        if (not state or int(state.get('enabled') or 0) != 1
                or not state.get('activated_at')):
            summary['skipped_reason'] = 'disabled'
            return summary

        now = _iso_ms(datetime.now(timezone.utc))
        try:
            turso_execute(SWEEP_DISCOVERY_SQL, [now, now, limit])
            rows = turso_query(SWEEP_CANDIDATES_SQL, [now, now, limit])
        except Exception as e:
            summary['error'] = 'lookup_failed'
            logger.error(f'[sweep] consulta global fallida: {type(e).__name__}')
            return summary

        for row in rows:
            if time.monotonic() >= deadline:
                summary['truncated'] = True
                break
            summary['processed'] += 1
            notification_id = int(row['notification_id'])
            try:
                await asyncio.wait_for(
                    _notify_referral_commission(
                        {'commission_applied': True},
                        int(row['referred_id']),
                        str(row['reference']),
                        bot,
                    ),
                    timeout=SWEEP_ITEM_TIMEOUT,
                )
            except Exception as e:
                summary['failed'] += 1
                logger.error(f'[sweep] fallo id={notification_id}: {type(e).__name__}')
                continue
            try:
                after = turso_query_one(
                    "SELECT status FROM referral_commission_notifications WHERE id = ?",
                    [notification_id],
                )
            except Exception:
                after = None
            status = str((after or {}).get('status') or '')
            if status == 'sent':
                summary['sent'] += 1
            elif status == 'failed':
                summary['failed'] += 1
            else:
                summary['skipped'] += 1
        return summary


async def record_star_purchase(
    telegram_id: int,
    stars: int,
    gems_amount: int,
    messages_amount: int,
    is_first_purchase: bool,
    charge_id: str,
    purchase_type: str = 'gems',
    bot: Optional[Bot] = None,
    invoice_payload: str = '',
) -> str:
    """Aplica el pago de Stars mediante el procesador transaccional interno.

    Devuelve 'applied' | 'duplicate' | 'conflict' | 'rejected' | 'review_required'.
    Lanza StarPurchaseTransientError si no se pudo confirmar.

    Este bot ya no escribe saldos, asientos ni estado de la compra: el
    procesador los confirma en una única transacción (H-3). `gems_amount`,
    `messages_amount` y `purchase_type` se conservan solo por compatibilidad de
    firma; la comisión la calcula y acredita el procesador.
    """
    if not invoice_payload:
        raise StarPurchaseTransientError(
            f'payload de factura ausente para el cargo {charge_id}'
        )

    result = await _call_gem_processor({
        'provider': 'stars',
        'telegram_id': str(telegram_id),
        'telegram_charge_id': charge_id,
        'invoice_payload': invoice_payload,
        'currency': 'XTR',
        'total_amount': stars,
    })

    status = str(result.get('status') or '')

    if status == 'applied':
        # La compra ya está aplicada. La comisión se acredita DENTRO de la
        # transacción del procesador (applyGemPurchaseAtomic): Python no vuelve
        # a mover gemas ni a insertar comisiones. La notificación al referidor
        # se trata aparte (Parche 4b).
        await _notify_referral_commission(result, telegram_id, charge_id, bot)
        return 'applied'

    if status == 'duplicate':
        return 'duplicate'

    if status == 'conflict':
        logger.error(
            f'[stars] cargo {charge_id} requiere conciliación: {result.get("reason")}'
        )
        return 'conflict'

    if status == 'rejected':
        logger.error(
            f'[stars] cargo {charge_id} rechazado (HTTP {result.get("http_status")})'
        )
        return 'rejected'

    if status == 'review_required':
        # Pago verificado pero no acreditable automáticamente (p. ej. referidor
        # inexistente). No es transitorio: reintentar no cambia el resultado.
        logger.error(
            f'[stars] cargo {charge_id} requiere revisión: {result.get("reason")}'
        )
        return 'review_required'

    raise StarPurchaseTransientError(
        f'respuesta inesperada del procesador: {status or result}'
    )


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

async def apply_pending_referral(telegram_id: int, ref_code: str, bot: Optional[Bot] = None) -> bool:
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

        if bot is not None:
            try:
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
            bonus = user.get('bonus_gems', 0) if user else 0
            text = (
                f"👋 *¡Hola de nuevo!*\n\n"
                f"💎 Gemas de Pago: *{gems}*\n"
                f"💌 Mensajes de Chat: *{bonus}*\n\n"
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
            bonus = user.get('bonus_gems', 0) if user else 0
            text = (
                f"👋 *Welcome back!*\n\n"
                f"💎 Paid Gems: *{gems}*\n"
                f"💌 Chat Messages: *{bonus}*\n\n"
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
        await apply_pending_referral(telegram_id, pending_ref, bot=callback.bot)

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
    telegram_id = message.from_user.id

    prior_purchase = await has_prior_purchase(telegram_id)

    builder = InlineKeyboardBuilder()

    if language == 'es':
        text = "💎 *Tienda de Gemas*\n\nSelecciona un paquete:\n\n"
    else:
        text = "💎 *Gem Store*\n\nSelect a package:\n\n"

    for i, pkg in enumerate(STAR_PACKAGES):
        if pkg['first_time'] and prior_purchase:
            continue

        final_gems = calc_final_gems(pkg)
        if language == 'es':
            line = f"⭐ {pkg['stars']} Stars → 💎 {final_gems} gemas"
            if pkg['first_time']:
                line += " (¡Primera vez!)"
        else:
            line = f"⭐ {pkg['stars']} Stars → 💎 {final_gems} gems"
            if pkg['first_time']:
                line += " (First time!)"
        text += f"{i+1}. {line}\n"
        builder.button(
            text=(f"Opción {i+1}" if language == 'es' else f"Option {i+1}"),
            callback_data=f"buy_gem_{i}"
        )

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

    if pkg['first_time']:
        prior = await has_prior_purchase(telegram_id)
        if prior:
            return await callback.answer(
                "Este paquete es solo para nuevos usuarios." if user.get('language') == 'es'
                else "This package is for new users only.",
                show_alert=True
            )

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
    total_paid = message.successful_payment.total_amount

    if payload.startswith("vip_sub_"):
        # Polling shares the durable path. Webhook intercepts before Dispatcher.
        # Neither path credits VIP in Python; TS ledger owns idempotency.
        from vip_inbox import receive_vip_payment
        await receive_vip_payment(message, message.bot.id)
        return

    is_hybrid = payload.startswith("hybrid_purchase_")
    is_messages = payload.startswith("message_purchase_")
    is_gems = payload.startswith("gem_purchase_")

    if is_hybrid:
        prefix = "hybrid_purchase_"
        active_packages = HYBRID_PACKAGES
    elif is_messages:
        prefix = "message_purchase_"
        active_packages = MESSAGE_PACKAGES
    elif is_gems:
        prefix = "gem_purchase_"
        active_packages = STAR_PACKAGES
    else:
        logger.error(f"Unknown payment payload: {payload}")
        return await message.answer("⚠️ Error: payload de pago desconocido. Contacta a soporte.")

    try:
        pkg_idx = int(payload.replace(prefix, ""))
    except ValueError:
        return await message.answer("⚠️ Error al procesar la compra.")

    if pkg_idx >= len(active_packages):
        return await message.answer("⚠️ Error al procesar la compra.")

    pkg = active_packages[pkg_idx]

    expected_stars = pkg['stars']
    if total_paid != expected_stars:
        logger.error(
            f"⚠️ Amount mismatch: paid {total_paid} but expected {expected_stars} for package {pkg_idx} ({payload})"
        )

    if pkg.get('first_time', False):
        prior = await has_prior_purchase(telegram_id)
        if prior:
            logger.warning(
                f"⚠️ User {telegram_id} paid for first_time package {pkg_idx} but already has prior purchases or VIP. Processing as regular package."
            )

    gems_amount = 0
    messages_amount = 0
    purchase_type = 'gems'

    if is_hybrid:
        gems_amount = pkg['gems']
        messages_amount = pkg['messages']
        purchase_type = 'hybrid'
    elif is_messages:
        messages_amount = pkg['messages']
        purchase_type = 'messages'
    else:
        gems_amount = calc_final_gems(pkg)
        purchase_type = 'gems'

    prior_purchase_exists = await has_prior_purchase(telegram_id)
    is_user_first_purchase = not prior_purchase_exists

    try:
        purchase_status = await record_star_purchase(
            telegram_id, pkg['stars'], gems_amount, messages_amount,
            is_user_first_purchase,
            charge_id, purchase_type,
            bot=message.bot,
            invoice_payload=payload,
        )
    except StarPurchaseTransientError as e:
        logger.critical(
            f"[stars] pago sin acreditar charge={charge_id} user={telegram_id} "
            f"payload={payload} stars={total_paid}: {e}"
        )
        return await message.answer(
            "⚠️ Hemos recibido tu pago, pero aún no pudimos acreditarlo. "
            f"Guarda este identificador y contacta a soporte: {charge_id}"
        )

    # Comparación explícita de estados: nunca se usa el resultado como booleano
    # (en Python cualquier cadena no vacía es truthy, incluido 'rejected').
    if purchase_status == 'duplicate':
        return await message.answer("⚠️ Esta compra ya fue procesada anteriormente.")

    if purchase_status in ('conflict', 'rejected', 'review_required'):
        logger.critical(
            f"[stars] pago no confirmado charge={charge_id} user={telegram_id} "
            f"status={purchase_status} payload={payload} stars={total_paid}"
        )
        return await message.answer(
            "⚠️ Tu pago figura en revisión y todavía no se ha acreditado. "
            f"Contacta a soporte con este identificador: {charge_id}"
        )

    if purchase_status != 'applied':
        # Defensivo: nunca se confirma una compra sin estado 'applied'.
        logger.critical(
            f"[stars] estado inesperado charge={charge_id} status={purchase_status}"
        )
        return await message.answer(
            "⚠️ No pudimos confirmar tu compra. "
            f"Contacta a soporte con este identificador: {charge_id}"
        )

    user = await get_user(telegram_id)
    lang = user.get('language', 'es') if user else 'es'

    if is_hybrid:
        if lang == 'es':
            text = f"✅ ¡Compra exitosa! Recibiste *{gems_amount} gemas* y *{messages_amount} mensajes de chat*."
        else:
            text = f"✅ Purchase successful! You received *{gems_amount} gems* and *{messages_amount} chat messages*."
    elif is_messages:
        if lang == 'es':
            text = f"✅ ¡Compra exitosa! Recibiste *{messages_amount} mensajes de chat*.\n\n🎉 ¡Ahora puedes seguir hablando con tus personajes!"
        else:
            text = f"✅ Purchase successful! You received *{messages_amount} chat messages*.\n\n🎉 You can now keep talking with your characters!"
    else:
        if lang == 'es':
            text = f"✅ ¡Compra exitosa! Recibiste *{gems_amount} gemas*.\n\n🎉 ¡Ahora tienes acceso a audio e imágenes!"
        else:
            text = f"✅ Purchase successful! You received *{gems_amount} gems*.\n\n🎉 You now have access to audio and images!"

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
