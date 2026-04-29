-- Fase 10: campos de perfil extendido (organigrama)
--
-- Aplicar en VPS:
--   source infra/.env && docker exec -i euromex-postgres psql \
--     -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     < apps/api/src/db/migrations/006-profile-extended.sql

-- Puesto / cargo del usuario (libre, ej. "Gerente de Ventas")
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS job_title TEXT;

-- Departamento o área (ej. "Finanzas", "Ventas")
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department TEXT;

-- Jefe directo. ON DELETE SET NULL: si el manager es eliminado,
-- sus reportes quedan como nodos raíz del organigrama.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS manager_user_id UUID
    REFERENCES users(id) ON DELETE SET NULL;

-- Índice para recorrer el árbol eficientemente
CREATE INDEX IF NOT EXISTS idx_users_manager
  ON users(manager_user_id)
  WHERE manager_user_id IS NOT NULL;
