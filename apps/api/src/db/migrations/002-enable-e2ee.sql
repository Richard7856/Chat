-- Fase 4: E2EE vía libsodium crypto_box.
--
-- Los mensajes pasan de `messages.content` (texto plano) a
-- `message_envelopes.ciphertext + nonce`, un sobre por cada dispositivo
-- destinatario. Los mensajes viejos con content != NULL siguen visibles
-- como "sin cifrar" (legado Fase 3).
--
-- Aplicar en el VPS:
--   source infra/.env && docker exec -i euromex-postgres psql \
--     -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     < apps/api/src/db/migrations/002-enable-e2ee.sql

-- Añade columna nonce al sobre (faltaba en Fase 1).
ALTER TABLE message_envelopes
  ADD COLUMN IF NOT EXISTS nonce BYTEA;

-- Permite que un dispositivo publique su clave pública de identidad tras
-- enrolarse. Ya era nullable, pero añadimos índice para lookups rápidos.
CREATE INDEX IF NOT EXISTS idx_devices_active_ids
  ON devices (id) WHERE status = 'active' AND identity_public_key IS NOT NULL;
