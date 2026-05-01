-- Fase 19: Suscripciones de Web Push por dispositivo
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  device_id  UUID        NOT NULL REFERENCES devices(id)  ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
