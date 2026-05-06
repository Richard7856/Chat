# Euromex Chat

Chat interno self-hosted para Grupo Euromex. Sustituye el uso de WhatsApp para
hablar de proyectos, números e ideas. Acceso solo por invitación, encriptación
de extremo a extremo, y deploy en VPS propio.

> **Importante:** antes de retomar trabajo aquí, lee primero
> [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) (visión + stack + roadmap),
> luego [`DECISIONS.md`](DECISIONS.md) (ADRs detallados) y
> [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) (parches abiertos + edge cases).
> El histórico cronológico completo está en [`archive/HISTORY.md`](archive/HISTORY.md).

## Stack

- Monorepo: **pnpm workspaces + Turbo**
- Backend: **Node.js 22 + TypeScript + Fastify** + Socket.IO (`apps/api`)
- Frontend: **Next.js 15 + React + Tailwind + shadcn/ui** (`apps/web`)
- Mobile: **Capacitor** (Android, scaffold iOS) (`apps/mobile`)
- Infra: **Docker Compose** con **PostgreSQL 16** + **Redis 7** (`infra/`)
- E2EE: **NaCl (tweetnacl)** — wrappers en `packages/crypto`
- Schemas compartidos: **Zod** (`packages/shared`)
- Auth: Argon2id + TOTP obligatorio + JWT firmado + biometría mobile (Capacitor)

Detalle de cada decisión en [DECISIONS.md](DECISIONS.md).

## Requisitos

- Node.js **≥ 20.11** (probado con 22)
- pnpm **≥ 10**
- Docker con plugin `compose`

## Setup local

```bash
# 1. Instalar dependencias
pnpm install

# 2. Preparar variables de entorno
cp infra/.env.example infra/.env
cp apps/api/.env.example apps/api/.env

# 3. Levantar Postgres + Redis
pnpm infra:up

# 4. Levantar API y web en modo dev
pnpm dev
```

- API: http://localhost:4000/health
- Web: http://localhost:3100

## Scripts útiles

| Comando | Qué hace |
|---------|----------|
| `pnpm dev` | Levanta API y web en watch mode |
| `pnpm build` | Compila todos los paquetes |
| `pnpm typecheck` | `tsc --noEmit` en cada paquete |
| `pnpm infra:up` / `infra:down` | Arranca/detiene Postgres y Redis |
| `pnpm infra:logs` | Logs seguidos de Postgres y Redis |

## Estructura

```
apps/
  api/        Fastify + Socket.IO + scripts CLI (create-admin, migrate, etc.)
  web/        Next.js 15 + Tailwind + shadcn/ui (PWA)
  mobile/     Wrapper Capacitor Android (scaffold iOS)
packages/
  shared/     Schemas Zod compartidos
  crypto/     Wrappers NaCl (E2EE primitivas)
infra/
  docker-compose.yml         (Postgres + Redis locales)
  traefik/                   (config de referencia, no usada en VPS)

PROJECT_BRIEF.md             Visión + stack + roadmap (start here)
DECISIONS.md                 ADRs detallados (40+ decisiones)
KNOWN_ISSUES.md              Parches pendientes + edge cases
HOSTINGER.md                 Runbook operacional VPS
archive/HISTORY.md           Bitácora cronológica histórica (1900+ líneas)
```

## Branch de desarrollo

Todo el trabajo va en `claude/private-chat-mac-auth-e9QYn` hasta que el
usuario indique otra cosa.

## Seguridad — resumen del modelo

- Sin registro público: alta solo por invitación de admin (códigos de un uso).
- Contraseña (Argon2id) + TOTP obligatorio.
- Enrollment explícito de cada dispositivo; nuevos dispositivos se aprueban
  desde uno ya autorizado.
- E2EE con Signal Protocol (Fase 4): el servidor solo ve ciphertext.
- Revocación inmediata de dispositivo/usuario vía Redis pub/sub.

## Licencia

Interno de Grupo Euromex. Sin licencia pública.
