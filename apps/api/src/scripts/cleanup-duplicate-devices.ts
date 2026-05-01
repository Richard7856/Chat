/**
 * Cleanup de dispositivos duplicados — un solo uso.
 *
 * Hasta el commit que introdujo el reuso de device en /auth/login, cada full
 * login creaba una fila nueva en `devices`. Si un usuario hizo logout/login
 * varias veces (o limpió localStorage), terminó con N registros para 1 browser.
 *
 * Este script agrupa los devices activos de cada usuario por
 * (user_agent + platform + device_name) y conserva el de mayor `last_seen_at`
 * (o `created_at` si todos son NULL). El resto se marca como `revoked`.
 *
 * Uso:
 *   pnpm --filter @euromex/api run cleanup-devices             # dry-run
 *   CLEANUP_APPLY=1 pnpm --filter @euromex/api run cleanup-devices  # ejecuta
 *
 * Por seguridad, sin `CLEANUP_APPLY=1` solo imprime qué haría.
 */
import "dotenv/config";
import { pool } from "../db/pg.js";

interface DeviceRow {
  id: string;
  user_id: string;
  username: string;
  device_name: string;
  platform: string;
  user_agent: string | null;
  last_seen_at: Date | null;
  created_at: Date;
}

async function main() {
  const apply = process.env.CLEANUP_APPLY === "1";

  const r = await pool.query<DeviceRow>(
    `SELECT d.id, d.user_id, u.username, d.device_name, d.platform,
            d.user_agent, d.last_seen_at, d.created_at
       FROM devices d
       JOIN users u ON u.id = d.user_id
      WHERE d.status = 'active'
      ORDER BY d.user_id, d.user_agent, d.platform, d.device_name,
               d.last_seen_at DESC NULLS LAST, d.created_at DESC`,
  );

  // Agrupar por (user_id + user_agent + platform + device_name).
  // El user_agent sirve como fingerprint razonable: distinto browser = distinto UA.
  const groups = new Map<string, DeviceRow[]>();
  for (const dev of r.rows) {
    const key = `${dev.user_id}|${dev.user_agent ?? ""}|${dev.platform}|${dev.device_name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(dev);
  }

  const toRevoke: DeviceRow[] = [];
  const summaryByUser = new Map<string, number>();

  for (const devs of groups.values()) {
    if (devs.length <= 1) continue;
    // Las filas ya vienen ordenadas DESC por last_seen_at — devs[0] es el "vivo".
    // Los demás se revocan.
    for (let i = 1; i < devs.length; i++) {
      toRevoke.push(devs[i]!);
      summaryByUser.set(
        devs[i]!.username,
        (summaryByUser.get(devs[i]!.username) ?? 0) + 1,
      );
    }
  }

  if (toRevoke.length === 0) {
    console.log("✔ No hay devices duplicados que limpiar.");
    await pool.end();
    return;
  }

  console.log(`Encontrados ${toRevoke.length} device(s) duplicado(s):\n`);
  for (const [username, count] of summaryByUser.entries()) {
    console.log(`  • ${username}: ${count} device(s) a revocar`);
  }

  if (!apply) {
    console.log(
      "\n(dry-run) — re-ejecuta con CLEANUP_APPLY=1 para aplicar los cambios.",
    );
    await pool.end();
    return;
  }

  const ids = toRevoke.map((d) => d.id);
  const result = await pool.query(
    `UPDATE devices
        SET status = 'revoked',
            revoked_at = now()
      WHERE id = ANY($1::uuid[])`,
    [ids],
  );

  // Audit log para el cleanup
  await pool.query(
    `INSERT INTO audit_log (action, metadata)
     VALUES ('devices.cleanup', $1::jsonb)`,
    [
      JSON.stringify({
        via: "cleanup-duplicate-devices script",
        revoked: result.rowCount ?? 0,
        breakdown: Object.fromEntries(summaryByUser.entries()),
      }),
    ],
  );

  console.log(`\n✔ Revocados ${result.rowCount} device(s) duplicado(s).`);
  console.log(
    "  Los usuarios con sesiones en esos devices deberán hacer login de nuevo.",
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
