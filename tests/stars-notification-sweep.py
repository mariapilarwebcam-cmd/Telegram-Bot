"""Pruebas del barrido 4b-3 (sweep_referral_notifications).

Reutiliza el arnes de stars-notification-contract.py (shim Turso sobre sqlite3,
bot simulado, esquema real de la migracion 006) y extrae por AST las funciones
reales. Sin red, sin Turso, sin Telegram y sin credenciales.
"""
import ast
import asyncio
import importlib.util
import os
import sqlite3
import time as time_module
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
SOURCE_PATH = ROOT / 'api' / 'bot' / 'telegrabot.py'
HARNESS_PATH = Path(__file__).resolve().parent / 'stars-notification-contract.py'

_spec = importlib.util.spec_from_file_location('notification_contract', HARNESS_PATH)
H = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(H)

SWEEP_FUNCTIONS = ('sweep_referral_notifications',)
SWEEP_CONSTANTS = (
    'SWEEP_LIMIT', 'SWEEP_BUDGET_SECONDS', 'SWEEP_ITEM_TIMEOUT',
    'SWEEP_STATE_SQL', 'SWEEP_DISCOVERY_SQL', 'SWEEP_CANDIDATES_SQL', '_sweep_lock',
)


def build_sweep_namespace(shim, logger):
    tree = ast.parse(SOURCE_PATH.read_text(encoding='utf-8'))
    wanted_functions = set(H.FUNCTIONS) | set(SWEEP_FUNCTIONS)
    wanted_constants = set(H.CONSTANTS) | set(SWEEP_CONSTANTS)
    body = []
    found_functions = set()
    found_constants = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in wanted_functions:
            body.append(node)
            found_functions.add(node.name)
        elif isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            hit = [n for n in names if n in wanted_constants]
            if hit:
                body.append(node)
                found_constants.update(hit)
    missing = (wanted_functions - found_functions) | (wanted_constants - found_constants)
    if missing:
        raise AssertionError(f'extraccion AST incompleta: {sorted(missing)}')
    module = ast.Module(body=body, type_ignores=[])
    ast.fix_missing_locations(module)
    namespace = {
        'os': os,
        'datetime': datetime,
        'timezone': timezone,
        'timedelta': timedelta,
        'Optional': Optional,
        'Bot': H.DummyBotType,
        'logger': logger,
        'turso_query': shim.query,
        'turso_query_one': shim.query_one,
        'turso_execute': shim.execute,
        'asyncio': asyncio,
        'time': time_module,
        'TelegramBadRequest': H.TelegramBadRequest,
        'TelegramForbiddenError': H.TelegramForbiddenError,
        'TelegramServerError': H.TelegramServerError,
        'TelegramNetworkError': H.TelegramNetworkError,
        'TelegramRetryAfter': H.TelegramRetryAfter,
    }
    exec(compile(module, str(SOURCE_PATH), 'exec'), namespace)
    return namespace


class SweepBase(unittest.TestCase):
    def setUp(self):
        self.con = sqlite3.connect(':memory:')
        self.con.executescript(H.BASE_SCHEMA)
        self.con.executescript(H.MIGRATION_PATH.read_text(encoding='utf-8'))
        self.con.commit()
        self.logger = H.FakeLogger()
        self.shim = H.Shim(self.con)
        self.ns = build_sweep_namespace(self.shim, self.logger)
        self.bot = H.FakeBot()
        self.now = self.ns['_iso_ms'](datetime.now(timezone.utc))

    def seed(self, *, enabled=1, activated=True, min_id=0, source='stars',
             referrer=True, buyer='123', referrer_id='456789',
             charge='ch-1', gems=100):
        self.con.execute(
            "INSERT OR IGNORE INTO users (telegram_id, gems, language) VALUES (?,?,?)",
            (buyer, 10, 'es'))
        if referrer:
            self.con.execute(
                "INSERT OR IGNORE INTO users (telegram_id, gems, language) VALUES (?,?,?)",
                (referrer_id, gems, 'es'))
        cur = self.con.execute(
            """INSERT INTO referral_commissions
                 (referrer_id, referred_id, purchase_gems, commission_gems,
                  commission_pct, source, reference)
               VALUES (?,?,?,?,?,?,?)""",
            (referrer_id, buyer, 315, 15, 5, source, charge))
        self.con.execute(
            "UPDATE referral_notification_state "
            "SET enabled = ?, min_commission_id = ?, activated_at = ? WHERE id = 1",
            (enabled, min_id, self.now if activated else None))
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
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (commission_id, referrer_id, buyer, charge, status, attempts,
             claim, lease, next_at, sent_at))
        self.con.commit()
        return cur.lastrowid

    def notification(self, commission_id):
        cur = self.con.execute(
            "SELECT * FROM referral_commission_notifications "
            "WHERE referral_commission_id = ?", (commission_id,))
        cols = [d[0] for d in cur.description]
        row = cur.fetchone()
        return dict(zip(cols, row)) if row else None

    def run_sweep(self, limit=None, bot=None):
        sweep = self.ns['sweep_referral_notifications']
        target = self.bot if bot is None else bot
        if limit is None:
            return asyncio.run(sweep(target))
        return asyncio.run(sweep(target, limit))

    def past(self, minutes=30):
        return self.ns['_iso_ms'](
            datetime.now(timezone.utc) - timedelta(minutes=minutes))

    def future(self, minutes=30):
        return self.ns['_iso_ms'](
            datetime.now(timezone.utc) + timedelta(minutes=minutes))


class SweepSelection(SweepBase):
    def test_01_pending_due_is_sent(self):
        cid = self.seed()
        self.insert_notification(cid, status='pending', next_at=self.past())
        summary = self.run_sweep()
        self.assertIsNone(summary['error'])
        self.assertEqual(summary['sent'], 1)
        self.assertEqual(len(self.bot.calls), 1)
        self.assertEqual(self.notification(cid)['status'], 'sent')

    def test_02_pending_future_backoff_is_skipped(self):
        cid = self.seed()
        self.insert_notification(cid, status='pending', next_at=self.future())
        summary = self.run_sweep()
        self.assertEqual(summary['processed'], 0)
        self.assertEqual(self.bot.calls, [])
        self.assertEqual(self.notification(cid)['status'], 'pending')

    def test_03_expired_lease_is_recovered(self):
        cid = self.seed()
        self.insert_notification(cid, status='sending', attempts=1,
                                 claim='stale-token', lease=self.past())
        summary = self.run_sweep()
        self.assertEqual(summary['sent'], 1)
        self.assertEqual(self.notification(cid)['status'], 'sent')

    def test_04_exhausted_is_failed_without_send(self):
        cid = self.seed()
        self.insert_notification(cid, status='pending', attempts=5)
        summary = self.run_sweep()
        self.assertEqual(self.bot.calls, [])
        row = self.notification(cid)
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['last_error'], 'attempts_exhausted')
        self.assertEqual(summary['failed'], 1)

    def test_05_disabled_does_nothing(self):
        cid = self.seed(enabled=0)
        self.insert_notification(cid)
        summary = self.run_sweep()
        self.assertEqual(summary['skipped_reason'], 'disabled')
        self.assertEqual(self.bot.calls, [])
        self.assertEqual(self.notification(cid)['status'], 'pending')

    def test_06_not_activated_does_nothing(self):
        cid = self.seed(enabled=1, activated=False)
        self.insert_notification(cid)
        summary = self.run_sweep()
        self.assertEqual(summary['skipped_reason'], 'disabled')
        self.assertEqual(self.bot.calls, [])

    def test_07_before_cutoff_is_skipped(self):
        cid = self.seed(min_id=999)
        self.insert_notification(cid)
        self.run_sweep()
        self.assertEqual(self.bot.calls, [])
        self.assertEqual(self.notification(cid)['status'], 'pending')

    def test_08_non_stars_never_selected(self):
        cid = self.seed(source='crypto')
        self.insert_notification(cid)
        summary = self.run_sweep()
        self.assertEqual(self.bot.calls, [])
        self.assertEqual(summary['processed'], 0)


class SweepRobustness(SweepBase):
    def test_09_discovery_enqueues_missing_row(self):
        cid = self.seed()
        self.assertIsNone(self.notification(cid))
        summary = self.run_sweep()
        self.assertEqual(summary['sent'], 1)
        self.assertEqual(len(self.bot.calls), 1)
        self.assertEqual(self.notification(cid)['status'], 'sent')

    def test_10_global_state_failure_reports_error(self):
        self.seed()
        self.shim.fail_contains = 'SELECT enabled, min_commission_id, activated_at'
        summary = self.run_sweep()
        self.assertEqual(summary['error'], 'lookup_failed')
        self.assertEqual(self.bot.calls, [])

    def test_10b_discovery_failure_reports_error(self):
        cid = self.seed()
        self.insert_notification(cid)
        self.shim.fail_contains = 'INSERT OR IGNORE INTO referral_commission_notifications'
        summary = self.run_sweep()
        self.assertEqual(summary['error'], 'lookup_failed')
        self.assertEqual(self.bot.calls, [])

    def test_11_item_error_does_not_stop_the_pass(self):
        first = self.seed(buyer='123', charge='ch-1')
        second = self.seed(buyer='124', charge='ch-2')
        self.insert_notification(first, next_at=self.past(),
                                 buyer='123', charge='ch-1')
        self.insert_notification(second, next_at=self.past(),
                                 buyer='124', charge='ch-2')

        class FlakyBot(H.FakeBot):
            def __init__(self):
                super().__init__()
                self.count = 0

            async def send_message(self, chat_id=None, text=None, parse_mode=None):
                self.count += 1
                if self.count == 1:
                    raise H.TelegramServerError('boom')
                return await super().send_message(chat_id=chat_id, text=text,
                                                  parse_mode=parse_mode)

        summary = self.run_sweep(bot=FlakyBot())
        self.assertEqual(summary['processed'], 2)
        self.assertEqual(summary['sent'], 1)
        self.assertEqual(self.notification(first)['status'], 'pending')
        self.assertEqual(self.notification(second)['status'], 'sent')

    def test_12_budget_exhausted_marks_truncated(self):
        cid = self.seed()
        self.insert_notification(cid, next_at=self.past())
        self.ns['SWEEP_BUDGET_SECONDS'] = 0.0
        summary = self.run_sweep()
        self.assertTrue(summary['truncated'])
        self.assertEqual(summary['processed'], 0)
        self.assertEqual(self.bot.calls, [])

    def test_13_overlapping_sweep_reports_in_progress(self):
        self.seed()
        lock = self.ns['_sweep_lock']
        sweep = self.ns['sweep_referral_notifications']

        async def scenario():
            await lock.acquire()
            try:
                return await sweep(self.bot)
            finally:
                lock.release()

        summary = asyncio.run(scenario())
        self.assertEqual(summary['skipped_reason'], 'in_progress')
        self.assertEqual(self.bot.calls, [])

    def test_14_invalid_limit_is_rejected(self):
        self.seed()
        for bad in (0, -1, 21, True):
            summary = self.run_sweep(limit=bad)
            self.assertEqual(summary['error'], 'invalid_limit', msg=f'limit={bad}')
        self.assertEqual(self.bot.calls, [])

    def test_15_exhaust_does_not_break_live_lease(self):
        cid = self.seed()
        nid = self.insert_notification(cid, status='sending', attempts=5,
                                       claim='live-token', lease=self.future())
        affected = self.ns['_exhaust_notification'](nid)
        self.assertEqual(affected, 0)
        row = self.notification(cid)
        self.assertEqual(row['status'], 'sending')
        self.assertEqual(row['claim_token'], 'live-token')
        self.assertIsNone(row['last_error'])

    def test_16_limit_is_honoured(self):
        for i in range(3):
            cid = self.seed(buyer=str(200 + i), charge='ch-%d' % i)
            self.insert_notification(cid, next_at=self.past(),
                                     buyer=str(200 + i), charge='ch-%d' % i)
        summary = self.run_sweep(limit=2)
        self.assertEqual(summary['processed'], 2)
        self.assertEqual(len(self.bot.calls), 2)

    def test_17_cron_endpoint_requires_cron_secret(self):
        path = ROOT / 'api' / 'bot' / 'cron_referral_notifications.py'
        source = path.read_text(encoding='utf-8')
        tree = ast.parse(source)
        handler = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef))

        methods = []
        for decorator in handler.decorator_list:
            for keyword in decorator.keywords:
                if keyword.arg == 'methods':
                    methods.extend(e.value for e in keyword.value.elts)
        self.assertEqual(set(methods), {'GET'}, 'el cron solo debe aceptar GET')
        self.assertNotIn('"POST"', source)
        self.assertIn('hmac.compare_digest', source)
        self.assertIn('Bearer {CRON_SECRET}', source)
        self.assertIn('status_code=403', source)
        self.assertLess(source.index('hmac.compare_digest'),
                        source.index('Bot(token='),
                        'la autenticacion debe preceder a la creacion del Bot')
        self.assertIn('finally:', source)
        self.assertIn('await bot.session.close()', source)


if __name__ == '__main__':
    unittest.main(verbosity=2)

