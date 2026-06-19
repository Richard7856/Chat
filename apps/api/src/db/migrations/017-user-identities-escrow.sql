-- Fase 31 Capa 2 — identidad por usuario + escrow corporativo.
-- Ver docs/FASE-31-IDENTIDAD-ESCROW.md y ADR-040.
--
-- Cambio de modelo: de "identidad por dispositivo" (devices.identity_public_key)
-- a "identidad por usuario". Cada usuario tiene UN keypair de cifrado cuya
-- privada se guarda cifrada de dos formas:
--   - con una llave derivada de su contraseña (uso normal, server no la lee)
--   - con la llave de escrow de la organización (recovery por admin/self)
--
-- Estas tablas son ADITIVAS: no se usan hasta las capas 3+. El modelo viejo
-- (envelopes por device) sigue funcionando hasta la Capa 7 (mensajería).

-- Identidad de cifrado por usuario.
CREATE TABLE IF NOT EXISTS user_identities (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Clave pública X25519 del usuario (32 bytes). Pública, se usa para que
  -- otros cifren mensajes hacia este usuario.
  identity_public     BYTEA NOT NULL,
  -- Privada envuelta con la llave derivada de la contraseña (secretbox:
  -- nonce || ciphertext). El server NO puede abrirla (no tiene la password).
  identity_enc_pw     BYTEA NOT NULL,
  -- Salt para derivar la llave de contraseña (Argon2id) en el cliente.
  pw_salt             BYTEA NOT NULL,
  -- Privada sellada hacia la pública de escrow (sealed box:
  -- ephemeralPub || nonce || ciphertext). Solo la privada de escrow la abre.
  identity_enc_escrow BYTEA NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Llave de escrow de la organización. Una sola fila (id = 1).
-- Opción A (ADR-040): la privada vive aquí cifrada con MASTER_ENC_KEY, y se
-- respalda offline (caja fuerte) para disaster recovery.
CREATE TABLE IF NOT EXISTS org_escrow_key (
  id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Pública X25519 de escrow (32 bytes). Se usa para sellar identidades.
  escrow_public      BYTEA NOT NULL,
  -- Privada de escrow cifrada con MASTER_ENC_KEY (AES-256-GCM:
  -- nonce(12) || ciphertext || tag(16), mismo formato que totp_secret_enc).
  escrow_private_enc BYTEA NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
