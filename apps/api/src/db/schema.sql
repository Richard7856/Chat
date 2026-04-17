-- Euromex Chat — esquema inicial (Fase 1)
-- Las claves privadas NUNCA se almacenan aquí; solo metadatos y ciphertext.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Usuarios
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username        TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  email           TEXT UNIQUE,
  password_hash   TEXT NOT NULL,
  totp_secret_enc BYTEA NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status) WHERE status = 'active';

-- ============================================================================
-- Invitaciones (alta por admin, sin registro público)
-- ============================================================================
CREATE TABLE IF NOT EXISTS invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash    TEXT NOT NULL UNIQUE,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  intended_for TEXT,
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_active
  ON invitations(expires_at)
  WHERE used_at IS NULL;

-- ============================================================================
-- Dispositivos (enrollment por usuario; solo dispositivos aprobados hablan)
-- Los campos Signal (identity_public_key, signed_prekey_*) son NULL hasta
-- Fase 4, cuando se integre libsignal. En Fase 2 el dispositivo se
-- registra con solo user_agent/platform/device_name.
-- ============================================================================
CREATE TABLE IF NOT EXISTS devices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name           TEXT NOT NULL,
  platform              TEXT NOT NULL CHECK (platform IN ('web','ios','android','desktop')),
  user_agent            TEXT,
  registration_id       INTEGER,
  identity_public_key   BYTEA,
  signed_prekey_id      INTEGER,
  signed_prekey_public  BYTEA,
  signed_prekey_sig     BYTEA,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','active','revoked')),
  approved_by_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  last_seen_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ,
  UNIQUE (user_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_devices_user_active
  ON devices(user_id)
  WHERE status = 'active';

-- One-time prekeys (Signal X3DH). Se consumen al abrir una sesión nueva.
CREATE TABLE IF NOT EXISTS one_time_prekeys (
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  prekey_id   INTEGER NOT NULL,
  public_key  BYTEA NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, prekey_id)
);

CREATE INDEX IF NOT EXISTS idx_otp_available
  ON one_time_prekeys(device_id)
  WHERE consumed_at IS NULL;

-- ============================================================================
-- Conversaciones (DM y grupos por proyecto)
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('dm','group')),
  name        TEXT,
  description TEXT,
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at    TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);

-- ============================================================================
-- Mensajes.
-- Fase 3: `content` contiene el texto plano (sin E2EE).
-- Fase 4: `content` pasa a NULL para mensajes cifrados; el payload vive en
--        message_envelopes (un ciphertext por dispositivo destinatario).
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  content         TEXT,
  content_type    TEXT NOT NULL DEFAULT 'text/plain',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages(conversation_id, created_at DESC);

-- Un sobre por cada dispositivo destinatario. En Fase 4 se usa crypto_box
-- de libsodium (X25519 + XSalsa20-Poly1305); ciphertext incluye el MAC.
CREATE TABLE IF NOT EXISTS message_envelopes (
  message_id       UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_device UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ciphertext       BYTEA NOT NULL,
  nonce            BYTEA,
  delivered_at     TIMESTAMPTZ,
  PRIMARY KEY (message_id, recipient_device)
);

CREATE INDEX IF NOT EXISTS idx_envelopes_pending
  ON message_envelopes(recipient_device)
  WHERE delivered_at IS NULL;

-- ============================================================================
-- Auditoría (login, enrollment, revocación, altas/bajas)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id  UUID REFERENCES devices(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip         INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
