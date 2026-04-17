/**
 * Reset de contraseña por CLI. Usa cuando un usuario olvidó su password.
 * El TOTP (2FA) NO cambia; si también perdió el TOTP, añadiremos otro
 * script para eso cuando lo necesitemos.
 *
 * Uso (en el VPS):
 *   RESET_USERNAME=richard RESET_PASSWORD='NuevaContraseñaLarga!' \
 *     pnpm --filter @euromex/api run reset-password
 *
 * Opcional, para forzar re-login en todos los dispositivos del usuario
 * (recomendado si la contraseña se filtró o se olvidó por seguridad):
 *   RESET_REVOKE_DEVICES=1 RESET_USERNAME=... RESET_PASSWORD=... \
 *     pnpm --filter @euromex/api run reset-password
 */
import "dotenv/config";
import { pool } from "../db/pg.js";
import { hashPassword } from "../auth/crypto.js";

async function main() {
  const username = process.env.RESET_USERNAME;
  const password = process.env.RESET_PASSWORD;
  const revokeDevices = process.env.RESET_REVOKE_DEVICES === "1";

  if (!username || !password) {
    console.error("Faltan RESET_USERNAME y/o RESET_PASSWORD en env.");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("RESET_PASSWORD debe tener al menos 12 caracteres.");
    process.exit(1);
  }

  const existing = await pool.query<{ id: string; status: string }>(
    "SELECT id, status FROM users WHERE username = $1",
    [username],
  );
  const user = existing.rows[0];
  if (!user) {
    console.error(`El usuario '${username}' no existe.`);
    process.exit(1);
  }
  if (user.status !== "active") {
    console.error(
      `El usuario '${username}' tiene status '${user.status}'. Reactívalo primero.`,
    );
    process.exit(1);
  }

  const hash = await hashPassword(password);
  await pool.query(
    "UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2",
    [hash, user.id],
  );

  let revoked = 0;
  if (revokeDevices) {
    const r = await pool.query(
      `UPDATE devices SET status = 'revoked', revoked_at = now()
        WHERE user_id = $1 AND status = 'active'`,
      [user.id],
    );
    revoked = r.rowCount ?? 0;
  }

  await pool.query(
    `INSERT INTO audit_log (user_id, action, metadata)
     VALUES ($1, 'password.reset', $2::jsonb)`,
    [
      user.id,
      JSON.stringify({
        via: "reset-password script",
        revokedDevices: revokeDevices ? revoked : 0,
      }),
    ],
  );

  console.log(`\n✔ Contraseña actualizada para '${username}'.`);
  console.log(`  El TOTP (2FA) NO cambió; sigue usando la misma app autenticadora.`);
  if (revokeDevices) {
    console.log(`  Dispositivos activos revocados: ${revoked}`);
    console.log(`  El usuario debe hacer login de nuevo desde cada dispositivo.`);
  } else {
    console.log(
      `  Las sesiones activas siguen vivas. Para cerrarlas, re-ejecuta con RESET_REVOKE_DEVICES=1`,
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
