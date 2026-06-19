/**
 * Bootstrap de la llave de escrow de la organización — Fase 31 Capa 2.
 *
 * Se corre UNA SOLA VEZ al inicializar el sistema de identidad por usuario.
 * Genera el keypair X25519 de escrow:
 *   - La PÚBLICA se guarda en org_escrow_key.escrow_public (sella identidades).
 *   - La PRIVADA se cifra con MASTER_ENC_KEY y se guarda en escrow_private_enc.
 *   - La PRIVADA también se IMPRIME en claro UNA SOLA VEZ → respaldar offline
 *     (caja fuerte + copia personal). Es la única forma de recuperar si el
 *     server o el MASTER_ENC_KEY se pierden (disaster recovery).
 *
 * Uso (en el VPS):
 *   cd /opt/euromex/apps/api && source .env && pnpm bootstrap-escrow
 *
 * IDEMPOTENCIA: si ya existe una llave de escrow, ABORTA sin tocar nada.
 * Sobrescribirla haría IRRECUPERABLES todas las identidades ya selladas con
 * la llave vieja.
 */
import "dotenv/config";
import pg from "pg";
import { generateEscrowKeypair, toBase64 } from "@euromex/crypto";
import { loadMasterKey, encryptSecret } from "../auth/crypto.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const masterEncKey = process.env.MASTER_ENC_KEY;
  if (!databaseUrl) {
    console.error("Falta DATABASE_URL en el environment.");
    process.exit(1);
  }
  if (!masterEncKey) {
    console.error("Falta MASTER_ENC_KEY en el environment.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });

  try {
    // Verificar que la tabla exista (migración 017 aplicada).
    const tableExists = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'org_escrow_key'
       ) AS exists`,
    );
    if (!tableExists.rows[0]?.exists) {
      console.error("❌ La tabla org_escrow_key no existe. Corre primero: pnpm migrate");
      process.exit(1);
    }

    // Idempotencia: no sobrescribir una llave existente.
    const existing = await pool.query("SELECT 1 FROM org_escrow_key WHERE id = 1");
    if ((existing.rowCount ?? 0) > 0) {
      console.error("❌ Ya existe una llave de escrow. NO se sobrescribe.");
      console.error("   Sobrescribirla haría irrecuperables todas las identidades selladas.");
      console.error("   Si necesitas rotarla, es un procedimiento aparte (re-sellar todas las identidades).");
      process.exit(1);
    }

    const masterKey = loadMasterKey(masterEncKey);

    // Generar el keypair de escrow.
    const escrow = await generateEscrowKeypair();
    const publicB64 = await toBase64(escrow.publicKey);
    const privateB64 = await toBase64(escrow.privateKey);

    // Cifrar la privada con MASTER_ENC_KEY (mismo patrón que los TOTP secrets).
    const privateEnc = encryptSecret(masterKey, Buffer.from(escrow.privateKey));

    await pool.query(
      `INSERT INTO org_escrow_key (id, escrow_public, escrow_private_enc)
       VALUES (1, $1, $2)`,
      [Buffer.from(escrow.publicKey), privateEnc],
    );

    console.log("");
    console.log("════════════════════════════════════════════════════════════");
    console.log("  LLAVE DE ESCROW DE LA ORGANIZACIÓN — GENERADA");
    console.log("════════════════════════════════════════════════════════════");
    console.log("");
    console.log("  Pública (no secreta, ya guardada en BD):");
    console.log(`    ${publicB64}`);
    console.log("");
    console.log("  🔒 PRIVADA — RESPÁLDALA OFFLINE AHORA (se muestra UNA VEZ):");
    console.log("");
    console.log(`    ${privateB64}`);
    console.log("");
    console.log("════════════════════════════════════════════════════════════");
    console.log("");
    console.log("  → Copia la PRIVADA a la caja fuerte de la oficina + tu copia personal.");
    console.log("  → La privada YA está cifrada con MASTER_ENC_KEY en la BD para uso normal.");
    console.log("  → Esta copia offline es SOLO para disaster recovery (si el server o");
    console.log("    el MASTER_ENC_KEY se pierden). Sin ella + sin MASTER_ENC_KEY, NADIE");
    console.log("    podrá recuperar identidades de usuarios que olviden su contraseña.");
    console.log("  → NO la guardes en este servidor ni en el repo. Papel / gestor offline.");
    console.log("");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error inesperado:", err);
  process.exit(1);
});
