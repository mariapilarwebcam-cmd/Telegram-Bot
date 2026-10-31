"""Pruebas aisladas, sin leer .env ni contactar Telegram o Turso."""

import importlib.util
import os
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx


WEBHOOK_PATH = (
    Path(__file__).resolve().parents[1]
    / 'api' / 'support' / 'webhook.py'
)
TEST_SECRET = 'synthetic_support_secret_for_tests_123'
TEST_TOKEN = 'synthetic_bot_token_not_a_real_credential'
HEADER = 'x-telegram-bot-api-secret-token'


def load_webhook(secret=TEST_SECRET):
    environment = {'SUPPORT_BOT_TOKEN': TEST_TOKEN}
    if secret is not None:
        environment['SUPPORT_WEBHOOK_SECRET'] = secret

    support_bot = ModuleType('support_bot')
    support_bot.router = object()
    spec = importlib.util.spec_from_file_location(
        'support_webhook_under_test', WEBHOOK_PATH
    )
    module = importlib.util.module_from_spec(spec)

    # Evitar cargar .env, importar Turso o registrar handlers reales.
    with (
        patch.dict(os.environ, environment, clear=True),
        patch.dict(sys.modules, {'support_bot': support_bot}),
        patch.object(sys, 'path', sys.path.copy()),
        patch('dotenv.load_dotenv'),
        patch('aiogram.Dispatcher') as dispatcher,
    ):
        spec.loader.exec_module(module)
        dispatcher.assert_called_once_with()
    return module


class SupportWebhookConfigurationTests(unittest.TestCase):
    def test_missing_empty_or_invalid_secret_prevents_initialization(self):
        secrets = (
            None, '', ' ', ' leading', 'trailing ',
            'bad\nvalue', 'ñ', 'a' * 257,
        )
        for index, secret in enumerate(secrets):
            with self.subTest(case=index):
                with self.assertRaises(RuntimeError) as error:
                    load_webhook(secret)
                self.assertEqual(
                    str(error.exception),
                    'SUPPORT_WEBHOOK_SECRET ausente o con formato inválido',
                )

    def test_valid_secret_format_boundaries(self):
        for secret in ('a', 'A_0-', 'a' * 256):
            with self.subTest(length=len(secret)):
                module = load_webhook(secret)
                self.assertEqual(module.SUPPORT_WEBHOOK_SECRET, secret)


class SupportWebhookRequestTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.module = load_webhook()
        self.module.dp.feed_update = AsyncMock()
        self.bot = MagicMock()
        self.bot.session.close = AsyncMock()

        bot_patch = patch.object(
            self.module, 'Bot', return_value=self.bot
        )
        self.bot_factory = bot_patch.start()
        self.addCleanup(bot_patch.stop)

        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.module.app),
            base_url='http://testserver',
        )
        self.addAsyncCleanup(self.client.aclose)

    async def test_valid_secret_dispatches_once_and_closes_session(self):
        response = await self.client.post(
            '/api/support/webhook',
            headers={HEADER: TEST_SECRET},
            json={'update_id': 1},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})
        self.bot_factory.assert_called_once_with(token=TEST_TOKEN)
        self.module.dp.feed_update.assert_awaited_once()
        bot, update = self.module.dp.feed_update.await_args.args
        self.assertIs(bot, self.bot)
        self.assertEqual(update.update_id, 1)
        self.bot.session.close.assert_awaited_once()

    async def test_missing_empty_or_invalid_header_is_rejected(self):
        cases = (
            [],
            [(HEADER, '')],
            [(HEADER, 'wrong_secret')],
            [(HEADER, 'has spaces')],
            [(HEADER, 'a' * 257)],
            [(HEADER.encode(), b'\xff')],
        )
        for index, headers in enumerate(cases):
            with self.subTest(case=index):
                with patch.object(self.module, 'Update') as update:
                    response = await self.client.post(
                        '/api/support/webhook',
                        headers=headers,
                        content=b'not-json',
                    )
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(
                        response.json(), {'detail': 'Forbidden'}
                    )
                    update.assert_not_called()
        self.bot_factory.assert_not_called()
        self.module.dp.feed_update.assert_not_awaited()
        self.bot.session.close.assert_not_awaited()

    async def test_duplicate_headers_are_rejected_before_processing(self):
        cases = (
            [(HEADER, TEST_SECRET), (HEADER, TEST_SECRET)],
            [(HEADER, TEST_SECRET), (HEADER, 'wrong_secret')],
        )
        for index, headers in enumerate(cases):
            with self.subTest(case=index):
                with (
                    patch.object(
                        self.module.Request, 'json',
                        new_callable=AsyncMock,
                    ) as read_json,
                    patch.object(self.module, 'Update') as update,
                ):
                    response = await self.client.post(
                        '/api/support/webhook',
                        headers=headers,
                        content=b'not-json',
                    )
                self.assertEqual(response.status_code, 403)
                self.assertEqual(
                    response.json(), {'detail': 'Forbidden'}
                )
                read_json.assert_not_awaited()
                update.assert_not_called()
        self.bot_factory.assert_not_called()
        self.module.dp.feed_update.assert_not_awaited()

    async def test_missing_header_does_not_read_body(self):
        with patch.object(
            self.module.Request, 'json', new_callable=AsyncMock
        ) as read_json:
            response = await self.client.post(
                '/api/support/webhook', content=b'not-json'
            )
        self.assertEqual(response.status_code, 403)
        read_json.assert_not_awaited()
        self.bot_factory.assert_not_called()

    async def test_malformed_json_closes_session_without_dispatch(self):
        response = await self.client.post(
            '/api/support/webhook',
            headers={HEADER: TEST_SECRET},
            content=b'not-json',
        )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {'status': 'error'})
        self.module.dp.feed_update.assert_not_awaited()
        self.bot.session.close.assert_awaited_once()

    async def test_update_validation_failure_closes_session(self):
        response = await self.client.post(
            '/api/support/webhook',
            headers={HEADER: TEST_SECRET},
            json={'update_id': 'not-an-integer'},
        )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {'status': 'error'})
        self.module.dp.feed_update.assert_not_awaited()
        self.bot.session.close.assert_awaited_once()

    async def test_dispatch_failure_is_sanitized_and_closes_session(self):
        self.module.dp.feed_update.side_effect = RuntimeError(
            f'{TEST_SECRET} {TEST_TOKEN}'
        )
        with self.assertLogs(self.module.logger, level='ERROR') as logs:
            response = await self.client.post(
                '/api/support/webhook',
                headers={HEADER: TEST_SECRET},
                json={'update_id': 1},
            )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {'status': 'error'})
        self.module.dp.feed_update.assert_awaited_once()
        self.bot.session.close.assert_awaited_once()
        for credential in (TEST_SECRET, TEST_TOKEN):
            self.assertNotIn(credential, response.text)
            self.assertNotIn(credential, '\n'.join(logs.output))

    async def test_close_failure_is_sanitized(self):
        self.bot.session.close.side_effect = RuntimeError(
            f'{TEST_SECRET} {TEST_TOKEN}'
        )
        with self.assertLogs(self.module.logger, level='WARNING') as logs:
            response = await self.client.post(
                '/api/support/webhook',
                headers={HEADER: TEST_SECRET},
                json={'update_id': 1},
            )
        self.assertEqual(response.status_code, 200)
        self.bot.session.close.assert_awaited_once()
        for credential in (TEST_SECRET, TEST_TOKEN):
            self.assertNotIn(credential, response.text)
            self.assertNotIn(credential, '\n'.join(logs.output))

    async def test_rejection_does_not_log_credentials(self):
        wrong_secret = 'synthetic_wrong_secret_123'
        with self.assertLogs(self.module.logger, level='WARNING') as logs:
            response = await self.client.post(
                '/api/support/webhook',
                headers={HEADER: wrong_secret},
                json={'update_id': 1},
            )
        self.assertEqual(response.status_code, 403)
        for credential in (TEST_SECRET, TEST_TOKEN, wrong_secret):
            self.assertNotIn(credential, response.text)
            self.assertNotIn(credential, '\n'.join(logs.output))

    async def test_get_remains_public_without_creating_bot(self):
        response = await self.client.get('/api/support/webhook')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()['status'], 'support webhook alive'
        )
        self.bot_factory.assert_not_called()
        self.module.dp.feed_update.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()