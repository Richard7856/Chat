-- Fase 24: Permisos granulares por usuario.
--
-- Hasta ahora todo el control era binario: role = 'user' | 'admin'. El admin
-- tenía superpoderes y el resto compartía exactamente el mismo set de
-- permisos. Esto agrega flags individuales para que el admin pueda
-- restringir capacidades por persona (ej. proveedor externo que solo lee
-- mensajes pero no descarga archivos ni puede armar grupos).
--
-- Defaults conservadores cuando se trata de extracción de información:
--   can_download_attachments = true  (capacidad existente — no romper)
--   can_share_externally     = false (la mayoría no debería tomar capturas)
--   can_create_groups        = true  (capacidad existente)
--   can_invite_users         = false (solo admins por default)
--   can_initiate_calls       = true  (Fase 22 — todavía no implementado)
--   max_attachment_mb        = 50    (mismo default que apps/api/src/config.ts)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_download_attachments BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_share_externally     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_create_groups        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_invite_users         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_initiate_calls       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_attachment_mb        INT     NOT NULL DEFAULT 50
    CHECK (max_attachment_mb BETWEEN 1 AND 500);

-- Garantizar que cualquier admin existente preserve todos los permisos
-- aunque cambien los defaults futuros — los admins tienen "control total".
UPDATE users
   SET can_download_attachments = true,
       can_share_externally     = true,
       can_create_groups        = true,
       can_invite_users         = true,
       can_initiate_calls       = true
 WHERE role = 'admin';
