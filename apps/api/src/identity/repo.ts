/**
 * Repo de identidad por usuario — Fase 31.
 *
 * Acceso a las tablas user_identities y org_escrow_key. El server guarda y
 * devuelve blobs opacos (base64 ↔ BYTEA); nunca descifra la privada del
 * usuario salvo en el flujo de recovery (Capa 6), que usa la llave de escrow.
 */
import { pool } from "../db/pg.js";

export interface UserIdentityRow {
  identityPublic: Buffer;
  identityEncPw: Buffer;
  pwSalt: Buffer;
  identityEncEscrow: Buffer;
}

/** Devuelve la identidad del usuario, o null si aún no la enrolló. */
export async function getUserIdentity(userId: string): Promise<UserIdentityRow | null> {
  const r = await pool.query<{
    identity_public: Buffer;
    identity_enc_pw: Buffer;
    pw_salt: Buffer;
    identity_enc_escrow: Buffer;
  }>(
    `SELECT identity_public, identity_enc_pw, pw_salt, identity_enc_escrow
       FROM user_identities WHERE user_id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    identityPublic: row.identity_public,
    identityEncPw: row.identity_enc_pw,
    pwSalt: row.pw_salt,
    identityEncEscrow: row.identity_enc_escrow,
  };
}

/**
 * Crea la identidad del usuario. Falla si ya existe (no se sobrescribe por
 * accidente — cambiar la pública invalidaría todos los mensajes cifrados
 * hacia el usuario). Para re-envolver con password nueva, usar
 * `rewrapUserIdentity` (no toca la pública ni el escrow).
 */
export async function createUserIdentity(
  userId: string,
  data: {
    identityPublic: Buffer;
    identityEncPw: Buffer;
    pwSalt: Buffer;
    identityEncEscrow: Buffer;
  },
): Promise<{ ok: boolean; reason?: string }> {
  // INSERT con ON CONFLICT DO NOTHING → detecta si ya existía.
  const r = await pool.query(
    `INSERT INTO user_identities
       (user_id, identity_public, identity_enc_pw, pw_salt, identity_enc_escrow)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, data.identityPublic, data.identityEncPw, data.pwSalt, data.identityEncEscrow],
  );
  if ((r.rowCount ?? 0) === 0) {
    return { ok: false, reason: "identity_already_exists" };
  }
  return { ok: true };
}

/**
 * Re-envuelve la privada con una llave de contraseña nueva. Solo actualiza
 * `identity_enc_pw` + `pw_salt`; la pública y el blob de escrow no cambian
 * (la identidad es la misma). Para el cambio de contraseña.
 */
export async function rewrapUserIdentity(
  userId: string,
  data: { identityEncPw: Buffer; pwSalt: Buffer },
): Promise<{ ok: boolean }> {
  const r = await pool.query(
    `UPDATE user_identities
        SET identity_enc_pw = $2, pw_salt = $3, updated_at = now()
      WHERE user_id = $1`,
    [userId, data.identityEncPw, data.pwSalt],
  );
  return { ok: (r.rowCount ?? 0) > 0 };
}

/** Pública de escrow para que el cliente selle su identidad. null si no hay bootstrap. */
export async function getEscrowPublicKey(): Promise<Buffer | null> {
  const r = await pool.query<{ escrow_public: Buffer }>(
    `SELECT escrow_public FROM org_escrow_key WHERE id = 1`,
  );
  return r.rows[0]?.escrow_public ?? null;
}

/** Privada de escrow CIFRADA (con MASTER_ENC_KEY). Solo para el flujo de recovery (Capa 6). */
export async function getEscrowPrivateEnc(): Promise<Buffer | null> {
  const r = await pool.query<{ escrow_private_enc: Buffer }>(
    `SELECT escrow_private_enc FROM org_escrow_key WHERE id = 1`,
  );
  return r.rows[0]?.escrow_private_enc ?? null;
}
