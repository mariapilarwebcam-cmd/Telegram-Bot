-- 007_inventory_gift_ledger.sql
-- Fase 1: base ADITIVA, sin activacion funcional ni derechos retroactivos.
-- No INSERT, backfill, ALTER ni escrituras sobre tablas existentes.
-- user_inventory sigue siendo la unica fuente de existencias disponibles.
-- Reaplicable: IF NOT EXISTS no verifica/repara objetos preexistentes distintos.
-- Compatible con los tipos documentados en README: telegram_id/outfit TEXT,
-- character/message/image/inventory id INTEGER. No prueba el esquema remoto.
-- Referencias logicas, sin FK a tablas legacy: antes de activar, verificar su
-- esquema real. La futura ruta debe validar propietario, personaje desbloqueado,
-- catalogo y mensajes/imagen; esta migracion NO autoriza por si sola un regalo.
--
-- CONTRATO PARA FASE 2 (no implementado aqui):
-- * Crear evento SOLO junto al consumo real de una copia, asignacion permanente
--   y agradecimiento persistido, en la MISMA transaccion de escritura.
-- * Validar usuario e identidad completa al recuperar por idempotency_key.
--   Un conflicto con otro payload no es un nuevo regalo ni un exito equivalente.
-- * Reclamar pending/failed o generating con lease vencido mediante UPDATE
--   condicional atomico, token nuevo, lease futuro y attempt_count + 1.
-- * Finalizar/fallar SOLO WHERE id, user_id, photo_status='generating',
--   claim_token coinciden y lease_until > :now. Insertar mensaje de foto y
--   confirmar ready en la misma transaccion; si se pierde el claim, rollback.
-- * Un ready se devuelve sin regenerar. No mantener transaccion durante IA/R2.
-- * Un lease vencido permite recuperacion; no demuestra una unica llamada al
--   proveedor tras una caida. Los tokens cercan la PUBLICACION, no la IA externa.
-- * La transicion SQL no comprueba el reloj ni la autenticacion: son condiciones
--   obligatorias de las futuras consultas. No habilitar acceso directo cliente.

CREATE TABLE IF NOT EXISTS gift_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL CHECK (length(trim(user_id)) > 0),
    character_id INTEGER NOT NULL
        CHECK (typeof(character_id) = 'integer' AND character_id > 0),
    outfit_key TEXT NOT NULL CHECK (length(trim(outfit_key)) > 0),
    idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
    consumed_inventory_id INTEGER NOT NULL UNIQUE
        CHECK (typeof(consumed_inventory_id) = 'integer' AND consumed_inventory_id > 0),
    thank_you_message_id INTEGER NOT NULL UNIQUE
        CHECK (typeof(thank_you_message_id) = 'integer' AND thank_you_message_id > 0),

    photo_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (photo_status IN ('pending', 'generating', 'ready', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),
    claim_token TEXT CHECK (claim_token IS NULL OR length(trim(claim_token)) > 0),
    lease_until INTEGER CHECK (lease_until IS NULL OR
        (typeof(lease_until) = 'integer' AND lease_until > 0)),
    image_id INTEGER UNIQUE CHECK (image_id IS NULL OR
        (typeof(image_id) = 'integer' AND image_id > 0)),
    photo_message_id INTEGER UNIQUE CHECK (photo_message_id IS NULL OR
        (typeof(photo_message_id) = 'integer' AND photo_message_id > 0)),
    completed_at INTEGER CHECK (completed_at IS NULL OR
        (typeof(completed_at) = 'integer' AND completed_at > 0)),
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (user_id, character_id, outfit_key),
    UNIQUE (user_id, idempotency_key),
    CHECK (
        (photo_status = 'generating' AND claim_token IS NOT NULL
            AND lease_until IS NOT NULL AND attempt_count > 0)
        OR (photo_status <> 'generating' AND claim_token IS NULL AND lease_until IS NULL)
    ),
    CHECK (photo_status <> 'pending' OR attempt_count = 0),
    CHECK (photo_status NOT IN ('failed', 'ready') OR attempt_count > 0),
    CHECK (
        (photo_status = 'ready' AND image_id IS NOT NULL
            AND photo_message_id IS NOT NULL AND completed_at IS NOT NULL)
        OR (photo_status <> 'ready' AND image_id IS NULL
            AND photo_message_id IS NULL AND completed_at IS NULL)
    ),
    CHECK (photo_message_id IS NULL OR photo_message_id <> thank_you_message_id)
);

CREATE INDEX IF NOT EXISTS gift_events_photo_recovery
    ON gift_events (photo_status, lease_until);

-- Ningun INSERT puede fabricar un resultado ya completado o un claim previo.
CREATE TRIGGER IF NOT EXISTS gift_events_initial_state
BEFORE INSERT ON gift_events
WHEN NEW.photo_status <> 'pending' OR NEW.attempt_count <> 0
BEGIN
    SELECT RAISE(ABORT, 'gift event must start pending');
END;

CREATE TRIGGER IF NOT EXISTS gift_events_immutable_identity
BEFORE UPDATE ON gift_events
WHEN NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id
    OR NEW.character_id IS NOT OLD.character_id OR NEW.outfit_key IS NOT OLD.outfit_key
    OR NEW.idempotency_key IS NOT OLD.idempotency_key
    OR NEW.consumed_inventory_id IS NOT OLD.consumed_inventory_id
    OR NEW.thank_you_message_id IS NOT OLD.thank_you_message_id
    OR NEW.created_at IS NOT OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'gift identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS gift_events_photo_transition
BEFORE UPDATE ON gift_events
WHEN NOT (
    (OLD.photo_status IN ('pending', 'failed') AND NEW.photo_status = 'generating')
    OR (OLD.photo_status = 'generating' AND NEW.photo_status IN ('generating', 'ready', 'failed'))
)
BEGIN
    SELECT RAISE(ABORT, 'invalid gift photo transition');
END;

-- Cada nueva reserva aumenta exactamente una vez; renovar el mismo token no.
CREATE TRIGGER IF NOT EXISTS gift_events_attempt_sequence
BEFORE UPDATE ON gift_events
WHEN NEW.attempt_count <> OLD.attempt_count + CASE
    WHEN NEW.photo_status = 'generating'
        AND (OLD.photo_status <> 'generating' OR NEW.claim_token IS NOT OLD.claim_token)
    THEN 1 ELSE 0 END
BEGIN
    SELECT RAISE(ABORT, 'invalid gift attempt sequence');
END;

-- Conserva la idempotencia permanente. Una futura politica de borrado de datos
-- personales debe revisar este trigger explicitamente, no borrar silenciosamente.
CREATE TRIGGER IF NOT EXISTS gift_events_no_delete
BEFORE DELETE ON gift_events
BEGIN
    SELECT RAISE(ABORT, 'gift ledger cannot be deleted');
END;

-- Seguimiento por outfit, NO saldo disponible ni contador de regalos.
-- recorded_received cuenta SOLO recepciones desde tracking_started_at, que la
-- futura entrega de premios debe incrementar en su transaccion. No tiene limite
-- CHECK de 15: primero debe resolverse honestamente la politica historica.
-- legacy_received_minimum es evidencia previa minima, NO un total inventado.
-- legacy_history_complete=0 significa que el total de por vida es DESCONOCIDO;
-- 1 solo se permite operativamente tras acreditar el total previo completo.
-- No se siembran filas ni se derivan cifras del inventario/armarios/historial.
CREATE TABLE IF NOT EXISTS outfit_receipt_tracking (
    user_id TEXT NOT NULL CHECK (length(trim(user_id)) > 0),
    outfit_key TEXT NOT NULL CHECK (length(trim(outfit_key)) > 0),
    tracking_started_at TEXT NOT NULL,
    recorded_received INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(recorded_received) = 'integer' AND recorded_received >= 0),
    legacy_received_minimum INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(legacy_received_minimum) = 'integer' AND legacy_received_minimum >= 0),
    legacy_history_complete INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(legacy_history_complete) = 'integer' AND legacy_history_complete IN (0, 1)),
    legacy_evidence TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, outfit_key),
    CHECK (length(trim(tracking_started_at)) > 0),
    CHECK ((legacy_received_minimum = 0 AND legacy_history_complete = 0)
        OR (legacy_evidence IS NOT NULL AND length(trim(legacy_evidence)) > 0))
);