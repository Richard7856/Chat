-- Registra el user-agent del dispositivo al momento de activar biometric unlock.
-- Se compara en cada /auth/biometric/unlock para detectar uso del token desde
-- un device diferente al que lo emitió (posible extracción del JWT del Keystore).
-- NULL = biometría activada antes de este parche; esos devices no aplican el check
-- hasta que el usuario desactive y reactive la biometría.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS biometric_fingerprint TEXT;
