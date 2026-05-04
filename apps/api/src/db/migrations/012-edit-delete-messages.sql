-- Fase 25: Editar y borrar mensajes con auditoría preservada.
--
-- Filosofía: soft delete + edit-history. Los usuarios regulares ven el
-- estado actual del mensaje (con "(editado)" si aplica, o un tombstone si
-- fue borrado), pero los envelopes originales NO se eliminan — quedan en
-- `message_envelopes_history` para que admins (que tengan acceso por ser
-- miembros de la conversación) puedan auditar el historial completo en
-- caso de filtraciones, abusos o disputas.
--
-- Limitación E2EE: el admin solo puede DESCIFRAR contenido si era miembro
-- de la conversación cuando el mensaje original se envió. Para conversaciones
-- en las que no participa, ve metadata (quién editó/borró, cuándo) pero no
-- puede leer plaintext. Esto es coherente con el modelo de seguridad y honesto
-- sobre los límites de E2EE.

-- 1) Marcadores de edit / delete en el mensaje base
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_count     INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by     UUID         REFERENCES users(id) ON DELETE SET NULL;

-- Índice parcial: optimiza el filtro "mensajes borrados de esta conv"
-- (lo necesita el admin para listar tombstones).
CREATE INDEX IF NOT EXISTS idx_messages_deleted
  ON messages(conversation_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 2) Histórico de envelopes — al editar, los envelopes de la versión
-- anterior se mueven aquí antes de insertar los nuevos en
-- `message_envelopes`.
CREATE TABLE IF NOT EXISTS message_envelopes_history (
  message_id       UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  -- Empieza en 1. La versión actual vive en `message_envelopes` (siempre la
  -- versión `edit_count + 1` según el contador del mensaje).
  version_number   INT  NOT NULL CHECK (version_number >= 1),
  recipient_device UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ciphertext       BYTEA NOT NULL,
  nonce            BYTEA,
  archived_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, version_number, recipient_device)
);

CREATE INDEX IF NOT EXISTS idx_envelopes_history_message
  ON message_envelopes_history(message_id, version_number);
