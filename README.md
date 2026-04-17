# Euromex Chat

Chat interno self-hosted para Grupo Euromex. Sustituye el uso de WhatsApp para
hablar de proyectos, números e ideas. Acceso solo por invitación, encriptación
de extremo a extremo, y deploy en VPS propio.

> **Importante:** antes de retomar trabajo aquí, lee `desicion.md` — es la
> fuente única de verdad sobre decisiones y progreso.

## Stack (Fase 1)

- Monorepo: **pnpm workspaces + Turbo**
- Backend: **Node.js 22 + TypeScript + Fastify** (`apps/api`)
- Frontend: **Next.js 15 + React** (`apps/web`)
- Infra local: **Docker Compose** con **PostgreSQL 16** + **Redis 7**
  (`infra/`)
- Tipos/schemas compartidos: **Zod** (`packages/shared`)

Crypto E2EE (Signal Protocol), React Native mobile y el panel admin llegan en
fases posteriores — ver el plan aprobado en
`/root/.claude/plans/te-comento-a-grandes-buzzing-wand.md` y las entradas en
`desicion.md`.

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
  api/        Fastify + (Socket.IO en Fase 3)
  web/        Next.js (usuario final)
packages/
  shared/     Schemas Zod y tipos compartidos
infra/
  docker-compose.yml
desicion.md   Bitácora de decisiones y progreso
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
