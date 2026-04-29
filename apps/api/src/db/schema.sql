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
  -- Si TRUE, este usuario recibe los avisos de seguridad (descargas,
  -- miembros añadidos, etc.) en las conversaciones donde participe. El
  -- bootstrap admin lo trae activo por default; los usuarios regulares no.
  receives_security_alerts BOOLEAN NOT NULL DEFAULT false,
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
-- Adjuntos (Fase 5).
-- El server solo guarda ciphertext en disco + metadatos mínimos. La clave
-- AES-256-GCM y el nombre/MIME del archivo viven dentro del plaintext del
-- mensaje que lo referencia — o sea, cifrados por dispositivo. Sin acceso a
-- los envelopes del mensaje, nadie puede descifrar el archivo aunque tenga
-- los bytes.
-- ============================================================================
CREATE TABLE IF NOT EXISTS attachments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  uploader_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploader_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  storage_key        TEXT NOT NULL UNIQUE,
  byte_size          BIGINT NOT NULL,
  -- Fase 14: vínculo al mensaje que referencia este adjunto (tiene la clave AES).
  message_id         UUID REFERENCES messages(id) ON DELETE SET NULL,
  -- PIN de descarga opcional (bcrypt hash). NULL = sin PIN.
  download_pin_hash  TEXT,
  -- 'all' = todos los miembros; 'restricted' = solo attachment_allowed_users.
  access_type        TEXT NOT NULL DEFAULT 'all'
                       CHECK (access_type IN ('all', 'restricted')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_conv ON attachments(conversation_id);

-- Lista blanca para attachments con access_type = 'restricted'.
CREATE TABLE IF NOT EXISTS attachment_allowed_users (
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  PRIMARY KEY (attachment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_attachment_allowed
  ON attachment_allowed_users(attachment_id);

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

-- Fase 15: Actividades y Tareas
CREATE TABLE IF NOT EXISTS activities (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description       TEXT        CHECK (length(description) <= 2000),
  creator_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  conversation_id   UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  duration_minutes  INTEGER,
  location          TEXT        CHECK (length(location) <= 300),
  status            TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_participants (
  activity_id   UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  rsvp_status   TEXT NOT NULL DEFAULT 'pending'
    CHECK (rsvp_status IN ('pending', 'confirmed', 'declined')),
  responded_at  TIMESTAMPTZ,
  PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description       TEXT        CHECK (length(description) <= 2000),
  creator_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  conversation_id   UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  due_date          DATE,
  status            TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  completed_at  TIMESTAMPTZ,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_activities_conv      ON activities(conversation_id);
CREATE INDEX IF NOT EXISTS idx_activities_scheduled ON activities(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tasks_conv           ON tasks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due            ON tasks(due_date);
