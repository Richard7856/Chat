-- Fase 5: adjuntos cifrados E2EE.
-- El archivo cifrado (AES-256-GCM cliente-side) se almacena en disco; solo
-- los metadatos de dueño/conversación/tamaño quedan en DB. La clave AES
-- viaja dentro del plaintext del mensaje → cifrada por dispositivo vía
-- NaCl box. El server nunca ve nombre, MIME ni contenido del archivo.
--
-- Aplicar en VPSs que vengan de Fase 4:
--   source infra/.env && docker exec -i euromex-postgres psql \
--     -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     < apps/api/src/db/migrations/003-add-attachments.sql

CREATE TABLE IF NOT EXISTS attachments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  uploader_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploader_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  storage_key        TEXT NOT NULL UNIQUE,
  byte_size          BIGINT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_conv ON attachments(conversation_id);
