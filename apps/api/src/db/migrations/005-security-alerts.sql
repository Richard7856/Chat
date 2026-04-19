-- Fase 8.2: avisos de seguridad solo para "super admins" (usuarios con el
-- flag `receives_security_alerts`). Regulares no los ven ni en historia ni
-- en vivo.
--
-- Aplicar en VPSs que vengan de Fase 8.1:
--   source infra/.env && docker exec -i euromex-postgres psql \
--     -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     < apps/api/src/db/migrations/005-security-alerts.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS receives_security_alerts BOOLEAN NOT NULL DEFAULT false;

-- Backfill: admins existentes opt-in por default (coherente con la
-- convención del proyecto — admins son los "super admins").
UPDATE users SET receives_security_alerts = true WHERE role = 'admin';
