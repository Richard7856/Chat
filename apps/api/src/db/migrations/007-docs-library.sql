-- Fase 14 — Biblioteca de documentos
-- Agrega: vínculo attachment→message, PIN de descarga, control de acceso.

-- Vincula el attachment al mensaje E2EE que lo referencia.
-- Permite que el panel de documentos sepa qué mensaje tiene la clave AES.
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

-- Hash bcrypt del PIN de descarga (opcional). Si es NULL no se requiere PIN.
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS download_pin_hash TEXT;

-- 'all' = todos los miembros de la conversación pueden descargar.
-- 'restricted' = solo los usuarios en attachment_allowed_users.
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS access_type TEXT NOT NULL DEFAULT 'all'
    CHECK (access_type IN ('all', 'restricted'));

-- Lista blanca de usuarios con acceso cuando access_type = 'restricted'.
CREATE TABLE IF NOT EXISTS attachment_allowed_users (
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  PRIMARY KEY (attachment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_attachment_allowed
  ON attachment_allowed_users(attachment_id);
