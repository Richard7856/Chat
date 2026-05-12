/**
 * Reset manual de password — workaround mientras se implementa el endpoint
 * admin/users/:id/reset-password (Fase 30).
 *
 * Uso (en el VPS):
 *   cd /opt/euromex/apps/api
 *   source .env
 *   ./node_modules/.bin/tsx src/scripts/reset-password-admin.ts <username>
 *
 * Genera una temp password random de 12 chars, la hashea con Argon2id, la
 * guarda en users.password_hash y la imprime en stdout UNA SOLA VEZ. Audit
 * log queda registrado con action='admin.password.reset_manual'.
 *
 * Limitaciones de este workaround (resueltas por Fase 30):
 *   - NO marca must_change_password=true (esa columna llega en migration 016).
 *     El admin debe pedir verbalmente al user que cambie la password al entrar.
 *   - NO revoca sesiones activas del user — si tenía una sesión válida ya
 *     loggeada, sigue funcionando. Si necesitas revocar: usa el panel admin
 *     → Devices → Revocar.
 *   - El TOTP del admin que ejecuta el script no se valida porque corre como
 *     proceso shell directo. Confiamos en que solo root tiene acceso al VPS.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "../auth/crypto.js";

async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    console.error("Uso: tsx src/scripts/reset-password-admin.ts <username>");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Falta DATABASE_URL en el environment");
    process.exit(1);
  }

  // 12 chars: 9 bytes base64url para evitar / + = (caracteres molestos al
  // copiar/pegar la password en clientes de correo).
  const tmpPass = randomBytes(9).toString("base64url").slice(0, 12);

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });

  try {
    const hash = await hashPassword(tmpPass);
    const r = await pool.query<{ id: string; username: string; display_name: string }>(
      `UPDATE users
          SET password_hash = $1, updated_at = now()
        WHERE username = $2
        RETURNING id, username, display_name`,
      [hash, username],
    );

    if (r.rowCount === 0) {
      console.error(`❌ Usuario '${username}' no encontrado`);
      process.exit(1);
    }
    const user = r.rows[0]!;

    // Audit trail — quién resetó la password de quién, cuándo, vía qué método.
    await pool.query(
      `INSERT INTO audit_log (user_id, action, metadata, ip, user_agent)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [
        user.id,
        "admin.password.reset_manual",
        JSON.stringify({
          script: "reset-password-admin.ts",
          username: user.username,
          executedBy: process.env.USER || process.env.LOGNAME || "unknown",
        }),
        "127.0.0.1",
        "tsx-script",
      ],
    );

    console.log("");
    console.log("═══════════════════════════════════════════");
    console.log(`Password temporal para @${user.username} (${user.display_name}):`);
    console.log("");
    console.log(`    ${tmpPass}`);
    console.log("");
    console.log("═══════════════════════════════════════════");
    console.log("");
    console.log("→ Envíasela al usuario por canal seguro (correo personal, etc).");
    console.log("→ El TOTP del usuario NO cambió: sigue usando el mismo authenticator.");
    console.log("→ Pídele que cambie la password inmediatamente al entrar");
    console.log("  (Settings → Cambiar contraseña).");
    console.log("");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error inesperado:", err);
  process.exit(1);
});
