-- Fase 30: flag para forzar cambio de password después de un admin reset.
--
-- Cuando un admin resetea la password de un user (porque la perdió), generamos
-- una temp password aleatoria. El user debe cambiarla obligatoriamente en el
-- primer login para que la temp no quede como password definitiva (la temp es
-- conocida por el admin que la generó, lo cual viola el modelo de zero-trust).
--
-- Flow:
--   1. Admin → POST /admin/users/:id/reset-password → set must_change_password = true
--   2. User → POST /auth/login con temp password + TOTP
--   3. Si must_change_password=true: server NO firma JWT normal, sino un
--      "change token" corto (5 min) que solo sirve para /auth/password/forced
--   4. User → POST /auth/password/forced → set must_change_password = false + nueva password
--   5. User obtiene JWT normal y entra a la app
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
