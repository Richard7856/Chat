-- Fase 28 — Tracking de migrations aplicadas.
--
-- Cierra la deuda técnica que causó el incidente del 2026-05-05: las
-- migrations 010, 011 y 012 nunca se habían aplicado en producción
-- aunque el código las requería desde Fase 24, y solo nos dimos cuenta
-- cuando /auth/login y /auth/reauth empezaron a tirar 500.
--
-- A partir de aquí cada migration aplicada queda registrada con su
-- checksum SHA256. El runner (apps/api/src/scripts/migrate.ts) compara
-- los archivos en disco contra esta tabla para saber qué falta.
--
-- Convenciones del runner:
--   - `version` es el nombre del archivo SIN extensión .sql
--     (ej. "013-biometric-unlock"). Coincide con el orden lexicográfico.
--   - `checksum` es el SHA256 del contenido del .sql en hex (lowercase).
--     Si el archivo cambia después de aplicarse, el runner WARN pero NO
--     re-aplica (las migrations son append-only — para cambiar una ya
--     aplicada se crea una nueva).
--   - `applied_at` se setea automáticamente al insert.
--   - `applied_by` registra qué proceso la corrió. Útil cuando hay
--     varios entornos (manual vs CI vs script).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT        PRIMARY KEY,
  checksum    TEXT        NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT        NOT NULL DEFAULT current_user
);

COMMENT ON TABLE schema_migrations IS
  'Registro de migrations aplicadas. Mantenido por apps/api/src/scripts/migrate.ts.';
