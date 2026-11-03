"""Durable VIP receipts; TypeScript exclusively owns subscription credit."""
import os
from urllib.parse import urlsplit
import httpx
from turso_client import turso_query_one


def record_vip_payment(message, bot_id):
    payment = message.successful_payment
    values = [str(bot_id), payment.telegram_payment_charge_id, payment.invoice_payload,
              str(message.from_user.id), payment.currency, payment.total_amount]
    row = turso_query_one(
        """INSERT INTO vip_payment_inbox
           (bot_id, telegram_charge_id, invoice_reference, telegram_id, currency, paid_amount_units)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(bot_id, telegram_charge_id) DO NOTHING RETURNING id""", values)
    if row:
        return row['id']
    existing = turso_query_one(
        "SELECT * FROM vip_payment_inbox WHERE bot_id = ? AND telegram_charge_id = ?", values[:2])
    if not existing or [existing[key] for key in (
        'invoice_reference', 'telegram_id', 'currency', 'paid_amount_units'
    )] != values[2:]:
        raise RuntimeError('vip_receipt_identity_conflict')
    return existing['id']


async def try_process_vip_payment(inbox_id):
    try:
        url = os.getenv('VIP_PROCESSOR_URL', '')
        secret = os.getenv('VIP_PROCESSOR_SECRET', '')
        parsed = urlsplit(url)
        if (not secret or parsed.scheme != 'https' or not parsed.hostname or
                parsed.username is not None or parsed.password is not None or
                parsed.query or parsed.fragment):
            return False
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
            response = await client.post(url, headers={'Authorization': f'Bearer {secret}'},
                                         json={'inboxId': inbox_id})
            return response.status_code == 200
    except Exception:
        # No credentials in logs. Cron recovers the durable pending receipt.
        return False


async def receive_vip_payment(message, bot_id):
    if (not message or not message.successful_payment or
            not message.successful_payment.invoice_payload.startswith('vip_sub_')):
        return False
    inbox_id = record_vip_payment(message, bot_id)  # failures must propagate
    await try_process_vip_payment(inbox_id)  # best effort, NOT proof of credit
    return True