# Fase 31 — Identidad por usuario con escrow corporativo

> **Estado:** DISEÑO (no implementado). Decisión tomada en ADR-040 (2026-06-19).
> Este documento es el diseño formal previo a construir. La implementación es por capas (~4-6 sesiones).

---

## 1. Objetivo y requisitos

Dos requisitos reales de operación de Grupo Euromex:

- **R1 — Recovery sin perder historial:** los empleados olvidan la contraseña con frecuencia. Hoy el reset revoca dispositivos → se pierde la identidad E2EE → historial ilegible.
- **R2 — Multi-dispositivo real:** abrir en computadora **y** celular viendo los mismos mensajes.

Ambos requisitos tienen la misma causa raíz: **hoy la identidad de cifrado está atada al dispositivo**, no a la persona.

---

## 2. Modelo ACTUAL (resumen del código)

| Pieza | Hoy |
|---|---|
| Identidad | 1 keypair X25519 **por dispositivo** (`nacl.box.keyPair`), privada solo en `localStorage` (`euromex.key.<deviceId>`) |
| Pub key | `devices.identity_public_key BYTEA` |
| Envelope | 1 por dispositivo destinatario: `message_envelopes (message_id, recipient_device, ciphertext, nonce)` |
| Envío | Cliente cifra el plaintext una vez **por cada device** de cada miembro (`encryptFor`), manda N envelopes |
| Recepción | `LEFT JOIN message_envelopes ON recipient_device = mi_device` |
| Multi-device | Vía "backfill" (Fase 23b): un device viejo online re-cifra para el nuevo. Frágil. |
| Recovery | No existe identidad recuperable. Reset revoca devices → pierde llaves. |
| Cripto disponible | `packages/crypto`: `generateIdentityKeypair`, `encryptFor`, `decryptFrom`, base64 helpers, `safetyNumber`. **NO hay** derivación de password ni `secretbox` exportado. |
| Patrón simétrico server | `MASTER_ENC_KEY` + AES-256-GCM (`nonce(12)||ct||tag(16)`) para TOTP secrets. Reusable. |

---

## 3. Modelo NUEVO (identidad por usuario)

**Una identidad de cifrado por USUARIO**, compartida por todos sus dispositivos, recuperable vía escrow.

El "dispositivo" sigue existiendo como **unidad de sesión/auth** (login, biometría, revocación), pero **deja de tener identidad de cifrado propia**. La identidad es de la persona.

### 3.1 Las tres copias de la llave privada del usuario

La privada del usuario (`userPriv`) nunca se guarda en claro en el servidor. Se guarda cifrada de dos formas, y vive en claro solo en memoria del cliente logueado:

| Copia | Cifrada con | Para qué |
|---|---|---|
| `identity_enc_pw` | Clave derivada de la **contraseña** (Argon2id) | Uso normal: login en cualquier device descifra con su password |
| `identity_enc_escrow` | **Llave pública de escrow** de la organización | Recovery: cuando el usuario olvida todo |

### 3.2 Flujos

**Enrollment (alta de usuario)**
1. Cliente genera `(userPub, userPriv)`.
2. Deriva `pwKey = Argon2id(password, salt)`.
3. `identity_enc_pw = secretbox(userPriv, pwKey)`.
4. `identity_enc_escrow = sealedBox(userPriv, escrowPub)`.
5. Sube `userPub`, `identity_enc_pw` + `salt`, `identity_enc_escrow`. El server **nunca** ve `userPriv`.

**Login (compu o cel)**
1. Usuario: username + password + TOTP. Server valida.
2. Server devuelve `userPub`, `identity_enc_pw`, `salt`.
3. Cliente deriva `pwKey` y descifra `userPriv`.
4. Cliente puede descifrar **todo** el historial cifrado para `userPub`.
5. Compu y cel → misma identidad → **mismo historial**. ✅ R2.

**Cambio de contraseña (sé la actual)**
1. Cliente ya tiene `userPriv` en memoria.
2. Deriva `pwKey'` con la nueva password + nuevo salt.
3. Re-cifra `identity_enc_pw'` y lo sube. **La identidad NO cambia** → historial intacto. ✅ R1.

**Reset / recovery (olvidé la contraseña)**
1. No puede descifrar `identity_enc_pw`. Entra el escrow.
2. El server usa `escrowPriv` para descifrar `identity_enc_escrow` → obtiene `userPriv`.
3. Se entrega `userPriv` al cliente (vía TLS) durante el reset; el cliente deriva la nueva `pwKey` y re-cifra `identity_enc_pw`.
4. Usuario recupera identidad + nueva password. **Historial intacto.** ✅ R1.
5. **Cada uso del escrow se audita obligatoriamente.**

### 3.3 Envío y recepción (cambio de "por device" a "por usuario")

- Envío: cifrar el plaintext una vez **por cada USUARIO** miembro (su `userPub`), no por device.
- `message_envelopes`: `recipient_device` → `recipient_user`.
- Recepción: `LEFT JOIN ON recipient_user = mi_user`. Cualquier device del usuario descifra el mismo envelope.
- **Elimina el backfill** (Fase 23b) — ya no hace falta: todos los devices del usuario comparten llave.
- Fan-out simplificado: 1 envelope por usuario vs N por devices.

---

## 4. Decisiones de diseño que requieren confirmación

### D1 — ¿Dónde vive la llave privada de escrow?

| Opción | Recovery | E2EE en operación normal | Fricción |
|---|---|---|---|
| **A. En el server, cifrada con MASTER_ENC_KEY** | Self-service fluido (TOTP, sin admin) | ⚠️ El server PUEDE leer todo siempre (con audit) | Baja |
| **B. Offline (caja fuerte), admin la ingresa en recovery** | Requiere admin + llave física cada vez | ✅ Server NO puede leer normalmente | Alta |

- "Se les olvida mucho" → recovery frecuente → **A** es operacionalmente más práctica.
- Pero **A** relaja más el E2EE (el server puede leer siempre, no solo en recovery).
- **Recomendación:** **A** para uso fluido + respaldo offline en caja fuerte para *disaster recovery* (si el server o el MASTER_ENC_KEY se pierden). Coherente con "se les olvida seguido".
- **Decisión del cliente pendiente.**

### D2 — Envelope por usuario (confirmar el cambio profundo)

- Confirmar que pasamos de `recipient_device` a `recipient_user`. Simplifica todo pero toca el corazón de la mensajería.
- Afecta ADR-009 (adjuntos restringidos): el split allowed/no-allowed pasa de "por device" a "por usuario" (de hecho más simple).

### D3 — Derivación de contraseña en el cliente

| Opción | Fuerza | Dependencia |
|---|---|---|
| **Argon2id** (vía `hash-wasm`, WASM ligero) | Fuerte, coherente con el server | +1 dep WASM |
| **PBKDF2** (WebCrypto nativo) | Más débil | Cero deps |

- **Recomendación:** Argon2id vía `hash-wasm`. Coherente con el hashing de passwords del server.

---

## 5. Esquema de BD (propuesto)

```sql
-- Nueva tabla: identidad de cifrado por usuario
CREATE TABLE user_identities (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  identity_public    BYTEA NOT NULL,         -- userPub (X25519, 32 bytes)
  identity_enc_pw    BYTEA NOT NULL,         -- secretbox(userPriv, Argon2id(pw))
  pw_salt            BYTEA NOT NULL,          -- salt para derivar pwKey
  identity_enc_escrow BYTEA NOT NULL,        -- sealedBox(userPriv, escrowPub)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Llave de escrow de la organización (una fila)
CREATE TABLE org_escrow_key (
  id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  escrow_public      BYTEA NOT NULL,
  -- Opción A: privada cifrada con MASTER_ENC_KEY; Opción B: NULL (vive offline)
  escrow_private_enc BYTEA,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cambio en message_envelopes: de recipient_device a recipient_user
-- (corte limpio — ver §6; tabla nueva o ALTER según plan de migración)
--   recipient_user UUID REFERENCES users(id) ON DELETE CASCADE
--   PRIMARY KEY (message_id, recipient_user)

-- Auditoría obligatoria del uso de escrow
-- (usar audit_log existente con action='identity.escrow_recovery')
```

`devices.identity_public_key` queda obsoleta (la identidad ya no es por device). Se puede dejar nullable/deprecada o limpiar en una migración posterior.

---

## 6. Plan de migración (corte limpio — confirmado)

El cliente confirmó: **todo el historial actual es de prueba, se borra.**

1. Truncar `messages`, `message_envelopes`, `message_envelopes_history`, `conversations`, `conversation_members` (data de prueba).
2. Generar el keypair de escrow de la organización una sola vez → guardar `escrow_public` (+ `escrow_private_enc` si Opción A) → respaldar privada offline (caja fuerte + copia personal).
3. Los usuarios existentes regeneran identidad en su próximo login (nuevo enrollment de identidad). Como no hay historial que preservar, es indoloro.

---

## 7. Las 4 preguntas de robustez (en detalle)

**1. Casos edge:**
- Usuarios actuales sin `user_identities` → forzar creación de identidad en el próximo login.
- Dos devices cambiando password casi simultáneo → re-cifrado de `identity_enc_pw` necesita `updated_at` con last-write-wins + re-fetch, o advisory lock.
- Device con `userPriv` cacheado tras cambio de password en otro device → invalidar cache / re-login.
- Usuario añadido a una conversación después de mensajes enviados → no tiene envelopes viejos (igual que hoy, pero ahora consistente por usuario).
- Adjuntos restringidos (ADR-009) → split por usuario en vez de device.

**2. Si algo falla:**
- Pérdida/corrupción de `escrowPriv` = **único punto irrecuperable** → respaldo offline doble obligatorio.
- `hash-wasm` no carga (CSP, red) → fallback a PBKDF2 o bloquear con error claro (no degradar silenciosamente).
- Server cae a mitad de un recovery → la operación debe ser transaccional/idempotente.

**3. Supuestos:**
- El historial de prueba se puede descartar. ✅ confirmado.
- La contraseña tiene entropía suficiente para derivar llave → subir mínimo de 12 a, p.ej., 14-16 chars, o exigir frase.
- TLS protege la entrega transitoria de `userPriv` en recovery.

**4. Cómo lo rompo (adversarial):**
- Admin malicioso usa escrow para leer a todos → **audit log obligatorio** de cada `escrow_recovery` + idealmente **aprobación de 2 admins**.
- Robo del `MASTER_ENC_KEY` (Opción A) → leer todo. Ese secreto se vuelve aún más crítico.
- XSS roba `userPriv` de memoria → mismo riesgo que hoy con la llave de device; CSP estricto sigue siendo la defensa.
- Replay del blob de identidad viejo tras cambio de password → versionar `updated_at` y rechazar blobs viejos.

---

## 8. Plan de implementación por capas

Orden de menor a mayor riesgo, cada capa testeable antes de la siguiente:

1. **Cripto aislada** (`packages/crypto`): agregar `deriveKeyFromPassword` (Argon2id), `secretbox`/`secretboxOpen`, `sealedBox`/`sealedBoxOpen`. Tests de round-trip. **Cero impacto en producción.**
2. **BD + escrow**: migración de tablas, generar keypair de escrow, script de bootstrap del escrow.
3. **Enrollment de identidad**: crear `user_identities` al alta + endpoint para usuarios existentes.
4. **Login**: entregar `identity_enc_pw` + salt, cliente descifra `userPriv`.
5. **Cambio de password**: re-cifrar el blob.
6. **Recovery/reset vía escrow**: el flujo más sensible, con audit log.
7. **Mensajería**: cambiar fan-out y recepción de device→user. Eliminar backfill. **La capa más invasiva.**
8. **Corte limpio**: truncar data de prueba.
9. **Narrativa**: reescribir `/seguridad` ("E2EE con recuperación administrada por la empresa").

---

## 9. Impacto en la narrativa de seguridad

⚠️ Esto **cambia la promesa**. La página `/seguridad` dice hoy "ni el servidor puede leer" y "E2EE real". Con escrow corporativo (especialmente Opción A) eso deja de ser 100% cierto. **Obligatorio** reescribir a algo honesto: *"Cifrado de extremo a extremo con recuperación administrada por la empresa. La organización custodia una llave maestra que permite restaurar el acceso de un empleado; cada uso queda auditado."*

---

**Referencias:** ADR-040 (decisión), ADR-041 (filosofía DLP relacionada), ADR-006/007 (modelo E2EE actual que esto reemplaza), ADR-009 (adjuntos restringidos, a adaptar).
