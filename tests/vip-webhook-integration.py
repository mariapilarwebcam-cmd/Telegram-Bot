"""Local integration: real receipt SQL + outer webhook, no credentials/network."""
import ast
import asyncio
import importlib.util
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, **attrs):
    value = types.ModuleType(name)
    value.__dict__.update(attrs)
    return value


class VipIntegration(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript((ROOT / 'migrations/001_vip_payment_records.sql').read_text())
        def query(sql, args):
            row = self.db.execute(sql, args).fetchone()
            self.db.commit()
            return dict(row) if row else None
        self.query = query
        self.fake_http = module('httpx', AsyncClient=None)
        self.modules = patch.dict(sys.modules, {
            'turso_client': module('turso_client', turso_query_one=query),
            'httpx': self.fake_http,
        })
        self.modules.start()
        spec = importlib.util.spec_from_file_location('vip_inbox', ROOT / 'api/bot/vip_inbox.py')
        self.inbox = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.inbox)
        self.message = types.SimpleNamespace(from_user=types.SimpleNamespace(id=123),
            successful_payment=types.SimpleNamespace(invoice_payload='vip_sub_weekly_123_one',
                telegram_payment_charge_id='charge-one', currency='XTR', total_amount=250))

    def tearDown(self):
        self.modules.stop()
        self.db.close()

    async def test_receipt_defaults_duplicate_and_identity_conflict(self):
        first = self.inbox.record_vip_payment(self.message, 999)
        self.assertEqual(first, self.inbox.record_vip_payment(self.message, 999))
        row = self.query('SELECT * FROM vip_payment_inbox', [])
        self.assertEqual((row['status'], row['attempt_count'], row['processed_reference']), ('pending', 0, None))
        self.message.successful_payment.total_amount = 1
        with self.assertRaisesRegex(RuntimeError, 'identity_conflict'):
            self.inbox.record_vip_payment(self.message, 999)

    async def test_immediate_https_auth_no_redirects_and_http_failure(self):
        client = types.SimpleNamespace(post=AsyncMock(return_value=types.SimpleNamespace(status_code=503)))
        context = types.SimpleNamespace(__aenter__=None)
        class Context:
            async def __aenter__(self): return client
            async def __aexit__(self, *args): pass
        calls = []
        self.fake_http.AsyncClient = lambda **kw: (calls.append(kw) or Context())
        with patch.dict(os.environ, {'VIP_PROCESSOR_URL': 'https://processor.example/api/bot/vip-payments',
                                     'VIP_PROCESSOR_SECRET': 'test-only'}):
            self.assertFalse(await self.inbox.try_process_vip_payment(1))
            self.assertEqual(client.post.call_args.kwargs['headers'], {'Authorization': 'Bearer test-only'})
            self.assertFalse(calls[0]['follow_redirects'])
            client.post.return_value.status_code = 200
            self.assertTrue(await self.inbox.try_process_vip_payment(1))
            for url in ['http://processor.example', 'https://user:pass@processor.example', 'https://processor.example?secret=x']:
                os.environ['VIP_PROCESSOR_URL'] = url
                self.assertFalse(await self.inbox.try_process_vip_payment(1))

    async def test_webhook_outer_handler_storage_failure_500_and_gems_dispatch(self):
        # Execute the actual outer handler AST with isolated transport adapters.
        tree = ast.parse((ROOT / 'api/bot/webhook.py').read_text(encoding='utf-8'))
        handler = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'catch_all')
        handler.decorator_list = []
        session = types.SimpleNamespace(close=AsyncMock())
        dispatcher = types.SimpleNamespace(feed_update=AsyncMock())
        receive = self.inbox.receive_vip_payment
        class Response:
            def __init__(self, body, status_code): self.status_code = status_code
        scope = dict(Request=object, hmac=__import__('hmac'), TELEGRAM_WEBHOOK_SECRET='webhook-only',
                     TELEGRAM_BOT_TOKEN='999:test', Bot=lambda **kw: types.SimpleNamespace(id=999, session=session),
                     Update=lambda **kw: types.SimpleNamespace(message=self.message), dp=dispatcher,
                     receive_vip_payment=receive, JSONResponse=Response,
                     logger=types.SimpleNamespace(exception=lambda *a: None, warning=lambda *a: None))
        exec(compile(ast.Module(body=[handler], type_ignores=[]), '<actual-webhook>', 'exec'), scope)
        request = types.SimpleNamespace(method='POST', headers={'x-telegram-bot-api-secret-token': 'webhook-only'},
                                        json=AsyncMock(return_value={}))
        with patch.object(self.inbox, 'turso_query_one', side_effect=RuntimeError('storage down')):
            result = await scope['catch_all'](request, '')
            self.assertEqual(result.status_code, 500)
            dispatcher.feed_update.assert_not_awaited()
        with patch.object(self.inbox, 'try_process_vip_payment', AsyncMock(return_value=False)):
            self.assertEqual(await scope['catch_all'](request, ''), {'status': 'ok'})
            self.assertEqual(self.query('SELECT status FROM vip_payment_inbox', [])['status'], 'pending')
        self.message.successful_payment.invoice_payload = 'gem_purchase_0'
        self.assertEqual(await scope['catch_all'](request, ''), {'status': 'ok'})
        dispatcher.feed_update.assert_awaited_once()

    def test_other_economic_branches_unchanged(self):
        before = subprocess.check_output(['git', 'show', 'HEAD:api/bot/telegrabot.py'], cwd=ROOT).decode('utf-8')
        after = (ROOT / 'api/bot/telegrabot.py').read_text(encoding='utf-8')
        marker = '    is_hybrid = payload.startswith("hybrid_purchase_")'
        self.assertEqual(before[before.index(marker):], after[after.index(marker):])

    def test_http_turso_adapter_insert_returning_and_errors(self):
        # Exercise the real adapter's decoding and error propagation, not only
        # sqlite3's RETURNING support. Fake HTTP transport is intentionally local.
        spec = importlib.util.spec_from_file_location('adapter', ROOT / 'api/bot/turso_client.py')
        adapter = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {'TURSO_DATABASE_URL': 'libsql://local.invalid', 'TURSO_AUTH_TOKEN': 'test-only'}):
            spec.loader.exec_module(adapter)
        result = {'results': [{'type': 'ok', 'response': {'type': 'execute', 'result': {
            'cols': [{'name': 'id'}], 'rows': [[{'type': 'integer', 'value': '7'}]]}}}]}
        class Context:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def post(self, *args, **kw): return types.SimpleNamespace(status_code=200, json=lambda: result)
        self.fake_http.Client = lambda **kw: Context()
        self.assertEqual(adapter.turso_query_one('INSERT INTO example VALUES (1) RETURNING id'), {'id': 7})
        result['results'] = [{'type': 'error', 'error': {'message': 'synthetic-storage-failure'}}]
        with self.assertRaisesRegex(RuntimeError, 'synthetic-storage-failure'):
            adapter.turso_query_one('INSERT INTO example VALUES (1) RETURNING id')


if __name__ == '__main__':
    unittest.main()