-- Fase 3: añade columna para texto plano de mensajes.
-- Aplicar en DBs que ya existían de Fase 2:
--   psql $DATABASE_URL -f apps/api/src/db/migrations/001-add-message-content.sql
-- Las instancias nuevas ya traen la columna en schema.sql.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS content TEXT;
