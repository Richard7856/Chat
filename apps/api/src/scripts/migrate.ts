/**
 * Runner de migrations — Fase 28.
 *
 * Cierra la deuda técnica que causó el incidente del 2026-05-05 (las
 * migrations 010-012 nunca se aplicaron en producción aunque el código
 * las requería desde Fase 24).
 *
 * Comandos:
 *   pnpm --filter @euromex/api migrate:status
 *     Lista cada archivo en src/db/migrations/ y dice si está applied,
 *     pending, o tiene checksum_mismatch (archivo cambió post-aplicación).
 *
 *   pnpm --filter @euromex/api migrate
 *     Aplica las pending en orden. Crea schema_migrations si no existe
 *     (la inicializa con 014 que es justamente la que la define).
 *     Cada migration corre en su propia transacción — si una falla, las
 *     anteriores quedan aplicadas, la actual rollback, y el comando
 *     termina con exit 1.
 *
 *   pnpm --filter @euromex/api migrate:bootstrap
 *     One-shot para DBs LEGACY donde las migrations YA están aplicadas
 *     pero no registradas (es nuestro caso post-2026-05-05). Crea la
 *     tabla schema_migrations e inserta TODAS las migrations existentes
 *     como ya aplicadas, sin ejecutar el SQL. Útil únicamente en el VPS;
 *     en una DB nueva hay que usar `migrate` normal.
 *
 *   pnpm --filter @euromex/api migrate:dry-run
 *     Como `migrate` pero NO toca la BD — solo lista qué se aplicaría.
 *
 * Diseño:
 *   - Archivos en src/db/migrations/*.sql, ordenados por nombre lexicográfico.
 *   - `version` = filename sin .sql (ej. "013-biometric-unlock").
 *   - `checksum` = SHA256(content) en hex lowercase.
 *   - Las migrations son APPEND-ONLY: una vez registrada, NO se re-aplica
 *     aunque el archivo cambie. Para corregir, crear una migration nueva.
 *   - Checksum mismatch genera WARN pero no bloquea — útil para detectar
 *     que alguien tocó un .sql viejo sin pretender re-aplicarlo.
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// El runner intencionalmente NO importa db/pg.js (que carga config.ts y
// exige REDIS_URL, JWT_SECRET, etc.). Para correr migrations basta con
// DATABASE_URL — esto permite usar el runner desde CI o desde un script
// de setup sin tener que pasar el resto del .env del API.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Falta DATABASE_URL en el environment.");
  console.error("   Usa: source apps/api/.env && pnpm --filter @euromex/api migrate:status");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 4,
  idleTimeoutMillis: 5_000,
});

// Resolver el dir de migrations relativo a este archivo. Usar import.meta
// (ES modules) hace que el script funcione tanto vía tsx como compilado.
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");

interface MigrationFile {
  version: string;
  filename: string;
  content: string;
  checksum: string;
}

interface AppliedRow {
  version: string;
  checksum: string;
  applied_at: Date;
}

type Status = "applied" | "pending" | "checksum_mismatch";

interface MigrationStatus extends MigrationFile {
  status: Status;
  appliedAt: Date | null;
  storedChecksum: string | null;
}

function loadMigrationFiles(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((filename) => {
    const content = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    return {
      version: filename.replace(/\.sql$/, ""),
      filename,
      content,
      checksum: sha256Hex(content),
    };
  });
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

async function ensureTrackingTableExists(): Promise<boolean> {
  // Si la tabla no existe, no podemos preguntar por filas. Probamos con
  // information_schema antes de cualquier SELECT al schema_migrations.
  const r = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'schema_migrations'
     ) AS exists`,
  );
  return r.rows[0]?.exists ?? false;
}

async function loadApplied(): Promise<Map<string, AppliedRow>> {
  const exists = await ensureTrackingTableExists();
  if (!exists) return new Map();
  const r = await pool.query<AppliedRow>(
    `SELECT version, checksum, applied_at FROM schema_migrations`,
  );
  const map = new Map<string, AppliedRow>();
  for (const row of r.rows) map.set(row.version, row);
  return map;
}

async function statusOfAll(): Promise<MigrationStatus[]> {
  const files = loadMigrationFiles();
  const applied = await loadApplied();
  return files.map((f) => {
    const row = applied.get(f.version);
    if (!row) {
      return { ...f, status: "pending" as Status, appliedAt: null, storedChecksum: null };
    }
    if (row.checksum !== f.checksum) {
      return {
        ...f,
        status: "checksum_mismatch" as Status,
        appliedAt: row.applied_at,
        storedChecksum: row.checksum,
      };
    }
    return { ...f, status: "applied" as Status, appliedAt: row.applied_at, storedChecksum: row.checksum };
  });
}

function printStatusTable(items: MigrationStatus[]): void {
  const widthV = Math.max(7, ...items.map((i) => i.version.length));
  const header = `${"VERSION".padEnd(widthV)}  STATUS              APPLIED_AT`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const it of items) {
    const date = it.appliedAt ? it.appliedAt.toISOString().slice(0, 19).replace("T", " ") : "-";
    const statusLabel =
      it.status === "applied"
        ? "applied"
        : it.status === "pending"
        ? "PENDING"
        : "CHECKSUM MISMATCH";
    console.log(`${it.version.padEnd(widthV)}  ${statusLabel.padEnd(18)}  ${date}`);
  }
  const pending = items.filter((i) => i.status === "pending").length;
  const mismatch = items.filter((i) => i.status === "checksum_mismatch").length;
  console.log("");
  console.log(`Total: ${items.length} | applied: ${items.length - pending - mismatch} | pending: ${pending} | mismatch: ${mismatch}`);
}

async function applyOne(file: MigrationFile, appliedBy: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(file.content);
    // Si la migration que estamos aplicando ES la 014 (la que define la
    // tabla), el INSERT a continuación es válido porque 014 ya creó la
    // tabla en este mismo BEGIN.
    await client.query(
      `INSERT INTO schema_migrations (version, checksum, applied_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO NOTHING`,
      [file.version, file.checksum, appliedBy],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function cmdStatus(): Promise<void> {
  const items = await statusOfAll();
  printStatusTable(items);
}

async function cmdApply(opts: { dryRun: boolean; appliedBy: string }): Promise<void> {
  const items = await statusOfAll();
  const pending = items.filter((i) => i.status === "pending");
  const mismatched = items.filter((i) => i.status === "checksum_mismatch");

  if (mismatched.length > 0) {
    console.warn(
      `⚠️  ${mismatched.length} migration(s) tienen checksum distinto al registrado:`,
    );
    for (const m of mismatched) console.warn(`   - ${m.version}`);
    console.warn(
      "   El runner NO las re-aplica. Si necesitas el cambio, crea una migration nueva.",
    );
    console.warn("");
  }

  if (pending.length === 0) {
    console.log("Nada pendiente. La BD está al día.");
    return;
  }

  console.log(`Pendientes a aplicar: ${pending.length}`);
  for (const p of pending) console.log(`   - ${p.version}`);
  console.log("");

  if (opts.dryRun) {
    console.log("(dry-run: no se ejecutó nada.)");
    return;
  }

  for (const p of pending) {
    process.stdout.write(`Aplicando ${p.version} ... `);
    try {
      await applyOne(p, opts.appliedBy);
      process.stdout.write("OK\n");
    } catch (err) {
      process.stdout.write("FAIL\n");
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ ${p.version} falló:\n   ${msg}\n`);
      console.error(
        "   Las migrations anteriores quedaron aplicadas. Resuelve el error y vuelve a correr `pnpm migrate`.",
      );
      process.exit(1);
    }
  }

  console.log("");
  console.log(`✔ ${pending.length} migration(s) aplicada(s) sin errores.`);
}

async function cmdBootstrap(opts: { appliedBy: string }): Promise<void> {
  // Caso especial: DB legacy donde las migrations YA están aplicadas pero
  // no registradas. Aplicamos SOLO la 014 (que crea la tabla) y luego
  // marcamos todas las demás como aplicadas SIN ejecutar su SQL.
  const items = loadMigrationFiles();
  const tracker = items.find((i) => i.version.startsWith("014-"));
  if (!tracker) {
    console.error("❌ No encuentro la migration 014-schema-migrations-tracking.sql.");
    process.exit(1);
  }

  const exists = await ensureTrackingTableExists();
  if (exists) {
    console.error(
      "❌ La tabla schema_migrations YA existe. Bootstrap solo aplica si nunca se ha corrido el runner.",
    );
    console.error("   Usa `pnpm migrate:status` para ver el estado actual.");
    process.exit(1);
  }

  console.log("Bootstrap: creando tabla schema_migrations + marcando legacy...");
  console.log("");

  // Paso 1: aplicar 014 normalmente (crea la tabla, registra a sí misma).
  process.stdout.write(`Aplicando ${tracker.version} ... `);
  try {
    await applyOne(tracker, opts.appliedBy);
    process.stdout.write("OK\n");
  } catch (err) {
    process.stdout.write("FAIL\n");
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ ${tracker.version} falló:\n   ${msg}`);
    process.exit(1);
  }

  // Paso 2: marcar todas las demás como aplicadas (INSERT sin ejecutar).
  const legacy = items.filter((i) => i.version !== tracker.version);
  for (const l of legacy) {
    await pool.query(
      `INSERT INTO schema_migrations (version, checksum, applied_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO NOTHING`,
      [l.version, l.checksum, `${opts.appliedBy} (bootstrap)`],
    );
    console.log(`Marcando legacy ${l.version} como aplicada`);
  }

  console.log("");
  console.log(`✔ Bootstrap completo: ${items.length} migrations registradas.`);
  console.log("   Próximas veces: usa `pnpm migrate` para aplicar pendientes nuevas.");
}

function whoAmI(): string {
  return process.env.USER || process.env.LOGNAME || "migrate-script";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "apply";
  const appliedBy = whoAmI();

  switch (cmd) {
    case "status":
      await cmdStatus();
      break;
    case "apply":
    case undefined:
      await cmdApply({ dryRun: false, appliedBy });
      break;
    case "dry-run":
      await cmdApply({ dryRun: true, appliedBy });
      break;
    case "bootstrap":
      await cmdBootstrap({ appliedBy });
      break;
    default:
      console.error(`Comando desconocido: ${cmd}`);
      console.error("Uso: migrate [status|apply|dry-run|bootstrap]");
      process.exit(2);
  }
}

main()
  .catch((err) => {
    console.error("Error inesperado:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
