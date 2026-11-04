-- 006_referral_commission_notifications.sql
-- Libro de entrega de notificaciones de comisión de referidos (Telegram Stars).
--
-- ADITIVO: no toca filas, saldos, comisiones, precios ni promociones.
-- FUENTE ECONÓMICA DE VERDAD: referral_commissions (solo la escribe TypeScript).
-- ESCRITOR DE ESTAS TABLAS: únicamente el bot (Python). Nunca saldos ni comisiones.
--
-- COMPATIBILIDAD Turso/libSQL: CHECK, UNIQUE, índices, INSERT OR IGNORE,
-- AUTOINCREMENT, CURRENT_TIMESTAMP y strftime('%Y-%m-%dT%H:%M:%fZ','now').
-- No se usa RETURNING (el cliente HTTP del bot no devuelve filas en execute).
-- No se usan transacciones multi-sentencia (el cliente envía 1 sentencia/petición).
--
-- REGLAS DE OPERACIÓN (documentadas aquí y aplicadas por el bot):
--   * El claim DEBE respetar next_attempt_at: una fila 'pending' solo se
--     reclama si next_attempt_at IS NULL OR next_attempt_at <= :now.
--   * Los estados 'sent' y 'failed' NUNCA se reclaman automáticamente.
--   * Los reintentos agotados (attempt_count >= 5) pasan a 'failed' y quedan
--     para REVISIÓN MANUAL; no se borran ni se reintentan solos.
--   * El sistema DEBE filtrar source = 'stars' (las comisiones crypto usan
--     source = 'crypto' y no se notifican por este canal).
--   * 'enabled' es un INTERRUPTOR DE EMERGENCIA: la instalación nace con
--     enabled = 1; el envío inmediato y el barrido deben respetar enabled = 0
--     para detener las notificaciones sin desplegar código.
--   * Punto de inicio: min_commission_id = MAX(id) de referral_commissions en
--     el momento de instalar. Lo anterior nunca se notifica; toda comisión
--     nueva (id mayor) queda habilitada sin pasos posteriores.

-- 1. Libro de entrega: una fila por comisión, con claim por token y lease.
CREATE TABLE IF NOT EXISTS referral_commission_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Clave de idempotencia: una comisión no puede tener dos entregas.
    referral_commission_id INTEGER NOT NULL,

    referrer_id TEXT NOT NULL,
    referred_id TEXT NOT NULL,
    reference   TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed')),

    attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),

    -- Propiedad del envío en curso: solo el dueño del token puede confirmar.
    claim_token TEXT,
    lease_until TEXT,

    next_attempt_at TEXT,
    last_error      TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at    TEXT,

    UNIQUE (referral_commission_id),

    -- 'sending' exige claim + lease; cualquier otro estado los prohíbe.
    CHECK (
        (status = 'sending' AND claim_token IS NOT NULL AND lease_until IS NOT NULL)
        OR
        (status <> 'sending' AND claim_token IS NULL AND lease_until IS NULL)
    ),

    -- 'sent' exige marca temporal de envío.
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);

-- 2. Índices del barrido.
CREATE INDEX IF NOT EXISTS referral_commission_notifications_due
    ON referral_commission_notifications (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS referral_commission_notifications_lease
    ON referral_commission_notifications (status, lease_until);

-- 3. Estado de activación (una sola fila).
CREATE TABLE IF NOT EXISTS referral_notification_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),

    -- Cota inferior EXCLUSIVA: solo se notifican comisiones con id > este valor.
    min_commission_id INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(min_commission_id) = 'integer' AND min_commission_id >= 0),

    -- 0 = notificaciones desactivadas (envío inmediato y barrido).
    enabled INTEGER NOT NULL DEFAULT 1
        CHECK (enabled IN (0, 1)),

    activated_at TEXT,
    updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Fila de configuración: habilitada y con punto de inicio coherente.
INSERT OR IGNORE INTO referral_notification_state
    (id, min_commission_id, enabled, activated_at, updated_at)
VALUES (
    1,
    (SELECT COALESCE(MAX(id), 0) FROM referral_commissions),
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

-- Verificación (solo lectura):
--   SELECT name FROM sqlite_master
--    WHERE name IN ('referral_commission_notifications', 'referral_notification_state',
--                   'referral_commission_notifications_due',
--                   'referral_commission_notifications_lease');
--   SELECT * FROM referral_notification_state;
--   SELECT status, COUNT(*) FROM referral_commission_notifications GROUP BY status;
