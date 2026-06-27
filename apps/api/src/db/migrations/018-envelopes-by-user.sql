-- Fase 31 Capa 7 — mensajería por usuario (corte limpio).
-- Ver docs/FASE-31-IDENTIDAD-ESCROW.md §6 y ADR-040.
--
-- Cambia los envelopes de "por dispositivo" a "por usuario": un envelope por
-- usuario destinatario, cifrado a su identidad compartida entre devices.
--
-- ⚠️ CORTE LIMPIO: el historial actual es de prueba (confirmado con el
-- cliente). Se borra. Usuarios, dispositivos e identidades se preservan.

-- 1) Corte limpio del historial de chat (CASCADE borra envelopes, adjuntos,
--    starred, etc. que referencian estas tablas). users / devices /
--    user_identities NO se tocan.
TRUNCATE TABLE messages, conversations, conversation_members CASCADE;

-- 2) message_envelopes: recipient_device → recipient_user.
ALTER TABLE message_envelopes DROP CONSTRAINT IF EXISTS message_envelopes_pkey;
DROP INDEX IF EXISTS idx_envelopes_pending;
ALTER TABLE message_envelopes DROP COLUMN IF EXISTS recipient_device;
ALTER TABLE message_envelopes
  ADD COLUMN recipient_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE message_envelopes ADD PRIMARY KEY (message_id, recipient_user);
CREATE INDEX idx_envelopes_pending_user
  ON message_envelopes(recipient_user) WHERE delivered_at IS NULL;

-- 3) message_envelopes_history: recipient_device → recipient_user.
ALTER TABLE message_envelopes_history DROP CONSTRAINT IF EXISTS message_envelopes_history_pkey;
ALTER TABLE message_envelopes_history DROP COLUMN IF EXISTS recipient_device;
ALTER TABLE message_envelopes_history
  ADD COLUMN recipient_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE message_envelopes_history
  ADD PRIMARY KEY (message_id, version_number, recipient_user);

-- 4) devices.identity_public_key queda obsoleta (la identidad es por usuario
--    ahora, en user_identities). La dejamos nullable sin borrar para no
--    arriesgar; se puede limpiar en una migración futura.
