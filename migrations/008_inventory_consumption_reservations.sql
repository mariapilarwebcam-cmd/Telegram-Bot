-- 008: exclusivamente aditiva, sin activacion, backfill ni cambios en 007.
-- IF NOT EXISTS permite reaplicar; no valida objetos preexistentes diferentes.
-- user_inventory sigue siendo la unica fuente de existencias disponibles.
-- Verificar esquema real antes de desplegar. Referencias legacy logicas.
--
-- SEGURIDAD: escrituras SOLO desde backend con credenciales privadas, nunca
-- distribuidas al cliente. SQLite/triggers no autentican al proceso escritor.
-- Integracion/verificacion de creadores TypeScript y Python PENDIENTES.
-- NO conceder derechos desde acreditaciones antes de verificar esos controles.
--
-- CONTRATO PENDIENTE DE INTEGRACION (no modifica rutas):
-- Una reserva por copia; clave estable vinculada a operacion original antes del
-- consumo. Replay compara identidad COMPLETA: usuario, clase/clave de operacion,
-- copia, tipo/clave de item. Diferencia = conflicto. Nunca INSERT OR REPLACE.
-- INSERT pending + DELETE por id/usuario/tipo/clave comprobando RETURNING en la
-- MISMA transaction('write'). inventory.id debe seguir AUTOINCREMENT: no asignar
-- ids manualmente, reutilizarlos ni resetear sqlite_sequence.
-- UPDATE WHERE status='pending' RETURNING para resolver. Reembolso: INSERT con
-- tipo/clave originales y resolucion refunded en la MISMA transaccion. Replay
-- terminal sin efectos; resultado contrario = conflicto. No mantener transaccion
-- durante proveedores. Resultado desconocido conserva pending hasta reconciliar;
-- no expirar automaticamente. Los triggers NO ejecutan consumo/reembolso.
-- Reembolso no es nueva recepcion ni se sustituye por compensacion.
-- Capacidad por tipo = disponibles + pending, incluyendo claves legacy distintas.
-- Slots = UNION DISTINCT (tipo,clave) de disponibles y pending, canonicalizados
-- igual en ambos origenes; no sumar slots separados. Admisiones/resoluciones en
-- transaccion de escritura. Conservar excesos legacy y posibles devoluciones.

CREATE TABLE IF NOT EXISTS inventory_consumption_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL CHECK (length(trim(user_id)) > 0),
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('image', 'audio')),
    operation_key TEXT NOT NULL CHECK (length(trim(operation_key)) > 0),
    consumed_inventory_id INTEGER NOT NULL UNIQUE
        CHECK (typeof(consumed_inventory_id) = 'integer' AND consumed_inventory_id > 0),
    item_type TEXT NOT NULL CHECK (item_type IN ('photo_token', 'audio_token', 'fantasy_pass')),
    item_key TEXT NOT NULL CHECK (length(trim(item_key)) > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'refunded')),
    refunded_inventory_id INTEGER UNIQUE CHECK (refunded_inventory_id IS NULL OR
        (typeof(refunded_inventory_id) = 'integer' AND refunded_inventory_id > 0)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (length(trim(created_at)) > 0),
    resolved_at TEXT,
    UNIQUE (user_id, operation_kind, operation_key),
    CHECK ((operation_kind = 'audio' AND item_type = 'audio_token') OR
        (operation_kind = 'image' AND item_type IN ('photo_token', 'fantasy_pass'))),
    CHECK ((status = 'pending' AND resolved_at IS NULL AND refunded_inventory_id IS NULL)
        OR (status = 'succeeded' AND resolved_at IS NOT NULL AND length(trim(resolved_at)) > 0
            AND refunded_inventory_id IS NULL)
        OR (status = 'refunded' AND resolved_at IS NOT NULL AND length(trim(resolved_at)) > 0
            AND refunded_inventory_id IS NOT NULL)),
    CHECK (refunded_inventory_id IS NULL OR refunded_inventory_id <> consumed_inventory_id)
);
CREATE INDEX IF NOT EXISTS inventory_reservations_pending_capacity
    ON inventory_consumption_reservations (user_id, status, item_type, item_key);
CREATE TRIGGER IF NOT EXISTS inventory_reservations_initial_state
BEFORE INSERT ON inventory_consumption_reservations WHEN NEW.status <> 'pending'
BEGIN
    SELECT RAISE(ABORT, 'reservation must start pending');
END;
-- Explicit guard prevents REPLACE even with recursive_triggers disabled.
CREATE TRIGGER IF NOT EXISTS inventory_reservations_no_replace
BEFORE INSERT ON inventory_consumption_reservations
WHEN EXISTS (SELECT 1 FROM inventory_consumption_reservations
    WHERE id = NEW.id OR consumed_inventory_id = NEW.consumed_inventory_id
        OR (user_id = NEW.user_id AND operation_kind = NEW.operation_kind
            AND operation_key = NEW.operation_key))
BEGIN
    SELECT RAISE(ABORT, 'reservation already exists; compare full identity');
END;
CREATE TRIGGER IF NOT EXISTS inventory_reservations_identity
BEFORE UPDATE ON inventory_consumption_reservations
WHEN NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id
    OR NEW.operation_kind IS NOT OLD.operation_kind OR NEW.operation_key IS NOT OLD.operation_key
    OR NEW.consumed_inventory_id IS NOT OLD.consumed_inventory_id
    OR NEW.item_type IS NOT OLD.item_type OR NEW.item_key IS NOT OLD.item_key
    OR NEW.created_at IS NOT OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'reservation identity is immutable');
END;
CREATE TRIGGER IF NOT EXISTS inventory_reservations_resolution
BEFORE UPDATE ON inventory_consumption_reservations
WHEN OLD.status <> 'pending' OR NEW.status NOT IN ('succeeded', 'refunded')
BEGIN
    SELECT RAISE(ABORT, 'reservation resolution is terminal');
END;
CREATE TRIGGER IF NOT EXISTS inventory_reservations_no_delete
BEFORE DELETE ON inventory_consumption_reservations
BEGIN
    SELECT RAISE(ABORT, 'reservation ledger cannot be deleted');
END;

-- Vacia al instalar. INSERT id=1 explicito tras actualizar TODOS los escritores
-- y drenar/reconciliar operaciones previas. Capturar MAX(gacha_history.id) en la
-- misma transaccion: SOLO auditoria, NO prueba de historico cero/completo.
-- Fecha epoch UTC en segundos. Nunca usar users.rowid para acreditar antiguedad.
CREATE TABLE IF NOT EXISTS inventory_limits_activation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    activation_key TEXT NOT NULL UNIQUE CHECK (length(trim(activation_key)) > 0),
    activated_at INTEGER NOT NULL DEFAULT (unixepoch())
        CHECK (typeof(activated_at) = 'integer' AND activated_at > 0),
    gacha_history_watermark INTEGER NOT NULL
        CHECK (typeof(gacha_history_watermark) = 'integer' AND gacha_history_watermark >= 0)
);
CREATE TRIGGER IF NOT EXISTS inventory_activation_no_replace
BEFORE INSERT ON inventory_limits_activation
WHEN EXISTS (SELECT 1 FROM inventory_limits_activation)
BEGIN
    SELECT RAISE(ABORT, 'inventory activation already exists');
END;
CREATE TRIGGER IF NOT EXISTS inventory_activation_no_update
BEFORE UPDATE ON inventory_limits_activation
BEGIN
    SELECT RAISE(ABORT, 'inventory activation is immutable');
END;
CREATE TRIGGER IF NOT EXISTS inventory_activation_no_delete
BEFORE DELETE ON inventory_limits_activation
BEGIN
    SELECT RAISE(ABORT, 'inventory activation is immutable');
END;

-- Atestacion explicita permanente por identidad Telegram, incluso al recrear users.
-- No se llena automaticamente ni modifica legacy_history_complete de 007.
-- Dependencia entrega B: integrar createUser (TS) y creador Python en transacciones
-- coordinando users, telegram_ids_seen y acreditacion. Ausencia en users/seen NO
-- prueba primera alta. Exigir evidencia verificable de cobertura historica COMPLETA
-- del registro seen y de esta primera alta. Flujos actuales toleran fallos de seen:
-- NO presumir cobertura fiable. Sin prueba NO acreditar. Seen previo/recreacion
-- no obtiene nueva acreditacion; conservar prueba/ledger/contadores al recrear.
-- Nunca reiniciar recepciones. Comparar todos los campos ante replay. El texto
-- almacena evidencia, no verifica su verdad: solo backend autorizado puede atestar.
-- Sin historico acreditado: politica conservadora para nuevos premios de outfits
-- (40 mensajes), conservando objetos/equipamiento anteriores. Sin backfill.
CREATE TABLE IF NOT EXISTS inventory_user_creation_evidence (
    user_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(user_id)) > 0),
    activation_key TEXT NOT NULL CHECK (length(trim(activation_key)) > 0),
    creation_operation_key TEXT NOT NULL UNIQUE CHECK (length(trim(creation_operation_key)) > 0),
    source TEXT NOT NULL CHECK (source IN ('typescript', 'python')),
    first_created_at INTEGER NOT NULL
        CHECK (typeof(first_created_at) = 'integer' AND first_created_at > 0),
    creation_evidence TEXT NOT NULL CHECK (length(trim(creation_evidence)) > 0),
    seen_registry_evidence TEXT NOT NULL CHECK (length(trim(seen_registry_evidence)) > 0)
);
CREATE TRIGGER IF NOT EXISTS inventory_creation_activation
BEFORE INSERT ON inventory_user_creation_evidence
WHEN NOT EXISTS (SELECT 1 FROM inventory_limits_activation
    WHERE activation_key = NEW.activation_key AND activated_at <= NEW.first_created_at)
BEGIN
    SELECT RAISE(ABORT, 'creation evidence requires matching prior activation');
END;
CREATE TRIGGER IF NOT EXISTS inventory_creation_no_replace
BEFORE INSERT ON inventory_user_creation_evidence
WHEN EXISTS (SELECT 1 FROM inventory_user_creation_evidence
    WHERE user_id = NEW.user_id OR creation_operation_key = NEW.creation_operation_key)
BEGIN
    SELECT RAISE(ABORT, 'creation evidence already exists; compare full identity');
END;
CREATE TRIGGER IF NOT EXISTS inventory_creation_no_update
BEFORE UPDATE ON inventory_user_creation_evidence
BEGIN
    SELECT RAISE(ABORT, 'creation evidence is immutable');
END;
CREATE TRIGGER IF NOT EXISTS inventory_creation_no_delete
BEFORE DELETE ON inventory_user_creation_evidence
BEGIN
    SELECT RAISE(ABORT, 'creation evidence is immutable');
END;