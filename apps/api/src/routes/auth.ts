import type { FastifyInstance } from "fastify";
import {
  AuthSuccessResponseSchema,
  BeginTotpRotationRequestSchema,
  BiometricUnlockRequestSchema,
  ChangePasswordRequestSchema,
  ConfirmTotpRotationRequestSchema,
  EnableBiometricRequestSchema,
  EnrollBeginRequestSchema,
  EnrollCompleteRequestSchema,
  ForcedPasswordChangeRequestSchema,
  LoginRequestSchema,
  ReauthRequestSchema,
  SelfResetPasswordRequestSchema,
  type AuthSuccessResponse,
  type BeginTotpRotationResponse,
  type EnableBiometricResponse,
  type EnrollBeginResponse,
  type LoginChangeRequiredResponse,
  type MeResponse,
} from "@euromex/shared";
import { randomUUID } from "crypto";
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
  app.post(
    "/auth/login",
    async (req, reply): Promise<AuthSuccessResponse | LoginChangeRequiredResponse> => {
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
      must_change_password: boolean;
    }>(
      `SELECT id, username, display_name, password_hash, totp_secret_enc, role, status,
              must_change_password
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

    // Fase 30 — Si el admin reseteó la password recientemente, el user debe
    // cambiarla ANTES de obtener sesión válida. El changeToken es un JWT
    // corto (5 min) con claim `t: "password-change"` que SOLO sirve para
    // /auth/password/forced. Cualquier otro endpoint protegido lo rechaza.
    // No creamos device aquí — eso pasa en /auth/password/forced, después
    // de que el user complete el cambio.
    //
    // Race-condition guard: re-leer must_change_password fresco de BD justo
    // antes de decidir. Un admin reset concurrente entre el SELECT inicial y
    // este punto cambiaría el flag a TRUE; sin esta re-lectura el user
    // entraría con sesión normal bypaseando el cambio forzado.
    const freshFlagRes = await pool.query<{ must_change_password: boolean }>(
      "SELECT must_change_password FROM users WHERE id = $1",
      [user.id],
    );
    const mustChange = freshFlagRes.rows[0]?.must_change_password ?? user.must_change_password;
    if (mustChange) {
      const changeToken = app.jwt.sign(
        { t: "password-change", sub: user.id } as unknown as SessionClaims,
        { expiresIn: "5m" },
      );
      await audit(req, {
        userId: user.id,
        action: "login.change_required",
        metadata: { username },
      });
      return {
        changeRequired: true,
        changeToken,
        username: user.username,
        displayName: user.display_name,
      };
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
  // Fase 26 (C3) — POST /auth/password
  //
  // Cambia la password del usuario autenticado. Requiere:
  //   - currentPassword (verificación argon2 contra hash en BD)
  //   - newPassword (mínimo 12 chars, validado por PasswordSchema en shared)
  //   - totpToken (segundo factor — evita que sesión robada cambie password)
  //   - revokeOtherDevices (default true: revoca todos los demás devices del
  //                          usuario para zero-trust en credential filtradas)
  //
  // Rate-limit handled at app-level (fastify-rate-limit ya está en /auth/*).
  // --------------------------------------------------------------------------
  app.post(
    "/auth/password",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const parsed = ChangePasswordRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const { currentPassword, newPassword, totpToken, revokeOtherDevices } = parsed.data;
      const userId = req.session!.sub;
      const deviceId = req.session!.did;

      const userRes = await pool.query<{
        password_hash: string;
        totp_secret_enc: Buffer;
      }>(
        "SELECT password_hash, totp_secret_enc FROM users WHERE id = $1",
        [userId],
      );
      const user = userRes.rows[0];
      if (!user) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      const passOk = await verifyPassword(user.password_hash, currentPassword);
      if (!passOk) {
        await audit(req, {
          userId,
          deviceId,
          action: "password.change_failed",
          metadata: { reason: "current_password_invalid" },
        });
        return reply.code(401).send({ error: "invalid_current_password" });
      }

      const totpSecret = decryptSecret(masterKey, user.totp_secret_enc).toString("utf8");
      if (!verifyTotp(totpSecret, totpToken)) {
        await audit(req, {
          userId,
          deviceId,
          action: "password.change_failed",
          metadata: { reason: "invalid_totp" },
        });
        return reply.code(401).send({ error: "invalid_totp" });
      }

      // Rechazar si la nueva es igual a la actual (mejor UX que dejarlo pasar
      // y que el usuario crea que cambió algo).
      const sameAsOld = await verifyPassword(user.password_hash, newPassword);
      if (sameAsOld) {
        return reply.code(400).send({ error: "same_as_current" });
      }

      const newHash = await hashPassword(newPassword);
      await pool.query(
        "UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2",
        [newHash, userId],
      );

      let revokedCount = 0;
      if (revokeOtherDevices) {
        const r = await pool.query(
          `UPDATE devices SET status = 'revoked', revoked_at = now()
            WHERE user_id = $1 AND id <> $2 AND status = 'active'`,
          [userId, deviceId],
        );
        revokedCount = r.rowCount ?? 0;
      }

      await audit(req, {
        userId,
        deviceId,
        action: "password.changed",
        metadata: { revokedDevices: revokedCount },
      });

      return reply.code(204).send();
    },
  );

  // --------------------------------------------------------------------------
  // Fase 30 — POST /auth/password/forced
  //
  // Cambio de password obligatorio tras un admin reset. Diferencias con
  // /auth/password (Fase 26 C3):
  //   - NO requiere `currentPassword` — la temp ya fue verificada en /auth/login.
  //   - Acepta `changeToken` (JWT corto con claim t="password-change") en
  //     lugar del JWT de sesión normal. Cualquier otro JWT es rechazado.
  //   - Crea device + devuelve AuthSuccessResponse completa al finalizar,
  //     por lo que el user queda logueado en una sola operación.
  //
  // El TOTP sigue siendo obligatorio: el segundo factor no se relaja por
  // estar en flujo de reset.
  // --------------------------------------------------------------------------
  app.post("/auth/password/forced", async (req, reply): Promise<AuthSuccessResponse> => {
    const parsed = ForcedPasswordChangeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { changeToken, newPassword, totpToken, deviceName, platform } = parsed.data;

    // 1) Validar el changeToken — debe ser un JWT firmado por nosotros con
    //    claim t="password-change". El verify ya valida firma + expiry.
    //    Cualquier rechazo se audita: ayuda a detectar intentos de replay o
    //    de usar tokens de otros tipos (rotation, biometric) en este endpoint.
    let claims: { t: string; sub: string };
    try {
      claims = app.jwt.verify(changeToken) as { t: string; sub: string };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "verify_failed";
      await audit(req, {
        action: "password.forced_change_invalid_token",
        metadata: { reason },
      });
      return reply.code(401).send({ error: "invalid_change_token" });
    }
    if (claims.t !== "password-change" || !claims.sub) {
      await audit(req, {
        userId: claims.sub ?? null,
        action: "password.forced_change_invalid_token",
        metadata: { reason: "wrong_token_type", t: claims.t },
      });
      return reply.code(401).send({ error: "invalid_change_token" });
    }
    const userId = claims.sub;

    // 2) Cargar user + verificar que sigue requerido el cambio. Si el flag
    //    ya está en false, alguien (otra sesión paralela, admin) ya completó
    //    el cambio — rechazamos para evitar doble efecto.
    const userRes = await pool.query<{
      id: string;
      username: string;
      display_name: string;
      totp_secret_enc: Buffer;
      role: "user" | "admin";
      status: string;
      must_change_password: boolean;
      password_hash: string;
    }>(
      `SELECT id, username, display_name, totp_secret_enc, role, status,
              must_change_password, password_hash
         FROM users WHERE id = $1`,
      [userId],
    );
    const user = userRes.rows[0];
    if (!user || user.status !== "active") {
      return reply.code(401).send({ error: "session_revoked" });
    }
    if (!user.must_change_password) {
      // El user ya completó el cambio en otro flujo. Pedirle login normal.
      return reply.code(409).send({ error: "no_change_required" });
    }

    // 3) Validar TOTP — segundo factor obligatorio.
    const totpSecret = decryptSecret(masterKey, user.totp_secret_enc).toString("utf8");
    if (!verifyTotp(totpSecret, totpToken)) {
      await audit(req, {
        userId,
        action: "password.forced_change_failed",
        metadata: { reason: "invalid_totp" },
      });
      return reply.code(401).send({ error: "invalid_totp" });
    }

    // 4) Rechazar si la nueva password coincide con la temp — el reset
    //    pierde sentido si el user "cambia" a la misma que el admin generó.
    const sameAsTemp = await verifyPassword(user.password_hash, newPassword);
    if (sameAsTemp) {
      return reply.code(400).send({ error: "same_as_temp_password" });
    }

    // 5) Persistir nueva password + limpiar flag + crear device para la
    //    sesión nueva. Transacción para que sea atómico.
    const newHash = await hashPassword(newPassword);
    const client = await pool.connect();
    let device: { id: string; device_name: string; platform: string };
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE users
            SET password_hash = $1,
                must_change_password = FALSE,
                updated_at = now()
          WHERE id = $2`,
        [newHash, userId],
      );

      const deviceRes = await client.query<{
        id: string;
        device_name: string;
        platform: string;
      }>(
        `INSERT INTO devices (user_id, device_name, platform, user_agent, status, last_seen_at)
         VALUES ($1, $2, $3, $4, 'active', now())
         RETURNING id, device_name, platform`,
        [
          userId,
          deviceName,
          platform,
          (req.headers["user-agent"] as string) ?? null,
        ],
      );
      device = deviceRes.rows[0]!;

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      req.log.error({ err, userId }, "forced password change failed");
      return reply.code(500).send({ error: "change_failed" });
    } finally {
      client.release();
    }

    await audit(req, {
      userId,
      deviceId: device.id,
      action: "password.forced_change",
      metadata: { platform },
    });

    const token = app.jwt.sign({ sub: userId, did: device.id, role: user.role });
    return await buildAuthResponse(token, user, device);
  });

  // --------------------------------------------------------------------------
  // Fase 30b — POST /auth/password/reset-self
  //
  // Self-service password reset. El user que conserva su TOTP puede cambiar
  // la password por sí mismo sin pasar por un admin. El TOTP es el segundo
  // factor — sin él, el endpoint no hace nada.
  //
  // Diferencia con /auth/password (Fase 26 C3): NO requiere currentPassword
  // (justamente: el user la olvidó). El TOTP autoriza el reset.
  // Diferencia con /admin/users/:id/reset-password (Fase 30a): el admin no
  // interviene, no se genera temp password, el user define directamente la
  // nueva. El admin solo lo ve después en audit log.
  //
  // Anti-enumeration: si el username no existe o user está inactivo, devolvemos
  // el mismo 401 invalid_credentials_or_totp que con TOTP malo, después de
  // ejecutar verifyPassword con fakeHash para igualar el timing.
  // --------------------------------------------------------------------------
  app.post("/auth/password/reset-self", async (req, reply) => {
    const parsed = SelfResetPasswordRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { username, totpToken, newPassword } = parsed.data;

    const userRes = await pool.query<{
      id: string;
      username: string;
      password_hash: string;
      totp_secret_enc: Buffer;
      status: string;
    }>(
      `SELECT id, username, password_hash, totp_secret_enc, status
         FROM users WHERE username = $1`,
      [username],
    );
    const user = userRes.rows[0];

    // Anti-timing: siempre corremos verifyPassword aunque user no exista.
    // El resultado se descarta (no comparamos), solo igualamos el ~100ms.
    const fakeHash =
      "$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$fQvYVWfQ7gQBZzwYcxNh8UeYPPrQHk5vmzkQCrHnmzU";
    await verifyPassword(user?.password_hash ?? fakeHash, newPassword);

    if (!user || user.status !== "active") {
      await audit(req, {
        action: "password.self_reset_failed",
        metadata: { username, reason: "user_not_found_or_inactive" },
      });
      return reply.code(401).send({ error: "invalid_credentials_or_totp" });
    }

    const totpSecret = decryptSecret(masterKey, user.totp_secret_enc).toString("utf8");
    if (!verifyTotp(totpSecret, totpToken)) {
      await audit(req, {
        userId: user.id,
        action: "password.self_reset_failed",
        metadata: { username, reason: "invalid_totp" },
      });
      return reply.code(401).send({ error: "invalid_credentials_or_totp" });
    }

    // Reset exitoso: nueva pwd, limpia el flag de must_change (por si venía
    // de un admin reset pendiente — se cancela ese flow), revoca TODOS los
    // devices activos. El user se loguea fresh con la nueva pwd y crea
    // device nuevo.
    const newHash = await hashPassword(newPassword);
    const client = await pool.connect();
    let revokedCount = 0;
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE users
            SET password_hash = $1,
                must_change_password = FALSE,
                updated_at = now()
          WHERE id = $2`,
        [newHash, user.id],
      );
      const revokeRes = await client.query(
        `UPDATE devices
            SET status = 'revoked', revoked_at = now()
          WHERE user_id = $1 AND status = 'active'`,
        [user.id],
      );
      revokedCount = revokeRes.rowCount ?? 0;
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      req.log.error({ err, userId: user.id }, "self password reset failed");
      return reply.code(500).send({ error: "reset_failed" });
    } finally {
      client.release();
    }

    await audit(req, {
      userId: user.id,
      action: "password.self_reset",
      metadata: { username: user.username, revokedDevices: revokedCount },
    });

    return reply.code(204).send();
  });

  // --------------------------------------------------------------------------
  // Fase 26 (C4) — POST /auth/totp/begin
  //
  // Inicia rotación de 2FA. Requiere TOTP actual (prueba de posesión del
  // device autenticador viejo). Genera nuevo secret + lo cifra + lo embebe
  // en un JWT de 5 min. Devuelve el JWT, el otpauth URI y el QR PNG.
  //
  // El secret nuevo NUNCA toca BD hasta que el usuario llame /auth/totp/confirm.
  // --------------------------------------------------------------------------
  app.post(
    "/auth/totp/begin",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<BeginTotpRotationResponse> => {
      const parsed = BeginTotpRotationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const { totpToken } = parsed.data;
      const userId = req.session!.sub;

      const userRes = await pool.query<{
        username: string;
        totp_secret_enc: Buffer;
      }>(
        "SELECT username, totp_secret_enc FROM users WHERE id = $1",
        [userId],
      );
      const user = userRes.rows[0];
      if (!user) return reply.code(404).send({ error: "user_not_found" });

      const oldSecret = decryptSecret(masterKey, user.totp_secret_enc).toString("utf8");
      if (!verifyTotp(oldSecret, totpToken)) {
        await audit(req, {
          userId,
          deviceId: req.session!.did,
          action: "totp.rotate_begin_failed",
          metadata: { reason: "invalid_current_totp" },
        });
        return reply.code(401).send({ error: "invalid_current_totp" });
      }

      const enrollment = await createTotpEnrollment(user.username);
      // Embebemos el secret nuevo cifrado dentro del rotation token. Así no
      // necesitamos almacenamiento intermedio (Redis / tabla temp); basta
      // con que el cliente devuelva el token al confirmar.
      const encNewSecret = encryptSecret(masterKey, enrollment.secret).toString("base64");
      // app.jwt.sign tipa el payload contra SessionClaims (auth/jwt.ts), pero
      // este token es un JWT diferente con su propio shape. Casteamos vía
      // unknown — el verify del lado opuesto valida claims.t === "totp-rotate"
      // antes de usarlo como rotation token.
      const rotationToken = app.jwt.sign(
        { t: "totp-rotate", sub: userId, ns: encNewSecret } as unknown as SessionClaims,
        { expiresIn: "5m" },
      );

      const qrBase64 = enrollment.qrDataUrl.replace(/^data:image\/png;base64,/, "");

      return {
        rotationToken,
        otpauthUri: enrollment.uri,
        qrPngBase64: qrBase64,
      };
    },
  );

  // --------------------------------------------------------------------------
  // Fase 26 (C4) — POST /auth/totp/confirm
  //
  // Confirma rotación: el usuario ya escaneó el nuevo QR en su autenticador
  // y manda el código actual del NUEVO secret. Si valida, persistimos el
  // nuevo secret cifrado en BD reemplazando el viejo.
  // --------------------------------------------------------------------------
  app.post(
    "/auth/totp/confirm",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const parsed = ConfirmTotpRotationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const { rotationToken, totpToken } = parsed.data;
      const userId = req.session!.sub;

      let claims: { t: string; sub: string; ns: string };
      try {
        claims = app.jwt.verify(rotationToken) as { t: string; sub: string; ns: string };
      } catch {
        return reply.code(401).send({ error: "invalid_rotation_token" });
      }

      if (claims.t !== "totp-rotate" || claims.sub !== userId) {
        return reply.code(401).send({ error: "invalid_rotation_token" });
      }

      let newSecret: string;
      try {
        newSecret = decryptSecret(masterKey, Buffer.from(claims.ns, "base64")).toString("utf8");
      } catch {
        return reply.code(401).send({ error: "invalid_rotation_token" });
      }

      if (!verifyTotp(newSecret, totpToken)) {
        await audit(req, {
          userId,
          deviceId: req.session!.did,
          action: "totp.rotate_confirm_failed",
          metadata: { reason: "invalid_new_totp" },
        });
        return reply.code(401).send({ error: "invalid_new_totp" });
      }

      const newEnc = encryptSecret(masterKey, newSecret);
      await pool.query(
        "UPDATE users SET totp_secret_enc = $1, updated_at = now() WHERE id = $2",
        [newEnc, userId],
      );

      await audit(req, {
        userId,
        deviceId: req.session!.did,
        action: "totp.rotated",
        metadata: {},
      });

      return reply.code(204).send();
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

  // --------------------------------------------------------------------------
  // FASE 27 — Biometric unlock (per-device)
  //
  // Modelo: el server emite un biometric_unlock_token (JWT, ttl 90d) cuando el
  // usuario activa la conveniencia. El cliente lo guarda cifrado con biometría
  // en Keystore (Android) / Keychain (iOS). Al re-loguear con huella, el
  // cliente desbloquea el JWT y lo cambia por una session normal vía
  // /auth/biometric/unlock.
  //
  // El TOTP NO se elimina: se pide una vez al activar (segundo factor del
  // opt-in) y vuelve a ser obligatorio si el usuario hace logout total o
  // pierde el device. La biometría es un atajo de UX, no un reemplazo del
  // modelo de auth.
  //
  // Revocación instantánea: cualquier disable o re-enable rota el JTI; el
  // JWT viejo deja de servir aunque el cliente todavía lo tenga en Keystore.
  // --------------------------------------------------------------------------

  const BIOMETRIC_TOKEN_TTL_SEC = 60 * 60 * 24 * 90; // 90 días

  // POST /auth/biometric/enable — activar biometric unlock para este device.
  // Requiere: session activa + TOTP (segundo factor del opt-in).
  app.post(
    "/auth/biometric/enable",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<EnableBiometricResponse> => {
      const parsed = EnableBiometricRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", issues: parsed.error.issues });
      }

      const userId = req.session!.sub;
      const deviceId = req.session!.did;

      const r = await pool.query<{ totp_secret_enc: Buffer }>(
        `SELECT totp_secret_enc FROM users WHERE id = $1`,
        [userId],
      );
      const row = r.rows[0];
      if (!row) {
        return reply.code(401).send({ error: "session_revoked" });
      }

      const totpSecret = decryptSecret(masterKey, row.totp_secret_enc).toString("utf8");
      if (!verifyTotp(totpSecret, parsed.data.totpToken)) {
        await audit(req, {
          userId,
          deviceId,
          action: "biometric.enable_failed",
          metadata: { reason: "invalid_totp" },
        });
        return reply.code(401).send({ error: "invalid_totp" });
      }

      const jti = randomUUID();
      // JWT firmado con la misma master secret del Fastify JWT plugin.
      // type discrimina contra session tokens normales — el unlock endpoint
      // RECHAZA cualquier JWT que no diga type === 'biometric_unlock'.
      const biometricToken = app.jwt.sign(
        { sub: userId, did: deviceId, type: "biometric_unlock", jti } as unknown as SessionClaims,
        { expiresIn: BIOMETRIC_TOKEN_TTL_SEC },
      );

      // Guardar fingerprint al activar — se usará para comparar en /unlock
      // y detectar uso del token desde otro device (parche #3 KNOWN_ISSUES).
      await pool.query(
        `UPDATE devices
            SET biometric_enabled = true,
                biometric_token_jti = $1,
                biometric_fingerprint = $2
          WHERE id = $3`,
        [jti, (req.headers["user-agent"] as string) ?? null, deviceId],
      );

      await audit(req, {
        userId,
        deviceId,
        action: "biometric.enabled",
      });

      return {
        biometricToken,
        expiresInSec: BIOMETRIC_TOKEN_TTL_SEC,
      };
    },
  );

  // POST /auth/biometric/unlock — login con huella.
  // NO requiere session previa; el biometricToken ES la prueba.
  // El cliente lo desbloqueó del Keystore después del prompt biométrico.
  app.post("/auth/biometric/unlock", async (req, reply): Promise<AuthSuccessResponse> => {
    const parsed = BiometricUnlockRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", issues: parsed.error.issues });
    }

    let claims: { sub: string; did: string; type?: string; jti?: string };
    try {
      claims = app.jwt.verify(parsed.data.biometricToken) as typeof claims;
    } catch {
      return reply.code(401).send({ error: "invalid_biometric_token" });
    }
    if (claims.type !== "biometric_unlock" || !claims.jti) {
      return reply.code(401).send({ error: "invalid_biometric_token" });
    }

    const r = await pool.query<{
      user_id: string;
      device_id: string;
      username: string;
      display_name: string;
      role: "user" | "admin";
      user_status: string;
      device_status: string;
      device_name: string;
      platform: string;
      biometric_enabled: boolean;
      biometric_token_jti: string | null;
      biometric_fingerprint: string | null;
    }>(
      `SELECT u.id AS user_id, d.id AS device_id, u.username, u.display_name,
              u.role, u.status AS user_status, d.status AS device_status,
              d.device_name, d.platform, d.biometric_enabled, d.biometric_token_jti,
              d.biometric_fingerprint
         FROM devices d
         JOIN users u ON u.id = d.user_id
        WHERE d.id = $1 AND u.id = $2`,
      [claims.did, claims.sub],
    );
    const row = r.rows[0];
    if (!row || row.user_status !== "active" || row.device_status !== "active") {
      return reply.code(401).send({ error: "session_revoked" });
    }

    // Comparación crítica: el JTI almacenado es el ÚNICO válido. Si el
    // usuario desactivó/reactivó, o el admin revocó la sesión, el JTI cambió
    // o se borró → el JWT viejo debe rechazarse aunque su firma siga buena.
    if (!row.biometric_enabled || row.biometric_token_jti !== claims.jti) {
      await audit(req, {
        userId: row.user_id,
        deviceId: row.device_id,
        action: "biometric.unlock_revoked",
      });
      return reply.code(401).send({ error: "biometric_revoked" });
    }

    // Comparar user-agent del unlock con el registrado al activar.
    // Si difieren completamente, lo más probable es que el JWT fue extraído
    // del Keystore (requiere root) y se está usando desde otro device.
    // NULL en biometric_fingerprint = token emitido antes de este parche;
    // lo dejamos pasar y se actualizará al próximo enable.
    // Nota: un update de browser puede cambiar el UA levemente y causar un
    // falso positivo; el usuario puede desactivar/reactivar biometría para
    // resetear el fingerprint.
    const requestUa = (req.headers["user-agent"] as string) ?? null;
    if (row.biometric_fingerprint && requestUa && row.biometric_fingerprint !== requestUa) {
      await audit(req, {
        userId: row.user_id,
        deviceId: row.device_id,
        action: "biometric.fingerprint_mismatch",
        metadata: {
          platform: row.platform,
          stored: row.biometric_fingerprint,
          received: requestUa,
        },
      });
      return reply.code(401).send({ error: "biometric_fingerprint_mismatch" });
    }

    await audit(req, {
      userId: row.user_id,
      deviceId: row.device_id,
      action: "biometric.unlock",
      metadata: { authMethod: "biometric", platform: row.platform },
    });

    const token = app.jwt.sign({
      sub: row.user_id,
      did: row.device_id,
      role: row.role,
    });
    return await buildAuthResponse(
      token,
      {
        id: row.user_id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
      },
      { id: row.device_id, device_name: row.device_name, platform: row.platform },
    );
  });

  // POST /auth/biometric/disable — desactivar biometric unlock para este
  // device. NO se pide TOTP — bajar la conveniencia es siempre menos
  // sensible que activarla. El JTI se borra → cualquier JWT viejo en
  // Keystore queda inservible inmediatamente.
  app.post(
    "/auth/biometric/disable",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      await pool.query(
        `UPDATE devices
            SET biometric_enabled = false, biometric_token_jti = NULL
          WHERE id = $1`,
        [req.session!.did],
      );
      await audit(req, {
        userId: req.session!.sub,
        deviceId: req.session!.did,
        action: "biometric.disabled",
      });
      return reply.code(204).send();
    },
  );
}
