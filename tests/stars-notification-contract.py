"""Pruebas funcionales locales de las notificaciones de comisiones Stars.

No importa telegrabot.py ni turso_client.py: extrae las funciones reales por AST
y las ejecuta contra SQLite en memoria con el cliente Turso simulado.
Sin red, sin Turso, sin Telegram y sin credenciales reales.

Garantia declarada: la entrega es AL-MENOS-UNA-VEZ. Telegram sendMessage no
ofrece idempotencia, por lo que no se afirma entrega exactamente una vez.
"""
import ast
import asyncio
import os
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
SOURCE_PATH = ROOT / 'api' / 'bot' / 'telegrabot.py'
MIGRATION_PATH = ROOT / 'migrations' / '006_referral_commission_notifications.sql'

FUNCTIONS = (
    '_iso_ms', '_backoff_seconds', '_notification_state', '_star_commission',
    '_claim_notification', '_finish_notification', '_exhaust_notification',
    '_release_preparation_claim', '_classify_telegram_error',
    '_build_notification_text', '_notify_referral_commission',
)
CONSTANTS = (
    'NOTIFICATION_LEASE_MINUTES', 'NOTIFICATION_MAX_ATTEMPTS',
    'NOTIFICATION_UNKNOWN_DELAY_SECONDS', '_PERMANENT_BAD_REQUEST',
)


class TelegramAPIError(Exception):
    def __init__(self, message=''):
        super().__init__(message)
        self.message = message


class TelegramBadRequest(TelegramAPIError):
    pass


class TelegramForbiddenError(TelegramAPIError):
    pass


class TelegramServerError(TelegramAPIError):
    pass


class TelegramNetworkError(TelegramAPIError):
    pass


class TelegramRetryAfter(TelegramAPIError):
    def __init__(self, retry_after=1, message=''):
        super().__init__(message)
        self.retry_after = retry_after


class FakeLogger:
    def __init__(self):
        self.records = []

    def _add(self, msg):
        self.records.append(str(msg))

    def error(self, msg, *a, **k):
        self._add(msg)

    def warning(self, msg, *a, **k):
        self._add(msg)

    def info(self, msg, *a, **k):
        self._add(msg)

    def critical(self, msg, *a, **k):
        self._add(msg)


class FakeBot:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    async def send_message(self, chat_id=None, text=None, parse_mode=None):
        if self.error is not None:
            raise self.error
        self.calls.append({'chat_id': chat_id, 'text': text, 'parse_mode': parse_mode})


class DummyBotType:
    pass


def build_namespace(shim, logger):
    """Extrae por nombre las 11 funciones y las 4 constantes reales."""
    tree = ast.parse(SOURCE_PATH.read_text(encoding='utf-8'))
    body = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in FUNCTIONS:
            body.append(node)
        elif isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if any(t in CONSTANTS for t in targets):
                body.append(node)
    found_functions = {n.name for n in body
                       if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    missing_functions = [n for n in FUNCTIONS if n not in found_functions]
    found_constants = set()
    for n in body:
        if isinstance(n, ast.Assign):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    found_constants.add(t.id)
    missing_constants = [n for n in CONSTANTS if n not in found_constants]
    if missing_functions or missing_constants:
        raise AssertionError(
            f'extraccion AST incompleta: funciones={missing_functions} '
            f'constantes={missing_constants}')
    module = ast.Module(body=body, type_ignores=[])
    ast.fix_missing_locations(module)
    namespace = {
        'os': os,
        'datetime': datetime,
        'timezone': timezone,
        'timedelta': timedelta,
        'Optional': Optional,
        'Bot': DummyBotType,
        'logger': logger,
        'turso_query': shim.query,
        'turso_query_one': shim.query_one,
        'turso_execute': shim.execute,
        'TelegramBadRequest': TelegramBadRequest,
        'TelegramForbiddenError': TelegramForbiddenError,
        'TelegramServerError': TelegramServerError,
        'TelegramNetworkError': TelegramNetworkError,
        'TelegramRetryAfter': TelegramRetryAfter,
    }
    exec(compile(module, str(SOURCE_PATH), 'exec'), namespace)
    return namespace


class Shim:
    """Cliente Turso simulado sobre sqlite3 (mismo contrato que turso_client.py)."""

    def __init__(self, con):
        self.con = con
        self.fail_contains = None
        self.fail_exc = None

    def _maybe_fail(self, sql):
        if self.fail_contains and self.fail_contains in sql:
            raise self.fail_exc or RuntimeError('fallo sintetico')

    def query(self, sql, args=None):
        self._maybe_fail(sql)
        cur = self.con.execute(sql, args or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def query_one(self, sql, args=None):
        rows = self.query(sql, args)
        return rows[0] if rows else None

    def execute(self, sql, args=None):
        self._maybe_fail(sql)
        cur = self.con.execute(sql, args or [])
        self.con.commit()
        return {'affected_row_count': cur.rowcount, 'last_insert_rowid': cur.lastrowid}


BASE_SCHEMA = """
CREATE TABLE users (
    telegram_id TEXT PRIMARY KEY,
    gems INTEGER DEFAULT 0,
    language TEXT DEFAULT 'es'
);
CREATE TABLE referral_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id TEXT, referred_id TEXT, purchase_gems INTEGER,
    commission_gems INTEGER, commission_pct INTEGER,
    source TEXT, reference TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE gem_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT, amount INTEGER,
    transaction_type TEXT, description TEXT
);
"""


class Base(unittest.TestCase):
    def setUp(self):
        self.con = sqlite3.connect(':memory:')
        self.con.executescript(BASE_SCHEMA)
        self.con.executescript(MIGRATION_PATH.read_text(encoding='utf-8'))
        self.con.commit()
        self.logger = FakeLogger()
        self.shim = Shim(self.con)
        self.ns = build_namespace(self.shim, self.logger)
        self.bot = FakeBot()

    def seed(self, *, enabled=1, min_id=0, source='stars', referrer=True,
             buyer='123', referrer_id='456789', charge='ch-1', gems=100):
        self.con.execute(
            "INSERT OR IGNORE INTO users (telegram_id, gems, language) VALUES (?, ?, ?)",
            (buyer, 10, 'es'))
        if referrer:
            self.con.execute(
                "INSERT OR IGNORE INTO users (telegram_id, gems, language) VALUES (?, ?, ?)",
                (referrer_id, gems, 'es'))
        cur = self.con.execute(
            """INSERT INTO referral_commissions
                 (referrer_id, referred_id, purchase_gems, commission_gems,
                  commission_pct, source, reference)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (referrer_id, buyer, 315, 15, 5, source, charge))
        self.con.execute(
            "UPDATE referral_notification_state SET enabled = ?, min_commission_id = ? WHERE id = 1",
            (enabled, min_id))
        self.con.commit()
        return cur.lastrowid

    def insert_notification(self, commission_id, *, status='pending', attempts=0,
                            claim=None, lease=None, next_at=None, sent_at=None,
                            referrer_id='456789', buyer='123', charge='ch-1'):
        cur = self.con.execute(
            """INSERT INTO referral_commission_notifications
                 (referral_commission_id, referrer_id, referred_id, reference,
                  status, attempt_count, claim_token, lease_until,
                  next_attempt_at, sent_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (commission_id, referrer_id, buyer, charge, status, attempts,
             claim, lease, next_at, sent_at))
        self.con.commit()
        return cur.lastrowid

    def notification(self, commission_id):
        cur = self.con.execute(
            "SELECT * FROM referral_commission_notifications WHERE referral_commission_id = ?",
            (commission_id,))
        cols = [d[0] for d in cur.description]
        row = cur.fetchone()
        return dict(zip(cols, row)) if row else None

    def run_notify(self, *, buyer=123, charge='ch-1', result=None, bot=None):
        payload = {'status': 'applied', 'commission_applied': True,
                   'commission_pending': False}
        if result:
            payload.update(result)
        asyncio.run(self.ns['_notify_referral_commission'](
            payload, buyer, charge, self.bot if bot is None else bot))


class AppliedAndGuards(Base):
    def test_01_applied_sends_and_marks_sent(self):
        cid = self.seed()
        self.run_notify()
        self.assertEqual(len(self.bot.calls), 1)
        sent = self.notification(cid)
        self.assertEqual(sent['status'], 'sent')
        self.assertIsNotNone(sent['sent_at'])
        self.assertIsNone(sent['claim_token'])
        self.assertIsNone(sent['lease_until'])
        self.assertEqual(sent['attempt_count'], 1)
        self.assertEqual(self.bot.calls[0]['chat_id'], 456789)
        self.assertEqual(self.bot.calls[0]['parse_mode'], 'Markdown')
        self.assertIn('¡Tu referido compró gemas!', self.bot.calls[0]['text'])
        self.assertIn('+15', self.bot.calls[0]['text'])
        self.assertIn('*100*', self.bot.calls[0]['text'])

    def test_02_commission_pending_does_not_send(self):
        cid = self.seed()
        self.run_notify(result={'commission_pending': True})
        self.assertEqual(self.bot.calls, [])
        self.assertIsNone(self.notification(cid))

    def test_02b_commission_not_applied_does_not_send(self):
        cid = self.seed()
        self.run_notify(result={'commission_applied': False})
        self.assertEqual(self.bot.calls, [])
        self.assertIsNone(self.notification(cid))

    def test_03_already_sent_is_not_resent(self):
        cid = self.seed()
        self.insert_notification(cid, status='sent', sent_at='2026-01-01T00:00:00.000Z')
        self.run_notify()
        self.assertEqual(self.bot.calls, [])
        self.assertEqual(self.notification(cid)['status'], 'sent')

    def test_03b_failed_is_not_retried(self):
        cid = self.seed()
        self.insert_notification(cid, status='failed', attempts=5)
        self.run_notify()
        self.assertEqual(self.bot.calls, [])
        self.assertEqual(self.notification(cid)['status'], 'failed')

    def test_04_disabled_does_not_send(self):
        cid = self.seed(enabled=0)
        self.run_notify()
        self.assertEqual(self.bot.calls, [])
        self.assertIsNone(self.notification(cid))

    def test_05_before_cutoff_does_not_send(self):
        cid = self.seed(min_id=999)
        self.run_notify()
        self.assertEqual(self.bot.calls, [])
        self.assertIsNone(self.notification(cid))

    def test_06_non_stars_source_does_not_send(self):
        self.seed(source='crypto')
        self.run_notify()
        self.assertEqual(self.bot.calls, [])




class ClaimsAndErrors(Base):
    def _now(self):
        return self.ns['_iso_ms'](datetime.now(timezone.utc))

    def test_07_concurrent_claims_only_one_wins(self):
        cid = self.seed()
        nid = self.insert_notification(cid)
        now = self._now()
        claim = self.ns['_claim_notification']
        self.assertIsNotNone(claim(nid, now))
        self.assertIsNone(claim(nid, now))
        self.assertIsNone(claim(nid, now))

    def test_08_transient_error_retries_with_backoff(self):
        cid = self.seed()
        self.bot.error = TelegramServerError('boom')
        self.run_notify()
        row = self.notification(cid)
        self.assertEqual(row['status'], 'pending')
        self.assertEqual(row['last_error'], 'server_error')
        self.assertIsNone(row['claim_token'])
        self.assertGreater(row['next_attempt_at'], self._now())

    def test_08b_retry_after_is_honoured(self):
        cid = self.seed()
        self.bot.error = TelegramRetryAfter(retry_after=42)
        self.run_notify()
        row = self.notification(cid)
        self.assertEqual(row['status'], 'pending')
        self.assertEqual(row['last_error'], 'retry_after')
        low = self.ns['_iso_ms'](datetime.now(timezone.utc) + timedelta(seconds=30))
        high = self.ns['_iso_ms'](datetime.now(timezone.utc) + timedelta(seconds=120))
        self.assertGreater(row['next_attempt_at'], low)
        self.assertLess(row['next_attempt_at'], high)

    def test_09_permanent_forbidden_marks_failed(self):
        cid = self.seed()
        self.bot.error = TelegramForbiddenError('bot was blocked by the user')
        self.run_notify()
        row = self.notification(cid)
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['last_error'], 'rejected_permanent')

    def test_09b_permanent_bad_request_marks_failed(self):
        cid = self.seed()
        self.bot.error = TelegramBadRequest('Bad Request: chat not found')
        self.run_notify()
        self.assertEqual(self.notification(cid)['last_error'], 'rejected_permanent')

    def test_09c_unknown_bad_request_is_not_permanent(self):
        cid = self.seed()
        self.bot.error = TelegramBadRequest('Bad Request: something odd')
        self.run_notify()
        row = self.notification(cid)
        self.assertEqual(row['status'], 'pending')
        self.assertEqual(row['last_error'], 'bad_request_unknown')

    def test_10_fifth_attempt_failure_ends_in_failed(self):
        cid = self.seed()
        self.insert_notification(cid, attempts=4)
        self.bot.error = TelegramServerError('boom')
        self.run_notify()
        row = self.notification(cid)
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['last_error'], 'attempts_exhausted')
        self.bot.error = None
        self.run_notify()
        self.assertEqual(len(self.bot.calls), 0)
        self.assertEqual(self.notification(cid)['status'], 'failed')

    def test_10b_exhausted_is_not_claimable(self):
        cid = self.seed()
        nid = self.insert_notification(cid, attempts=5)
        self.assertIsNone(self.ns['_claim_notification'](nid, self._now()))

    def test_11_attempt_count_read_failure_keeps_sending(self):
        cid = self.seed()
        self.shim.fail_contains = 'SELECT attempt_count FROM referral_commission_notifications'
        self.run_notify()
        row = self.notification(cid)
        self.assertEqual(row['status'], 'sending')
        self.assertIsNotNone(row['claim_token'])
        self.assertIsNotNone(row['lease_until'])
        self.assertEqual(self.bot.calls, [])

    def test_12_confirmation_failure_keeps_uncertain_state(self):
        cid = self.seed()
        self.shim.fail_contains = "SET status = 'sent'"
        self.run_notify()
        row = self.notification(cid)
        self.assertEqual(len(self.bot.calls), 1)
        self.assertEqual(row['status'], 'sending')
        self.assertIsNotNone(row['claim_token'])
        self.assertIsNotNone(row['lease_until'])


class IsolationAndSafety(Base):
    def snapshot(self):
        gems = self.con.execute('SELECT SUM(gems) FROM users').fetchone()[0]
        commissions = self.con.execute(
            'SELECT COUNT(*) FROM referral_commissions').fetchone()[0]
        ledger = self.con.execute('SELECT COUNT(*) FROM gem_transactions').fetchone()[0]
        balances = self.con.execute(
            'SELECT telegram_id, gems FROM users ORDER BY telegram_id').fetchall()
        return (gems, commissions, ledger, tuple(balances))

    def test_13_missing_referrer_marks_referrer_missing(self):
        cid = self.seed(referrer=False)
        self.run_notify()
        row = self.notification(cid)
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['last_error'], 'referrer_missing')
        self.assertEqual(self.bot.calls, [])

    def test_14_db_error_on_state_never_propagates(self):
        self.seed()
        self.shim.fail_contains = 'SELECT enabled'
        try:
            self.run_notify()
        except Exception as exc:
            self.fail(f'la notificacion propago {type(exc).__name__}')
        self.assertEqual(self.bot.calls, [])

    def test_14b_db_error_on_insert_never_propagates(self):
        self.seed()
        self.shim.fail_contains = 'INSERT OR IGNORE INTO referral_commission_notifications'
        try:
            self.run_notify()
        except Exception as exc:
            self.fail(f'la notificacion propago {type(exc).__name__}')
        self.assertEqual(self.bot.calls, [])

    def test_15_economics_untouched(self):
        cid = self.seed()
        before = self.snapshot()
        self.run_notify()
        self.assertEqual(len(self.bot.calls), 1)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.notification(cid)['status'], 'sent')

    def test_16_logs_have_no_sensitive_ids(self):
        self.seed()
        self.bot.error = TelegramForbiddenError('bot was blocked by the user')
        self.run_notify()
        joined = ' '.join(self.logger.records)
        self.assertTrue(joined.strip(), 'se esperaba al menos un log')
        for secret in ('456789', '123', 'ch-1'):
            self.assertNotIn(secret, joined)

    def test_17_second_run_does_not_duplicate(self):
        cid = self.seed()
        self.run_notify()
        self.run_notify()
        count = self.con.execute(
            'SELECT COUNT(*) FROM referral_commission_notifications').fetchone()[0]
        self.assertEqual(count, 1)
        self.assertEqual(len(self.bot.calls), 1)
        self.assertEqual(self.notification(cid)['status'], 'sent')


if __name__ == '__main__':
    unittest.main(verbosity=2)

