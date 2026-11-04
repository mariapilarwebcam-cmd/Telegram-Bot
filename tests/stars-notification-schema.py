"""Compatibilidad entre la migracion 006, las consultas SQL y la integracion.

Solo SQLite en memoria y analisis estatico con AST.
Sin Turso, sin Telegram, sin red y sin credenciales.
"""
import ast
import re
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_PATH = ROOT / 'api' / 'bot' / 'telegrabot.py'
MIGRATION_PATH = ROOT / 'migrations' / '006_referral_commission_notifications.sql'

FUNCTIONS = (
    '_iso_ms', '_backoff_seconds', '_notification_state', '_star_commission',
    '_claim_notification', '_finish_notification', '_exhaust_notification',
    '_release_preparation_claim', '_classify_telegram_error',
    '_build_notification_text', '_notify_referral_commission',
)

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


def load_tree():
    return ast.parse(SOURCE_PATH.read_text(encoding='utf-8'))


def sql_literals():
    """(funcion, sql) de cada sentencia literal de las 11 funciones."""
    found = []
    for node in load_tree().body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in FUNCTIONS:
            for inner in ast.walk(node):
                if isinstance(inner, ast.Constant) and isinstance(inner.value, str):
                    text = inner.value.strip()
                    if text.startswith(('SELECT', 'UPDATE', 'INSERT')):
                        found.append((node.name, text))
    return found


def is_applied_test(node):
    return (isinstance(node, ast.Compare)
            and getattr(node.left, 'id', None) == 'status'
            and len(node.comparators) == 1
            and isinstance(node.comparators[0], ast.Constant)
            and node.comparators[0].value == 'applied')


class SchemaCompatibility(unittest.TestCase):
    def setUp(self):
        self.con = sqlite3.connect(':memory:')
        self.con.executescript(BASE_SCHEMA)
        self.con.executescript(MIGRATION_PATH.read_text(encoding='utf-8'))
        self.con.commit()

    def test_01_tables_and_indexes_exist(self):
        names = {r[0] for r in self.con.execute('SELECT name FROM sqlite_master')}
        for expected in ('referral_commission_notifications',
                         'referral_notification_state',
                         'referral_commission_notifications_due',
                         'referral_commission_notifications_lease'):
            self.assertIn(expected, names)

    def test_02_state_is_enabled_by_default(self):
        row = self.con.execute(
            'SELECT enabled, min_commission_id, activated_at '
            'FROM referral_notification_state WHERE id = 1').fetchone()
        self.assertEqual(row[0], 1, 'enabled debe nacer activo')
        self.assertEqual(row[1], 0, 'sin comisiones historicas el corte es 0')
        self.assertIsNotNone(row[2], 'el punto de inicio debe quedar registrado')

    def test_02b_starting_point_is_max_id(self):
        con = sqlite3.connect(':memory:')
        con.executescript(BASE_SCHEMA)
        con.execute(
            "INSERT INTO referral_commissions (referrer_id, referred_id, "
            "purchase_gems, commission_gems, commission_pct, source, reference) "
            "VALUES ('r','b',315,15,5,'stars','ch-1')")
        con.execute(
            "INSERT INTO referral_commissions (referrer_id, referred_id, "
            "purchase_gems, commission_gems, commission_pct, source, reference) "
            "VALUES ('r','b',600,30,5,'stars','ch-2')")
        con.executescript(MIGRATION_PATH.read_text(encoding='utf-8'))
        row = con.execute(
            'SELECT enabled, min_commission_id FROM referral_notification_state '
            'WHERE id = 1').fetchone()
        self.assertEqual(row, (1, 2),
                         'el corte debe excluir las comisiones ya existentes')

    def test_03_migration_is_idempotent(self):
        self.con.executescript(MIGRATION_PATH.read_text(encoding='utf-8'))
        count = self.con.execute(
            'SELECT COUNT(*) FROM referral_notification_state').fetchone()[0]
        self.assertEqual(count, 1)

    def test_04_expected_columns(self):
        notif = {r[1] for r in self.con.execute(
            'PRAGMA table_info(referral_commission_notifications)')}
        for column in ('referral_commission_id', 'referrer_id', 'referred_id',
                       'reference', 'status', 'attempt_count', 'claim_token',
                       'lease_until', 'next_attempt_at', 'last_error', 'sent_at'):
            self.assertIn(column, notif)
        state = {r[1] for r in self.con.execute(
            'PRAGMA table_info(referral_notification_state)')}
        for column in ('enabled', 'min_commission_id', 'activated_at'):
            self.assertIn(column, state)

    def test_05_every_sql_is_valid_against_schema(self):
        statements = sql_literals()
        self.assertGreaterEqual(len(statements), 10,
                                f'se esperaban >=10 sentencias, hay {len(statements)}')
        for name, sql in statements:
            placeholders = sql.count('?')
            try:
                self.con.execute('EXPLAIN ' + sql, [None] * placeholders)
            except sqlite3.Error as exc:
                self.fail(f'{name}: SQL incompatible con el esquema -> {exc}\n{sql}')

    def test_06_no_economic_writes(self):
        pattern = re.compile(
            r'\b(?:INSERT\s+INTO|UPDATE)\s+(?:users|gem_transactions|referral_commissions)\b',
            re.IGNORECASE)
        for name, sql in sql_literals():
            self.assertIsNone(pattern.search(sql),
                              f'{name} escribe en tablas economicas: {sql}')

    def test_07_notification_call_inside_applied_branch(self):
        tree = load_tree()
        function = next((n for n in tree.body
                         if isinstance(n, ast.AsyncFunctionDef)
                         and n.name == 'record_star_purchase'), None)
        self.assertIsNotNone(function, 'no se encontro record_star_purchase')
        applied = None
        for node in ast.walk(function):
            if isinstance(node, ast.If) and is_applied_test(node.test):
                applied = node
                break
        self.assertIsNotNone(applied, "no se encontro if status == 'applied'")

        call_index = None
        return_index = None
        for index, stmt in enumerate(applied.body):
            if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Await):
                call = stmt.value.value
                if isinstance(call, ast.Call) and getattr(call.func, 'id', None) == '_notify_referral_commission':
                    call_index = index
                    names = [getattr(arg, 'id', None) for arg in call.args]
                    self.assertEqual(names, ['result', 'telegram_id', 'charge_id', 'bot'])
            if (isinstance(stmt, ast.Return)
                    and isinstance(stmt.value, ast.Constant)
                    and stmt.value.value == 'applied'):
                return_index = index

        self.assertIsNotNone(call_index, 'falta la llamada a _notify_referral_commission')
        self.assertIsNotNone(return_index, "falta return 'applied'")
        self.assertLess(call_index, return_index,
                        'la notificacion debe ejecutarse antes de return applied')

    def test_08_five_error_codes_documented(self):
        constants = []
        for node in load_tree().body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in FUNCTIONS:
                for inner in ast.walk(node):
                    if isinstance(inner, ast.Constant) and isinstance(inner.value, str):
                        constants.append(inner.value)
        blob = '\n'.join(constants)
        self.assertTrue(blob.strip(), 'no se extrajo codigo de las funciones de notificacion')
        for code in ('rejected_permanent', 'attempts_exhausted',
                     'unknown_delivery', 'db_error', 'referrer_missing'):
            self.assertIn(code, blob, f'falta la clasificacion {code}')


if __name__ == '__main__':
    unittest.main(verbosity=2)
