import type { FastifyInstance } from "fastify";
import {
  AuthSuccessResponseSchema,
  EnrollBeginRequestSchema,
  EnrollCompleteRequestSchema,
  LoginRequestSchema,
  ReauthRequestSchema,
  type AuthSuccessResponse,
  type EnrollBeginResponse,
  type MeResponse,
} from "@euromex/shared";
import { pool } from "../db/pg.js";
import {
  hashPassword,
  verifyPassword,
  verifyInviteCode,
  encryptSecret,
  decryptSecret,
  loadMasterKey,
} from "../auth/crypto.js";
import { createTotpEnrollment, verifyTotp } from "../auth/totp.js";
import { requireAuth, type SessionClaims } from "../auth/jwt.js";
import { config } from "../config.js";

type InvitationRow = {
  id: string;
  code_hash: string;
  role: "user" | "admin";
  expires_at: Date;
  used_at: Date | null;
};

/** Claims del JWT de enrollment (corto, 10 min). Viaja a cliente y vuelve. */
interface EnrollmentClaims {
  t: "enroll";
  inviteId: string;
  username: string;
  displayName: string;
  email: string | null;
  role: "user" | "admin";
  totp: string; // secret base32
}

const ENROLLMENT_TTL_SEC = 600;

async function findLiveInvitationForCode(code: string): Promise<InvitationRow | null> {
  const rows = await pool.query<InvitationRow>(
    `SELECT id, code_hash, role, expires_at, used_at
       FROM invitations
      WHERE used_at IS NULL AND expires_at > now()`,
  );
  for (const row of rows.rows) {
    if (await verifyInviteCode(row.code_hash, code)) return row;
  }
  return null;
}

async function audit(
  req: { ip: string; headers: Record<string, unknown> },
  params: {
    userId?: string | null;
    deviceId?: string | null;
    action: string;
    metadata?: Record<string, unknown>;
  },
) {
  await pool.query(
    `INSERT INTO audit_log (user_id, device_id, action, metadata, ip, user_agent)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      params.userId ?? null,
      params.deviceId ?? null,
      params.action,
      JSON.stringify(params.metadata ?? {}),
      req.ip,
      req.headers["user-agent"] ?? null,
    ],
  );
}

/**
 * Carga los permisos granulares (Fase 24) del usuario desde la BD.
 * Aislado en helper para que cada respuesta de auth los incluya sin
 * obligar a cada SELECT de auth.ts a traer las 6 columnas extra.
 */
async function loadUserPermissions(userId: string) {
  const r = await pool.query<{
    can_download_attachments: boolean;
    can_share_externally: boolean;
    can_create_groups: boolean;
    can_invite_users: boolean;
    can_initiate_calls: boolean;
    max_attachment_mb: number;
  }>(
    `SELECT can_download_attachments, can_share_externally, can_create_groups,
            can_invite_users, can_initiate_calls, max_attachment_mb
       FROM users
      WHERE id = $1`,
    [userId],
  );
  const p = r.rows[0];
  // Defaults conservadores si por alguna razón el row desapareció
  if (!p) {
    return {
      canDownloadAttachments: true,
      canShareExternally: false,
      canCreateGroups: true,
      canInviteUsers: false,
      canInitiateCalls: true,
      maxAttachmentMb: 50,
    };
  }
  return {
    canDownloadAttachments: p.can_download_attachments,
    canShareExternally: p.can_share_externally,
    canCreateGroups: p.can_create_groups,
    canInviteUsers: p.can_invite_users,
    canInitiateCalls: p.can_initiate_calls,
    maxAttachmentMb: p.max_attachment_mb,
  };
}

async function buildAuthResponse(
  token: string,
  user: { id: string; username: string; display_name: string; role: "user" | "admin" },
  device: { id: string; device_name: string; platform: string },
): Promise<AuthSuccessResponse> {
  const permissions = await loadUserPermissions(user.id);
  return AuthSuccessResponseSchema.parse({
    accessToken: token,
    expiresInSec: config.jwtTtlSec,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      permissions,
    },
    device: {
      id: device.id,
      deviceName: device.device_name,
      platform: device.platform,
    },
  });
}

export async function authRoutes(app: FastifyInstance) {
  const masterKey = loadMasterKey(config.masterEncKey);

  // --------------------------------------------------------------------------
  // POST /auth/enroll/begin — valida invitación, devuelve TOTP QR + handle
  // --------------------------------------------------------------------------
  app.post("/auth/enroll/begin", async (req, reply): Promise<EnrollBeginResponse> => {
    const parsed = EnrollBeginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { code, username, displayName, email } = parsed.data;

    const invitation = await findLiveInvitationForCode(code);
    if (!invitation) {
      await audit(req, { action: "enroll.invalid_code", metadata: { username } });
      return reply.code(400).send({ error: "invalid_or_expired_code" });
    }

    const existing = await pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
    if ((existing.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: "username_taken" });
    }

    const totp = await createTotpEnrollment(username);

    const claims: EnrollmentClaims = {
      t: "enroll",
      inviteId: invitation.id,
      username,
      displayName,
      email: email ?? null,
      role: invitation.role,
      totp: totp.secret,
    };
    const enrollmentId = app.jwt.sign(claims as unknown as SessionClaims, {
      expiresIn: ENROLLMENT_TTL_SEC,
    });

    return {
      enrollmentId,
      totpUri: totp.uri,
      totpQrDataUrl: totp.qrDataUrl,
    };
  });

  // --------------------------------------------------------------------------
  // POST /auth/enroll/complete — verifica TOTP, crea user + device, firma JWT
  // --------------------------------------------------------------------------
  app.post("/auth/enroll/complete", async (req, reply): Promise<AuthSuccessResponse> => {
    const parsed = EnrollCompleteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { enrollmentId, password, totpToken, deviceName, platform } = parsed.data;

    let claims: EnrollmentClaims;
    try {
      claims = app.jwt.verify<EnrollmentClaims>(enrollmentId);
    } catch {
      return reply.code(400).send({ error: "enrollment_expired" });
    }
    if (claims.t !== "enroll") {
      return reply.code(400).send({ error: "invalid_enrollment" });
    }

    if (!verifyTotp(claims.totp, totpToken)) {
      await audit(req, {
        action: "enroll.totp_failed",
        metadata: { username: claims.username },
      });
      return reply.code(400).send({ error: "invalid_totp" });
    }

    const invitation = await pool.query<InvitationRow>(
      "SELECT id, code_hash, role, expires_at, used_at FROM invitations WHERE id = $1",
      [claims.inviteId],
    );
    const inv = invitation.rows[0];
    if (!inv || inv.used_at || new Date(inv.expires_at) < new Date()) {
      return reply.code(400).send({ error: "invitation_no_longer_valid" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const passwordHash = await hashPassword(password);
      const totpEnc = encryptSecret(masterKey, claims.totp);

      const userRes = await client.query<{
        id: string;
        username: string;
        display_name: string;
        role: "user" | "admin";
      }>(
        `INSERT INTO users (username, display_name, email, password_hash, totp_secret_enc, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, display_name, role`,
        [
          claims.username,
          claims.displayName,
          claims.email,
          passwordHash,
          totpEnc,
          claims.role,
        ],
      );
      const user = userRes.rows[0]!;

      const deviceRes = await client.query<{
        id: string;
        device_name: string;
        platform: string;
      }>(
        `INSERT INTO devices (user_id, device_name, platform, user_agent, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id, device_name, platform`,
        [user.id, deviceName, platform, (req.headers["user-agent"] as string) ?? null],
      );
      const device = deviceRes.rows[0]!;

      await client.query(
        "UPDATE invitations SET used_at = now(), used_by = $1 WHERE id = $2",
        [user.id, inv.id],
      );

      await client.query(
        `INSERT INTO audit_log (user_id, device_id, action, metadata, ip, user_agent)
         VALUES ($1, $2, 'enroll.complete', $3::jsonb, $4, $5)`,
        [
          user.id,
          device.id,
          JSON.stringify({ invitationId: inv.id }),
          req.ip,
          req.headers["user-agent"] ?? null,
        ],
      );

      await client.query("COMMIT");

      const token = app.jwt.sign({ sub: user.id, did: device.id, role: user.role });
      return await buildAuthResponse(token, user, device);
    } catch (err) {
      await client.query("ROLLBACK");
      req.log.error({ err }, "enroll.complete failed");
      return reply.code(500).send({ error: "enrollment_failed" });
    } finally {
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // POST /auth/login — verifica password + TOTP, crea o reusa device
  // --------------------------------------------------------------------------
  app.post("/auth/login", async (req, reply): Promise<AuthSuccessResponse> => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { username, password, totpToken, deviceName, platform, deviceId: hintedDeviceId } = parsed.data;

    const userRes = await pool.query<{
      id: string;
      username: string;
      display_name: string;
      password_hash: string;
      totp_secret_enc: Buffer;
      role: "user" | "admin";
      status: string;
    }>(
      `SELECT id, username, display_name, password_hash, totp_secret_enc, role, status
         FROM users WHERE username = $1`,
      [username],
    );
    const user = userRes.rows[0];

    // Ejecuta verifyPassword siempre (aunque user no exista) para mitigar
    // enumeración por timing.
    const fakeHash =
      "$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$fQvYVWfQ7gQBZzwYcxNh8UeYPPrQHk5vmzkQCrHnmzU";
    const passOk = await verifyPassword(user?.password_hash ?? fakeHash, password);

    if (!user || user.status !== "active" || !passOk) {
      await audit(req, { action: "login.failed", metadata: { username } });
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const totpSecret = decryptSecret(masterKey, user.totp_secret_enc).toString("utf8");
    if (!verifyTotp(totpSecret, totpToken)) {
      await audit(req, {
        userId: user.id,
        action: "login.totp_failed",
        metadata: { username },
      });
      return reply.code(401).send({ error: "invalid_totp" });
    }

    // Reuso de device: si el cliente mandó un deviceId del hint local Y existe
    // Y pertenece a este usuario Y está activo → actualizamos last_seen_at y lo
    // re-usamos. Esto evita acumular devices zombie cuando el usuario hace
    // logout/login en el mismo browser.
    let device: { id: string; device_name: string; platform: string } | null = null;

    if (hintedDeviceId) {
      const reuseRes = await pool.query<{
        id: string;
        device_name: string;
        platform: string;
      }>(
        `UPDATE devices
            SET last_seen_at = now(),
                user_agent = COALESCE($3, user_agent)
          WHERE id = $1 AND user_id = $2 AND status = 'active'
          RETURNING id, device_name, platform`,
        [hintedDeviceId, user.id, (req.headers["user-agent"] as string) ?? null],
      );
      device = reuseRes.rows[0] ?? null;
    }

    if (!device) {
      const deviceRes = await pool.query<{
        id: string;
        device_name: string;
        platform: string;
      }>(
        `INSERT INTO devices (user_id, device_name, platform, user_agent, status, last_seen_at)
         VALUES ($1, $2, $3, $4, 'active', now())
         RETURNING id, device_name, platform`,
        [user.id, deviceName, platform, (req.headers["user-agent"] as string) ?? null],
      );
      device = deviceRes.rows[0]!;
    }

    await audit(req, {
      userId: user.id,
      deviceId: device.id,
      action: "login.success",
      metadata: { platform },
    });

    const token = app.jwt.sign({ sub: user.id, did: device.id, role: user.role });
    return await buildAuthResponse(token, user, device);
  });

  // --------------------------------------------------------------------------
  // POST /auth/reauth — renueva JWT para un dispositivo ya enrollado
  //
  // Permite que el usuario vuelva a entrar con solo el TOTP, sin re-ingresar
  // contraseña ni crear un device nuevo. Esto preserva el deviceId (y por
  // tanto el keypair E2EE) entre sesiones → los mensajes anteriores siguen
  // siendo descifrables.
  //
  // Condición de uso: el device debe estar 'active' en DB. Si fue revocado
  // por un admin, este endpoint devuelve session_revoked y el cliente debe
  // mostrar el formulario completo.
  // --------------------------------------------------------------------------
  app.post("/auth/reauth", async (req, reply): Promise<AuthSuccessResponse> => {
    const parsed = ReauthRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { deviceId, totpToken } = parsed.data;

    const r = await pool.query<{
      user_id: string;
      username: string;
      display_name: string;
      totp_secret_enc: Buffer;
      role: "user" | "admin";
      user_status: string;
      device_status: string;
      device_name: string;
      platform: string;
    }>(
      `SELECT u.id AS user_id, u.username, u.display_name, u.totp_secret_enc,
              u.role, u.status AS user_status, d.status AS device_status,
              d.device_name, d.platform
         FROM devices d
         JOIN users u ON u.id = d.user_id
        WHERE d.id = $1`,
      [deviceId],
    );

    const row = r.rows[0];
    // Cualquier estado que no sea user+device activos → force full login
    if (!row || row.user_status !== "active" || row.device_status !== "active") {
      return reply.code(401).send({ error: "session_revoked" });
    }

    const totpSecret = decryptSecret(masterKey, row.totp_secret_enc).toString("utf8");
    if (!verifyTotp(totpSecret, totpToken)) {
      await audit(req, {
        userId: row.user_id,
        deviceId,
        action: "login.reauth_totp_failed",
      });
      return reply.code(401).send({ error: "invalid_totp" });
    }

    await audit(req, {
      userId: row.user_id,
      deviceId,
      action: "login.reauth",
      metadata: { platform: row.platform },
    });

    const token = app.jwt.sign({ sub: row.user_id, did: deviceId, role: row.role });
    return await buildAuthResponse(
      token,
      { id: row.user_id, username: row.username, display_name: row.display_name, role: row.role },
      { id: deviceId, device_name: row.device_name, platform: row.platform },
    );
  });

  // --------------------------------------------------------------------------
  // GET /auth/me
  // --------------------------------------------------------------------------
  app.get(
    "/auth/me",
    { preHandler: [requireAuth] },
    async (req): Promise<MeResponse> => {
      const res = await pool.query<{
        id: string;
        username: string;
        display_name: string;
        email: string | null;
        role: "user" | "admin";
        receives_security_alerts: boolean;
        device_id: string;
        device_name: string;
        platform: "web" | "ios" | "android" | "desktop";
        last_seen_at: Date | null;
      }>(
        `SELECT u.id, u.username, u.display_name, u.email, u.role,
                u.receives_security_alerts,
                d.id AS device_id, d.device_name, d.platform, d.last_seen_at
           FROM users u JOIN devices d ON d.user_id = u.id
          WHERE u.id = $1 AND d.id = $2`,
        [req.session!.sub, req.session!.did],
      );
      const r = res.rows[0]!;
      const permissions = await loadUserPermissions(r.id);
      return {
        user: {
          id: r.id,
          username: r.username,
          displayName: r.display_name,
          email: r.email,
          role: r.role,
          receivesSecurityAlerts: r.receives_security_alerts,
          permissions,
        },
        device: {
          id: r.device_id,
          deviceName: r.device_name,
          platform: r.platform,
          lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
        },
      };
    },
  );

  // --------------------------------------------------------------------------
  // POST /auth/logout — cierre de sesión suave (no revoca el device)
  //
  // Solo registra el evento en audit_log. El device queda 'active' para
  // permitir re-auth con solo TOTP la próxima vez. Si se necesita revocar
  // un dispositivo (p.ej. teléfono perdido), el admin usa el panel admin
  // → Usuarios → Dispositivos → Revocar.
  // --------------------------------------------------------------------------
  app.post(
    "/auth/logout",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      await audit(req, {
        userId: req.session!.sub,
        deviceId: req.session!.did,
        action: "logout",
      });
      return reply.code(204).send();
    },
  );
}
