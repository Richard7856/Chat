-- Fase 27 — Biometric unlock per device.
--
-- biometric_enabled: per-device opt-in para "iniciar con huella". Es flag
--   independiente del usuario porque la decisión es local (un usuario puede
--   tener huella en su Android personal pero no querer biometría en el iPad
--   compartido).
--
-- biometric_token_jti: JTI del último biometric_unlock_token emitido por
--   /auth/biometric/enable. El cliente guarda el JWT cifrado con biometría
--   en Keystore/Keychain. Al hacer /auth/biometric/unlock, server compara
--   el jti del JWT recibido con esta columna — si difiere, el token está
--   revocado (el usuario lo desactivó y reactivó, por ejemplo) y el unlock
--   falla aunque el JWT en sí siga válido por TTL.

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS biometric_enabled    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS biometric_token_jti  TEXT    NULL;

COMMENT ON COLUMN devices.biometric_enabled IS
  'Per-device opt-in para login con huella. Independiente de role/permisos.';
COMMENT ON COLUMN devices.biometric_token_jti IS
  'JTI del biometric_unlock_token activo. Diferencia con el del JWT recibido = token revocado.';
