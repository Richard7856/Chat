/**
 * Bootstrap del primer admin. Corre una sola vez.
 *
 * Uso (en el VPS, con los .env ya cargados):
 *   ADMIN_USERNAME=richard ADMIN_PASSWORD='xxxx' ADMIN_DISPLAY='Richard'
 *   pnpm --filter @euromex/api run create-admin
 *
 * Genera TOTP y devuelve la URI + QR (en consola como data URL). Escanéalo
 * con Google Authenticator / 1Password / Aegis antes de salir del script.
 */
import "dotenv/config";
import { pool } from "../db/pg.js";
import { hashPassword, encryptSecret, loadMasterKey } from "../auth/crypto.js";
import { createTotpEnrollment } from "../auth/totp.js";
import { config } from "../config.js";

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_DISPLAY ?? username;
  const email = process.env.ADMIN_EMAIL;

  if (!username || !password) {
    console.error("Faltan ADMIN_USERNAME y/o ADMIN_PASSWORD en env.");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("ADMIN_PASSWORD debe tener al menos 12 caracteres.");
    process.exit(1);
  }

  const existing = await pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
  if ((existing.rowCount ?? 0) > 0) {
    console.error(`El usuario '${username}' ya existe. Aborto.`);
    process.exit(1);
  }

  const key = loadMasterKey(config.masterEncKey);
  const passwordHash = await hashPassword(password);
  const totp = await createTotpEnrollment(username);
  const totpSecretEnc = encryptSecret(key, totp.secret);

  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (username, display_name, email, password_hash, totp_secret_enc, role, receives_security_alerts)
     VALUES ($1, $2, $3, $4, $5, 'admin', true)
     RETURNING id`,
    [username, displayName, email ?? null, passwordHash, totpSecretEnc],
  );

  await pool.query(
    `INSERT INTO audit_log (user_id, action, metadata)
     VALUES ($1, 'admin.bootstrap', $2::jsonb)`,
    [result.rows[0]?.id, JSON.stringify({ via: "create-admin script" })],
  );

  console.log("\n✔ Admin creado.");
  console.log("  user id:     ", result.rows[0]?.id);
  console.log("  username:    ", username);
  console.log("\n▶ Escanea este QR con tu app autenticadora AHORA:");
  console.log("  ", totp.qrDataUrl, "\n");
  console.log("  (o copia la URI otpauth a mano:)");
  console.log("  ", totp.uri, "\n");
  console.log("Guarda la semilla por si pierdes el teléfono:", totp.secret);
  console.log("\nYa puedes iniciar sesión desde /login con usuario + contraseña + código TOTP.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
